/**
 * Shared workflow types used by the editor, validator, and execution engine.
 */

export type NodeKind = "trigger" | "action" | "logic";

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  /** Output port id on the source node, e.g. "out", "true", "false", "0", "default", "body" */
  sourcePort: string;
  target: string;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  code: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type ExecutionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type NodeRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

// --- Node configuration form schema (drives the dynamic config panel) ---

export type ConfigFieldType =
  | "text"
  | "textarea"
  | "number"
  | "password"
  | "select"
  | "multiselect"
  | "boolean"
  | "radio"
  | "json"
  | "code"
  | "expression"
  | "credential"
  | "date"
  | "datetime"
  | "fields" // list of {key, value(expression)}
  | "conditions" // list of {source, operator, target}
  | "cases" // list of {value, label} for switch
  | "filters" // list of {column, op, value} for supabase
  | "fieldOps" // list of {op, key, value, to}
  | "renames"; // list of {from, to}

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: ConfigFieldOption[];
  default?: unknown;
  /** Only show this field when another field equals a value */
  showIf?: { key: string; equals: string | number | boolean };
  /** for credential type: which connection providers are allowed */
  credentialProvider?: string;
}

export interface OutputPort {
  id: string;
  label: string;
  color?: string;
}

export interface NodeExecutionError {
  message: string;
  details?: unknown;
}

export interface NodeExecutionResult {
  status: "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: NodeExecutionError;
  logs?: string[];
  /** For branch nodes: which output ports to activate */
  activatePorts?: string[];
  /** Wait semantics: engine suspends execution until this time */
  waitUntil?: Date;
  /** Hard stop of the execution */
  stopExecution?: { status: "succeeded" | "failed"; message?: string };
  /** Set by the webhook-response node */
  webhookResponse?: { status: number; headers?: Record<string, string>; body: string; contentType: string };
  /** Set by loop nodes: engine executes the loop body region per item */
  loop?: { items: unknown[]; batchSize: number; continueOnError: boolean; delayMs: number };
}

// Expression context available to nodes
export interface ExpressionContextData {
  trigger: unknown;
  vars: Record<string, unknown>;
  item?: unknown;
  index?: number;
  items?: unknown[];
  execution: {
    id: string;
    workflowId: string;
    workspaceId: string;
    startedAt: string;
    timezone: string;
    triggerType: string;
  };
  nodeOutputs: Record<string, unknown>;
}

export interface NodeExecutionContext {
  executionId: string;
  nodeId: string;
  nodeType: string;
  /** Resolve {{...}} expressions in a string against current context */
  resolve: (template: string) => unknown;
  /** Evaluate a raw expression (without {{}}) */
  evaluate: (expr: string) => unknown;
  /** Full context data for expression engine */
  ctx: ExpressionContextData;
  /** Resolve a decrypted connection credential (server-side only) */
  getConnection: (connectionId: string) => { provider: string; credentials: Record<string, unknown> } | null;
  log: (message: string, metadata?: unknown) => void;
  /** Current UTC time (deterministic for tests) */
  now: () => Date;
}

export interface NodeDefinition {
  type: string;
  version: number;
  name: string;
  description: string;
  category: string;
  icon: string; // lucide icon name
  kind: NodeKind;
  inputs: number;
  outputs: OutputPort[];
  configSchema: ConfigField[];
  defaultConfig: Record<string, unknown>;
  /** Documentation of output shape, shown in mapping UI */
  outputHint?: string;
  validate: (config: Record<string, unknown>) => ValidationIssue[];
  execute: (
    ctx: NodeExecutionContext,
    config: Record<string, unknown>,
    input: unknown
  ) => Promise<NodeExecutionResult>;
}
