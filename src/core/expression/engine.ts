/**
 * Safe expression engine - hand-written tokenizer + recursive-descent parser.
 * NO eval, NO new Function. Supports:
 *   {{ nodeId.path.to.field }}        - reference another node's output
 *   {{ $trigger.body.user.email }}    - trigger data
 *   {{ $item }} / {{ $index }}        - loop variables
 *   {{ $vars.name }}                  - workflow variables
 *   literals, arithmetic, comparison, ternary, function calls (allowlist)
 * String interpolation: "Hello {{ $trigger.name }}" inside larger text.
 */
import type { ExpressionContextData } from "@/core/types";

export interface EvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = "num" | "str" | "ident" | "op" | "eof";
interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = [
  "===", "!==", "==", "!=", "<=", ">=", "&&", "||", "??", "?.",
  "+", "-", "*", "/", "%", "<", ">", "!", "?", ":",
  "(", ")", "[", "]", ".", ",",
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] || ""))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = "";
      while (j < input.length && input[j] !== ch) {
        if (input[j] === "\\") { out += input[j + 1] || ""; j += 2; }
        else { out += input[j]; j++; }
      }
      if (j >= input.length) throw new Error("Unterminated string literal");
      tokens.push({ type: "str", value: out });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_$]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ type: "op", value: op });
      i += op.length;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

