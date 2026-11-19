import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { syncScheduleForWorkflow } from "@/core/engine/scheduler";

export const POST = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await getOwnedWorkflow(id, workspace.id);
  await db.workflow.update({ where: { id }, data: { status: "inactive" } });
  await db.schedule.updateMany({ where: { workflowId: id }, data: { enabled: false } });
  void syncScheduleForWorkflow;
  return ok({ deactivated: true });
});
