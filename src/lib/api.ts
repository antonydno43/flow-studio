import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Centralized API helpers: structured responses, error handling, zod body
 * validation, and in-memory rate limiting.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status }
  );
}

/** Wrap a route handler with structured error handling. */
export function handler(
  fn: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return fail(err.status, err.code, err.message, err.details);
      }
      const e = err as { status?: number; code?: string; message?: string };
      if (e && typeof e.status === "number") {
        return fail(e.status, e.code || "ERROR", e.message || "Request failed");
      }
      console.error("[api] unhandled error:", err);
      return fail(500, "INTERNAL", "An unexpected error occurred");
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory sliding window; per-instance)
// ---------------------------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function enforceRateLimit(req: NextRequest, scope: string, limit: number, windowMs: number) {
  const { allowed, retryAfter } = rateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
  if (!allowed) {
    throw new ApiError(429, "RATE_LIMITED", `Too many requests. Retry in ${retryAfter}s.`);
  }
}

export const APP_URL =
  process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
