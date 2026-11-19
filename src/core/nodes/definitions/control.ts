/**
 * Control-flow nodes: IF/ELSE, Switch, Filter, Loop Over Items,
 * Split in Batches, Loop End, Merge, Wait/Delay, Stop/Error.
 */
import type { NodeDefinition, NodeExecutionContext } from "@/core/types";
import {
  evaluateConditions, requireFields, rval, rnum, rstr,
  type ConditionConfig, OPERATOR_OPTIONS,
} from "@/core/nodes/utils";

function getConditions(config: Record<string, unknown>): ConditionConfig[] {
  return Array.isArray(config.conditions)
    ? (config.conditions as ConditionConfig[]).filter((c) => c && c.source !== undefined)
    : [];
}

export const ifNode: NodeDefinition = {
  type: "if",
  version: 1,
  name: "IF / ELSE",
  description: "Routes execution down a True or False branch based on conditions.",
  category: "Conditions & Logic",
  icon: "GitBranch",
  kind: "logic",
  inputs: 1,
  outputs: [
    { id: "true", label: "True", color: "#14B8A6" },
    { id: "false", label: "False", color: "#F97316" },
  ],
  configSchema: [
    {
      key: "combinator", label: "Multiple conditions", type: "radio",
      options: [{ value: "and", label: "ALL conditions (AND)" }, { value: "or", label: "ANY condition (OR)" }],
      default: "and",
    },
    {
      key: "conditions", label: "Conditions", type: "conditions",
      help: "Values support expressions like $trigger.body.amount or a previous node id. Operators: " + OPERATOR_OPTIONS.map((o) => o.label).join(", ") + ".",
    },
  ],
  defaultConfig: { combinator: "and", conditions: [] },
  outputHint: "{ conditionMet: true|false, input }",
  validate: (config) => {
    const conds = getConditions(config);
    if (!conds.length) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "conditions", message: "Add at least one condition." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const met = evaluateConditions(ctx, getConditions(config), (config.combinator as "and" | "or") || "and");
    return {
      status: "succeeded",
      output: { conditionMet: met, input },
      activatePorts: [met ? "true" : "false"],
    };
  },
};

export const switchNode: NodeDefinition = {
  type: "switch",
  version: 1,
  name: "Switch",
  description: "Routes execution to one of up to 5 branches (or default).",
  category: "Conditions & Logic",
  icon: "Split",
  kind: "logic",
  inputs: 1,
  outputs: [
    { id: "0", label: "Case 1" },
    { id: "1", label: "Case 2" },
    { id: "2", label: "Case 3" },
    { id: "3", label: "Case 4" },
    { id: "4", label: "Case 5" },
    { id: "default", label: "Default", color: "#768196" },
  ],
  configSchema: [
    { key: "source", label: "Value", type: "expression", required: true, help: "Expression producing the value to switch on, e.g. $trigger.body.country" },
    {
      key: "cases", label: "Cases", type: "cases",
      help: "Case value 1 goes to output 1, and so on. Leave a case empty to skip it.",
    },
    { key: "useDefault", label: "Use default branch when nothing matches", type: "boolean", default: true },
  ],
  defaultConfig: { source: "", cases: [], useDefault: true },
  outputHint: "{ matchedCase: <index or 'default'>, value, input }",
  validate: (config) => {
    const issues = requireFields(config, [{ key: "source", label: "Value" }]);
    const cases = Array.isArray(config.cases) ? config.cases : [];
    if (!cases.some((c) => String((c as { value?: string })?.value ?? "") !== "")) {
      issues.push({ code: "MISSING_REQUIRED_FIELD", field: "cases", message: "Add at least one case value." });
    }
    return issues;
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    const value = rval(ctx, config.source);
    const cases = (Array.isArray(config.cases) ? config.cases : []) as { value?: string }[];
    for (let i = 0; i < Math.min(cases.length, 5); i++) {
      const caseValue = cases[i]?.value;
      if (caseValue === undefined || caseValue === "") continue;
      const caseVal = rval(ctx, caseValue);
      if (String(value) === String(caseVal)) {
        return {
          status: "succeeded",
          output: { matchedCase: i, value, input },
          activatePorts: [String(i)],
        };
      }
    }
    if (config.useDefault !== false) {
      return { status: "succeeded", output: { matchedCase: "default", value, input }, activatePorts: ["default"] };
    }
    return { status: "succeeded", output: { matchedCase: null, value, input }, activatePorts: [] };
  },
};

