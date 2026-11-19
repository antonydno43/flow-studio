/**
 * Integration nodes. Each calls a real external API using either a stored
 * (encrypted) connection credential or a directly-configured value.
 * When no credentials are available the node fails with CONFIGURATION_REQUIRED
 * instead of pretending to succeed.
 */
import type { NodeDefinition, NodeExecutionContext } from "@/core/types";
import { safeFetch } from "@/lib/ssrf";
import {
  requireFields, rnum, rstr, rval, truncateForStorage, parseJsonSafe, resolveJsonObject,
} from "@/core/nodes/utils";

function configRequired(message: string, field: string) {
  return {
    code: "CONFIGURATION_REQUIRED",
    field,
    message,
  };
}

// ---------------------------------------------------------------------------
// Resend - Send Email
// ---------------------------------------------------------------------------

export const sendEmailNode: NodeDefinition = {
  type: "send-email",
  version: 1,
  name: "Send Email (Resend)",
  description: "Sends an email through the Resend API. Requires a Resend connection or a server-side RESEND_API_KEY.",
  category: "Communication",
  icon: "Mail",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Result" }],
  outputHint: "{ messageId, status }",
  configSchema: [
    { key: "connection", label: "Resend connection", type: "credential", credentialProvider: "resend", help: "Select a stored Resend API key connection, or leave empty to use the server's RESEND_API_KEY." },
    { key: "from", label: "From (email)", type: "expression", placeholder: "onboarding@resend.dev", help: "Must be a verified Resend sender domain." },
    { key: "to", label: "To (email)", type: "expression", required: true, placeholder: "{{ $trigger.body.email }}" },
    { key: "subject", label: "Subject", type: "expression", required: true },
    { key: "bodyMode", label: "Body type", type: "radio", options: [{ value: "html", label: "HTML" }, { value: "text", label: "Plain text" }], default: "html" },
    { key: "html", label: "HTML body", type: "expression", showIf: { key: "bodyMode", equals: "html" }, help: "Supports expressions, e.g. <p>Hello {{ $trigger.body.name }}</p>" },
    { key: "text", label: "Text body", type: "expression", showIf: { key: "bodyMode", equals: "text" } },
    { key: "replyTo", label: "Reply-To", type: "expression" },
  ],
  defaultConfig: { bodyMode: "html" },
  validate: (config) => requireFields(config, [
    { key: "to", label: "Recipient (To)" },
    { key: "subject", label: "Subject" },
  ]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    // Resolve API key: connection credential first, then env
    let apiKey = "";
    if (config.connection) {
      const conn = ctx.getConnection(String(config.connection));
      if (!conn) {
        return { status: "failed", error: { message: "Selected Resend connection no longer exists. Re-create it on the Connections page." } };
      }
      apiKey = String(conn.credentials.apiKey ?? "");
    }
    if (!apiKey) apiKey = process.env.RESEND_API_KEY || "";
    if (!apiKey) {
      return {
        status: "failed",
        error: {
          message: "Resend is not configured. Add a Resend connection with your API key on the Connections page (or set RESEND_API_KEY on the server).",
          details: configRequired("Resend API key missing", "connection"),
        },
      };
    }
    const from = config.from ? rstr(ctx, config.from) : process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    const to = rstr(ctx, config.to);
    const subject = rstr(ctx, config.subject);
    const body = String(config.bodyMode || "html") === "text"
      ? { text: rstr(ctx, config.text) }
      : { html: rstr(ctx, config.html) };
    const payload: Record<string, unknown> = {
      from,
      to: to.split(",").map((t) => t.trim()).filter(Boolean),
      subject,
      ...body,
    };
    const replyTo = config.replyTo ? rstr(ctx, config.replyTo) : "";
    if (replyTo) payload.reply_to = replyTo;

    try {
      const res = await safeFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      const parsed = parseJsonSafe(res.bodyText);
      const data = parsed.ok ? parsed.value : { raw: res.bodyText };
      if (res.status >= 200 && res.status < 300) {
        return {
          status: "succeeded",
          output: { messageId: (data as { id?: string })?.id, status: "sent", to: payload.to, subject },
        };
      }
      return {
        status: "failed",
        error: {
          message: `Resend API error ${res.status}: ${(data as { message?: string })?.message || res.bodyText.slice(0, 200)}`,
        },
      };
    } catch (err) {
      return { status: "failed", error: { message: `Email delivery failed: ${(err as Error).message}` } };
    }
  },
};

// ---------------------------------------------------------------------------
// Slack message (incoming webhook)
// ---------------------------------------------------------------------------

