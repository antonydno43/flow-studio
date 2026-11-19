import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError, enforceRateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow, assertExecutionQuota, ensureDraftVersion } from "@/lib/workflow-service";
import { createExecution, runExecution } from "@/core/engine/executor";
import { validateGraph, parseGraph } from "@/core/graph/validator";
import { getNodeDefinition } from "@/core/nodes/registry";

const runSchema = z.object({
  mode: z.enum(["test", "live"]).default("test"),
  input: z.any().optional(),
});

/**
 * Manual run.
 * - mode=test: executes the current DRAFT (testMode=true, no notifications, no usage notifications)
 * - mode=live: executes the PUBLISHED version of an active workflow
 */
export const POST = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  enforceRateLimit(req, `run:${user.id}`, 30, 60_000);
  const body = await parseBody(req, runSchema);
  await assertExecutionQuota(workspace.id);

  const workflow = await getOwnedWorkflow(id, workspace.id);

  let versionId: string;
  let testMode: boolean;
  if (body.mode === "live") {
    if (workflow.status !== "active" || !workflow.publishedVersionId) {
      throw new ApiError(400, "NOT_ACTIVE",
        "Activate the workflow first - live runs execute the published version of an active workflow.");
    }
    versionId = workflow.publishedVersionId;
    testMode = false;
  } else {
    versionId = await ensureDraftVersion(id);
    testMode = true;
  }

  // Validate before executing (draft or published)
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError(500, "VERSION_MISSING", "Workflow version missing.");
  let graph;
  try {
    graph = parseGraph(version.graphDefinition);
  } catch (err) {
    throw new ApiError(400, "INVALID_GRAPH", (err as Error).message);
  }
  const validation = validateGraph(graph);
  if (!validation.valid) {
    return ok({ ran: false, validation }, 200);
  }

  // Build trigger data depending on trigger type
  const triggerNode = graph.nodes.find((n) => {
    const def = getNodeDefinition(n.type);
    return def?.kind === "trigger";
  });
  const triggerType = triggerNode?.type || "trigger-manual";
  // manual test runs fall back to the trigger node's configured sample input
  let runInput = body.input;
  if (runInput === undefined && triggerType === "trigger-manual" && triggerNode) {
    const sample = triggerNode.config?.sampleInput;
    if (typeof sample === "string" && sample.trim()) {
      try { runInput = JSON.parse(sample); } catch { runInput = sample; }
    }
  }
  let triggerData: unknown = { input: runInput ?? null };
  if (triggerType === "trigger-webhook") {
    // test runs can provide sample body via the trigger node's sampleInput
    let body = runInput ?? null;
    if (body === null && typeof triggerNode?.config?.sampleInput === "string" && triggerNode.config.sampleInput.trim()) {
      try { body = JSON.parse(triggerNode.config.sampleInput); } catch { body = triggerNode.config.sampleInput; }
    }
    triggerData = {
      method: "POST",
      headers: { "x-flow-test": "true" },
      query: {},
      body,
      receivedAt: new Date().toISOString(),
    };
  } else if (triggerType === "trigger-schedule") {
    triggerData = { scheduledAt: new Date().toISOString(), timezone: workspace.timezone, testRun: true };
  }

  const execution = await createExecution({
    workspaceId: workspace.id,
    workflowId: id,
    workflowVersionId: versionId,
    triggerType: "manual",
    triggerData,
    testMode,
  });

  const result = await runExecution(execution.id);
  return ok({
    ran: true,
    executionId: execution.id,
    status: result.status,
    error: result.error ?? null,
  });
});
