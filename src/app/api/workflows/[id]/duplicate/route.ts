import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow, assertWorkflowQuota, ensureDraftVersion } from "@/lib/workflow-service";

export const POST = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  await assertWorkflowQuota(workspace.id);

  const copy = await db.workflow.create({
    data: {
      workspaceId: workspace.id,
      name: `${workflow.name} (copy)`,
      description: workflow.description,
      status: "draft", // duplicates always start as drafts
      folderId: workflow.folderId,
    },
  });
  // Copy graph from the source's draft (or published) version
  const sourceVersionId = workflow.currentDraftVersionId || workflow.publishedVersionId;
  let graphDef = JSON.stringify({ nodes: [], edges: [] });
  if (sourceVersionId) {
    const source = await db.workflowVersion.findUnique({ where: { id: sourceVersionId } });
    if (source) graphDef = source.graphDefinition;
  }
  const draftId = await ensureDraftVersion(copy.id);
  await db.workflowVersion.update({ where: { id: draftId }, data: { graphDefinition: graphDef } });
  return ok({ workflow: { ...copy, currentDraftVersionId: draftId } }, 201);
});