export const slackMessageNode: NodeDefinition = {
  type: "slack-message",
  version: 1,
  name: "Send Slack Message",
  description: "Posts a message to a Slack channel using an incoming webhook.",
  category: "Integrations",
  icon: "MessageSquare",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Result" }],
  outputHint: "{ delivered: true }",
  configSchema: [
    { key: "connection", label: "Slack webhook connection", type: "credential", credentialProvider: "slack-webhook", help: "Create a Slack incoming webhook (api.slack.com/messaging/webhooks) and store its URL as a connection." },
    { key: "webhookUrl", label: "or Webhook URL directly", type: "password", help: "https://hooks.slack.com/services/..." },
    { key: "text", label: "Message", type: "expression", required: true, help: "Supports expressions, e.g. New order from {{ $trigger.body.name }} ({{ $trigger.body.amount }})" },
  ],
  defaultConfig: {},
  validate: (config) => {
    const issues = requireFields(config, [{ key: "text", label: "Message" }]);
    if (!config.connection && !config.webhookUrl) {
      issues.push(configRequired("Provide a Slack webhook connection or a webhook URL.", "connection"));
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    let webhookUrl = "";
    if (config.connection) {
      const conn = ctx.getConnection(String(config.connection));
      if (!conn) return { status: "failed", error: { message: "Selected Slack connection no longer exists." } };
      webhookUrl = String(conn.credentials.webhookUrl ?? "");
    }
    if (!webhookUrl && config.webhookUrl) webhookUrl = rstr(ctx, config.webhookUrl);
    if (!webhookUrl) {
      return { status: "failed", error: { message: "No Slack webhook URL available. Configure a connection or enter the URL." } };
    }
    const text = rstr(ctx, config.text);
    try {
      const res = await safeFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        timeoutMs: 15000,
      });
      if (res.status >= 200 && res.status < 300) {
        return { status: "succeeded", output: { delivered: true, response: res.bodyText.slice(0, 200) } };
      }
      return { status: "failed", error: { message: `Slack webhook returned HTTP ${res.status}: ${res.bodyText.slice(0, 200)}` } };
    } catch (err) {
      return { status: "failed", error: { message: `Slack message failed: ${(err as Error).message}` } };
    }
  },
};

// ---------------------------------------------------------------------------
// Discord message (webhook)
// ---------------------------------------------------------------------------

export const discordMessageNode: NodeDefinition = {
  type: "discord-message",
  version: 1,
  name: "Send Discord Message",
  description: "Posts a message to a Discord channel using a channel webhook.",
  category: "Integrations",
  icon: "Hash",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Result" }],
  outputHint: "{ delivered: true }",
  configSchema: [
    { key: "connection", label: "Discord webhook connection", type: "credential", credentialProvider: "discord-webhook" },
    { key: "webhookUrl", label: "or Webhook URL directly", type: "password", help: "https://discord.com/api/webhooks/..." },
    { key: "content", label: "Message", type: "expression", required: true },
    { key: "username", label: "Override bot username", type: "expression" },
  ],
  defaultConfig: {},
  validate: (config) => {
    const issues = requireFields(config, [{ key: "content", label: "Message" }]);
    if (!config.connection && !config.webhookUrl) {
      issues.push(configRequired("Provide a Discord webhook connection or a webhook URL.", "connection"));
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    let webhookUrl = "";
    if (config.connection) {
      const conn = ctx.getConnection(String(config.connection));
      if (!conn) return { status: "failed", error: { message: "Selected Discord connection no longer exists." } };
      webhookUrl = String(conn.credentials.webhookUrl ?? "");
    }
    if (!webhookUrl && config.webhookUrl) webhookUrl = rstr(ctx, config.webhookUrl);
    if (!webhookUrl) {
      return { status: "failed", error: { message: "No Discord webhook URL available." } };
    }
    const payload: Record<string, unknown> = { content: rstr(ctx, config.content) };
    if (config.username) payload.username = rstr(ctx, config.username);
    try {
      const res = await safeFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 15000,
      });
      if (res.status >= 200 && res.status < 300) {
        return { status: "succeeded", output: { delivered: true } };
      }
      return { status: "failed", error: { message: `Discord webhook returned HTTP ${res.status}: ${res.bodyText.slice(0, 200)}` } };
    } catch (err) {
      return { status: "failed", error: { message: `Discord message failed: ${(err as Error).message}` } };
    }
  },
};

// ---------------------------------------------------------------------------
// Supabase (customer's own project, via PostgREST)
// ---------------------------------------------------------------------------

