import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { handler, ok, parseBody, enforceRateLimit, ApiError } from "@/lib/api";
import { ensureDefaultPreferences } from "@/lib/notifications";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2, "Enter your full name").max(80),
  workspaceName: z.string().min(2).max(60).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  enforceRateLimit(req, "auth:register", 10, 60_000);
  const body = await parseBody(req, schema);

  const existing = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (existing) {
    throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists. Try logging in.");
  }

  const workspaceName = body.workspaceName?.trim() || `${body.fullName.split(" ")[0]}'s Workspace`;

  const result = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        fullName: body.fullName.trim(),
      },
    });
    // Exactly one personal workspace per owner (enforced by unique ownerId)
    const workspace = await tx.workspace.create({
      data: {
        ownerId: user.id,
        name: workspaceName,
        planId: "free",
      },
    });
    await tx.subscription.create({
      data: { workspaceId: workspace.id, planId: "free", status: "active" },
    });
    return { user, workspace };
  });

  await ensureDefaultPreferences(result.workspace.id);
  await createSession(result.user.id);
  await db.auditLog.create({
    data: {
      workspaceId: result.workspace.id,
      userId: result.user.id,
      action: "auth.register",
      entityType: "user",
      entityId: result.user.id,
    },
  });

  return ok({
    user: {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      timezone: result.user.timezone,
    },
    workspace: { id: result.workspace.id, name: result.workspace.name, planId: result.workspace.planId },
  }, 201);
});
