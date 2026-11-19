import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError, enforceRateLimit } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { getNodeDefinition } from "@/core/nodes/registry";
import { loadConnectionsMap } from "@/core/engine/executor";
import { resolveTemplate } from "@/core/expression/engine";
import type { ExpressionContextData, GraphNode } from "@/core/types";

const testSchema = z.object({
  nodeId: z.string().min(1),
  input: z.any().optional(),
  triggerSample: z.any().optional(),
});

/** Executes a single node with a provided test input and returns its output. */
export const POST = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  enforceRateLimit(req, `testnode:${user.id}`, 30, 60_000);
  const body = await parseBody(req, testSchema);
  const workflow = await getOwnedWorkflow(id, workspace.id);

  const versionId = workflow.currentDraftVersionId || workflow.publishedVersionId;
  if (!versionId) throw new ApiError(400, "EMPTY", "Workflow has no version to test against.");
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found.");
  const graph = JSON.parse(version.graphDefinition) as { nodes: GraphNode[]; edges: unknown[] };
  const node = graph.nodes.find((n) => n.id === body.nodeId);
  if (!node) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found in the workflow.");
  const def = getNodeDefinition(node.type);
  if (!def) throw new ApiError(400, "UNKNOWN_NODE_TYPE", `Unknown node type ${node.type}`);

  const connections = await loadConnectionsMap(workspace.id);
  const ctxData: ExpressionContextData = {
    trigger: body.triggerSample ?? null,
    vars: {},
    nodeOutputs: {},
    execution: {
      id: "test-node",
      workflowId: id,
      workspaceId: workspace.id,
      startedAt: new Date().toISOString(),
      timezone: workspace.timezone,
      triggerType: "manual",
    },
  };

  const config = { ...def.defaultConfig, ...(node.config || {}) };
  try {
    const result = await def.execute(
      {
        executionId: "test-node",
        nodeId: node.id,
        nodeType: node.type,
        resolve: (t: string) => {
          const r = resolveTemplate(t, ctxData);
          if (!r.ok) throw new Error(r.error);
          return r.value;
        },
        evaluate: (e: string) => {
          const r = resolveTemplate(`{{ ${e} }}`, ctxData);
          if (!r.ok) throw new Error(r.error);
          return r.value;
        },
        ctx: ctxData,
        getConnection: (cid: string) => connections.get(cid) ?? null,
        log: () => {},
        now: () => new Date(),
      },
      config,
      body.input ?? null
    );
    return ok({ result });
  } catch (err) {
    return ok({
      result: { status: "failed", error: { message: (err as Error).message } },
    });
  }
});
