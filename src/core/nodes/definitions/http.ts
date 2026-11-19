/**
 * HTTP & API nodes: HTTP Request (with SSRF protection, auth, retries) and
 * Webhook Response (returns data to the webhook caller).
 */
import type { NodeDefinition, NodeExecutionContext } from "@/core/types";
import { safeFetch, SsrfError } from "@/lib/ssrf";
import {
  requireFields, resolveFieldList, rnum, rstr, parseJsonSafe,
  truncateForStorage, rval, resolveJsonObject,
} from "@/core/nodes/utils";

function buildUrl(url: string, queryParams: Record<string, unknown>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(queryParams)) {
    if (k) u.searchParams.set(k, v === undefined || v === null ? "" : String(v));
  }
  return u.toString();
}

export const httpRequestNode: NodeDefinition = {
  type: "http-request",
  version: 1,
  name: "HTTP Request",
  description: "Calls any REST API with headers, query params, body, and authentication.",
  category: "HTTP & APIs",
  icon: "Globe",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Response" }],
  outputHint: "{ status, ok, headers, data, requestUrl }",
  configSchema: [
    {
      key: "method",
      label: "Method",
      type: "select",
      options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((m) => ({ value: m, label: m })),
      default: "GET",
      required: true,
    },
    { key: "url", label: "URL", type: "expression", required: true, placeholder: "https://api.example.com/users/{{ $trigger.body.id }}", help: "Only public http/https endpoints are allowed. Private networks are blocked for security." },
    { key: "headers", label: "Headers", type: "fields", help: "Request headers (name / value). Values support expressions." },
    { key: "queryParams", label: "Query parameters", type: "fields" },
    {
      key: "bodyType", label: "Body type", type: "radio",
      options: [
        { value: "none", label: "None" },
        { value: "json", label: "JSON" },
        { value: "text", label: "Text" },
        { value: "form", label: "Form data" },
      ],
      default: "none",
    },
    { key: "jsonBody", label: "JSON body", type: "expression", showIf: { key: "bodyType", equals: "json" }, help: 'Expression returning an object, e.g. { "name": "{{ $trigger.body.name }}" } or {{ $trigger.body }}' },
    { key: "textBody", label: "Text body", type: "expression", showIf: { key: "bodyType", equals: "text" } },
    {
      key: "authType", label: "Authentication", type: "select",
      options: [
        { value: "none", label: "None" },
        { value: "basic", label: "Basic (username/password)" },
        { value: "bearer", label: "Bearer token" },
        { value: "apikey", label: "API key header" },
      ],
      default: "none",
    },
    { key: "authUsername", label: "Username", type: "expression", showIf: { key: "authType", equals: "basic" } },
    { key: "authPassword", label: "Password", type: "password", showIf: { key: "authType", equals: "basic" } },
    { key: "authBearerToken", label: "Bearer token", type: "password", showIf: { key: "authType", equals: "bearer" } },
    { key: "authApiKeyName", label: "API key header name", type: "text", default: "X-API-Key", showIf: { key: "authType", equals: "apikey" } },
    { key: "authApiKeyValue", label: "API key value", type: "password", showIf: { key: "authType", equals: "apikey" } },
    { key: "timeoutMs", label: "Timeout (ms)", type: "number", default: 30000 },
    { key: "retryMaxTries", label: "Max attempts on failure", type: "number", default: 1, help: "1 = no retry. Engine retries transient failures with exponential backoff." },
    { key: "retryBackoffMs", label: "Retry backoff (ms)", type: "number", default: 1000 },
    { key: "continueOnFail", label: "Continue workflow on request failure", type: "boolean", default: false, help: "When enabled the node outputs the error instead of failing the workflow." },
  ],
  defaultConfig: {
    method: "GET",
    url: "",
    bodyType: "none",
    authType: "none",
    timeoutMs: 30000,
    retryMaxTries: 1,
    retryBackoffMs: 1000,
    continueOnFail: false,
  },
  validate: (config) => {
    const issues = requireFields(config, [{ key: "url", label: "URL" }]);
    if (config.url && !/^https?:\/\/.+/i.test(String(config.url).replace(/\{\{.*?\}\}/g, "x"))) {
      issues.push({ code: "INVALID_VALUE", field: "url", message: "URL must start with http:// or https://" });
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    const method = String(config.method || "GET").toUpperCase();
    const rawUrl = rstr(ctx, config.url);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(resolveFieldList(ctx, config.headers))) {
      if (k) headers[k] = String(v);
    }
    const queryParams = resolveFieldList(ctx, config.queryParams);
    const url = buildUrl(rawUrl, queryParams);

    // auth
    const authType = String(config.authType || "none");
    if (authType === "basic") {
      const user = rstr(ctx, config.authUsername);
      const pass = rstr(ctx, config.authPassword);
      headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    } else if (authType === "bearer") {
      headers["Authorization"] = `Bearer ${rstr(ctx, config.authBearerToken)}`;
    } else if (authType === "apikey") {
      const name = String(config.authApiKeyName || "X-API-Key");
      headers[name] = rstr(ctx, config.authApiKeyValue);
    }

    // body
    let body: string | undefined;
    const bodyType = String(config.bodyType || "none");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      if (bodyType === "json") {
        body = JSON.stringify(resolveJsonObject(ctx, config.jsonBody) ?? {});
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
      } else if (bodyType === "text") {
        body = rstr(ctx, config.textBody);
        headers["Content-Type"] = headers["Content-Type"] || "text/plain";
      } else if (bodyType === "form") {
        const form = resolveFieldList(ctx, config.formBody);
        body = new URLSearchParams(
          Object.entries(form).map(([k, v]) => [k, String(v)])
        ).toString();
        headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded";
      }
    }

    const timeoutMs = Math.min(Math.max(rnum(ctx, config.timeoutMs, 30000), 1000), 120000);

    try {
      const res = await safeFetch(url, {
        method,
        headers,
        body,
        timeoutMs,
      });

      let data: unknown = res.bodyText;
      const contentType = res.headers["content-type"] || "";
      if (contentType.includes("json") || contentType.includes("+json")) {
        const parsed = parseJsonSafe(res.bodyText);
        data = parsed.ok ? parsed.value : res.bodyText;
      }
      const ok = res.status >= 200 && res.status < 300;
      const output = truncateForStorage({
        status: res.status,
        ok,
        headers: res.headers,
        data,
        truncated: res.truncated,
        requestUrl: url,
      });
      if (!ok && !config.continueOnFail) {
        return {
          status: "failed",
          output,
          error: {
            message: `HTTP ${res.status} ${res.bodyText?.slice(0, 300) || ""}`.trim(),
            details: { status: res.status },
          },
        };
      }
      return { status: "succeeded", output };
    } catch (err) {
      const message = err instanceof SsrfError
        ? `Blocked request: ${err.message}`
        : (err as Error).message;
      return {
        status: "failed",
        error: { message, details: { url } },
      };
    }
  },
};

