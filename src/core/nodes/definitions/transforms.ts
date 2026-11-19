/**
 * Data transformation nodes. Each takes the previous node's output and
 * returns a new structured output - these are real transformations.
 */
import type { NodeDefinition, NodeExecutionContext } from "@/core/types";
import {
  requireFields, resolveFieldList, rnum, rstr, rval, parseJsonSafe, truncateForStorage,
} from "@/core/nodes/utils";

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { data: unknown[] }).data;
  }
  return v === undefined || v === null ? [] : [v];
}

function dateDiff(a: Date, b: Date, unit: string): number {
  const ms = a.getTime() - b.getTime();
  switch (unit) {
    case "seconds": return Math.round(ms / 1000);
    case "minutes": return Math.round(ms / 60000);
    case "hours": return Math.round(ms / 3600000);
    case "days": return Math.round(ms / 86400000);
    default: return ms;
  }
}

export const setFieldsNode: NodeDefinition = {
  type: "set-fields",
  version: 1,
  name: "Set Fields",
  description: "Sets new fields on the incoming data using expressions.",
  category: "Data Transformation",
  icon: "Braces",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  outputHint: "{ ...input, <your fields> }",
  configSchema: [{ key: "fields", label: "Fields to set", type: "fields", required: true }],
  defaultConfig: { fields: [] },
  validate: (config) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    if (!fields.some((f) => (f as { key?: string })?.key)) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "fields", message: "Add at least one field." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const base = input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
    const values = resolveFieldList(ctx, config.fields);
    return { status: "succeeded", output: { ...base, ...values } };
  },
};

export const editFieldsNode: NodeDefinition = {
  type: "edit-fields",
  version: 1,
  name: "Edit Fields",
  description: "Set, rename, or remove fields in one operation.",
  category: "Data Transformation",
  icon: "FilePen",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  outputHint: "{ ...edited fields }",
  configSchema: [
    {
      key: "operations", label: "Field operations", type: "fieldOps",
      help: "Set: key = new value (expression). Rename: from -> to. Remove: delete the key.",
      required: true,
    },
  ],
  defaultConfig: { operations: [] },
  validate: (config) => {
    const ops = Array.isArray(config.operations) ? config.operations : [];
    if (!ops.length) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "operations", message: "Add at least one field operation." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const obj = input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
    const ops = (Array.isArray(config.operations) ? config.operations : []) as {
      op?: string; key?: string; value?: string; to?: string;
    }[];
    for (const op of ops) {
      if (!op) continue;
      if (op.op === "remove" && op.key) {
        delete obj[op.key];
      } else if (op.op === "rename" && op.key && op.to) {
        if (op.key in obj) {
          obj[op.to] = obj[op.key];
          delete obj[op.key];
        }
      } else if (op.key) {
        obj[op.key] = op.value ? rval(ctx, op.value) : "";
      }
    }
    return { status: "succeeded", output: obj };
  },
};

export const renameFieldsNode: NodeDefinition = {
  type: "rename-fields",
  version: 1,
  name: "Rename Fields",
  description: "Renames fields using a from/to list.",
  category: "Data Transformation",
  icon: "TextCursorInput",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  outputHint: "{ ...renamed fields }",
  configSchema: [{ key: "renames", label: "Renames (from -> to)", type: "renames", required: true }],
  defaultConfig: { renames: [] },
  validate: (config) => {
    const ops = Array.isArray(config.renames) ? config.renames : [];
    if (!ops.length) return [{ code: "MISSING_REQUIRED_FIELD", field: "renames", message: "Add at least one rename." }];
    return [];
  },
  async execute(_ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const obj = input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
    for (const r of (Array.isArray(config.renames) ? config.renames : []) as { from?: string; to?: string }[]) {
      if (r?.from && r?.to && r.from in obj) {
        obj[r.to] = obj[r.from];
        delete obj[r.from];
      }
    }
    return { status: "succeeded", output: obj };
  },
};

export const removeFieldsNode: NodeDefinition = {
  type: "remove-fields",
  version: 1,
  name: "Remove Fields",
  description: "Removes the listed fields from the input.",
  category: "Data Transformation",
  icon: "Eraser",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    { key: "keys", label: "Field keys to remove", type: "text", required: true, help: "Comma-separated list, e.g. password, internalId" },
  ],
  defaultConfig: { keys: "" },
  validate: (config) => requireFields(config, [{ key: "keys", label: "Field keys" }]),
  async execute(_ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const obj = input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
    const keys = String(config.keys || "").split(",").map((k) => k.trim()).filter(Boolean);
    for (const k of keys) delete obj[k];
    return { status: "succeeded", output: obj };
  },
};

