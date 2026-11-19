import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { assertConnectionQuota } from "@/lib/workflow-service";
import { encryptSecrets, isVaultConfigured } from "@/lib/crypto";

export const CONNECTION_PROVIDERS: Record<string, {
  label: string;
  description: string;
  docsUrl: string;
  fields: { key: string; label: string; type: "text" | "password"; required: boolean; placeholder?: string; help?: string }[];
}> = {
  resend: {
    label: "Resend",
    description: "Email delivery API (api.resend.com)",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      { key: "apiKey", label: "API key", type: "password", required: true, placeholder: "re_...", help: "Create a key at resend.com/api-keys" },
    ],
  },
  "slack-webhook": {
    label: "Slack (incoming webhook)",
    description: "Post messages to a Slack channel",
    docsUrl: "https://api.slack.com/messaging/webhooks",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", type: "password", required: true, placeholder: "https://hooks.slack.com/services/..." },
    ],
  },
  "discord-webhook": {
    label: "Discord (channel webhook)",
    description: "Post messages to a Discord channel",
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", type: "password", required: true, placeholder: "https://discord.com/api/webhooks/..." },
    ],
  },
  supabase: {
    label: "Supabase",
    description: "Your own Supabase project (PostgREST API)",
    docsUrl: "https://supabase.com/docs/guides/api",
    fields: [
      { key: "url", label: "Project URL", type: "text", required: true, placeholder: "https://xxxx.supabase.co" },
      { key: "apiKey", label: "API key (service_role or anon)", type: "password", required: true },
    ],
  },
  "http-basic": {
    label: "HTTP Basic auth",
    description: "Username & password for HTTP Request nodes",
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication",
    fields: [
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
    ],
  },
  "http-bearer": {
    label: "HTTP Bearer token",
    description: "Bearer token for HTTP Request nodes",
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication",
    fields: [
      { key: "token", label: "Token", type: "password", required: true },
    ],
  },
};

const createSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1).max(80),
  credentials: z.record(z.string(), z.unknown()),
});

export const GET = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  const connections = await db.connection.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });
  // Never return decrypted credentials - only metadata
  return ok({
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      providerLabel: CONNECTION_PROVIDERS[c.provider]?.label ?? c.provider,
      name: c.name,
      status: c.status,
      lastTestedAt: c.lastTestedAt,
      lastTestResult: c.lastTestResult,
      createdAt: c.createdAt,
    })),
    providers: Object.entries(CONNECTION_PROVIDERS).map(([id, p]) => ({
      id,
      label: p.label,
      description: p.description,
      docsUrl: p.docsUrl,
      fields: p.fields,
    })),
    vaultConfigured: isVaultConfigured(),
  });
});

export const POST = handler(async (req: NextRequest) => {
  const { workspace } = await requireWorkspace();
  if (!isVaultConfigured()) {
    throw new ApiError(503, "VAULT_NOT_CONFIGURED",
      "The credential vault is not configured on this server (CREDENTIAL_ENCRYPTION_KEY missing). Connections cannot be stored.");
  }
  await assertConnectionQuota(workspace.id);
  const body = await parseBody(req, createSchema);

  const provider = CONNECTION_PROVIDERS[body.provider];
  if (!provider) throw new ApiError(400, "UNKNOWN_PROVIDER", `Unknown connection provider "${body.provider}".`);
  for (const field of provider.fields) {
    if (field.required && !body.credentials[field.key]) {
      throw new ApiError(400, "MISSING_FIELD", `${field.label} is required.`);
    }
  }

  const connection = await db.connection.create({
    data: {
      workspaceId: workspace.id,
      provider: body.provider,
      name: body.name,
      encryptedCredentials: encryptSecrets(body.credentials),
      status: "untested",
    },
  });
  await db.auditLog.create({
    data: { workspaceId: workspace.id, action: "connection.create", entityType: "connection", entityId: connection.id, metadata: JSON.stringify({ provider: body.provider }) },
  });
  return ok({
    connection: {
      id: connection.id,
      provider: connection.provider,
      name: connection.name,
      status: connection.status,
      createdAt: connection.createdAt,
    },
  }, 201);
});
