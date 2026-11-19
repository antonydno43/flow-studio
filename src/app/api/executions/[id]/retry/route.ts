import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError, enforceRateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedExecution, assertExecutionQuota } from "@/lib/workflow-service";
import { createExecution, runExecution } from "@/core/engine/executor";

const schema = z.object({ mode: z.enum(["retry", "replay"]).default("retry") });

/**
 * Retry / replay: creates a NEW execution from the original's trigger data and
 * workflow version (immutable snapshot), then runs it.
 */
export const POST = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  enforceRateLimit(req, `retry:${user.id}`, 20, 60_000);
  await parseBody(req, schema);
  await assertExecutionQuota(workspace.id);

  const execution = await getOwnedExecution(id, workspace.id);
  const triggerData = execution.triggerData ? JSON.parse(execution.triggerData) : null;

  const newExecution = await createExecution({
    workspaceId: workspace.id,
    workflowId: execution.workflowId,
    workflowVersionId: execution.workflowVersionId,
    triggerType: execution.triggerType === "schedule" ? "schedule" : "retry",
    triggerData,
    testMode: execution.testMode,
  });
  const result = await runExecution(newExecution.id);
  return ok({ executionId: newExecution.id, status: result.status, error: result.error ?? null });
});
