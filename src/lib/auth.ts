import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Session-based authentication with httpOnly cookies.
 * Passwords are bcrypt-hashed; session tokens are random 32-byte strings.
 */

export const SESSION_COOKIE = "fs_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  workspaceId: string;
  workspaceName: string;
  planId: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } });
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * Resolve the current session to a user + their single personal workspace.
 * Returns null when unauthenticated or when the workspace is missing.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: { include: { workspace: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const { user } = session;
  if (!user.workspace) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    workspaceId: user.workspace.id,
    workspaceName: user.workspace.name,
    planId: user.workspace.planId,
  };
}

/**
 * The server resolves the authorized workspace from the session - never from
 * a client-supplied workspace id. Every data access helper uses this.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw Object.assign(new Error("Authentication required"), {
      status: 401,
      code: "UNAUTHENTICATED",
    });
  }
  return user;
}

export async function requireWorkspace() {
  const user = await requireUser();
  const workspace = await db.workspace.findUnique({
    where: { ownerId: user.id },
  });
  if (!workspace) {
    throw Object.assign(new Error("Workspace not found"), {
      status: 404,
      code: "WORKSPACE_NOT_FOUND",
    });
  }
  return { user, workspace };
}
