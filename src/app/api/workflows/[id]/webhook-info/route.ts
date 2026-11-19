import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { getOwnedWorkflow } from "@/lib/workflow-service";
import { generatePublicId, decryptSecrets, encryptSecrets } from "@/lib/crypto";
import { APP_URL } from "@/lib/api";
import type { GraphNode } from "@/core/types";

/**
 * Returns (and lazily provisions) the webhook endpoint info for a workflow
 * containing a webhook trigger: public URL + signing secret.
 */
export const GET = handler(async (_req: NextRequest, { params }) => {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const workflow = await getOwnedWorkflow(id, workspace.id);

  const versionId = workflow.currentDraftVersionId || workflow.publishedVersionId;
  if (!versionId) throw new ApiError(400, "EMPTY", "Workflow has no content.");
  const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found.");
  const graph = JSON.parse(version.graphDefinition) as { nodes: GraphNode[] };
  const hasWebhookTrigger = graph.nodes.some((n) => n.type === "trigger-webhook");
  if (!hasWebhookTrigger) {
    return ok({ hasWebhook: false, url: null, secret: null, enabled: false });
  }

  let endpoint = await db.webhookEndpoint.findFirst({ where: { workflowId: id } });
  if (!endpoint) {
    endpoint = await db.webhookEndpoint.create({
      data: {
        workspaceId: workspace.id,
        workflowId: id,
        publicIdentifier: generatePublicId("whk"),
        encryptedSecret: encryptSecrets({ secret: generatePublicId("sig") }),
        method: "POST",
        enabled: true,
      },
    });
  }

  let secret: string | null = null;
  try {
    secret = String(decryptSecrets(endpoint.encryptedSecret).secret ?? "");
  } catch { secret = null; }

  return ok({
    hasWebhook: true,
    url: `${APP_URL}/api/webhooks/${endpoint.publicIdentifier}`,
    secret,
    enabled: endpoint.enabled && workflow.status === "active",
    publicIdentifier: endpoint.publicIdentifier,
    note: endpoint.enabled && workflow.status !== "active"
      ? "The webhook accepts requests once the workflow is activated."
      : null,
  });
});
