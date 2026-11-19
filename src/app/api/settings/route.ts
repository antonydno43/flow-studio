import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getPlan } from "@/lib/workflow-service";
import { syncScheduleForWorkflow } from "@/core/engine/scheduler";
import { z } from "zod";
import { parseBody } from "@/lib/api";

const patchSchema = z.object({
  fullName: z.string().min(2).max(80).optional(),
  timezone: z.string().min(1).max(60).optional(),
  workspaceName: z.string().min(2).max(60).optional(),
  workspaceTimezone: z.string().min(1).max(60).optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const { user, workspace } = await requireWorkspace();
  const body = await parseBody(req, patchSchema);

  if (body.fullName !== undefined || body.timezone !== undefined) {
    await db.user.update({
      where: { id: user.id },
      data: {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      },
    });
  }
  if (body.workspaceName !== undefined || body.workspaceTimezone !== undefined) {
    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        ...(body.workspaceName !== undefined ? { name: body.workspaceName } : {}),
        ...(body.workspaceTimezone !== undefined ? { timezone: body.workspaceTimezone } : {}),
      },
    });
    // timezone changes re-sync schedule next-run times
    const workflows = await db.workflow.findMany({ where: { workspaceId: workspace.id, status: "active" } });
    for (const wf of workflows) await syncScheduleForWorkflow(wf.id);
  }
  return ok({ updated: true });
});

export const GET = handler(async () => {
  const { workspace } = await requireWorkspace();
  const [sessionCount, plan] = await Promise.all([
    db.session.count({ where: { userId: workspace.ownerId } }),
    getPlan(workspace.planId),
  ]);
  return ok({
    settings: {
      timezone: workspace.timezone,
      sessionCount,
      plan: { id: plan.id, name: plan.name, limits: plan.limits },
    },
  });
});

export const DELETE = handler(async () => {
  const { user, workspace } = await requireWorkspace();
  const { destroySession } = await import("@/lib/auth");
  // Cascades remove workspace, workflows, executions, connections, credentials
  await db.user.delete({ where: { id: user.id } });
  await destroySession();
  void ApiError;
  return ok({ deleted: true });
});
