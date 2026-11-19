/**
 * Trigger node definitions: Manual, Schedule, Webhook.
 * Triggers have no inputs and a single "out" port. Their execute() simply
 * produces the trigger payload for downstream nodes.
 */
import type { NodeDefinition, NodeExecutionContext } from "@/core/types";
import { requireFields } from "@/core/nodes/utils";

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { value: v };
}

export const manualTrigger: NodeDefinition = {
  type: "trigger-manual",
  version: 1,
  name: "Manual Trigger",
  description: "Runs the workflow when you click Test or Run.",
  category: "Triggers",
  icon: "Play",
  kind: "trigger",
  inputs: 0,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    {
      key: "sampleInput",
      label: "Test input (JSON)",
      type: "json",
      help: "Optional sample payload used when you press Test Run. In live mode the trigger data comes from the run request.",
    },
  ],
  defaultConfig: { sampleInput: "" },
  outputHint: "{ input: <your test input or live trigger payload> }",
  validate: () => [],
  async execute(ctx: NodeExecutionContext, _config: Record<string, unknown>, _input: unknown) {
    return { status: "succeeded", output: ctx.ctx.trigger ?? null };
  },
};

export const scheduleTrigger: NodeDefinition = {
  type: "trigger-schedule",
  version: 1,
  name: "Schedule Trigger",
  description: "Runs the workflow automatically on a schedule (cron).",
  category: "Triggers",
  icon: "Clock",
  kind: "trigger",
  inputs: 0,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    {
      key: "mode",
      label: "Repeat",
      type: "select",
      options: [
        { value: "minutes", label: "Every N minutes" },
        { value: "hourly", label: "Hourly" },
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" },
        { value: "custom", label: "Custom cron expression" },
      ],
      default: "daily",
    },
    { key: "minutes", label: "Minutes interval", type: "number", default: 60, showIf: { key: "mode", equals: "minutes" } },
    { key: "hour", label: "Hour (0-23)", type: "number", default: 9, showIf: { key: "mode", equals: "daily" } },
    { key: "minute", label: "Minute (0-59)", type: "number", default: 0, showIf: { key: "mode", equals: "daily" } },
    { key: "weekHour", label: "Hour (0-23)", type: "number", default: 9, showIf: { key: "mode", equals: "weekly" } },
    { key: "weekMinute", label: "Minute (0-59)", type: "number", default: 0, showIf: { key: "mode", equals: "weekly" } },
    {
      key: "dayOfWeek",
      label: "Day of week",
      type: "select",
      options: [
        { value: "1", label: "Monday" }, { value: "2", label: "Tuesday" },
        { value: "3", label: "Wednesday" }, { value: "4", label: "Thursday" },
        { value: "5", label: "Friday" }, { value: "6", label: "Saturday" },
        { value: "0", label: "Sunday" },
      ],
      default: "1",
      showIf: { key: "mode", equals: "weekly" },
    },
    { key: "monthDay", label: "Day of month (1-31)", type: "number", default: 1, showIf: { key: "mode", equals: "monthly" } },
    { key: "monthHour", label: "Hour (0-23)", type: "number", default: 9, showIf: { key: "mode", equals: "monthly" } },
    { key: "monthMinute", label: "Minute (0-59)", type: "number", default: 0, showIf: { key: "mode", equals: "monthly" } },
    { key: "cronExpression", label: "Cron expression (min hour day month weekday)", type: "text", default: "0 9 * * *", showIf: { key: "mode", equals: "custom" }, help: "5-field cron in the workflow timezone, e.g. */15 * * * *" },
    { key: "timezone", label: "Timezone", type: "text", default: "Asia/Kolkata", help: "IANA timezone, e.g. Asia/Kolkata" },
    { key: "enabled", label: "Schedule enabled", type: "boolean", default: true },
  ],
  defaultConfig: {
    mode: "daily",
    hour: 9,
    minute: 0,
    timezone: "Asia/Kolkata",
    enabled: true,
  },
  outputHint: "{ scheduledAt, timezone, cron, timestamp }",
  validate: (config) => {
    const issues: ReturnType<NodeDefinition["validate"]> = [];
    if (config.mode === "custom" && !config.cronExpression) {
      issues.push({ code: "MISSING_REQUIRED_FIELD", field: "cronExpression", message: "Cron expression is required for custom schedules." });
    }
    if (config.mode === "custom") {
      const expr = String(config.cronExpression || "").trim();
      const parts = expr.split(/\s+/);
      if (parts.length !== 5) {
        issues.push({ code: "INVALID_VALUE", field: "cronExpression", message: "Cron expression must have 5 fields (minute hour day-of-month month day-of-week)." });
      }
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, _config: Record<string, unknown>, _input: unknown) {
    const trigger = asObject(ctx.ctx.trigger);
    return {
      status: "succeeded",
      output: {
        scheduledAt: trigger.scheduledAt ?? new Date().toISOString(),
        timezone: trigger.timezone ?? null,
        cron: trigger.cron ?? null,
        timestamp: new Date().toISOString(),
        ...trigger,
      },
    };
  },
};

export const webhookTrigger: NodeDefinition = {
  type: "trigger-webhook",
  version: 1,
  name: "Webhook Trigger",
  description: "Starts the workflow when an external system sends an HTTP request to your unique webhook URL.",
  category: "Triggers",
  icon: "Webhook",
  kind: "trigger",
  inputs: 0,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    {
      key: "note",
      label: "Webhook URL",
      type: "text",
      help: "The unique URL and signing secret are generated for you and shown here once this workflow has a webhook trigger. Requests are accepted after you publish & activate the workflow.",
    },
    {
      key: "requireSignature",
      label: "Require X-Flow-Signature header",
      type: "boolean",
      default: false,
      help: "When enabled, requests must include header X-Flow-Signature: sha256=<hex hmac of raw body with the endpoint secret>.",
    },
    {
      key: "sampleInput",
      label: "Sample body (JSON, for Test run)",
      type: "json",
      help: 'Used as the request body when you press Test run in the editor, e.g. { "name": "Asha", "amount": 1500 }',
    },
  ],
  defaultConfig: { requireSignature: false, sampleInput: "" },
  outputHint: "{ method, headers, query, body, receivedAt }",
  validate: () => [],
  async execute(ctx: NodeExecutionContext, _config: Record<string, unknown>, _input: unknown) {
    const trigger = asObject(ctx.ctx.trigger);
    return {
      status: "succeeded",
      output: {
        method: trigger.method ?? "POST",
        headers: trigger.headers ?? {},
        query: trigger.query ?? {},
        body: trigger.body ?? null,
        receivedAt: trigger.receivedAt ?? new Date().toISOString(),
      },
    };
  },
};
