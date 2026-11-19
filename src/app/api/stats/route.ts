import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getPlan } from "@/lib/workflow-service";

/** Dashboard statistics computed from real database records. */
export const GET = handler(async () => {
  const { workspace } = await requireWorkspace();

  const [
    totalWorkflows, activeWorkflows, inactiveWorkflows, totalExecutions,
    succeededExecutions, failedExecutions, runningExecutions,
    favoriteWorkflows, recentWorkflows, recentExecutions, connections, usage,
  ] = await Promise.all([
    db.workflow.count({ where: { workspaceId: workspace.id, status: { not: "archived" } } }),
    db.workflow.count({ where: { workspaceId: workspace.id, status: "active" } }),
    db.workflow.count({ where: { workspaceId: workspace.id, status: { in: ["inactive", "draft"] } } }),
    db.execution.count({ where: { workspaceId: workspace.id } }),
    db.execution.count({ where: { workspaceId: workspace.id, status: "succeeded" } }),
    db.execution.count({ where: { workspaceId: workspace.id, status: "failed" } }),
    db.execution.count({ where: { workspaceId: workspace.id, status: { in: ["running", "waiting", "queued"] } } }),
    db.workflow.findMany({ where: { workspaceId: workspace.id, isFavorite: true }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.workflow.findMany({ where: { workspaceId: workspace.id, status: { not: "archived" } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.execution.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { workflow: { select: { name: true } } },
    }),
    db.connection.findMany({ where: { workspaceId: workspace.id } }),
    (() => {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return db.usageRecord.findUnique({ where: { workspaceId_periodStart: { workspaceId: workspace.id, periodStart } } });
    })(),
  ]);

  // executions per day for the last 14 days
  const since = new Date(Date.now() - 13 * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const executions = await db.execution.findMany({
    where: { workspaceId: workspace.id, createdAt: { gte: since } },
    select: { createdAt: true, status: true },
  });
  const byDay = new Map<string, { total: number; succeeded: number; failed: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    byDay.set(d.toISOString().slice(0, 10), { total: 0, succeeded: 0, failed: 0 });
  }
  for (const e of executions) {
    const key = e.createdAt.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.total++;
      if (e.status === "succeeded") bucket.succeeded++;
      if (e.status === "failed") bucket.failed++;
    }
  }

  const plan = getPlan(workspace.planId);
  const finished = succeededExecutions + failedExecutions;

  return ok({
    stats: {
      totalWorkflows,
      activeWorkflows,
      inactiveWorkflows,
      totalExecutions,
      succeededExecutions,
      failedExecutions,
      runningExecutions,
      successRate: finished > 0 ? Math.round((succeededExecutions / finished) * 100) : null,
    },
    chart: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
    recentWorkflows,
    favoriteWorkflows,
    recentExecutions: recentExecutions.map((e) => ({
      id: e.id,
      workflowName: e.workflow.name,
      status: e.status,
      triggerType: e.triggerType,
      testMode: e.testMode,
      createdAt: e.createdAt,
      durationMs: e.durationMs,
    })),
    connectionsHealth: connections.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      status: c.status,
      lastTestedAt: c.lastTestedAt,
    })),
    usage: {
      executionCount: usage?.executionCount ?? 0,
      nodeOperationCount: usage?.nodeOperationCount ?? 0,
      planName: plan.name,
      planLimits: plan.limits,
    },
  });
});
