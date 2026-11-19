import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { rateLimit, fail } from "@/lib/api";
import { decryptSecrets } from "@/lib/crypto";
import { createExecution, runExecution } from "@/core/engine/executor";
import { parseGraph } from "@/core/graph/validator";
import type { GraphNode } from "@/core/types";

const MAX_BODY_BYTES = 256 * 1024; // 256 KB

/**
 * Public webhook trigger endpoint: POST/GET /api/webhooks/{publicIdentifier}
 * No internal ids are exposed; rate limited; optionally signature-verified.
 * If the workflow contains a Webhook Response node, its configured response
 * is returned to the caller; otherwise 202 Accepted.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  return handleWebhook(req, publicId);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  return handleWebhook(req, publicId);
}

async function handleWebhook(req: NextRequest, publicId: string) {
  try {
    const endpoint = await db.webhookEndpoint.findUnique({
      where: { publicIdentifier: publicId },
      include: { workflow: true },
    });
    if (!endpoint) {
      return fail(404, "NOT_FOUND", "Unknown webhook endpoint.");
    }
    if (!endpoint.enabled) {
      return fail(404, "DISABLED", "This webhook endpoint is disabled.");
    }
    const workflow = endpoint.workflow;
    if (workflow.status !== "active" || !workflow.publishedVersionId) {
      return fail(409, "WORKFLOW_INACTIVE", "The workflow for this webhook is not active.");
    }

    // rate limit per endpoint+ip
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { allowed, retryAfter } = rateLimit(`webhook:${endpoint.id}:${ip}`, 60, 60_000);
    if (!allowed) {
      return fail(429, "RATE_LIMITED", `Too many webhook requests. Retry in ${retryAfter}s.`);
    }

    // read raw body (capped)
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      await recordDelivery(endpoint.id, "rejected", 413, req.headers.get("content-type"), contentLength, null, "Payload too large");
      return fail(413, "PAYLOAD_TOO_LARGE", "Webhook payload exceeds the 256 KB limit.");
    }
    const rawBody = await req.text().catch(() => "");
    if (rawBody.length > MAX_BODY_BYTES) {
      await recordDelivery(endpoint.id, "rejected", 413, req.headers.get("content-type"), rawBody.length, null, "Payload too large");
      return fail(413, "PAYLOAD_TOO_LARGE", "Webhook payload exceeds the 256 KB limit.");
    }

    // parse body
    const contentType = req.headers.get("content-type") || "";
    let body: unknown = null;
    if (contentType.includes("application/json")) {
      try { body = rawBody ? JSON.parse(rawBody) : null; }
      catch {
        await recordDelivery(endpoint.id, "rejected", 400, contentType, rawBody.length, null, "Invalid JSON");
        return fail(400, "INVALID_JSON", "Request body is not valid JSON.");
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    } else if (rawBody) {
      body = rawBody;
    }

    // optional signature verification (workflow's webhook trigger config)
    const version = await db.workflowVersion.findUnique({ where: { id: workflow.publishedVersionId } });
    if (!version) return fail(500, "VERSION_MISSING", "Published version missing.");
    const graph = parseGraph(version.graphDefinition);
    const triggerNode = graph.nodes.find((n) => n.type === "trigger-webhook") as GraphNode | undefined;
    if (triggerNode?.config?.requireSignature === true) {
      let secret: string | null = null;
      try { secret = String(decryptSecrets(endpoint.encryptedSecret).secret ?? ""); } catch { secret = null; }
      const provided = req.headers.get("x-flow-signature") || "";
      const expected = `sha256=${crypto.createHmac("sha256", secret || "").update(rawBody).digest("hex")}`;
      if (!secret || provided !== expected) {
        await recordDelivery(endpoint.id, "rejected", 401, contentType, rawBody.length, null, "Invalid or missing X-Flow-Signature");
        return fail(401, "INVALID_SIGNATURE", "Missing or invalid X-Flow-Signature header.");
      }
    }

    // collect headers (safe subset, auth values excluded)
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      if (!["cookie", "authorization", "x-flow-signature"].includes(k)) headers[k] = v;
    });
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());

    const execution = await createExecution({
      workspaceId: endpoint.workspaceId,
      workflowId: workflow.id,
      workflowVersionId: workflow.publishedVersionId,
      triggerType: "webhook",
      triggerData: {
        method: req.method,
        headers,
        query,
        body,
        receivedAt: new Date().toISOString(),
      },
    });

    const result = await runExecution(execution.id);
    await recordDelivery(endpoint.id, "accepted", 200, contentType, rawBody.length, execution.id, `execution_${result.status}`);

    // If the workflow produced a webhook response, return it to the caller
    if (result.webhookResponse) {
      const wr = result.webhookResponse;
      return new NextResponse(wr.body, {
        status: wr.status,
        headers: { ...wr.headers, "Content-Type": wr.contentType },
      });
    }
    return NextResponse.json(
      { ok: true, received: true, executionId: execution.id, status: result.status },
      { status: 202 }
    );
  } catch (err) {
    console.error("[webhook] error:", err);
    return fail(500, "INTERNAL", "Webhook processing failed.");
  }
}

async function recordDelivery(
  endpointId: string,
  status: string,
  statusCode: number | null,
  contentType: string | null,
  sizeBytes: number | null,
  executionId: string | null,
  message: string | null
) {
  await db.webhookDelivery.create({
    data: { endpointId, status, statusCode, contentType, sizeBytes, executionId, message },
  }).catch(() => {});
}