// ---------------------------------------------------------------------------
// AST + parser
// ---------------------------------------------------------------------------

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "path"; root: string; parts: (string | { idx: number })[] }
  | { t: "call"; name: string; args: Node[] }
  | { t: "unary"; op: string; arg: Node }
  | { t: "bin"; op: string; left: Node; right: Node }
  | { t: "ternary"; cond: Node; then: Node; else: Node };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expectOp(op: string) {
    const t = this.next();
    if (t.type !== "op" || t.value !== op) {
      throw new Error(`Expected "${op}" but found "${t.value || "end of expression"}"`);
    }
  }
  private matchOps(...ops: string[]): string | null {
    const t = this.peek();
    if (t.type === "op" && ops.includes(t.value)) {
      this.pos++;
      return t.value;
    }
    return null;
  }

  parse(): Node {
    const node = this.parseTernary();
    if (this.peek().type !== "eof") {
      throw new Error(`Unexpected token "${this.peek().value}"`);
    }
    return node;
  }

  private parseTernary(): Node {
    const cond = this.parseOr();
    if (this.matchOps("?")) {
      const then = this.parseTernary();
      this.expectOp(":");
      const els = this.parseTernary();
      return { t: "ternary", cond, then, else: els };
    }
    return cond;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.matchOps("||", "??")) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseAnd();
      left = { t: "bin", op, left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    while (this.matchOps("&&")) {
      const right = this.parseEquality();
      left = { t: "bin", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseComparison();
    while (this.matchOps("===", "!==", "==", "!=")) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseComparison();
      left = { t: "bin", op, left, right };
    }
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    while (this.matchOps("<=", ">=", "<", ">")) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseAdditive();
      left = { t: "bin", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.matchOps("+", "-")) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseMultiplicative();
      left = { t: "bin", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.matchOps("*", "/", "%")) {
      const op = this.tokens[this.pos - 1].value;
      const right = this.parseUnary();
      left = { t: "bin", op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.matchOps("!", "-")) {
      const op = this.tokens[this.pos - 1].value;
      return { t: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.next();
    if (t.type === "num") return { t: "num", v: Number(t.value) };
    if (t.type === "str") return { t: "str", v: t.value };
    if (t.type === "ident") {
      if (t.value === "true") return { t: "bool", v: true };
      if (t.value === "false") return { t: "bool", v: false };
      if (t.value === "null") return { t: "null" };
      // function call?
      if (this.peek().type === "op" && this.peek().value === "(") {
        this.pos++; // consume (
        const args: Node[] = [];
        if (!(this.peek().type === "op" && this.peek().value === ")")) {
          args.push(this.parseTernary());
          while (this.matchOps(",")) args.push(this.parseTernary());
        }
        this.expectOp(")");
        return { t: "call", name: t.value, args };
      }
      // path
      const parts: (string | { idx: number })[] = [];
      let guard = 0;
      while (guard++ < 100) {
        const p = this.peek();
        if (p.type === "op" && (p.value === "." || p.value === "?.")) {
          this.pos++;
          const idt = this.next();
          if (idt.type !== "ident") throw new Error("Expected property name after '.'");
          parts.push(idt.value);
        } else if (p.type === "op" && p.value === "[") {
          this.pos++;
          const idxTok = this.next();
          if (idxTok.type !== "num") throw new Error("Expected numeric index in [..]");
          this.expectOp("]");
          parts.push({ idx: Number(idxTok.value) });
        } else break;
      }
      return { t: "path", root: t.value, parts };
    }
    if (t.type === "op" && t.value === "(") {
      const inner = this.parseTernary();
      this.expectOp(")");
      return inner;
    }
    throw new Error(`Unexpected token "${t.value || "end of expression"}"`);
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

const FUNCS: Record<string, (...args: unknown[]) => unknown> = {
  upper: (s) => String(s ?? "").toUpperCase(),
  lower: (s) => String(s ?? "").toLowerCase(),
  trim: (s) => String(s ?? "").trim(),
  length: (v) =>
    v == null ? 0 : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : String(v).length,
  string: (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)),
  number: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`Cannot convert "${String(v)}" to number`);
    return n;
  },
  boolean: (v) => (v === "false" ? false : Boolean(v)),
  json: (s) => JSON.parse(String(s)),
  keys: (o) => (o && typeof o === "object" ? Object.keys(o) : []),
  values: (o) => (o && typeof o === "object" ? Object.values(o) : []),
  includes: (arr, v) =>
    Array.isArray(arr) ? arr.includes(v) : String(arr ?? "").includes(String(v)),
  split: (s, sep) => String(s ?? "").split(String(sep)),
  join: (arr, sep) => (Array.isArray(arr) ? arr.join(String(sep)) : String(arr ?? "")),
  replace: (s, find, rep) => String(s ?? "").split(String(find)).join(String(rep)),
  sum: (arr) => (Array.isArray(arr) ? arr.reduce((a, b) => a + (Number(b) || 0), 0) : Number(arr) || 0),
  min: (arr) => Math.min(...(Array.isArray(arr) ? (arr as number[]) : [Number(arr)])),
  max: (arr) => Math.max(...(Array.isArray(arr) ? (arr as number[]) : [Number(arr)])),
  abs: (n) => Math.abs(Number(n)),
  round: (n, d = 0) => {
    const f = 10 ** Number(d);
    return Math.round(Number(n) * f) / f;
  },
  floor: (n) => Math.floor(Number(n)),
  ceil: (n) => Math.ceil(Number(n)),
  now: () => new Date().toISOString(),
  formatDate: (d, fmt) => {
    const date = d ? new Date(String(d)) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${String(d)}`);
    return formatDate(date, String(fmt || "yyyy-MM-dd HH:mm:ss"));
  },
  timestamp: () => Date.now(),
  uuid: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }),
  random: () => Math.random(),
  coalesce: (...args) => args.find((a) => a !== null && a !== undefined && a !== ""),
  default: (v, d) => (v === null || v === undefined || v === "" ? d : v),
  contains: (haystack, needle) => {
    const hay = typeof haystack === "object" ? JSON.stringify(haystack ?? "") : String(haystack ?? "");
    return hay.includes(String(needle ?? ""));
  },
  startsWith: (s, p) => String(s ?? "").startsWith(String(p)),
  endsWith: (s, p) => String(s ?? "").endsWith(String(p)),
  matches: (s, re) => {
    try { return new RegExp(String(re)).test(String(s ?? "")); }
    catch { throw new Error(`Invalid regular expression: ${String(re)}`); }
  },
  typeOf: (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v),
};

export const EXPRESSION_FUNCTIONS = Object.keys(FUNCS);

function formatDate(date: Date, fmt: string): string {
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const map: Record<string, string | number> = {
    yyyy: date.getUTCFullYear(),
    MM: pad(date.getUTCMonth() + 1),
    dd: pad(date.getUTCDate()),
    HH: pad(date.getUTCHours()),
    mm: pad(date.getUTCMinutes()),
    ss: pad(date.getUTCSeconds()),
  };
  let out = fmt;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(String(v));
  return out;
}

function getPath(root: unknown, parts: (string | { idx: number })[]): unknown {
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof part === "string") {
      if (typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[part.idx];
    }
  }
  return cur;
}

function resolveRoot(name: string, ctx: ExpressionContextData): unknown {
  switch (name) {
    case "$trigger": return ctx.trigger;
    case "$vars": return ctx.vars;
    case "$item": return ctx.item;
    case "$index": return ctx.index;
    case "$items": return ctx.items;
    case "$execution": return ctx.execution;
    case "$now": return new Date().toISOString();
    default:
      return ctx.nodeOutputs[name] ?? undefined;
  }
}

function evalNode(node: Node, ctx: ExpressionContextData): unknown {
  switch (node.t) {
    case "num": return node.v;
    case "str": return node.v;
    case "bool": return node.v;
    case "null": return null;
    case "path": return getPath(resolveRoot(node.root, ctx), node.parts);
    case "call": {
      const fn = FUNCS[node.name];
      if (!fn) throw new Error(`Unknown function "${node.name}()". Allowed: ${EXPRESSION_FUNCTIONS.join(", ")}`);
      const args = node.args.map((a) => evalNode(a, ctx));
      return fn(...args);
    }
    case "unary": {
      const v = evalNode(node.arg, ctx);
      if (node.op === "!") return !truthy(v);
      return -Number(v);
    }
    case "ternary":
      return truthy(evalNode(node.cond, ctx)) ? evalNode(node.then, ctx) : evalNode(node.else, ctx);
    case "bin": {
      if (node.op === "&&") {
        const l = evalNode(node.left, ctx);
        return truthy(l) ? evalNode(node.right, ctx) : l;
      }
      if (node.op === "||") {
        const l = evalNode(node.left, ctx);
        return truthy(l) ? l : evalNode(node.right, ctx);
      }
      if (node.op === "??") {
        const l = evalNode(node.left, ctx);
        return l === null || l === undefined ? evalNode(node.right, ctx) : l;
      }
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case "+":
          if (typeof l === "string" || typeof r === "string") return String(l ?? "") + String(r ?? "");
          return Number(l) + Number(r);
        case "-": return Number(l) - Number(r);
        case "*": return Number(l) * Number(r);
        case "/": {
          if (Number(r) === 0) throw new Error("Division by zero");
          return Number(l) / Number(r);
        }
        case "%": return Number(l) % Number(r);
        case "<": return compare(l, r) < 0;
        case ">": return compare(l, r) > 0;
        case "<=": return compare(l, r) <= 0;
        case ">=": return compare(l, r) >= 0;
        case "==": return looseEq(l, r, false);
        case "===": return looseEq(l, r, true);
        case "!=": return !looseEq(l, r, false);
        case "!==": return !looseEq(l, r, true);
      }
      throw new Error(`Unsupported operator ${node.op}`);
    }
  }
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function compare(l: unknown, r: unknown): number {
  if (typeof l === "string" || typeof r === "string") {
    return String(l).localeCompare(String(r));
  }
  return Number(l) - Number(r);
}

function looseEq(l: unknown, r: unknown, strict: boolean): boolean {
  if (strict) {
    if (Array.isArray(l) && Array.isArray(r)) return JSON.stringify(l) === JSON.stringify(r);
    return l === r;
  }
  if (l == null && r == null) return true;
  if (typeof l === "object" || typeof r === "object") return JSON.stringify(l) === JSON.stringify(r);
  return String(l) === String(r);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluateExpression(expr: string, ctx: ExpressionContextData): EvalResult {
  try {
    const tokens = tokenize(expr);
    const ast = new Parser(tokens).parse();
    return { ok: true, value: evalNode(ast, ctx) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Resolve a template string. If the entire string is a single {{expr}},
 * returns the raw value (may be object/array/number). Otherwise performs
 * string interpolation.
 */
export function resolveTemplate(template: string, ctx: ExpressionContextData): EvalResult {
  if (typeof template !== "string") return { ok: true, value: template };
  const full = template.trim().match(/^\{\{([\s\S]*)\}\}$/);
  if (full) {
    return evaluateExpression(full[1].trim(), ctx);
  }
  try {
    const out = template.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr: string) => {
      const r = evaluateExpression(expr.trim(), ctx);
      if (!r.ok) throw new Error(`Expression error in "{{${expr.trim()}}}": ${r.error}`);
      const v = r.value;
      if (v === null || v === undefined) return "";
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    });
    return { ok: true, value: out };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Validate expression syntax without a full context. */
export function checkExpressionSyntax(expr: string): string | null {
  try {
    const tokens = tokenize(expr);
    new Parser(tokens).parse();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