export const jsonParseNode: NodeDefinition = {
  type: "json-parse",
  version: 1,
  name: "JSON Parse",
  description: "Parses a JSON string into structured data.",
  category: "Data Transformation",
  icon: "FileJson",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Parsed JSON" }],
  outputHint: "<parsed object or array>",
  configSchema: [
    { key: "source", label: "JSON source", type: "expression", help: "Leave empty to use the previous node output. Use e.g. {{ node_abc.data }} to parse a specific field." },
  ],
  defaultConfig: { source: "" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    let raw: unknown = input;
    if (config.source) raw = rval(ctx, config.source);
    if (raw && typeof raw === "object") {
      return { status: "succeeded", output: raw, logs: ["Input is already an object; passed through."] };
    }
    const parsed = parseJsonSafe(String(raw ?? ""));
    if (!parsed.ok) {
      return { status: "failed", error: { message: `Invalid JSON: ${parsed.error}` } };
    }
    return { status: "succeeded", output: parsed.value };
  },
};

export const jsonCreateNode: NodeDefinition = {
  type: "json-create",
  version: 1,
  name: "JSON Create",
  description: "Builds a JSON object from mapped fields.",
  category: "Data Transformation",
  icon: "FileJson2",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "JSON object" }],
  configSchema: [{ key: "fields", label: "JSON fields", type: "fields", required: true }],
  defaultConfig: { fields: [] },
  validate: (config) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    if (!fields.some((f) => (f as { key?: string })?.key)) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "fields", message: "Add at least one field." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>) {
    return { status: "succeeded", output: resolveFieldList(ctx, config.fields) };
  },
};

export const csvParseNode: NodeDefinition = {
  type: "csv-parse",
  version: 1,
  name: "CSV Parse",
  description: "Parses CSV text into an array of row objects.",
  category: "Data Transformation",
  icon: "Sheet",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Rows" }],
  outputHint: "{ data: [ { col: value, ... } ] }",
  configSchema: [
    { key: "source", label: "CSV source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "delimiter", label: "Delimiter", type: "select", options: [{ value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }, { value: "\t", label: "Tab" }], default: "," },
    { key: "hasHeaderRow", label: "First row is the header", type: "boolean", default: true },
  ],
  defaultConfig: { delimiter: ",", hasHeaderRow: true },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    let raw: unknown = input;
    if (config.source) raw = rval(ctx, config.source);
    const text = raw && typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
    const delimiter = String(config.delimiter || ",");
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) return { status: "succeeded", output: { data: [] } };
    const splitLine = (line: string) => {
      const cells: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === delimiter && !inQuotes) {
          cells.push(cur); cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      return cells;
    };
    const header = config.hasHeaderRow === false
      ? splitLine(lines[0]).map((_, i) => `column_${i + 1}`)
      : splitLine(lines[0]).map((h) => h.trim());
    const rows: Record<string, string>[] = [];
    const dataLines = config.hasHeaderRow === false ? lines : lines.slice(1);
    for (const line of dataLines) {
      const cells = splitLine(line);
      const row: Record<string, string> = {};
      header.forEach((h, i) => {
        row[h] = (cells[i] ?? "").trim();
      });
      rows.push(row);
    }
    return { status: "succeeded", output: { data: rows, columns: header } };
  },
};

export const csvGenerateNode: NodeDefinition = {
  type: "csv-generate",
  version: 1,
  name: "CSV Generate",
  description: "Converts an array of objects into CSV text.",
  category: "Data Transformation",
  icon: "FileSpreadsheet",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "CSV text" }],
  outputHint: "{ csv: \"col1,col2...\" }",
  configSchema: [
    { key: "source", label: "Array source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "delimiter", label: "Delimiter", type: "select", options: [{ value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }], default: "," },
  ],
  defaultConfig: { delimiter: "," },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    const rows = toArray(value);
    const delimiter = String(config.delimiter || ",");
    const header = [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : [])))];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return s.includes(delimiter) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(delimiter)];
    for (const row of rows) {
      lines.push(header.map((h) => esc((row as Record<string, unknown>)?.[h])).join(delimiter));
    }
    return { status: "succeeded", output: { csv: lines.join("\n"), rowCount: rows.length, columns: header } };
  },
};

