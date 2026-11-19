import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";

export const GET = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const workflowId = url.searchParams.get("workflowId");
  const search = url.searchParams.get("search");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const where = {
    workspaceId: workspace.id,
    ...(status !== "all" ? { status } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
      },
    } : {}),
    ...(search ? { OR: [{ id: { contains: search } }, { workflow: { name: { contains: search } } }] } : {}),
  };

  const [executions, total] = await Promise.all([
    db.execution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { workflow: { select: { id: true, name: true } } },
    }),
    db.execution.count({ where }),
  ]);

  return ok({
    executions: executions.map((e) => ({
      id: e.id,
      workflowId: e.workflowId,
      workflowName: e.workflow.name,
      status: e.status,
      triggerType: e.triggerType,
      testMode: e.testMode,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      durationMs: e.durationMs,
      createdAt: e.createdAt,
      error: e.error ? JSON.parse(e.error) : null,
    })),
    total,
    limit,
    offset,
  });
});
