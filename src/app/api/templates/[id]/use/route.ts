import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { assertWorkflowQuota, ensureDraftVersion } from "@/lib/workflow-service";
import { TEMPLATES } from "@/core/templates";
import { validateGraph } from "@/core/graph/validator";
import { generatePublicId } from "@/lib/crypto";

/** Instantiate a template as a new editable draft workflow. */
export const POST = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await assertWorkflowQuota(workspace.id);

  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new ApiError(404, "NOT_FOUND", "Template not found.");

  // Regenerate node/edge ids so instances are independent
  const idMap = new Map<string, string>();
  const nodes = template.template.nodes.map((n) => {
    const newId = generatePublicId("n");
    idMap.set(n.id, newId);
    return { ...n, id: newId };
  });
  // Fix expression references to old node ids (t1, a1, ... -> new ids)
  const graph = JSON.parse(JSON.stringify({ nodes, edges: [] })) as typeof template.template;
  graph.nodes = graph.nodes.map((n) => {
    const configStr = JSON.stringify(n.config || {});
    const fixed = configStr.replace(/"(\w+)":/g, (m) => m); // keys untouched
    let parsed;
    try { parsed = JSON.parse(fixed); } catch { parsed = n.config; }
    // replace references like {{ t1. }} / {{ a1.name }} inside string values
    const replaceRefs = (value: unknown): unknown => {
      if (typeof value === "string") {
        return value.replace(/\{\{\s*(\w+)\./g, (m, ref: string) => {
          const mapped = idMap.get(ref);
          return mapped ? `{{ ${mapped}.` : m;
        });
      }
      if (Array.isArray(value)) return value.map(replaceRefs);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceRefs(v)]));
      }
      return value;
    };
    return { ...n, config: replaceRefs(parsed) as Record<string, unknown> };
  });
  graph.edges = template.template.edges.map((e) => ({
    ...e,
    id: generatePublicId("e"),
    source: idMap.get(e.source) || e.source,
    target: idMap.get(e.target) || e.target,
  }));

  const validation = validateGraph(graph);

  const workflow = await db.workflow.create({
    data: {
      workspaceId: workspace.id,
      name: template.name,
      description: template.description,
      status: "draft",
    },
  });
  const draftId = await ensureDraftVersion(workflow.id, graph);

  return ok({
    workflow: { ...workflow, currentDraftVersionId: draftId },
    validation,
    requiredProviders: template.requiredProviders,
    setupNotes: template.requiredProviders.length
      ? `This template needs these connections before it can run: ${template.requiredProviders.join(", ")}. Create them on the Connections page.`
      : null,
  }, 201);
});
