/**
 * Workflow graph validation engine. Runs before publishing and before every
 * execution. Returns structured errors/warnings that the editor can use to
 * focus the offending node + field.
 */
import type { GraphEdge, GraphNode, ValidationIssue, ValidationResult, WorkflowGraph } from "@/core/types";
import { getNodeDefinition } from "@/core/nodes/registry";
import { checkExpressionSyntax } from "@/core/expression/engine";

export function parseGraph(raw: string | WorkflowGraph): WorkflowGraph {
  const graph = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Invalid workflow graph: nodes and edges arrays required");
  }
  return graph as WorkflowGraph;
}

function findCycles(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  // Kahn's algorithm; leftover nodes with edges = part of a cycle
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    seen.add(id);
    for (const next of adj.get(id) || []) {
      const d = (indeg.get(next) || 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { nodes, edges } = graph;

  const nodeIds = new Set<string>();

  // --- node-level checks ---
  let triggerCount = 0;
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({ nodeId: node.id, code: "DUPLICATE_NODE_ID", message: `Duplicate node id "${node.id}"` });
    }
    nodeIds.add(node.id);

    const def = getNodeDefinition(node.type);
    if (!def) {
      errors.push({
        nodeId: node.id,
        code: "UNKNOWN_NODE_TYPE",
        message: `Unknown node type "${node.type}". Remove this node or update the workflow.`,
      });
      continue;
    }
    if (def.kind === "trigger") triggerCount += 1;

    // node-level config validation
    const issues = def.validate(node.config || {});
    for (const issue of issues) {
      (issue.code.startsWith("MISSING") || issue.code === "INVALID_VALUE" || issue.code === "INVALID_EXPRESSION" || issue.code === "CONFIGURATION_REQUIRED" ? errors : warnings).push({
        ...issue,
        nodeId: node.id,
      });
    }

    // expression syntax validation on text-ish config values
    validateExpressionsInConfig(node, def, errors);
  }

  if (nodes.length === 0) {
    warnings.push({ code: "EMPTY_WORKFLOW", message: "The workflow is empty. Add a trigger node to begin." });
  }
  if (nodes.length > 0 && triggerCount === 0) {
    errors.push({
      code: "MISSING_TRIGGER",
      message: "The workflow needs exactly one trigger node to start.",
    });
  }
  if (triggerCount > 1) {
    errors.push({
      code: "MULTIPLE_TRIGGERS",
      message: `Found ${triggerCount} trigger nodes. A workflow can have only one trigger.`,
    });
  }

  // --- edge-level checks ---
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({ edgeId: edge.id, code: "DUPLICATE_EDGE_ID", message: `Duplicate edge id "${edge.id}"` });
    }
    edgeIds.add(edge.id);

    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (!source) {
      errors.push({ edgeId: edge.id, code: "INVALID_SOURCE", message: `Edge references missing source node "${edge.source}"` });
      continue;
    }
    if (!target) {
      errors.push({ edgeId: edge.id, code: "INVALID_TARGET", message: `Edge references missing target node "${edge.target}"` });
      continue;
    }
    const srcDef = getNodeDefinition(source.type);
    if (srcDef && !srcDef.outputs.some((o) => o.id === edge.sourcePort)) {
      errors.push({
        edgeId: edge.id,
        nodeId: source.id,
        code: "INVALID_SOURCE_PORT",
        message: `Node "${source.name}" has no output port "${edge.sourcePort}"`,
      });
    }
    if (target.type === "trigger-manual" || target.type === "trigger-webhook" || target.type === "trigger-schedule") {
      errors.push({
        edgeId: edge.id,
        nodeId: target.id,
        code: "TRIGGER_HAS_INPUT",
        message: `Trigger node "${target.name}" cannot have an incoming connection.`,
      });
    }
    if (source.id === target.id) {
      errors.push({ edgeId: edge.id, code: "SELF_LOOP", message: "A node cannot connect to itself." });
    }
  }

  // --- cycles (loops are structured via loop nodes, not raw edges) ---
  if (nodes.length > 0) {
    const cycleNodes = findCycles(nodes, edges);
    for (const id of cycleNodes) {
      const node = nodes.find((n) => n.id === id);
      errors.push({
        nodeId: id,
        code: "CYCLE_DETECTED",
        message: `Node "${node?.name || id}" is part of a circular connection. Use a Loop node instead of connecting a node back to an earlier node.`,
      });
    }
  }

  // --- reachability ---
  if (nodes.length > 0 && triggerCount === 1) {
    const trigger = nodes.find((n) => {
      const def = getNodeDefinition(n.type);
      return def?.kind === "trigger";
    });
    if (trigger) {
      const reached = new Set<string>([trigger.id]);
      const stack = [trigger.id];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of edges.filter((ed) => ed.source === cur)) {
          if (!reached.has(e.target)) {
            reached.add(e.target);
            stack.push(e.target);
          }
        }
      }
      for (const n of nodes) {
        if (!reached.has(n.id)) {
          warnings.push({
            nodeId: n.id,
            code: "UNREACHABLE_NODE",
            message: `Node "${n.name}" is not connected from the trigger and will never execute.`,
          });
        }
      }
    }
  }

  // --- merge nodes need >= 2 inputs ---
  for (const n of nodes) {
    if (n.type === "merge") {
      const inputs = edges.filter((e) => e.target === n.id);
      if (inputs.length < 2) {
        errors.push({
          nodeId: n.id,
          code: "INVALID_MERGE_CONFIG",
          message: `Merge node "${n.name}" needs at least 2 incoming branches.`,
        });
      }
    }
    if (n.type === "loop-items" || n.type === "split-batches") {
      const hasLoopEnd = nodes.some((x) => x.type === "loop-end");
      if (!hasLoopEnd) {
        errors.push({
          nodeId: n.id,
          code: "MISSING_LOOP_END",
          message: `Loop node "${n.name}" requires a "Loop End" node to close the loop body.`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateExpressionsInConfig(
  node: GraphNode,
  def: { configSchema: { key: string; label: string; type: string }[] },
  errors: ValidationIssue[]
) {
  for (const field of def.configSchema) {
    const value = (node.config || {})[field.key];
    if (typeof value === "string" && value.includes("{{")) {
      for (const expr of stripBraces(value)) {
        const err = checkExpressionSyntax(expr);
        if (err) {
          errors.push({
            nodeId: node.id,
            field: field.key,
            code: "INVALID_EXPRESSION",
            message: `Invalid expression in "${field.label}": ${err}`,
          });
          break;
        }
      }
    }
    // fields list (key/expression pairs)
    if (Array.isArray(value)) {
      value.forEach((entry: unknown, idx: number) => {
        const e = entry as { value?: string };
        if (e && typeof e.value === "string" && e.value.includes("{{")) {
          for (const expr of stripBraces(e.value)) {
            const err = checkExpressionSyntax(expr);
            if (err) {
              errors.push({
                nodeId: node.id,
                field: `${field.key}[${idx}]`,
                code: "INVALID_EXPRESSION",
                message: `Invalid expression in "${field.label}" (row ${idx + 1}): ${err}`,
              });
              break;
            }
          }
        }
      });
    }
  }
}

function stripBraces(template: string): string[] {
  const exprs: string[] = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) exprs.push(m[1].trim());
  return exprs.length ? exprs : [template];
}