export const textFormatterNode: NodeDefinition = {
  type: "text-formatter",
  version: 1,
  name: "Text Formatter",
  description: "Transforms text: change case, trim, truncate, extract.",
  category: "Data Transformation",
  icon: "Type",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    { key: "source", label: "Text source", type: "expression", help: "Leave empty to use the previous node output." },
    {
      key: "operation", label: "Operation", type: "select",
      options: [
        { value: "uppercase", label: "UPPERCASE" },
        { value: "lowercase", label: "lowercase" },
        { value: "title", label: "Title Case" },
        { value: "capitalize", label: "Capitalize first letter" },
        { value: "trim", label: "Trim whitespace" },
        { value: "truncate", label: "Truncate" },
        { value: "extract_json", label: "Extract JSON from text" },
        { value: "template", label: "Template (interpolate)" },
      ],
      default: "trim",
    },
    { key: "maxLength", label: "Max length (truncate)", type: "number", default: 100, showIf: { key: "operation", equals: "truncate" } },
    { key: "template", label: "Template", type: "expression", showIf: { key: "operation", equals: "template" }, help: "e.g. Order {{ $trigger.body.id }} received" },
  ],
  defaultConfig: { operation: "trim" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const raw = config.source ? rval(ctx, config.source) : input;
    const text = raw && typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
    switch (String(config.operation)) {
      case "uppercase": return { status: "succeeded", output: { text: text.toUpperCase() } };
      case "lowercase": return { status: "succeeded", output: { text: text.toLowerCase() } };
      case "title": return { status: "succeeded", output: { text: text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) } };
      case "capitalize": return { status: "succeeded", output: { text: text.charAt(0).toUpperCase() + text.slice(1) } };
      case "trim": return { status: "succeeded", output: { text: text.trim() } };
      case "truncate": {
        const max = rnum(ctx, config.maxLength, 100);
        return { status: "succeeded", output: { text: text.length > max ? text.slice(0, max) + "..." : text } };
      }
      case "extract_json": {
        const m = text.match(/[{[][\s\S]*[}\]]/);
        if (!m) return { status: "failed", error: { message: "No JSON found in text." } };
        const parsed = parseJsonSafe(m[0]);
        if (!parsed.ok) return { status: "failed", error: { message: `Found JSON-like text but it is invalid: ${parsed.error}` } };
        return { status: "succeeded", output: parsed.value };
      }
      case "template": {
        return { status: "succeeded", output: { text: rstr(ctx, config.template) } };
      }
      default: return { status: "failed", error: { message: `Unknown operation ${config.operation}` } };
    }
  },
};

export const replaceTextNode: NodeDefinition = {
  type: "replace-text",
  version: 1,
  name: "Replace Text",
  description: "Finds and replaces text (optional regex).",
  category: "Data Transformation",
  icon: "Replace",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    { key: "source", label: "Text source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "find", label: "Find", type: "text", required: true },
    { key: "replace", label: "Replace with", type: "text" },
    { key: "useRegex", label: "Use regular expression", type: "boolean", default: false },
    { key: "caseSensitive", label: "Case sensitive", type: "boolean", default: true },
  ],
  defaultConfig: { useRegex: false, caseSensitive: true },
  validate: (config) => requireFields(config, [{ key: "find", label: "Find" }]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const raw = config.source ? rval(ctx, config.source) : input;
    const text = raw && typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
    const find = String(config.find ?? "");
    const replacement = config.replace === undefined ? "" : rstr(ctx, config.replace);
    try {
      if (config.useRegex) {
        const flags = config.caseSensitive ? "g" : "gi";
        const re = new RegExp(find, flags);
        return { status: "succeeded", output: { text: text.replace(re, replacement) } };
      }
      const flags = config.caseSensitive ? "g" : "gi";
      const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      return { status: "succeeded", output: { text: text.replace(re, replacement) } };
    } catch (err) {
      return { status: "failed", error: { message: `Invalid regex: ${(err as Error).message}` } };
    }
  },
};

