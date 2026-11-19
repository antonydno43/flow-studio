import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";

export const GET = handler(async (_req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const schedules = await db.schedule.findMany({
    where: { workspaceId: workspace.id },
    include: { workflow: { select: { id: true, name: true, status: true } } },
    orderBy: { nextRunAt: "asc" },
  });
  return ok({
    schedules: schedules.map((s) => ({
      id: s.id,
      workflowId: s.workflowId,
      workflowName: s.workflow.name,
      workflowStatus: s.workflow.status,
      cronExpression: s.cronExpression,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      enabled: s.enabled,
      lastDispatchStatus: s.lastDispatchStatus,
      lastDispatchAt: s.lastDispatchAt,
    })),
  });
});
