import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";

const restoreSchema = z.object({ versionId: z.string().min(1) });

/** Restore a previous version as the new draft. */
export const POST = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  const body = await parseBody(req, restoreSchema);

  const version = await db.workflowVersion.findUnique({ where: { id: body.versionId } });
  if (!version || version.workflowId !== id) {
    throw new ApiError(404, "NOT_FOUND", "Version not found for this workflow.");
  }

  const latest = await db.workflowVersion.findFirst({
    where: { workflowId: id },
    orderBy: { versionNumber: "desc" },
  });
  const restored = await db.workflowVersion.create({
    data: {
      workflowId: id,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      graphDefinition: version.graphDefinition,
      // note: restoring creates a new draft from the old snapshot
    },
  });
  await db.workflow.update({
    where: { id },
    data: { currentDraftVersionId: restored.id },
  });
  return ok({ restored: true, draftVersionId: restored.id, versionNumber: restored.versionNumber });
});

/** GET: version history with summaries. */
export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  const versions = await db.workflowVersion.findMany({
    where: { workflowId: id },
    orderBy: { versionNumber: "desc" },
  });
  return ok({
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      createdAt: v.createdAt,
      publishedAt: v.publishedAt,
      isActive: v.isActive,
      isDraft: v.id === workflow.currentDraftVersionId,
      isPublished: v.id === workflow.publishedVersionId,
      nodeCount: (() => {
        try { return (JSON.parse(v.graphDefinition) as { nodes: unknown[] }).nodes.length; }
        catch { return 0; }
      })(),
    })),
  });
});
