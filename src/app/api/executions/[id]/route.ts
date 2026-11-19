import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedExecution } from "@/lib/workflow-service";
import { runExecution } from "@/core/engine/executor";

export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const execution = await getOwnedExecution(id, workspace.id);

  // Opportunistic durable-resume: if this execution is waiting and the wait
  // has elapsed, continue it now (the cron dispatcher also does this).
  if (execution.status === "waiting" && execution.waitUntil && execution.waitUntil <= new Date()) {
    await runExecution(execution.id).catch(() => {});
  }

  const [fresh, steps, events, workflow] = await Promise.all([
    db.execution.findUnique({ where: { id } }),
    db.executionStep.findMany({ where: { executionId: id }, orderBy: { startedAt: "asc" } }),
    db.executionEvent.findMany({
      where: { executionId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.workflow.findUnique({ where: { id: execution.workflowId }, select: { name: true } }),
  ]);
  if (!fresh) throw new ApiError(404, "NOT_FOUND", "Execution not found");

  return ok({
    execution: {
      ...fresh,
      triggerData: fresh.triggerData ? JSON.parse(fresh.triggerData) : null,
      error: fresh.error ? JSON.parse(fresh.error) : null,
      workflowName: workflow?.name,
    },
    steps: steps.map((s) => ({
      ...s,
      inputData: s.inputData ? JSON.parse(s.inputData) : null,
      outputData: s.outputData ? JSON.parse(s.outputData) : null,
      error: s.error ? JSON.parse(s.error) : null,
    })),
    events: events.map((e) => ({ ...e, metadata: e.metadata ? JSON.parse(e.metadata) : null })),
  });
});