export const webhookResponseNode: NodeDefinition = {
  type: "webhook-response",
  version: 1,
  name: "Webhook Response",
  description: "Returns a response to the caller when the workflow was started by a webhook.",
  category: "HTTP & APIs",
  icon: "Reply",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  outputHint: "{ responded: true, status }",
  configSchema: [
    { key: "status", label: "HTTP status code", type: "number", default: 200 },
    { key: "headers", label: "Response headers", type: "fields" },
    {
      key: "bodyType", label: "Body", type: "radio",
      options: [
        { value: "json", label: "JSON" },
        { value: "text", label: "Text" },
      ],
      default: "json",
    },
    { key: "jsonBody", label: "JSON body", type: "expression", showIf: { key: "bodyType", equals: "json" }, default: '{ "received": true }' },
    { key: "textBody", label: "Text body", type: "expression", showIf: { key: "bodyType", equals: "text" } },
  ],
  defaultConfig: { status: 200, bodyType: "json", jsonBody: '{ "received": true }' },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const status = Math.min(Math.max(rnum(ctx, config.status, 200), 200), 599);
    const headers = resolveFieldList(ctx, config.headers);
    let bodyText: string;
    let contentType: string;
    if (String(config.bodyType) === "text") {
      bodyText = rstr(ctx, config.textBody);
      contentType = String(headers["Content-Type"] || "text/plain");
    } else {
      const parsed = resolveJsonObject(ctx, config.jsonBody);
      bodyText = JSON.stringify(parsed ?? {});
      contentType = String(headers["Content-Type"] || "application/json");
    }
    if (ctx.ctx.execution.triggerType !== "webhook") {
      return {
        status: "succeeded",
        output: { responded: false, note: "Workflow was not started by a webhook; response ignored." },
      };
    }
    return {
      status: "succeeded",
      output: { responded: true, status },
      webhookResponse: { status, headers: { ...headers, "Content-Type": contentType }, body: bodyText, contentType },
    };
  },
};
