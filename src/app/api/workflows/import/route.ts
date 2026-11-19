import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { assertWorkflowQuota, ensureDraftVersion } from "@/lib/workflow-service";
import { validateGraph } from "@/core/graph/validator";
import { getNodeDefinition } from "@/core/nodes/registry";
import { generatePublicId } from "@/lib/crypto";
import type { GraphEdge, GraphNode, WorkflowGraph } from "@/core/types";

const importSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  payload: z.object({
    format: z.string().optional(),
    graph: z.object({
      nodes: z.array(z.any()),
      edges: z.array(z.any()),
    }),
  }),
});

/** Import a portable workflow JSON: validate node types, regenerate ids, strip credentials. */
export const POST = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  await assertWorkflowQuota(workspace.id);
  const body = await parseBody(req, importSchema);

  const rawNodes = body.payload.graph.nodes as Record<string, unknown>[];
  const rawEdges = body.payload.graph.edges as Record<string, unknown>[];

  // structural validation + id remapping
  const idMap = new Map<string, string>();
  const nodes: GraphNode[] = [];
  const unknownTypes: string[] = [];
  for (const raw of rawNodes) {
    const type = String(raw.type || "");
    const def = getNodeDefinition(type);
    if (!def) { unknownTypes.push(type); continue; }
    const oldId = String(raw.id || generatePublicId("n"));
    const newId = generatePublicId("n");
    idMap.set(oldId, newId);
    nodes.push({
      id: newId,
      type,
      name: String(raw.name || def.name),
      position: {
        x: Number((raw.position as { x?: number })?.x ?? 0),
        y: Number((raw.position as { y?: number })?.y ?? 0),
      },
      config: { ...def.defaultConfig, ...((raw.config as Record<string, unknown>) || {}), connection: "" },
    });
  }
  const edges: GraphEdge[] = [];
  for (const raw of rawEdges) {
    const source = idMap.get(String(raw.source || ""));
    const target = idMap.get(String(raw.target || ""));
    if (!source || !target) continue; // drop edges referencing unknown nodes
    const sourcePort = String(raw.sourcePort || "out");
    edges.push({ id: generatePublicId("e"), source, sourcePort, target });
  }

  const graph: WorkflowGraph = { nodes, edges };
  const validation = validateGraph(graph);

  const workflow = await db.workflow.create({
    data: {
      workspaceId: workspace.id,
      name: body.name || "Imported workflow",
      description: "Imported workflow",
      status: "draft",
    },
  });
  const draftId = await ensureDraftVersion(workflow.id, graph);

  if (unknownTypes.length) {
    throw new ApiError(400, "UNKNOWN_NODE_TYPES",
      `The import file contains unsupported node types: ${[...new Set(unknownTypes)].join(", ")}. They were not imported.`, { unknownTypes });
  }

  return ok({ workflow: { ...workflow, currentDraftVersionId: draftId }, validation }, 201);
});
