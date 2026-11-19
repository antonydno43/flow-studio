import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok, parseBody } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { syncScheduleForWorkflow } from "@/core/engine/scheduler";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["draft", "active", "inactive", "archived"]).optional(),
  isFavorite: z.boolean().optional(),
  folderId: z.string().nullable().optional(),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }).optional(),
});

export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  const versions = await db.workflowVersion.findMany({
    where: { workflowId: id },
    orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, createdAt: true, publishedAt: true, isActive: true },
  });
  const executionsCount = await db.execution.count({ where: { workflowId: id } });
  return ok({ workflow, versions, executionsCount });
});

export const PATCH = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);
  const body = await parseBody(req, patchSchema);

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.isFavorite !== undefined) data.isFavorite = body.isFavorite;
  if (body.folderId !== undefined) data.folderId = body.folderId;
  if (body.status !== undefined) data.status = body.status;

  // Saving the graph updates the current draft version only
  if (body.graph) {
    if (workflow.currentDraftVersionId) {
      await db.workflowVersion.update({
        where: { id: workflow.currentDraftVersionId },
        data: { graphDefinition: JSON.stringify(body.graph) },
      });
    } else {
      const latest = await db.workflowVersion.findFirst({
        where: { workflowId: id },
        orderBy: { versionNumber: "desc" },
      });
      const version = await db.workflowVersion.create({
        data: {
          workflowId: id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          graphDefinition: JSON.stringify(body.graph),
        },
      });
      data.currentDraftVersionId = version.id;
    }
  }

  const updated = await db.workflow.update({ where: { id }, data });

  // Status transitions affect schedules
  if (body.status !== undefined && body.status !== "active") {
    await db.schedule.updateMany({ where: { workflowId: id }, data: { enabled: false } });
  } else if (body.status === "active") {
    await syncScheduleForWorkflow(id);
  }

  return ok({ workflow: updated });
});

export const DELETE = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await getOwnedWorkflow(id, workspace.id);
  // Cascade removes versions, executions, steps, events, schedules, webhook endpoints
  await db.workflow.delete({ where: { id } });
  await db.auditLog.create({
    data: { workspaceId: workspace.id, action: "workflow.delete", entityType: "workflow", entityId: id },
  });
  return ok({ deleted: true });
});
