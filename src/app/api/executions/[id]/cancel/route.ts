import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedExecution } from "@/lib/workflow-service";
import { logEvent } from "@/core/engine/executor";

export const POST = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const execution = await getOwnedExecution(id, workspace.id);

  if (!["queued", "running", "waiting"].includes(execution.status)) {
    throw new ApiError(400, "NOT_CANCELLABLE", `Execution is already ${execution.status}.`);
  }
  await db.execution.update({ where: { id }, data: { cancelRequested: true } });
  await logEvent(id, null, "info", "cancel_requested", "Cancellation requested by user");
  return ok({ cancelling: true });
});
