import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { handler, ok, parseBody, ApiError } from "@/lib/api";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const POST = handler(async (req: NextRequest) => {
  const { user } = await (await import("@/lib/auth")).requireWorkspace();
  const body = await parseBody(req, schema);
  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !(await verifyPassword(body.currentPassword, dbUser.passwordHash))) {
    throw new ApiError(400, "INVALID_PASSWORD", "Current password is incorrect.");
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
  // Invalidate all other sessions for security
  await db.session.deleteMany({ where: { userId: user.id } });
  await (await import("@/lib/auth")).createSession(user.id);
  return ok({ changed: true });
});