export const splitTextNode: NodeDefinition = {
  type: "split-text",
  version: 1,
  name: "Split Text",
  description: "Splits text into an array by a separator.",
  category: "Data Transformation",
  icon: "Scissors",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Parts" }],
  configSchema: [
    { key: "source", label: "Text source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "separator", label: "Separator", type: "text", required: true, placeholder: "," },
    { key: "trim", label: "Trim each part", type: "boolean", default: true },
  ],
  defaultConfig: { trim: true },
  validate: (config) => requireFields(config, [{ key: "separator", label: "Separator" }]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const raw = config.source ? rval(ctx, config.source) : input;
    const text = raw && typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? "");
    let parts = text.split(String(config.separator ?? ","));
    if (config.trim !== false) parts = parts.map((p) => p.trim());
    return { status: "succeeded", output: { data: parts, count: parts.length } };
  },
};

export const joinTextNode: NodeDefinition = {
  type: "join-text",
  version: 1,
  name: "Join Text",
  description: "Joins an array into a single string.",
  category: "Data Transformation",
  icon: "Link2",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Text" }],
  configSchema: [
    { key: "source", label: "Array source", type: "expression", help: "Leave empty to use the previous node output (or its data field)." },
    { key: "separator", label: "Separator", type: "text", default: ", " },
  ],
  defaultConfig: { separator: ", " },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    const items = toArray(value);
    return { status: "succeeded", output: { text: items.map(String).join(String(config.separator ?? ", ")) } };
  },
};

export const arrayAggregatorNode: NodeDefinition = {
  type: "array-aggregator",
  version: 1,
  name: "Array Aggregator",
  description: "Collects the input into an array. Useful after loops.",
  category: "Data Transformation",
  icon: "ListOrdered",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Array" }],
  configSchema: [
    { key: "source", label: "Source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "fieldName", label: "Output field name", type: "text", default: "data" },
  ],
  defaultConfig: { fieldName: "data" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    const key = String(config.fieldName || "data");
    if (Array.isArray(value)) return { status: "succeeded", output: { [key]: value, count: value.length } };
    const items = toArray(value);
    return { status: "succeeded", output: { [key]: items, count: items.length } };
  },
};

export const objectAggregatorNode: NodeDefinition = {
  type: "object-aggregator",
  version: 1,
  name: "Object Aggregator",
  description: "Builds an object from mapped fields.",
  category: "Data Transformation",
  icon: "Boxes",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Object" }],
  configSchema: [{ key: "fields", label: "Object fields", type: "fields", required: true }],
  defaultConfig: { fields: [] },
  validate: (config) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    if (!fields.some((f) => (f as { key?: string })?.key)) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "fields", message: "Add at least one field." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>) {
    return { status: "succeeded", output: resolveFieldList(ctx, config.fields) };
  },
};

