/**
 * Central schedule dispatcher.
 *
 * A single dispatcher (invoked by cronjob.org every minute on
 * /api/cron/dispatch) claims due schedules atomically, creates executions
 * from the published workflow versions, and resumes waiting executions.
 * This avoids per-customer cron jobs entirely.
 */
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { createExecution, runExecution, logEvent } from "./executor";
import type { GraphNode } from "@/core/types";

export function computeNextRun(cronExpression: string, timezone: string, from = new Date()): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}

export function isValidCron(cronExpression: string): boolean {
  try {
    CronExpressionParser.parse(cronExpression);
    return true;
  } catch {
    return false;
  }
}

/** Smallest interval (minutes) between the next 2 runs - for plan gating. */
export function cronIntervalMinutes(cronExpression: string, timezone: string): number | null {
  try {
    const first = computeNextRun(cronExpression, timezone);
    const second = computeNextRun(cronExpression, timezone, first);
    return Math.max(1, Math.round((second.getTime() - first.getTime()) / 60000));
  } catch {
    return null;
  }
}

/** Build a cron expression from schedule trigger config. */
export function scheduleConfigToCron(config: Record<string, unknown>): string | null {
  const mode = String(config.mode || "daily");
  const num = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(59, Math.trunc(n))) : d;
  };
  switch (mode) {
    case "minutes": {
      // "Every N minutes" is an interval, not a minute-of-hour - no 0-59 clamp
      const raw = Number(config.minutes);
      const m = Number.isFinite(raw) ? Math.max(1, Math.min(1440, Math.trunc(raw))) : 60;
      if (m >= 60) return `0 * * * *`;
      return `*/${m} * * * *`;
    }
    case "hourly":
      return `${num(config.minute, 0)} * * * *`;
    case "daily":
      return `${num(config.minute, 0)} ${num(config.hour, 9)} * * *`;
    case "weekly":
      return `${num(config.weekMinute, 0)} ${num(config.weekHour, 9)} * * ${num(config.dayOfWeek, 1)}`;
    case "monthly":
      return `${num(config.monthMinute, 0)} ${num(config.monthHour, 9)} ${Math.max(1, num(config.monthDay, 1))} * *`;
    case "custom":
      return String(config.cronExpression || "").trim() || null;
    default:
      return null;
  }
}

export interface DispatchResult {
  claimed: number;
  started: number;
  failed: number;
  resumed: number;
  errors: string[];
}

/**
 * Claim due schedules atomically and dispatch executions.
 * Uses a transaction with a conditional update to prevent double claims.
 */
export async function dispatchDueSchedules(): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, started: 0, failed: 0, resumed: 0, errors: [] };
  const now = new Date();

  const due = await db.schedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { workflow: true },
    take: 25,
  });

  for (const schedule of due) {
    // Atomic claim: only proceed if nextRunAt is still the claimed value
    const claimed = await db.schedule.updateMany({
      where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
      data: {
        nextRunAt: computeNextRun(schedule.cronExpression, schedule.timezone, schedule.nextRunAt),
        lastRunAt: now,
        lastDispatchAt: now,
        lastDispatchStatus: "dispatched",
      },
    });
    if (claimed.count === 0) continue; // another dispatcher instance won
    result.claimed++;

    try {
      const execution = await createExecution({
        workspaceId: schedule.workspaceId,
        workflowId: schedule.workflowId,
        workflowVersionId: schedule.workflowVersionId,
        triggerType: "schedule",
        triggerData: {
          scheduledAt: schedule.nextRunAt.toISOString(),
          timezone: schedule.timezone,
          cron: schedule.cronExpression,
        },
      });
      const execResult = await runExecution(execution.id);
      if (["failed"].includes(execResult.status)) result.failed++;
      else result.started++;
      await db.schedule.update({
        where: { id: schedule.id },
        data: { lastDispatchStatus: `execution_${execResult.status}` },
      });
    } catch (err) {
      result.failed++;
      result.errors.push(`Schedule ${schedule.id}: ${(err as Error).message}`);
      await db.schedule.update({
        where: { id: schedule.id },
        data: { lastDispatchStatus: `error: ${(err as Error).message.slice(0, 180)}` },
      }).catch(() => {});
    }
  }

  // Resume waiting executions whose wait has elapsed
  const waiting = await db.execution.findMany({
    where: { status: "waiting", waitUntil: { lte: now } },
    take: 25,
  });
  for (const execution of waiting) {
    try {
      await runExecution(execution.id);
      result.resumed++;
    } catch (err) {
      result.errors.push(`Resume ${execution.id}: ${(err as Error).message}`);
    }
  }

  return result;
}

/**
 * Sync schedule rows for a workflow after publish/activate/deactivate.
 * Reads the published graph's schedule trigger node.
 */
export async function syncScheduleForWorkflow(workflowId: string): Promise<{ synced: boolean; error?: string }> {
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 5 } },
  });
  if (!workflow || !workflow.publishedVersionId) {
    await db.schedule.deleteMany({ where: { workflowId } });
    return { synced: false };
  }
  const version = workflow.versions.find((v) => v.id === workflow.publishedVersionId);
  if (!version) {
    await db.schedule.deleteMany({ where: { workflowId } });
    return { synced: false };
  }
  let graph: { nodes: GraphNode[] };
  try {
    graph = JSON.parse(version.graphDefinition);
  } catch {
    return { synced: false, error: "Invalid published graph" };
  }
  const trigger = graph.nodes.find(
    (n) => n.type === "trigger-schedule"
  );
  if (!trigger) {
    await db.schedule.deleteMany({ where: { workflowId } });
    return { synced: false };
  }
  const config = trigger.config || {};
  if (config.enabled === false) {
    await db.schedule.updateMany({ where: { workflowId }, data: { enabled: false } });
    return { synced: false };
  }
  const cron = scheduleConfigToCron(config);
  if (!cron || !isValidCron(cron)) {
    return { synced: false, error: "Invalid schedule configuration" };
  }
  const timezone = String(config.timezone || "Asia/Kolkata");
  const nextRunAt = computeNextRun(cron, timezone);
  const existing = await db.schedule.findUnique({ where: { workflowId } });
  if (existing) {
    await db.schedule.update({
      where: { id: existing.id },
      data: { cronExpression: cron, timezone, nextRunAt, enabled: true, workflowVersionId: version.id },
    });
  } else {
    await db.schedule.create({
      data: {
        workspaceId: workflow.workspaceId,
        workflowId,
        workflowVersionId: version.id,
        cronExpression: cron,
        timezone,
        nextRunAt,
        enabled: true,
      },
    });
  }
  return { synced: true };
}