export const filterNode: NodeDefinition = {
  type: "filter",
  version: 1,
  name: "Filter",
  description: "Filters items in an array, keeping only those matching conditions.",
  category: "Conditions & Logic",
  icon: "Filter",
  kind: "logic",
  inputs: 1,
  outputs: [{ id: "out", label: "Filtered items" }],
  outputHint: "[ ...items that matched ]",
  configSchema: [
    {
      key: "combinator", label: "Multiple conditions", type: "radio",
      options: [{ value: "and", label: "ALL (AND)" }, { value: "or", label: "ANY (OR)" }],
      default: "and",
    },
    { key: "conditions", label: "Conditions", type: "conditions", help: "Use $item to reference the item being tested, e.g. source: {{ $item.status }} equals \"active\"." },
  ],
  defaultConfig: { combinator: "and", conditions: [] },
  validate: (config) =>
    getConditions(config).length
      ? []
      : [{ code: "MISSING_REQUIRED_FIELD", field: "conditions", message: "Add at least one filter condition." }],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    let items: unknown[];
    if (Array.isArray(input)) items = input;
    else if (input && typeof input === "object") {
      const data = (input as Record<string, unknown>).data;
      items = Array.isArray(data) ? data : [input];
    } else if (input === undefined || input === null) items = [];
    else items = [input];

    const conds = getConditions(config);
    const combinator = (config.combinator as "and" | "or") || "and";
    const kept: unknown[] = [];
    let tested = 0;
    for (const item of items) {
      // Evaluate conditions with $item bound
      const results = conds.map((c) =>
        evaluateConditionWithItem(ctx, c, item)
      );
      const pass = combinator === "and" ? results.every(Boolean) : results.some(Boolean);
      tested++;
      if (pass) kept.push(item);
    }
    return { status: "succeeded", output: { data: kept, total: items.length, kept: kept.length, tested } };
  },
};

function evaluateConditionWithItem(ctx: NodeExecutionContext, cond: ConditionConfig, item: unknown): boolean {
  // Rebind $item for this condition evaluation
  const prevItem = ctx.ctx.item;
  ctx.ctx.item = item;
  try {
    const left = cond.source ? rval(ctx, cond.source) : undefined;
    const right = cond.target ? rval(ctx, cond.target) : undefined;
    switch (cond.operator) {
      case "eq": return String(left) === String(right);
      case "neq": return String(left) !== String(right);
      case "gt": return Number(left) > Number(right);
      case "lt": return Number(left) < Number(right);
      case "gte": return Number(left) >= Number(right);
      case "lte": return Number(left) <= Number(right);
      case "contains": return JSON.stringify(left ?? "").includes(String(right ?? ""));
      case "not_contains": return !JSON.stringify(left ?? "").includes(String(right ?? ""));
      case "starts_with": return String(left ?? "").startsWith(String(right ?? ""));
      case "ends_with": return String(left ?? "").endsWith(String(right ?? ""));
      case "is_empty": return left === "" || left === null || left === undefined;
      case "is_not_empty": return !(left === "" || left === null || left === undefined);
      case "exists": return left !== undefined && left !== null;
      case "not_exists": return left === undefined || left === null;
      case "regex": return new RegExp(String(right ?? "")).test(String(left ?? ""));
      default: return false;
    }
  } finally {
    ctx.ctx.item = prevItem;
  }
}

export const loopItemsNode: NodeDefinition = {
  type: "loop-items",
  version: 1,
  name: "Loop Over Items",
  description: "Iterates over an array and runs the loop body once per item. Close the loop with a Loop End node.",
  category: "Loops",
  icon: "Repeat",
  kind: "logic",
  inputs: 1,
  outputs: [{ id: "body", label: "Loop body", color: "#6757D9" }],
  outputHint: "{ items: [...], count } then per-iteration body via $item / $index",
  configSchema: [
    { key: "items", label: "Items", type: "expression", required: true, help: "Expression returning an array, e.g. {{ $trigger.body.orders }} or {{ node_abc123.data }}" },
    { key: "maxIterations", label: "Max iterations (safety limit)", type: "number", default: 1000 },
    { key: "continueOnError", label: "Continue to next item when body fails", type: "boolean", default: false },
  ],
  defaultConfig: { items: "", maxIterations: 1000, continueOnError: false },
  validate: (config) => requireFields(config, [{ key: "items", label: "Items" }]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    const value = rval(ctx, config.items);
    let items: unknown[];
    if (Array.isArray(value)) items = value;
    else if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
      items = (value as { data: unknown[] }).data;
    } else if (value === undefined || value === null || value === "") {
      items = [];
    } else {
      return {
        status: "failed",
        error: { message: `Expression did not return an array (got ${Array.isArray(value) ? "array" : typeof value}).` },
      };
    }
    const max = rnum(ctx, config.maxIterations, 1000);
    if (items.length > max) {
      items = items.slice(0, max);
    }
    return {
      status: "succeeded",
      output: { items, count: items.length },
      loop: { items, batchSize: 1, continueOnError: config.continueOnError === true, delayMs: 0 },
    };
  },
};

