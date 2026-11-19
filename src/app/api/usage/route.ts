import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getPlan } from "@/lib/workflow-service";
import { PLANS } from "@/config/branding";

export const GET = handler(async () => {
  const { workspace } = await requireWorkspace();
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [usage, workflowCount, connectionCount, subscription] = await Promise.all([
    db.usageRecord.findUnique({ where: { workspaceId_periodStart: { workspaceId: workspace.id, periodStart } } }),
    db.workflow.count({ where: { workspaceId: workspace.id, status: { not: "archived" } } }),
    db.connection.count({ where: { workspaceId: workspace.id } }),
    db.subscription.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  const plan = getPlan(workspace.planId);
  return ok({
    period: { start: periodStart, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) },
    usage: {
      executions: usage?.executionCount ?? 0,
      nodeOperations: usage?.nodeOperationCount ?? 0,
      workflows: workflowCount,
      connections: connectionCount,
    },
    limits: plan.limits,
    plan: { id: plan.id, name: plan.name },
    subscription,
  });
});

void PLANS;
