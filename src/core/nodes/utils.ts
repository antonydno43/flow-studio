/**
 * Shared helpers used by node definitions.
 */
import type { ConfigField, NodeExecutionContext, ValidationIssue } from "@/core/types";
import { resolveTemplate } from "@/core/expression/engine";

export function requireFields(
  config: Record<string, unknown>,
  fields: { key: string; label: string }[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const f of fields) {
    const v = config?.[f.key];
    if (v === undefined || v === null || v === "") {
      issues.push({
        code: "MISSING_REQUIRED_FIELD",
        field: f.key,
        message: `${f.label} is required.`,
      });
    }
  }
  return issues;
}

export function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Resolve an expression config value to a string. Throws on error. */
export function rstr(ctx: NodeExecutionContext, v: unknown): string {
  const r = resolveTemplate(str(v), ctx.ctx);
  if (!r.ok) throw new Error(r.error);
  return r.value === null || r.value === undefined ? "" : String(r.value);
}

/** Resolve an expression config value to a boolean. */
export function rbool(ctx: NodeExecutionContext, v: unknown, fallback = false): boolean {
  if (v === undefined || v === null || v === "") return fallback;
  const r = resolveTemplate(str(v), ctx.ctx);
  if (!r.ok) throw new Error(r.error);
  const val = r.value;
  return val === true || val === "true" || val === 1 || val === "1";
}

/** Resolve an expression config value to a number. */
export function rnum(ctx: NodeExecutionContext, v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const r = resolveTemplate(str(v), ctx.ctx);
  if (!r.ok) throw new Error(r.error);
  const n = Number(r.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Resolve an expression that may return any JSON value. */
export function rval(ctx: NodeExecutionContext, v: unknown): unknown {
  const r = resolveTemplate(str(v), ctx.ctx);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Resolve a list of {key, value} field pairs into an object. */
export function resolveFieldList(
  ctx: NodeExecutionContext,
  list: unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    const e = entry as { key?: string; value?: string };
    if (e?.key) {
      out[e.key] = e.value === undefined || e.value === "" ? "" : rval(ctx, e.value);
    }
  }
  return out;
}

export function parseJsonSafe(text: string): { ok: boolean; value?: unknown; error?: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Resolve a JSON-body config value that may embed {{ }} references.
 * - Full expression (starts with {{): returns the raw evaluated value.
 * - JSON with embedded refs: interpolates, then parses the result as JSON.
 *   Strings should be quoted: "name": "{{ node.field }}"; numbers, booleans
 *   and objects can be inserted bare: "count": {{ node.count }}.
 * - Plain JSON: parsed directly.
 */
export function resolveJsonObject(ctx: NodeExecutionContext, raw: unknown): unknown {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{{")) {
    return rval(ctx, trimmed);
  }
  if (trimmed.includes("{{")) {
    const r = resolveTemplate(trimmed, ctx.ctx);
    if (!r.ok) throw new Error(r.error);
    const parsed = parseJsonSafe(String(r.value));
    if (!parsed.ok) {
      throw new Error(
        `JSON body is invalid after resolving expressions (${parsed.error}). Tip: put string references in quotes - "name": "{{ node.field }}" - and keep numbers/objects unquoted.`
      );
    }
    return parsed.value;
  }
  const parsed = parseJsonSafe(trimmed);
  if (!parsed.ok) throw new Error(`Invalid JSON: ${parsed.error}`);
  return parsed.value;
}

export function truncateForStorage(value: unknown, maxChars = 200_000): unknown {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return value;
  return {
    _truncated: true,
    _note: `Output exceeded ${maxChars} characters and was truncated for storage.`,
    preview: text.slice(0, maxChars),
  };
}

// ---------------------------------------------------------------------------
// Condition evaluation (shared by IF, Filter, Switch)
// ---------------------------------------------------------------------------

export type ConditionOperator =
  | "eq" | "neq" | "gt" | "lt" | "gte" | "lte"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "is_empty" | "is_not_empty" | "exists" | "not_exists" | "regex";

export interface ConditionConfig {
  source: string; // expression producing left value
  operator: ConditionOperator;
  target: string; // expression producing right value
}

export const OPERATOR_OPTIONS = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not equals" },
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
  { value: "gte", label: "Greater than or equal" },
  { value: "lte", label: "Less than or equal" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
  { value: "exists", label: "Exists" },
  { value: "not_exists", label: "Does not exist" },
  { value: "regex", label: "Matches regex" },
];

export function evaluateCondition(
  ctx: NodeExecutionContext,
  cond: ConditionConfig
): boolean {
  const left = cond.source ? rval(ctx, cond.source) : undefined;
  const right = cond.target ? rval(ctx, cond.target) : undefined;
  switch (cond.operator) {
    case "eq": return looseEq(left, right);
    case "neq": return !looseEq(left, right);
    case "gt": return num(left) > num(right);
    case "lt": return num(left) < num(right);
    case "gte": return num(left) >= num(right);
    case "lte": return num(left) <= num(right);
    case "contains": {
      const hay = typeof left === "object" ? JSON.stringify(left) : str(left);
      return hay.includes(str(right));
    }
    case "not_contains": {
      const hay = typeof left === "object" ? JSON.stringify(left) : str(left);
      return !hay.includes(str(right));
    }
    case "starts_with": return str(left).startsWith(str(right));
    case "ends_with": return str(left).endsWith(str(right));
    case "is_empty": return left === "" || left === null || left === undefined ||
      (Array.isArray(left) && left.length === 0);
    case "is_not_empty": return !(left === "" || left === null || left === undefined ||
      (Array.isArray(left) && left.length === 0));
    case "exists": return left !== undefined && left !== null;
    case "not_exists": return left === undefined || left === null;
    case "regex": {
      try { return new RegExp(str(right)).test(str(left)); }
      catch { throw new Error(`Invalid regular expression: ${str(right)}`); }
    }
    default: throw new Error(`Unknown operator "${cond.operator}"`);
  }
}

export function evaluateConditions(
  ctx: NodeExecutionContext,
  conditions: ConditionConfig[],
  combinator: "and" | "or"
): boolean {
  if (!conditions.length) return false;
  return combinator === "and"
    ? conditions.every((c) => evaluateCondition(ctx, c))
    : conditions.some((c) => evaluateCondition(ctx, c));
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Cannot compare "${str(v)}" as a number`);
  return n;
}

function looseEq(l: unknown, r: unknown): boolean {
  if (l == null && r == null) return true;
  if (typeof l === "object" || typeof r === "object") {
    return JSON.stringify(l) === JSON.stringify(r);
  }
  return String(l) === String(r);
}

/** Convert config schema to a plain description for storage/docs. */
export function fieldsDescription(fields: ConfigField[]): string {
  return fields.map((f) => `${f.key} (${f.type}${f.required ? ", required" : ""})`).join(", ");
}