export const splitBatchesNode: NodeDefinition = {
  type: "split-batches",
  version: 1,
  name: "Split in Batches",
  description: "Splits an array into batches and processes each batch inside the loop body.",
  category: "Loops",
  icon: "Layers",
  kind: "logic",
  inputs: 1,
  outputs: [{ id: "body", label: "Loop body", color: "#6757D9" }],
  outputHint: "{ batches: n, batchSize } - inside the body $item is the batch array",
  configSchema: [
    { key: "items", label: "Items", type: "expression", required: true },
    { key: "batchSize", label: "Batch size", type: "number", default: 10 },
    { key: "maxBatches", label: "Max batches (safety limit)", type: "number", default: 100 },
    { key: "delayMs", label: "Delay between batches (ms)", type: "number", default: 0 },
    { key: "continueOnError", label: "Continue to next batch when body fails", type: "boolean", default: false },
  ],
  defaultConfig: { items: "", batchSize: 10, maxBatches: 100, delayMs: 0, continueOnError: false },
  validate: (config) => requireFields(config, [{ key: "items", label: "Items" }]),
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    const value = rval(ctx, config.items);
    if (!Array.isArray(value)) {
      return { status: "failed", error: { message: `Expression did not return an array (got ${typeof value}).` } };
    }
    const size = Math.max(1, rnum(ctx, config.batchSize, 10));
    const maxBatches = Math.max(1, rnum(ctx, config.maxBatches, 100));
    const batches: unknown[][] = [];
    for (let i = 0; i < value.length && batches.length < maxBatches; i += size) {
      batches.push(value.slice(i, i + size));
    }
    return {
      status: "succeeded",
      output: { batches: batches.length, batchSize: size, totalItems: value.length },
      loop: {
        items: batches,
        batchSize: size,
        continueOnError: config.continueOnError === true,
        delayMs: rnum(ctx, config.delayMs, 0),
      },
    };
  },
};

export const loopEndNode: NodeDefinition = {
  type: "loop-end",
  version: 1,
  name: "Loop End",
  description: "Closes a loop body. Aggregates the output of every iteration.",
  category: "Loops",
  icon: "CornerDownLeft",
  kind: "logic",
  inputs: 1,
  outputs: [{ id: "out", label: "Aggregated results" }],
  outputHint: "[ ...per-iteration outputs ] (collect) or last output (last)",
  configSchema: [
    {
      key: "mode", label: "Output", type: "radio",
      options: [
        { value: "collect", label: "Collect all iteration outputs into an array" },
        { value: "last", label: "Pass through the last iteration output" },
      ],
      default: "collect",
    },
  ],
  defaultConfig: { mode: "collect" },
  validate: () => [],
  // The engine aggregates iteration outputs; execute() just passes through.
  async execute(_ctx: NodeExecutionContext, _config: Record<string, unknown>, input: unknown) {
    return { status: "succeeded", output: input };
  },
};

export const mergeNode: NodeDefinition = {
  type: "merge",
  version: 1,
  name: "Merge",
  description: "Combines results from multiple branches and continues with a single output.",
  category: "Conditions & Logic",
  icon: "GitMerge",
  kind: "logic",
  inputs: 5,
  outputs: [{ id: "out", label: "Merged" }],
  outputHint: "{ merged: [...branch outputs], branchCount }",
  configSchema: [
    {
      key: "mode", label: "Merge mode", type: "select",
      options: [
        { value: "append", label: "Append outputs into one array" },
        { value: "combine_position", label: "Combine by position (zip)" },
        { value: "combine_key", label: "Combine by matching key" },
        { value: "passthrough", label: "Pass through first completed branch" },
      ],
      default: "append",
    },
    { key: "keyField", label: "Key field (for combine by key)", type: "text", default: "id", showIf: { key: "mode", equals: "combine_key" } },
  ],
  defaultConfig: { mode: "append", keyField: "id" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    // Engine passes an array of branch outputs (from active incoming edges)
    const branches = Array.isArray(input) ? input : [input];
    const mode = String(config.mode || "append");
    if (mode === "passthrough") {
      return { status: "succeeded", output: branches[0] ?? null };
    }
    if (mode === "combine_position") {
      const arrays = branches.map((b) => (Array.isArray(b) ? b : [b]));
      const maxLen = Math.max(...arrays.map((a) => a.length), 0);
      const combined: unknown[][] = [];
      for (let i = 0; i < maxLen; i++) {
        combined.push(arrays.map((a) => a[i] ?? null));
      }
      return { status: "succeeded", output: { merged: combined, branchCount: branches.length } };
    }
    if (mode === "combine_key") {
      const key = String(config.keyField || "id");
      const map = new Map<string, Record<string, unknown>>();
      for (const branch of branches) {
        const rows = Array.isArray(branch) ? branch : [branch];
        for (const row of rows) {
          if (row && typeof row === "object" && key in (row as Record<string, unknown>)) {
            const k = String((row as Record<string, unknown>)[key]);
            map.set(k, { ...(map.get(k) as object || {}), ...(row as Record<string, unknown>) });
          }
        }
      }
      return { status: "succeeded", output: { merged: [...map.values()], branchCount: branches.length } };
    }
    // append
    const flat: unknown[] = [];
    for (const b of branches) {
      if (Array.isArray(b)) flat.push(...b);
      else flat.push(b);
    }
    return { status: "succeeded", output: { merged: flat, branchCount: branches.length } };
  },
};

