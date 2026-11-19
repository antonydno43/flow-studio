import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow, publishVersion, getPlan } from "@/lib/workflow-service";
import { validateGraph, parseGraph } from "@/core/graph/validator";
import { syncScheduleForWorkflow, scheduleConfigToCron, cronIntervalMinutes } from "@/core/engine/scheduler";

/**
 * Activate: validate the draft, publish an immutable version, and set active.
 * Schedule triggers are gated by the plan's minimum interval.
 */
export const POST = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);

  if (!workflow.currentDraftVersionId) {
    throw new ApiError(400, "EMPTY_WORKFLOW", "Add at least a trigger node before activating.");
  }
  const draft = await db.workflowVersion.findUnique({ where: { id: workflow.currentDraftVersionId } });
  if (!draft) throw new ApiError(400, "NO_DRAFT", "Draft version missing.");

  let graph;
  try {
    graph = parseGraph(draft.graphDefinition);
  } catch (err) {
    throw new ApiError(400, "INVALID_GRAPH", (err as Error).message);
  }
  const validation = validateGraph(graph);
  await db.workflowVersion.update({
    where: { id: draft.id },
    data: { validationResult: JSON.stringify(validation) },
  });
  if (!validation.valid) {
    return ok({ activated: false, validation }, 200);
  }

  // Plan gating for schedule precision
  const scheduleTrigger = graph.nodes.find((n) => n.type === "trigger-schedule");
  if (scheduleTrigger) {
    const cron = scheduleConfigToCron(scheduleTrigger.config || {});
    if (cron) {
      const tz = String(scheduleTrigger.config?.timezone || workspace.timezone || "Asia/Kolkata");
      const interval = cronIntervalMinutes(cron, tz);
      if (interval !== null) {
        const plan = getPlan(workspace.planId);
        if (interval < plan.limits.minScheduleIntervalMinutes) {
          throw new ApiError(403, "PLAN_LIMIT",
            `This schedule runs every ${interval} minute(s). The ${plan.name} plan requires at least ${plan.limits.minScheduleIntervalMinutes} minutes between runs. Upgrade your plan for more frequent schedules.`);
        }
      }
    }
  }

  const publishedId = await publishVersion(id);
  await db.workflow.update({ where: { id }, data: { status: "active" } });
  await syncScheduleForWorkflow(id);
  await db.auditLog.create({
    data: { workspaceId: workspace.id, action: "workflow.activate", entityType: "workflow", entityId: id },
  });
  return ok({ activated: true, publishedVersionId: publishedId, validation });
});