export const supabaseNode: NodeDefinition = {
  type: "supabase",
  version: 1,
  name: "Supabase",
  description: "Select, insert, update, upsert, or delete rows in a Supabase table, or run an RPC function.",
  category: "Integrations",
  icon: "Database",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Result" }],
  outputHint: "{ data: [...rows] } or { data: row }",
  configSchema: [
    { key: "connection", label: "Supabase connection", type: "credential", credentialProvider: "supabase", required: true, help: "Store your project URL + service role (or anon) key on the Connections page." },
    {
      key: "operation", label: "Operation", type: "select",
      options: [
        { value: "select", label: "Select records" },
        { value: "insert", label: "Insert record(s)" },
        { value: "update", label: "Update records" },
        { value: "upsert", label: "Upsert record(s)" },
        { value: "delete", label: "Delete records" },
        { value: "rpc", label: "Call RPC function" },
      ],
      default: "select",
      required: true,
    },
    { key: "table", label: "Table", type: "text", required: true, showIf: { key: "operation", equals: "select" } },
    { key: "tableIns", label: "Table", type: "text", showIf: { key: "operation", equals: "insert" } },
    { key: "tableUpd", label: "Table", type: "text", showIf: { key: "operation", equals: "update" } },
    { key: "tableUps", label: "Table", type: "text", showIf: { key: "operation", equals: "upsert" } },
    { key: "tableDel", label: "Table", type: "text", showIf: { key: "operation", equals: "delete" } },
    { key: "rpcName", label: "RPC function name", type: "text", showIf: { key: "operation", equals: "rpc" } },
    { key: "columns", label: "Columns to return", type: "text", default: "*", showIf: { key: "operation", equals: "select" }, help: "Comma-separated or * for all." },
    { key: "filters", label: "Filters", type: "filters", help: "PostgREST-style filters, e.g. column: status, op: eq, value: active. Available ops: eq, neq, gt, lt, gte, lte, like, ilike, is, in" },
    { key: "limit", label: "Limit", type: "number", default: 100, showIf: { key: "operation", equals: "select" } },
    { key: "orderBy", label: "Order by", type: "text", showIf: { key: "operation", equals: "select" }, help: "e.g. created_at.desc" },
    { key: "data", label: "Data (JSON, expressions supported)", type: "expression", showIf: { key: "operation", equals: "insert" } },
    { key: "dataUpd", label: "Set values (JSON, expressions supported)", type: "expression", showIf: { key: "operation", equals: "update" } },
    { key: "dataUps", label: "Rows (JSON, expressions supported)", type: "expression", showIf: { key: "operation", equals: "upsert" } },
    { key: "onConflict", label: "Conflict column (upsert)", type: "text", showIf: { key: "operation", equals: "upsert" }, help: "e.g. id or email" },
    { key: "rpcParams", label: "RPC parameters (JSON)", type: "expression", showIf: { key: "operation", equals: "rpc" } },
    { key: "continueOnFail", label: "Continue workflow on error", type: "boolean", default: false },
  ],
  defaultConfig: { operation: "select", columns: "*", limit: 100, continueOnFail: false },
  validate: (config) => {
    const issues = requireFields(config, [{ key: "connection", label: "Supabase connection" }]);
    const op = String(config.operation || "select");
    const tableKeys: Record<string, string> = {
      select: "table", insert: "tableIns", update: "tableUpd",
      upsert: "tableUps", delete: "tableDel", rpc: "rpcName",
    };
    const key = tableKeys[op];
    if (key && !config[key]) {
      issues.push({ code: "MISSING_REQUIRED_FIELD", field: key, message: op === "rpc" ? "RPC function name is required." : "Table name is required." });
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    const conn = ctx.getConnection(String(config.connection || ""));
    if (!conn) {
      return { status: "failed", error: { message: "Supabase connection not found. Create it on the Connections page." } };
    }
    const baseUrl = String(conn.credentials.url ?? "").replace(/\/$/, "");
    const apiKey = String(conn.credentials.apiKey ?? "");
    if (!baseUrl || !apiKey) {
      return { status: "failed", error: { message: "Supabase connection is incomplete (URL or API key missing). Edit it on the Connections page." } };
    }

    const op = String(config.operation || "select");
    const headers: Record<string, string> = {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    };
    const filters = Array.isArray(config.filters) ? (config.filters as { column?: string; op?: string; value?: string }[]) : [];
    const applyFilters = (url: URL) => {
      for (const f of filters) {
        if (f?.column && f?.op) {
          const val = f.value ? rstr(ctx, f.value) : "";
          url.searchParams.set(f.column, `${f.op}.${val}`);
        }
      }
    };

    try {
      if (op === "select") {
        const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(rstr(ctx, config.table))}`);
        url.searchParams.set("select", String(config.columns || "*"));
        applyFilters(url);
        const limit = rnum(ctx, config.limit, 100);
        url.searchParams.set("limit", String(limit));
        if (config.orderBy) url.searchParams.set("order", rstr(ctx, config.orderBy));
        const res = await safeFetch(url.toString(), { method: "GET", headers, timeoutMs: 20000 });
        const data = parseJsonSafe(res.bodyText);
        if (res.status >= 200 && res.status < 300) {
          const rows = data.ok ? data.value : [];
          return { status: "succeeded", output: truncateForStorage({ data: rows, count: Array.isArray(rows) ? rows.length : 1 }) };
        }
        return { status: "failed", error: { message: `Supabase select failed (${res.status}): ${res.bodyText.slice(0, 200)}` } };
      }
      if (op === "insert" || op === "upsert") {
        const table = op === "insert" ? config.tableIns : config.tableUps;
        const dataExpr = op === "insert" ? config.data : config.dataUps;
        const rows = resolveJsonObject(ctx, dataExpr);
        if (!rows) return { status: "failed", error: { message: "Data is required for insert/upsert operations." } };
        if (op === "upsert" && config.onConflict) {
          headers["Prefer"] = `resolution=merge-duplicates,on-conflict=${rstr(ctx, config.onConflict)}`;
        } else {
          headers["Prefer"] = "return=representation";
        }
        const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(rstr(ctx, table))}`);
        headers["Content-Type"] = "application/json";
        const res = await safeFetch(url.toString(), {
          method: "POST", headers, body: JSON.stringify(rows), timeoutMs: 20000,
        });
        const data = parseJsonSafe(res.bodyText);
        if (res.status >= 200 && res.status < 300) {
          return { status: "succeeded", output: { data: data.ok ? data.value : null, inserted: true } };
        }
        return { status: "failed", error: { message: `Supabase ${op} failed (${res.status}): ${res.bodyText.slice(0, 200)}` } };
      }
      if (op === "update") {
        const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(rstr(ctx, config.tableUpd))}`);
        applyFilters(url);
        const setValues = resolveJsonObject(ctx, config.dataUpd);
        if (!setValues) return { status: "failed", error: { message: "Set values are required for update." } };
        headers["Content-Type"] = "application/json";
        headers["Prefer"] = "return=representation";
        const res = await safeFetch(url.toString(), {
          method: "PATCH", headers, body: JSON.stringify(setValues), timeoutMs: 20000,
        });
        const data = parseJsonSafe(res.bodyText);
        if (res.status >= 200 && res.status < 300) {
          return { status: "succeeded", output: { data: data.ok ? data.value : null, updated: true } };
        }
        return { status: "failed", error: { message: `Supabase update failed (${res.status}): ${res.bodyText.slice(0, 200)}` } };
      }
      if (op === "delete") {
        const url = new URL(`${baseUrl}/rest/v1/${encodeURIComponent(rstr(ctx, config.tableDel))}`);
        applyFilters(url);
        headers["Prefer"] = "return=representation";
        const res = await safeFetch(url.toString(), { method: "DELETE", headers, timeoutMs: 20000 });
        const data = parseJsonSafe(res.bodyText);
        if (res.status >= 200 && res.status < 300) {
          return { status: "succeeded", output: { data: data.ok ? data.value : null, deleted: true } };
        }
        return { status: "failed", error: { message: `Supabase delete failed (${res.status}): ${res.bodyText.slice(0, 200)}` } };
      }
      if (op === "rpc") {
        const url = new URL(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(rstr(ctx, config.rpcName))}`);
        const params = config.rpcParams ? resolveJsonObject(ctx, config.rpcParams) : {};
        headers["Content-Type"] = "application/json";
        const res = await safeFetch(url.toString(), {
          method: "POST", headers, body: JSON.stringify(params), timeoutMs: 20000,
        });
        const data = parseJsonSafe(res.bodyText);
        if (res.status >= 200 && res.status < 300) {
          return { status: "succeeded", output: { data: data.ok ? data.value : null } };
        }
        return { status: "failed", error: { message: `Supabase RPC failed (${res.status}): ${res.bodyText.slice(0, 200)}` } };
      }
      return { status: "failed", error: { message: `Unknown operation "${op}"` } };
    } catch (err) {
      return { status: "failed", error: { message: `Supabase request failed: ${(err as Error).message}` } };
    }
  },
};
