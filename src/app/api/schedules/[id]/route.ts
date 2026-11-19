import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { computeNextRun } from "@/core/engine/scheduler";

const patchSchema = z.object({ enabled: z.boolean() });

async function getOwnedSchedule(id: string, workspaceId: string) {
  const schedule = await db.schedule.findUnique({ where: { id } });
  if (!schedule || schedule.workspaceId !== workspaceId) {
    throw new ApiError(404, "NOT_FOUND", "Schedule not found");
  }
  return schedule;
}

export const PATCH = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const schedule = await getOwnedSchedule(id, workspace.id);
  const body = await parseBody(req, patchSchema);

  const data: Record<string, unknown> = { enabled: body.enabled };
  if (body.enabled) {
    // recompute the next run from now (skips missed runs while paused)
    data.nextRunAt = computeNextRun(schedule.cronExpression, schedule.timezone);
  }
  const updated = await db.schedule.update({ where: { id }, data });
  return ok({ schedule: { id: updated.id, enabled: updated.enabled, nextRunAt: updated.nextRunAt } });
});

export const DELETE = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await getOwnedSchedule(id, workspace.id);
  await db.schedule.delete({ where: { id } });
  return ok({ deleted: true });
});
