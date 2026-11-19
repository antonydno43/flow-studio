import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { NOTIFICATION_TYPES, ensureDefaultPreferences } from "@/lib/notifications";

export const GET = handler(async () => {
  const { workspace } = await requireWorkspace();
  await ensureDefaultPreferences(workspace.id);
  const [notifications, prefs] = await Promise.all([
    db.notificationRecord.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.notificationPreference.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  return ok({
    notifications,
    unreadCount: notifications.filter((n) => !n.readAt).length,
    preferences: NOTIFICATION_TYPES.map((t) => ({
      ...t,
      enabled: prefs.find((p) => p.notificationType === t.id)?.enabled ?? t.default,
    })),
  });
});

const patchSchema = z.object({
  type: z.string().optional(),
  enabled: z.boolean().optional(),
  markAllRead: z.boolean().optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const body = await parseBody(req, patchSchema);
  if (body.markAllRead) {
    await db.notificationRecord.updateMany({
      where: { workspaceId: workspace.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ updated: true });
  }
  if (body.type && body.enabled !== undefined) {
    await db.notificationPreference.upsert({
      where: { workspaceId_notificationType: { workspaceId: workspace.id, notificationType: body.type } },
      create: { workspaceId: workspace.id, notificationType: body.type, enabled: body.enabled },
      update: { enabled: body.enabled },
    });
  }
  return ok({ updated: true });
});
