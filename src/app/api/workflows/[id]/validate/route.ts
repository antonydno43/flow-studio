import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { validateGraph, parseGraph } from "@/core/graph/validator";
import { db } from "@/lib/db";

/** Validates the DRAFT graph (or published graph when ?version=published). */
export const POST = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);

  const url = new URL(req.url);
  const which = url.searchParams.get("version") || "draft";
  const versionId = which === "published" ? workflow.publishedVersionId : workflow.currentDraftVersionId;
  if (!versionId) {
    return ok({ validation: { valid: false, errors: [{ code: "EMPTY_WORKFLOW", message: "The workflow is empty. Open the editor to add nodes." }], warnings: [] } });
  }
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");

  let graph;
  try {
    graph = parseGraph(version.graphDefinition);
  } catch (err) {
    return ok({
      validation: {
        valid: false,
        errors: [{ code: "INVALID_GRAPH", message: (err as Error).message }],
        warnings: [],
      },
    });
  }
  const validation = validateGraph(graph);
  await db.workflowVersion.update({
    where: { id: versionId },
    data: { validationResult: JSON.stringify(validation) },
  });
  return ok({ validation });
});