export const dateFormatterNode: NodeDefinition = {
  type: "date-formatter",
  version: 1,
  name: "Date Formatter",
  description: "Formats a date/time value (ISO or timestamp).",
  category: "Data Transformation",
  icon: "CalendarClock",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    { key: "source", label: "Date source", type: "expression", help: "ISO string, timestamp (ms), or empty for now." },
    {
      key: "format", label: "Output format", type: "select",
      options: [
        { value: "yyyy-MM-dd", label: "2024-05-01" },
        { value: "dd/MM/yyyy", label: "01/05/2024" },
        { value: "yyyy-MM-dd HH:mm:ss", label: "2024-05-01 14:30:00" },
        { value: "iso", label: "ISO 8601" },
        { value: "HH:mm", label: "14:30" },
        { value: "timestamp", label: "Unix timestamp (ms)" },
      ],
      default: "yyyy-MM-dd",
    },
    { key: "addDays", label: "Add days (can be negative)", type: "number", default: 0 },
    { key: "addHours", label: "Add hours", type: "number", default: 0 },
  ],
  defaultConfig: { format: "yyyy-MM-dd", addDays: 0, addHours: 0 },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    let raw: unknown = input;
    if (config.source) raw = rval(ctx, config.source);
    let date: Date;
    if (raw === undefined || raw === null || raw === "") date = new Date();
    else if (typeof raw === "number") date = new Date(raw);
    else {
      const s = String(raw);
      date = new Date(/^\d+$/.test(s) ? Number(s) : s);
    }
    if (Number.isNaN(date.getTime())) {
      return { status: "failed", error: { message: `Invalid date value: "${String(raw)}"` } };
    }
    date = new Date(date.getTime() + rnum(ctx, config.addDays, 0) * 86400000 + rnum(ctx, config.addHours, 0) * 3600000);
    const format = String(config.format || "yyyy-MM-dd");
    const pad = (n: number) => String(n).padStart(2, "0");
    let out: string;
    switch (format) {
      case "iso": out = date.toISOString(); break;
      case "timestamp": out = String(date.getTime()); break;
      case "dd/MM/yyyy": out = `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`; break;
      case "HH:mm": out = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`; break;
      default:
        out = format
          .replace("yyyy", String(date.getUTCFullYear()))
          .replace("MM", pad(date.getUTCMonth() + 1))
          .replace("dd", pad(date.getUTCDate()))
          .replace("HH", pad(date.getUTCHours()))
          .replace("mm", pad(date.getUTCMinutes()))
          .replace("ss", pad(date.getUTCSeconds()));
    }
    return { status: "succeeded", output: { date: out, iso: date.toISOString() } };
  },
};

export const dateDiffNode: NodeDefinition = {
  type: "date-diff",
  version: 1,
  name: "Date Difference",
  description: "Computes the difference between two dates.",
  category: "Data Transformation",
  icon: "CalendarDiff",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  configSchema: [
    { key: "dateA", label: "Date A (expression)", type: "expression", required: true },
    { key: "dateB", label: "Date B (expression)", type: "expression", help: "Leave empty to use the current time." },
    {
      key: "unit", label: "Result unit", type: "select",
      options: ["seconds", "minutes", "hours", "days"].map((u) => ({ value: u, label: u })),
      default: "days",
    },
  ],
  defaultConfig: { unit: "days" },
  validate: (config) => requireFields(config, [{ key: "dateA", label: "Date A" }]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>) {
    const a = new Date(rstr(ctx, config.dateA));
    if (Number.isNaN(a.getTime())) return { status: "failed", error: { message: "Date A is not a valid date." } };
    const bRaw = config.dateB ? rstr(ctx, config.dateB) : new Date().toISOString();
    const b = new Date(bRaw);
    if (Number.isNaN(b.getTime())) return { status: "failed", error: { message: "Date B is not a valid date." } };
    const diff = dateDiff(a, b, String(config.unit || "days"));
    return { status: "succeeded", output: { difference: diff, unit: config.unit, dateA: a.toISOString(), dateB: b.toISOString() } };
  },
};

export const mathNode: NodeDefinition = {
  type: "math",
  version: 1,
  name: "Math Operations",
  description: "Computes a math expression or aggregates numbers from an array.",
  category: "Data Transformation",
  icon: "Calculator",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Result" }],
  configSchema: [
    {
      key: "mode", label: "Mode", type: "radio",
      options: [
        { value: "expression", label: "Evaluate expression" },
        { value: "aggregate", label: "Aggregate array" },
      ],
      default: "expression",
    },
    { key: "expression", label: "Expression", type: "expression", showIf: { key: "mode", equals: "expression" }, help: "e.g. {{ $trigger.body.price }} * 1.18" },
    {
      key: "operation", label: "Operation", type: "select",
      options: ["sum", "avg", "min", "max", "count"].map((o) => ({ value: o, label: o })),
      default: "sum", showIf: { key: "mode", equals: "aggregate" },
    },
    { key: "source", label: "Array source", type: "expression", showIf: { key: "mode", equals: "aggregate" }, help: "Expression returning an array of numbers." },
  ],
  defaultConfig: { mode: "expression" },
  validate: (config) => {
    if (config.mode === "expression" && !config.expression) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "expression", message: "Enter a math expression." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>) {
    if (String(config.mode) === "aggregate") {
      const value = rval(ctx, config.source);
      const arr = Array.isArray(value) ? value : toArray(value);
      const nums = arr.map((v) => (typeof v === "object" ? Number((v as Record<string, unknown>).value ?? (v as Record<string, unknown>).amount ?? NaN) : Number(v))).filter((n) => Number.isFinite(n));
      switch (String(config.operation || "sum")) {
        case "sum": return { status: "succeeded", output: { result: nums.reduce((a, b) => a + b, 0) } };
        case "avg": return { status: "succeeded", output: { result: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000 : 0 } };
        case "min": return { status: "succeeded", output: { result: nums.length ? Math.min(...nums) : null } };
        case "max": return { status: "succeeded", output: { result: nums.length ? Math.max(...nums) : null } };
        case "count": return { status: "succeeded", output: { result: arr.length } };
      }
    }
    // Allow mixing {{ refs }} with operators: "({{ a }} + {{ b }}) * 2"
    const expr = String(config.expression ?? "");
    const normalized = expr.includes("{{")
      ? expr.replace(/\{\{([\s\S]*?)\}\}/g, "($1)")
      : expr;
    const r = rval(ctx, `{{ ${normalized} }}`);
    const n = Number(r);
    if (!Number.isFinite(n)) {
      return { status: "failed", error: { message: `Math expression did not produce a number (got ${typeof r === "object" ? JSON.stringify(r) : typeof r}).` } };
    }
    return { status: "succeeded", output: { result: n } };
  },
};

export const typeConversionNode: NodeDefinition = {
  type: "type-conversion",
  version: 1,
  name: "Type Conversion",
  description: "Converts a value between string, number, boolean, and JSON.",
  category: "Data Transformation",
  icon: "Repeat2",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Converted" }],
  configSchema: [
    { key: "source", label: "Value source", type: "expression", help: "Leave empty to use the previous node output." },
    {
      key: "targetType", label: "Convert to", type: "select",
      options: [
        { value: "string", label: "String" },
        { value: "number", label: "Number" },
        { value: "boolean", label: "Boolean" },
        { value: "json", label: "JSON (parse string)" },
      ],
      default: "string",
    },
  ],
  defaultConfig: { targetType: "string" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    switch (String(config.targetType || "string")) {
      case "string": return { status: "succeeded", output: { value: value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "") } };
      case "number": {
        const n = Number(value);
        if (Number.isNaN(n)) return { status: "failed", error: { message: `Cannot convert "${String(value)}" to a number.` } };
        return { status: "succeeded", output: { value: n } };
      }
      case "boolean": {
        if (value === "false" || value === false || value === 0 || value === "") return { status: "succeeded", output: { value: false } };
        return { status: "succeeded", output: { value: true } };
      }
      case "json": {
        const parsed = parseJsonSafe(typeof value === "string" ? value : JSON.stringify(value));
        if (!parsed.ok) return { status: "failed", error: { message: `Cannot parse as JSON: ${parsed.error}` } };
        return { status: "succeeded", output: parsed.value };
      }
      default: return { status: "failed", error: { message: "Unknown target type." } };
    }
  },
};

export const sortArrayNode: NodeDefinition = {
  type: "sort-array",
  version: 1,
  name: "Sort Array",
  description: "Sorts an array by a field or naturally.",
  category: "Data Transformation",
  icon: "ArrowDownAz",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Sorted" }],
  configSchema: [
    { key: "source", label: "Array source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "key", label: "Sort by field", type: "text", help: "Empty = natural sort of values." },
    { key: "order", label: "Order", type: "select", options: [{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }], default: "asc" },
  ],
  defaultConfig: { order: "asc" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    const arr = [...toArray(value)];
    const key = String(config.key || "").trim();
    const dir = config.order === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      const av = key ? (a as Record<string, unknown>)?.[key] : a;
      const bv = key ? (b as Record<string, unknown>)?.[key] : b;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
    return { status: "succeeded", output: { data: arr, count: arr.length } };
  },
};

export const removeDuplicatesNode: NodeDefinition = {
  type: "remove-duplicates",
  version: 1,
  name: "Remove Duplicates",
  description: "Removes duplicate items from an array.",
  category: "Data Transformation",
  icon: "CopyX",
  kind: "action",
  inputs: 1,
  outputs: [{ id: "out", label: "Unique items" }],
  configSchema: [
    { key: "source", label: "Array source", type: "expression", help: "Leave empty to use the previous node output." },
    { key: "key", label: "Compare by field", type: "text", help: "Empty = compare full items." },
  ],
  defaultConfig: {},
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = config.source ? rval(ctx, config.source) : input;
    const arr = toArray(value);
    const key = String(config.key || "").trim();
    const seen = new Set<string>();
    const out: unknown[] = [];
    let removed = 0;
    for (const item of arr) {
      const k = key ? String((item as Record<string, unknown>)?.[key]) : JSON.stringify(item ?? null);
      if (seen.has(k)) { removed++; continue; }
      seen.add(k);
      out.push(item);
    }
    return { status: "succeeded", output: truncateForStorage({ data: out, count: out.length, removed }) };
  },
};
