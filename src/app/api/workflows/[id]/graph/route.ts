import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { parseGraph } from "@/core/graph/validator";

/** Returns the current draft (or published) graph for the editor. */
export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  const versionId = workflow.currentDraftVersionId || workflow.publishedVersionId;
  if (!versionId) return ok({ graph: { nodes: [], edges: [] } });
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found");
  try {
    const graph = parseGraph(version.graphDefinition);
    return ok({ graph });
  } catch {
    return ok({ graph: { nodes: [], edges: [] } });
  }
});
