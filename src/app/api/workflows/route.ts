import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok, parseBody } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth";
import { assertWorkflowQuota, ensureDraftVersion } from "@/lib/workflow-service";
import type { WorkflowGraph } from "@/core/types";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  graph: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
  }).optional(),
});

export const GET = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const search = url.searchParams.get("search") || undefined;

  const workflows = await db.workflow.findMany({
    where: {
      workspaceId: workspace.id,
      ...(status && status !== "all" ? { status } : { status: { not: "archived" } }),
      ...(search ? { name: { contains: search } } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  // Enrich with last execution info
  const enriched = await Promise.all(
    workflows.map(async (wf) => {
      const lastExecution = await db.execution.findFirst({
        where: { workflowId: wf.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, createdAt: true, triggerType: true },
      });
      const executionCount = await db.execution.count({ where: { workflowId: wf.id } });
      return {
        ...wf,
        currentDraftVersionId: wf.currentDraftVersionId,
        publishedVersionId: wf.publishedVersionId,
        lastExecution,
        executionCount,
      };
    })
  );

  return ok({ workflows: enriched });
});

export const POST = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  await assertWorkflowQuota(workspace.id);
  const body = await parseBody(req, createSchema);

  const workflow = await db.workflow.create({
    data: {
      workspaceId: workspace.id,
      name: body.name,
      description: body.description,
      status: "draft",
    },
  });
  const draftVersionId = await ensureDraftVersion(
    workflow.id,
    body.graph as WorkflowGraph | undefined
  );
  await db.auditLog.create({
    data: { workspaceId: workspace.id, action: "workflow.create", entityType: "workflow", entityId: workflow.id },
  });
  return ok({ workflow: { ...workflow, currentDraftVersionId: draftVersionId } }, 201);
});