export const waitNode: NodeDefinition = {
  type: "wait",
  version: 1,
  name: "Wait / Delay",
  description: "Suspends the workflow for a delay or until a specific time, without holding a connection open.",
  category: "Conditions & Logic",
  icon: "Timer",
  kind: "logic",
  inputs: 1,
  outputs: [{ id: "out", label: "Output" }],
  outputHint: "{ resumedAt, waitedMs }",
  configSchema: [
    {
      key: "mode", label: "Wait type", type: "radio",
      options: [
        { value: "delay", label: "Delay for a duration" },
        { value: "until", label: "Until date & time" },
      ],
      default: "delay",
    },
    { key: "delayValue", label: "Duration", type: "number", default: 5, showIf: { key: "mode", equals: "delay" } },
    {
      key: "delayUnit", label: "Unit", type: "select",
      options: [
        { value: "seconds", label: "Seconds" },
        { value: "minutes", label: "Minutes" },
        { value: "hours", label: "Hours" },
      ],
      default: "seconds",
      showIf: { key: "mode", equals: "delay" },
    },
    { key: "untilDate", label: "Resume at (date & time, your workspace timezone)", type: "datetime", showIf: { key: "mode", equals: "until" } },
  ],
  defaultConfig: { mode: "delay", delayValue: 5, delayUnit: "seconds" },
  validate: (config) => {
    if (config.mode === "until" && !config.untilDate) {
      return [{ code: "MISSING_REQUIRED_FIELD", field: "untilDate", message: "Resume date & time is required." }];
    }
    return [];
  },
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, input: unknown) {
    let waitUntil: Date;
    if (String(config.mode) === "until") {
      const raw = rstr(ctx, config.untilDate);
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        return { status: "failed", error: { message: `Invalid date/time: "${raw}"` } };
      }
      waitUntil = d;
    } else {
      const value = Math.max(0, rnum(ctx, config.delayValue, 5));
      const unit = String(config.delayUnit || "seconds");
      const ms = unit === "hours" ? value * 3600_000 : unit === "minutes" ? value * 60_000 : value * 1000;
      waitUntil = new Date(Date.now() + ms);
    }
    if (waitUntil.getTime() > Date.now() + 365 * 24 * 3600 * 1000) {
      return { status: "failed", error: { message: "Wait time cannot exceed 1 year." } };
    }
    return {
      status: "succeeded", // engine converts this into a durable wait
      output: { waitingUntil: waitUntil.toISOString() },
      waitUntil,
      logs: [`Suspending execution until ${waitUntil.toISOString()}`],
    };
  },
};

export const stopNode: NodeDefinition = {
  type: "stop",
  version: 1,
  name: "Stop / Error",
  description: "Stops the workflow immediately with success or a custom error.",
  category: "Conditions & Logic",
  icon: "OctagonX",
  kind: "logic",
  inputs: 1,
  outputs: [],
  configSchema: [
    {
      key: "mode", label: "Stop with", type: "radio",
      options: [{ value: "success", label: "Success" }, { value: "error", label: "Error" }],
      default: "success",
    },
    { key: "message", label: "Message", type: "expression", help: "Optional message recorded on the execution." },
  ],
  defaultConfig: { mode: "success" },
  validate: () => [],
  async execute(ctx: NodeExecutionContext, config: Record<string, unknown>, _input: unknown) {
    const message = config.message ? rstr(ctx, config.message) : undefined;
    if (String(config.mode) === "error") {
      return {
        status: "failed",
        error: { message: message || "Workflow stopped with an error (Stop node)." },
        stopExecution: { status: "failed", message },
      };
    }
    return {
      status: "succeeded",
      output: { stopped: true, message },
      stopExecution: { status: "succeeded", message },
    };
  },
};
