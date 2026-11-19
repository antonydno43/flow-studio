import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { handler, ok, parseBody, enforceRateLimit, ApiError } from "@/lib/api";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req: NextRequest) => {
  enforceRateLimit(req, "auth:login", 10, 60_000);
  const body = await parseBody(req, schema);
  const user = await db.user.findUnique({
    where: { email: body.email.toLowerCase() },
    include: { workspace: true },
  });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }
  if (!user.workspace) {
    throw new ApiError(500, "NO_WORKSPACE", "Account is missing its workspace. Contact support.");
  }
  await createSession(user.id);
  return ok({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      timezone: user.timezone,
    },
    workspace: { id: user.workspace.id, name: user.workspace.name, planId: user.workspace.planId },
  });
});
