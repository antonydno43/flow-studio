/**
 * Workflow + plan service layer. All ownership checks resolve the workspace
 * from the authenticated session - never from client input.
 */
import { db } from "@/lib/db";
import { PLANS, DEFAULT_PLAN, type Plan, type PlanId } from "@/config/branding";
import { ApiError } from "@/lib/api";
import type { WorkflowGraph } from "@/core/types";

export function getPlan(planId: string | null | undefined): Plan {
  return PLANS[(planId as PlanId) ?? DEFAULT_PLAN] ?? PLANS.free;
}

export async function getOwnedWorkflow(workflowId: string, workspaceId: string) {
  const workflow = await db.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow || workflow.workspaceId !== workspaceId) {
    throw new ApiError(404, "NOT_FOUND", "Workflow not found");
  }
  return workflow;
}

export async function getOwnedExecution(executionId: string, workspaceId: string) {
  const execution = await db.execution.findUnique({ where: { id: executionId } });
  if (!execution || execution.workspaceId !== workspaceId) {
    throw new ApiError(404, "NOT_FOUND", "Execution not found");
  }
  return execution;
}

export async function getOwnedConnection(connectionId: string, workspaceId: string) {
  const connection = await db.connection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.workspaceId !== workspaceId) {
    throw new ApiError(404, "NOT_FOUND", "Connection not found");
  }
  return connection;
}

// --- Plan quota enforcement (server-side, cannot be bypassed client-side) ---

export async function assertWorkflowQuota(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const plan = getPlan(workspace?.planId);
  const count = await db.workflow.count({
    where: { workspaceId, status: { not: "archived" } },
  });
  if (count >= plan.limits.maxWorkflows) {
    throw new ApiError(403, "PLAN_LIMIT", `Your ${plan.name} plan allows ${plan.limits.maxWorkflows} workflows. Upgrade to create more.`, {
      limit: plan.limits.maxWorkflows,
      plan: plan.id,
    });
  }
}

export async function assertConnectionQuota(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const plan = getPlan(workspace?.planId);
  const count = await db.connection.count({ where: { workspaceId } });
  if (count >= plan.limits.maxConnections) {
    throw new ApiError(403, "PLAN_LIMIT", `Your ${plan.name} plan allows ${plan.limits.maxConnections} connections. Upgrade to add more.`, {
      limit: plan.limits.maxConnections,
      plan: plan.id,
    });
  }
}

export async function assertExecutionQuota(workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  const plan = getPlan(workspace?.planId);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await db.usageRecord.findUnique({
    where: { workspaceId_periodStart: { workspaceId, periodStart } },
  });
  if ((usage?.executionCount ?? 0) >= plan.limits.maxExecutionsPerMonth) {
    throw new ApiError(403, "PLAN_LIMIT", `You reached the ${plan.limits.maxExecutionsPerMonth.toLocaleString()} executions/month limit of the ${plan.name} plan.`, {
      limit: plan.limits.maxExecutionsPerMonth,
      plan: plan.id,
    });
  }
  const active = await db.execution.count({
    where: { workspaceId, status: { in: ["queued", "running", "waiting"] } },
  });
  if (active >= plan.limits.maxConcurrentRuns) {
    throw new ApiError(429, "CONCURRENCY_LIMIT", `You already have ${active} execution(s) in progress. The ${plan.name} plan allows ${plan.limits.maxConcurrentRuns} concurrent run(s).`);
  }
}

export function assertScheduleInterval(workspaceId: string | undefined, intervalMinutes: number, planId: string | null) {
  void workspaceId;
  const plan = getPlan(planId);
  if (intervalMinutes < plan.limits.minScheduleIntervalMinutes) {
    throw new ApiError(403, "PLAN_LIMIT",
      `Schedules must run at least every ${plan.limits.minScheduleIntervalMinutes} minutes on the ${plan.name} plan. Upgrade for more frequent scheduling.`, {
        intervalMinutes,
        requiredMinutes: plan.limits.minScheduleIntervalMinutes,
      });
  }
}

// --- Version management ---

export async function ensureDraftVersion(workflowId: string, graph?: WorkflowGraph) {
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!workflow) throw new ApiError(404, "NOT_FOUND", "Workflow not found");
  if (workflow.currentDraftVersionId) {
    if (graph) {
      await db.workflowVersion.update({
        where: { id: workflow.currentDraftVersionId },
        data: { graphDefinition: JSON.stringify(graph) },
      });
    }
    return workflow.currentDraftVersionId;
  }
  const nextVersion = (workflow.versions[0]?.versionNumber ?? 0) + 1;
  const version = await db.workflowVersion.create({
    data: {
      workflowId,
      versionNumber: nextVersion,
      graphDefinition: JSON.stringify(graph ?? { nodes: [], edges: [] }),
    },
  });
  await db.workflow.update({
    where: { id: workflowId },
    data: { currentDraftVersionId: version.id },
  });
  return version.id;
}

export async function publishVersion(workflowId: string) {
  const workflow = await db.workflow.findUnique({
    where: { id: workflowId },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  if (!workflow) throw new ApiError(404, "NOT_FOUND", "Workflow not found");
  const draftId = workflow.currentDraftVersionId;
  if (!draftId) throw new ApiError(400, "NO_DRAFT", "Nothing to publish - the workflow is empty.");
  const draft = await db.workflowVersion.findUnique({ where: { id: draftId } });
  if (!draft) throw new ApiError(400, "NO_DRAFT", "Draft version not found.");
  if (workflow.publishedVersionId === draftId) {
    return draftId; // already published as-is
  }
  const nextVersion = (workflow.versions[0]?.versionNumber ?? 0) + 1;
  const published = await db.workflowVersion.create({
    data: {
      workflowId,
      versionNumber: nextVersion,
      graphDefinition: draft.graphDefinition,
      isActive: true,
      publishedAt: new Date(),
    },
  });
  await db.workflow.update({
    where: { id: workflowId },
    data: { publishedVersionId: published.id, currentDraftVersionId: published.id },
  });
  return published.id;
}
