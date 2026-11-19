import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { validateGraph, parseGraph } from "@/core/graph/validator";
import type { WorkflowGraph } from "@/core/types";

/**
 * Portable workflow export. Never includes decrypted credentials - only
 * connection provider references so imports can flag re-configuration.
 */
export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);

  const versionId = workflow.currentDraftVersionId || workflow.publishedVersionId;
  let graph: WorkflowGraph = { nodes: [], edges: [] };
  let versionNumber = 0;
  if (versionId) {
    const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
    if (version) {
      try { graph = parseGraph(version.graphDefinition); } catch { /* empty */ }
      versionNumber = version.versionNumber;
    }
  }
  const validation = validateGraph(graph);

  // strip credential ids, keep provider names for setup hints
  const nodes = graph.nodes.map((n) => ({
    ...n,
    config: Object.fromEntries(
      Object.entries(n.config || {}).map(([k, v]) => {
        if (k === "connection") return [k, ""]; // never export connection references
        return [k, v];
      })
    ),
  }));

  const exportPayload = {
    format: "flow-studio-workflow",
    version: 1,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: workflow.name,
      description: workflow.description,
      versionNumber,
    },
    graph: { nodes, edges: graph.edges },
    validationSummary: {
      valid: validation.valid,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
    },
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${workflow.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.flow.json"`,
    },
  });
});
