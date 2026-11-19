import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedConnection } from "@/lib/workflow-service";
import { encryptSecrets } from "@/lib/crypto";
import { CONNECTION_PROVIDERS } from "../route";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const connection = await getOwnedConnection(id, workspace.id);
  const body = await parseBody(req, patchSchema);

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.credentials !== undefined) {
    // re-encrypt: merge with existing stored values to allow partial updates
    const { decryptSecrets } = await import("@/lib/crypto");
    let existing: Record<string, unknown> = {};
    try { existing = decryptSecrets(connection.encryptedCredentials); } catch { existing = {}; }
    data.encryptedCredentials = encryptSecrets({ ...existing, ...body.credentials });
    data.status = "untested";
    data.lastTestedAt = null;
    data.lastTestResult = null;
  }
  const updated = await db.connection.update({ where: { id }, data });
  return ok({ connection: { id: updated.id, name: updated.name, status: updated.status } });
});

export const DELETE = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await getOwnedConnection(id, workspace.id);
  await db.connection.delete({ where: { id } });
  await db.auditLog.create({
    data: { workspaceId: workspace.id, action: "connection.delete", entityType: "connection", entityId: id },
  });
  return ok({ deleted: true });
});

void CONNECTION_PROVIDERS;
