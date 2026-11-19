import { NextRequest } from "next/server";
import { handler, ok, fail } from "@/lib/api";
import { dispatchDueSchedules } from "@/core/engine/scheduler";

/**
 * Central cron dispatcher endpoint - call this from cronjob.org every minute:
 *   GET  {APP_URL}/api/cron/dispatch?secret=CRON_SECRET
 *   POST {APP_URL}/api/cron/dispatch  (Authorization: Bearer CRON_SECRET)
 *
 * Claims due schedules atomically, starts executions, and resumes waiting
 * executions. Protected by CRON_SECRET - never exposed publicly without it.
 */
async function dispatch(req: NextRequest) {
  const url = new URL(req.url);
  const secret =
    url.searchParams.get("secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-cron-secret") ||
    "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return fail(503, "NOT_CONFIGURED", "CRON_SECRET is not configured on the server.");
  }
  if (secret !== expected) {
    return fail(401, "UNAUTHORIZED", "Invalid dispatcher secret.");
  }
  const result = await dispatchDueSchedules();
  return ok({ dispatched: true, ...result, at: new Date().toISOString() });
}

export const GET = handler(async (req: NextRequest) => dispatch(req));
export const POST = handler(async (req: NextRequest) => dispatch(req));
