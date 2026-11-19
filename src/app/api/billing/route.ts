import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { PLANS, DEFAULT_PLAN } from "@/config/branding";
import { safeFetch } from "@/lib/ssrf";

/**
 * Billing behind the Razorpay provider interface.
 * - GET: plans + current subscription + provider configuration status
 * - POST: upgrade/downgrade. Without Razorpay credentials, paid plans fail
 *   honestly with a configuration notice (no simulated payments).
 */
export const GET = handler(async () => {
  const { workspace } = await requireWorkspace();
  const subscription = await db.subscription.findUnique({ where: { workspaceId: workspace.id } });
  return ok({
    plans: Object.values(PLANS),
    currentPlanId: workspace.planId,
    subscription,
    provider: {
      id: "razorpay",
      configured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    },
  });
});

const postSchema = z.object({ planId: z.enum(["free", "starter", "pro"]) });

export const POST = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const body = await parseBody(req, postSchema);
  const plan = PLANS[body.planId];

  if (body.planId === workspace.planId) {
    return ok({ changed: false, message: `You are already on the ${plan.name} plan.` });
  }

  if (body.planId === DEFAULT_PLAN) {
    // Downgrade to free is always allowed
    await db.workspace.update({ where: { id: workspace.id }, data: { planId: "free" } });
    await db.subscription.upsert({
      where: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, planId: "free", status: "active" },
      update: { planId: "free", status: "active" },
    });
    return ok({ changed: true, planId: "free" });
  }

  // Paid plan requires a configured provider
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new ApiError(503, "BILLING_NOT_CONFIGURED",
      "Billing is not configured on this server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing). The server administrator must configure Razorpay before paid plans can be purchased.");
  }

  // Create a real Razorpay subscription via the Payments API
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const res = await safeFetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: process.env[`RAZORPAY_PLAN_${plan.id.toUpperCase()}`] || "",
        total_count: 12,
        customer_notify: 1,
      }),
      timeoutMs: 20000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Razorpay returned HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
    }
    const sub = JSON.parse(res.bodyText) as { id: string; status: string };
    // Subscription activates via the provider webhook; do NOT fake success
    await db.subscription.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        planId: body.planId,
        status: "pending_activation",
        providerSubscriptionId: sub.id,
        provider: "razorpay",
      },
      update: {
        planId: body.planId,
        status: "pending_activation",
        providerSubscriptionId: sub.id,
      },
    });
    return ok({
      changed: false,
      subscriptionId: sub.id,
      checkoutRequired: true,
      message: "A Razorpay subscription was created. Complete the payment; the plan activates automatically after the provider webhook confirms it.",
    });
  } catch (err) {
    throw new ApiError(502, "PROVIDER_ERROR", `Could not create subscription: ${(err as Error).message}`);
  }
});
