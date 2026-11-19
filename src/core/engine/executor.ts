/**
 * Durable workflow execution engine.
 *
 * - Every node step is persisted (checkpointed) to the database.
 * - Waits suspend the execution (status=waiting, waitUntil set) and can be
 *   resumed later by the scheduler dispatcher - no HTTP request is held open.
 * - Branch nodes activate only their selected output ports; nodes reachable
 *   only through inactive ports are marked skipped.
 * - Loop nodes execute their body region per item ($item / $index).
 * - Node-level retries with exponential backoff + jitter.
 * - Executions run on an immutable workflow-version snapshot.
 * - Decrypted credentials live only inside the engine closure and are never
 *   exposed to the expression context.
 */
import { db } from "@/lib/db";
import { parseGraph } from "@/core/graph/validator";
import { getNodeDefinition } from "@/core/nodes/registry";
import { decryptSecrets } from "@/lib/crypto";
import { resolveTemplate } from "@/core/expression/engine";
import { truncateForStorage } from "@/core/nodes/utils";
import { notify } from "@/lib/notifications";
import type {
  ExpressionContextData, GraphNode, NodeExecutionContext,
  NodeExecutionResult, WorkflowGraph,
} from "@/core/types";

const MAX_INVOCATION_MS = 50_000;
const STEP_JSON_LIMIT = 200_000;

type StateStatus = "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";

interface RuntimeNodeState {
  id: string;
  status: StateStatus;
  output?: unknown;
  activePorts: Set<string> | null; // null = all ports active (default)
  error?: { message: string; details?: unknown };
  attempts: number;
  waitUntil?: Date;
  stop?: { status: "succeeded" | "failed"; message?: string };
  webhookResponse?: { status: number; headers?: Record<string, string>; body: string; contentType: string };
  stepId?: string;
}

export interface StartExecutionOptions {
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  triggerType: "manual" | "webhook" | "schedule" | "retry" | "replay";
  triggerData?: unknown;
  testMode?: boolean;
}

export interface EngineResult {
  status: string;
  error?: { message?: string } | null;
  webhookResponse?: { status: number; headers?: Record<string, string>; body: string; contentType: string };
}

export class BudgetExceeded extends Error {}

export async function createExecution(opts: StartExecutionOptions) {
  const execution = await db.execution.create({
    data: {
      workspaceId: opts.workspaceId,
      workflowId: opts.workflowId,
      workflowVersionId: opts.workflowVersionId,
      triggerType: opts.triggerType,
      triggerData: JSON.stringify(opts.triggerData ?? null).slice(0, STEP_JSON_LIMIT),
      testMode: opts.testMode ?? false,
      status: "queued",
    },
  });
  await incrementUsage(opts.workspaceId, { executions: 1 });
  return execution;
}

async function incrementUsage(workspaceId: string, delta: { executions?: number; nodeOps?: number }) {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await db.usageRecord.upsert({
    where: { workspaceId_periodStart: { workspaceId, periodStart } },
    create: {
      workspaceId, periodStart, periodEnd,
      executionCount: delta.executions ?? 0,
      nodeOperationCount: delta.nodeOps ?? 0,
    },
    update: {
      executionCount: { increment: delta.executions ?? 0 },
      nodeOperationCount: { increment: delta.nodeOps ?? 0 },
    },
  });
}

/** Pre-load decrypted workspace connections (engine closure only). */
export async function loadConnectionsMap(workspaceId: string) {
  const map = new Map<string, { provider: string; credentials: Record<string, unknown> }>();
  const connections = await db.connection.findMany({ where: { workspaceId } });
  for (const conn of connections) {
    try {
      map.set(conn.id, { provider: conn.provider, credentials: decryptSecrets(conn.encryptedCredentials) });
    } catch {
      // stale credential (e.g. key rotated) - treated as missing
    }
  }
  return map;
}

type ConnectionsMap = Map<string, { provider: string; credentials: Record<string, unknown> }>;

export async function runExecution(executionId: string): Promise<EngineResult> {
  const execution = await db.execution.findUnique({ where: { id: executionId } });
  if (!execution) throw new Error("Execution not found");
  if (["succeeded", "failed", "cancelled", "timed_out"].includes(execution.status)) {
    return { status: execution.status, error: execution.error ? JSON.parse(execution.error) : null };
  }

  const version = await db.workflowVersion.findUnique({ where: { id: execution.workflowVersionId } });
  if (!version) throw new Error("Workflow version not found");
  const graph = parseGraph(version.graphDefinition);

  const startedAt = new Date();
  const deadline = Date.now() + MAX_INVOCATION_MS;
  const connections = await loadConnectionsMap(execution.workspaceId);

  // --- rebuild runtime state from persisted steps (durable resume) ---
  const states = new Map<string, RuntimeNodeState>();
  for (const node of graph.nodes) {
    states.set(node.id, { id: node.id, status: "pending", activePorts: null, attempts: 0 });
  }
  const priorSteps = await db.executionStep.findMany({
    where: { executionId },
    orderBy: { startedAt: "asc" },
  });
  let nodeOps = 0;
  for (const step of priorSteps) {
    if (step.itemIndex !== null && step.itemIndex !== undefined) continue; // loop-iteration steps
    const state = states.get(step.nodeId);
    if (!state) continue;
    if (step.status === "succeeded") {
      state.status = "succeeded";
      state.output = step.outputData ? JSON.parse(step.outputData) : undefined;
      nodeOps++;
    } else if (step.status === "failed") {
      state.status = "failed";
      state.error = step.error ? JSON.parse(step.error) : undefined;
    }
    state.stepId = step.id;
  }

  // Incomplete loops: if a loop started but never completed, reset the loop
  // and its body so it re-runs from the beginning on resume.
  resetIncompleteLoops(graph, states);

  const ctxData: ExpressionContextData = {
    trigger: execution.triggerData ? JSON.parse(execution.triggerData) : null,
    vars: {},
    nodeOutputs: {},
    execution: {
      id: execution.id,
      workflowId: execution.workflowId,
      workspaceId: execution.workspaceId,
      startedAt: (execution.startedAt ?? startedAt).toISOString(),
      timezone: "UTC",
      triggerType: execution.triggerType,
    },
  };
  for (const [id, state] of states) {
    if (state.status === "succeeded") ctxData.nodeOutputs[id] = state.output;
  }

  await db.execution.update({
    where: { id: executionId },
    data: { status: "running", startedAt: execution.startedAt ?? startedAt },
  });

  let webhookResponse: EngineResult["webhookResponse"];

  try {
    // --- resume waiting nodes whose wait has elapsed ---
    if (execution.status === "waiting") {
      const waitingSteps = await db.executionStep.findMany({
        where: { executionId, status: "waiting" },
      });
      let resumed = 0;
      for (const step of waitingSteps) {
        const state = states.get(step.nodeId);
        if (!state) continue;
        if (execution.waitUntil && execution.waitUntil > new Date()) continue;
        state.status = "succeeded";
        state.output = { resumedAt: new Date().toISOString(), ...(step.outputData ? JSON.parse(step.outputData) : {}) };
        state.stepId = step.id;
        await db.executionStep.update({
          where: { id: step.id },
          data: { status: "succeeded", finishedAt: new Date(), outputData: safeJson(state.output) },
        });
        ctxData.nodeOutputs[step.nodeId] = state.output;
        await logEvent(executionId, step.nodeId, "info", "wait_resumed", "Wait completed; execution resumed");
        resumed++;
      }
      if (resumed > 0) {
        await db.execution.update({ where: { id: executionId }, data: { status: "running", waitUntil: null } });
      }
    }

    // --- main scheduling loop ---
    let iterations = 0;
    while (true) {
      if (Date.now() > deadline) throw new BudgetExceeded();
      if (++iterations > 10_000) throw new Error("Execution exceeded maximum scheduling iterations");

      // cancellation check
      if (await isCancelled(executionId)) {
        markPending(states, "cancelled");
        await finalize(executionId, "cancelled", null, nodeOps);
        return { status: "cancelled" };
      }

      cascadeSkips(graph, states);
      const ready = computeReady(graph, states);
      if (ready.length === 0) break;

      for (const node of ready) {
        if (Date.now() > deadline) throw new BudgetExceeded();
        const state = states.get(node.id)!;
        if (state.status !== "pending") continue;

        const outcome = await executeNode(executionId, node, graph, states, ctxData, connections, deadline, null);

        if (outcome.webhookResponse) webhookResponse = outcome.webhookResponse;
        if (outcome.status === "cancelled") {
          markPending(states, "cancelled");
          await finalize(executionId, "cancelled", null, nodeOps);
          return { status: "cancelled" };
        }
        if (outcome.status === "waiting") {
          await db.execution.update({
            where: { id: executionId },
            data: { status: "waiting", waitUntil: state.waitUntil },
          });
          await logEvent(executionId, node.id, "info", "execution_suspended",
            `Execution suspended until ${state.waitUntil?.toISOString()}. No connection is held open.`);
          return { status: "waiting" };
        }
        if (outcome.status === "succeeded") nodeOps++;

        // hard stop
        if (state.stop) {
          markPending(states, "skipped");
          if (state.stop.status === "failed") {
            await finalize(executionId, "failed", { message: state.stop.message || "Workflow stopped with error" }, nodeOps);
            return { status: "failed", error: { message: state.stop.message }, webhookResponse };
          }
          await finalize(executionId, "succeeded", null, nodeOps);
          return { status: "succeeded", webhookResponse };
        }
      }
    }

    // --- finalize ---
    let failure: { message: string; nodeId?: string } | null = null;
    for (const state of states.values()) {
      if (state.status === "failed" && !failure) {
        failure = { message: state.error?.message || "Node failed", nodeId: state.id };
      }
    }
    if (failure) {
      await finalize(executionId, "failed", failure, nodeOps);
      return { status: "failed", error: failure, webhookResponse };
    }
    await finalize(executionId, "succeeded", null, nodeOps);
    return { status: "succeeded", webhookResponse };
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      // Durable: checkpointed state lets the dispatcher continue later.
      await db.execution.update({
        where: { id: executionId },
        data: { status: "waiting", waitUntil: new Date(Date.now() + 3000) },
      });
      await logEvent(executionId, null, "warn", "invocation_budget_exceeded",
        "Invocation time budget exceeded; execution continues from the last checkpoint on the next dispatch.");
      return { status: "waiting" };
    }
    const message = (err as Error).message || "Execution error";
    await finalize(executionId, "failed", { message }, nodeOps);
    return { status: "failed", error: { message } };
  }
}

// ---------------------------------------------------------------------------
// Node execution (main flow)
// ---------------------------------------------------------------------------

interface NodeOutcome {
  status: "succeeded" | "failed" | "waiting" | "cancelled";
  webhookResponse?: EngineResult["webhookResponse"];
}

async function executeNode(
  executionId: string,
  node: GraphNode,
  graph: WorkflowGraph,
  states: Map<string, RuntimeNodeState>,
  ctxData: ExpressionContextData,
  connections: ConnectionsMap,
  deadline: number,
  itemIndex: number | null
): Promise<NodeOutcome> {
  const def = getNodeDefinition(node.type);
  const state = states.get(node.id)!;

  if (!def) {
    state.status = "failed";
    state.error = { message: `Unknown node type "${node.type}"` };
    await createStep(executionId, node, itemIndex, "failed", null, null, state.error, 1);
    return { status: "failed" };
  }

  const input = resolveInput(node.id, graph, states);
  const config = { ...def.defaultConfig, ...(node.config || {}) };
  const maxTries = Math.min(Math.max(Number(config.retryMaxTries ?? 1) || 1, 1), 5);
  const backoffMs = Math.min(Number(config.retryBackoffMs ?? 1000) || 1000, 30000);

  const stepStarted = new Date();
  state.stepId = await createStep(executionId, node, itemIndex, "running", input, null, null, 1);

  let attempt = 0;
  let result: NodeExecutionResult | null = null;
  let lastError: { message: string; details?: unknown } | null = null;

  while (attempt < maxTries) {
    attempt++;
    const ctx = buildContext(executionId, node, ctxData, connections);
    try {
      result = await def.execute(ctx, config, input);
      for (const line of result?.logs ?? []) {
        await logEvent(executionId, node.id, "info", "node_log", line);
      }
      lastError = result?.status === "failed" ? (result.error ?? { message: "Node failed" }) : null;
    } catch (err) {
      lastError = { message: (err as Error).message || "Node execution error" };
      result = null;
    }
    const isConfigError =
      lastError?.details && typeof lastError.details === "object" &&
      (lastError.details as { code?: string }).code === "CONFIGURATION_REQUIRED";
    if (!lastError || isConfigError || attempt >= maxTries) break;
    const delay = Math.min(backoffMs * 2 ** (attempt - 1), 15000) + Math.random() * 250;
    await logEvent(executionId, node.id, "warn", "node_retry",
      `Attempt ${attempt} failed (${lastError.message}). Retrying in ${Math.round(delay)}ms...`);
    await sleep(Math.min(delay, Math.max(deadline - Date.now(), 0)));
    if (Date.now() > deadline) break;
  }

  const finished = new Date();

  if (await isCancelled(executionId)) {
    state.status = "cancelled";
    await updateStep(state.stepId, "cancelled", null, null, attempt, finished);
    return { status: "cancelled" };
  }

  if (!result || lastError) {
    if (config.continueOnFail === true) {
      state.status = "succeeded";
      state.output = { error: lastError?.message, continued: true };
      await updateStep(state.stepId, "succeeded", state.output, null, attempt, finished);
      await logEvent(executionId, node.id, "warn", "node_continue_on_fail",
        `Node failed but the workflow continues: ${lastError?.message}`);
      return { status: "succeeded" };
    }
    state.status = "failed";
    state.error = lastError ?? { message: "Node failed" };
    await updateStep(state.stepId, "failed", result?.output ?? null, state.error, attempt, finished);
    await logEvent(executionId, node.id, "error", "node_failed", state.error.message);
    return { status: "failed" };
  }

  // durable wait
  if (result.waitUntil && result.waitUntil.getTime() > Date.now()) {
    state.status = "waiting";
    state.waitUntil = result.waitUntil;
    await updateStep(state.stepId, "waiting", result.output ?? null, null, attempt, finished);
    await db.execution.update({ where: { id: executionId }, data: { waitUntil: result.waitUntil } });
    return { status: "waiting" };
  }

  state.status = "succeeded";
  state.output = result.output ?? null;
  state.activePorts = result.activatePorts ? new Set(result.activatePorts) : null;
  state.stop = result.stopExecution ?? undefined;
  state.webhookResponse = result.webhookResponse ?? undefined;
  // publish output for downstream expression references ({{ nodeId.field }})
  ctxData.nodeOutputs[node.id] = state.output;
  await updateStep(state.stepId, "succeeded", state.output, null, attempt, finished);

  // loop region execution
  if (result.loop && !state.stop) {
    const loopOutcome = await runLoopRegion(executionId, node, graph, states, ctxData, connections, result.loop, deadline);
    if (loopOutcome === "cancelled") return { status: "cancelled" };
    if (loopOutcome === "failed" && !result.loop.continueOnError) {
      state.status = "failed";
      state.error = state.error ?? { message: "Loop body failed" };
      return { status: "failed" };
    }
  }
  return {
    status: "succeeded",
    webhookResponse: state.webhookResponse,
  };
}

// ---------------------------------------------------------------------------
// Loop region execution
// ---------------------------------------------------------------------------

function findLoopRegion(graph: WorkflowGraph, loopNode: GraphNode): { region: Set<string>; loopEnds: GraphNode[] } | { error: string } {
  const region = new Set<string>();
  const queue: string[] = [];
  for (const e of graph.edges) {
    if (e.source === loopNode.id && e.sourcePort === "body") queue.push(e.target);
  }
  while (queue.length) {
    const id = queue.shift()!;
    if (region.has(id)) continue;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) continue;
    region.add(id);
    if (node.type === "loop-end") continue;
    for (const e of graph.edges) {
      if (e.source === id) queue.push(e.target);
    }
  }
  for (const id of region) {
    for (const e of graph.edges) {
      if (e.target === id && e.source !== loopNode.id && !region.has(e.source)) {
        return { error: `Invalid loop body: node "${id}" receives a connection from outside the loop.` };
      }
    }
  }
  const loopEnds = graph.nodes.filter((n) => region.has(n.id) && n.type === "loop-end");
  if (!loopEnds.length) return { error: "Loop body has no Loop End node." };
  return { region, loopEnds };
}

async function runLoopRegion(
  executionId: string,
  loopNode: GraphNode,
  graph: WorkflowGraph,
  states: Map<string, RuntimeNodeState>,
  ctxData: ExpressionContextData,
  connections: ConnectionsMap,
  loop: NonNullable<NodeExecutionResult["loop"]>,
  deadline: number
): Promise<"ok" | "failed" | "cancelled"> {
  const found = findLoopRegion(graph, loopNode);
  if ("error" in found) {
    const state = states.get(loopNode.id)!;
    state.status = "failed";
    state.error = { message: found.error };
    await logEvent(executionId, loopNode.id, "error", "invalid_loop_region", found.error);
    return "failed";
  }
  const { region, loopEnds } = found;
  const prevItem = ctxData.item;
  const prevIndex = ctxData.index;
  const prevItems = ctxData.items;
  const collected: unknown[] = [];
  let overall: "ok" | "failed" | "cancelled" = "ok";

  try {
    for (let itemIndex = 0; itemIndex < loop.items.length; itemIndex++) {
      if (Date.now() > deadline) throw new BudgetExceeded();
      if (await isCancelled(executionId)) return "cancelled";

      ctxData.item = loop.items[itemIndex];
      ctxData.index = itemIndex;
      ctxData.items = loop.items;

      const overlay = new Map<string, RuntimeNodeState>();
      for (const id of region) {
        overlay.set(id, { id, status: "pending", activePorts: null, attempts: 0 });
      }

      let iterationFailed = false;
      let guard = 0;
      while (guard++ < 1000) {
        if (Date.now() > deadline) throw new BudgetExceeded();
        cascadeSkipsRegion(graph, overlay, region);
        const ready = computeRegionReady(graph, overlay, loopNode, region);
        if (!ready.length) break;
        let broke = false;
        for (const node of ready) {
          const st = overlay.get(node.id)!;
          if (st.status !== "pending") continue;
          const outcome = await executeNode(executionId, node, graph, overlay, ctxData, connections, deadline, itemIndex);
          if (outcome.status === "cancelled") return "cancelled";
          if (outcome.status === "failed") { iterationFailed = true; broke = true; break; }
          if (outcome.status === "waiting") {
            const loopState = states.get(loopNode.id)!;
            loopState.status = "failed";
            loopState.error = { message: "Wait nodes are not supported inside loop bodies in this version. Move the Wait node after the loop." };
            return "failed";
          }
          if (st.stop) {
            // Stop node inside the loop body stops the whole workflow
            const mainState = states.get(node.id);
            if (mainState) {
              mainState.status = "succeeded";
              mainState.stop = st.stop;
              mainState.output = st.output;
            }
            return "ok"; // main loop detects stop
          }
        }
        if (broke) break;
      }

      for (const endNode of loopEnds) {
        const st = overlay.get(endNode.id);
        if (st && st.status === "succeeded") collected.push(st.output);
      }
      for (const [id, st] of overlay) {
        if (st.status === "succeeded") ctxData.nodeOutputs[id] = st.output;
      }

      if (iterationFailed && !loop.continueOnError) {
        overall = "failed";
        break;
      }
      if (iterationFailed) {
        await logEvent(executionId, loopNode.id, "warn", "loop_item_failed",
          `Iteration ${itemIndex + 1} failed; continuing (continue-on-error enabled).`);
      }
      if (loop.delayMs > 0) await sleep(Math.min(loop.delayMs, 5000));
    }
  } finally {
    ctxData.item = prevItem;
    ctxData.index = prevIndex;
    ctxData.items = prevItems;
  }

  // loop-end final aggregated result
  const endNode = loopEnds[0];
  const mode = String(endNode.config?.mode || "collect");
  const aggregated = mode === "last" ? collected[collected.length - 1] ?? null : collected;
  const endState = states.get(endNode.id)!;
  endState.status = "succeeded";
  endState.output = aggregated;
  endState.activePorts = null;
  ctxData.nodeOutputs[endNode.id] = aggregated;
  const now = new Date();
  endState.stepId = await createStep(executionId, endNode, null, "succeeded", { loopCompleted: true }, aggregated, null, 1);
  await db.executionStep.update({
    where: { id: endState.stepId },
    data: { finishedAt: now, durationMs: 0 },
  });

  // mark remaining region nodes as terminal in main states so they never
  // re-execute outside the loop
  for (const id of region) {
    if (id === endNode.id) continue;
    const st = states.get(id);
    if (st && st.status === "pending") {
      st.status = "succeeded";
      st.output = ctxData.nodeOutputs[id] ?? null;
      st.activePorts = new Set(["out", "body", "true", "false", "default", "0", "1", "2", "3", "4"]);
    }
  }

  await logEvent(executionId, loopNode.id, "info", "loop_completed",
    `Loop completed: ${loop.items.length} iteration(s), ${collected.length} result(s) collected.`);
  return overall;
}

function cascadeSkipsRegion(graph: WorkflowGraph, overlay: Map<string, RuntimeNodeState>, region: Set<string>) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (const id of region) {
      const st = overlay.get(id);
      if (!st || st.status !== "pending") continue;
      const incoming = graph.edges.filter((e) => e.target === id);
      if (!incoming.length) continue;
      let anyActive = false;
      let allResolved = true;
      for (const e of incoming) {
        if (!overlay.has(e.source)) { allResolved = false; continue; }
        const src = overlay.get(e.source)!;
        if (src.status === "pending" || src.status === "running" || src.status === "waiting") { allResolved = false; continue; }
        const active = src.status === "succeeded" && (src.activePorts === null || src.activePorts.has(e.sourcePort));
        if (active) anyActive = true;
      }
      if (allResolved && !anyActive) { st.status = "skipped"; changed = true; }
    }
  }
}

function computeRegionReady(
  graph: WorkflowGraph,
  overlay: Map<string, RuntimeNodeState>,
  loopNode: GraphNode,
  region: Set<string>
): GraphNode[] {
  const ready: GraphNode[] = [];
  for (const id of region) {
    const st = overlay.get(id);
    if (!st || st.status !== "pending") continue;
    const incoming = graph.edges.filter((e) => e.target === id);
    if (!incoming.length) { ready.push(graph.nodes.find((n) => n.id === id)!); continue; }
    let anyActive = false;
    let allResolved = true;
    for (const e of incoming) {
      if (e.source === loopNode.id) {
        if (e.sourcePort === "body") anyActive = true;
        continue;
      }
      if (!overlay.has(e.source)) { allResolved = false; continue; }
      const src = overlay.get(e.source)!;
      if (src.status === "pending" || src.status === "running" || src.status === "waiting") { allResolved = false; continue; }
      const active = src.status === "succeeded" && (src.activePorts === null || src.activePorts.has(e.sourcePort));
      if (active) anyActive = true;
    }
    if (allResolved && anyActive) ready.push(graph.nodes.find((n) => n.id === id)!);
  }
  return ready;
}

// ---------------------------------------------------------------------------
// Readiness / skips (main flow)
// ---------------------------------------------------------------------------

function cascadeSkips(graph: WorkflowGraph, states: Map<string, RuntimeNodeState>) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (const node of graph.nodes) {
      const st = states.get(node.id);
      if (!st || st.status !== "pending") continue;
      const incoming = graph.edges.filter((e) => e.target === node.id);
      if (!incoming.length) continue;
      let anyActive = false;
      let allResolved = true;
      for (const e of incoming) {
        const src = states.get(e.source);
        if (!src) { allResolved = false; continue; }
        if (src.status === "pending" || src.status === "running" || src.status === "waiting") { allResolved = false; continue; }
        const active = src.status === "succeeded" && (src.activePorts === null || src.activePorts.has(e.sourcePort));
        if (active) anyActive = true;
      }
      if (allResolved && !anyActive) { st.status = "skipped"; changed = true; }
    }
  }
}

function computeReady(graph: WorkflowGraph, states: Map<string, RuntimeNodeState>): GraphNode[] {
  const ready: GraphNode[] = [];
  for (const node of graph.nodes) {
    const st = states.get(node.id);
    if (!st || st.status !== "pending") continue;
    const def = getNodeDefinition(node.type);
    const incoming = graph.edges.filter((e) => e.target === node.id);
    if (incoming.length === 0) {
      if (def?.kind === "trigger") ready.push(node);
      continue;
    }
    let anyActive = false;
    let allResolved = true;
    for (const e of incoming) {
      const src = states.get(e.source);
      if (!src) { allResolved = false; continue; }
      if (src.status === "pending" || src.status === "running" || src.status === "waiting") { allResolved = false; continue; }
      const active = src.status === "succeeded" && (src.activePorts === null || src.activePorts.has(e.sourcePort));
      if (active) anyActive = true;
    }
    if (allResolved && anyActive) ready.push(node);
  }
  return ready;
}

function resolveInput(nodeId: string, graph: WorkflowGraph, states: Map<string, RuntimeNodeState>): unknown {
  const incoming = graph.edges.filter((e) => e.target === nodeId);
  const activeInputs = incoming
    .filter((e) => {
      const src = states.get(e.source);
      if (!src || src.status !== "succeeded") return false;
      return src.activePorts === null || src.activePorts.has(e.sourcePort);
    })
    .map((e) => states.get(e.source)!.output);
  if (activeInputs.length === 0) return null;
  // Nodes with multiple incoming connections (e.g. Merge) always receive an
  // array of branch outputs so their behavior is deterministic regardless of
  // how many branches happened to be active.
  if (incoming.length > 1) return activeInputs;
  return activeInputs[0];
}

function markPending(states: Map<string, RuntimeNodeState>, status: StateStatus) {
  for (const s of states.values()) {
    if (s.status === "pending") s.status = status;
  }
}

function resetIncompleteLoops(graph: WorkflowGraph, states: Map<string, RuntimeNodeState>) {
  for (const node of graph.nodes) {
    if (node.type !== "loop-items" && node.type !== "split-batches") continue;
    const loopState = states.get(node.id);
    if (!loopState || loopState.status !== "succeeded") continue;
    const found = findLoopRegion(graph, node);
    if ("error" in found) continue;
    const endState = states.get(found.loopEnds[0].id);
    const loopCompleted = endState?.status === "succeeded";
    if (!loopCompleted) {
      // loop was interrupted (budget exceeded): restart it on resume
      loopState.status = "pending";
      for (const id of found.region) {
        const st = states.get(id);
        if (st) st.status = "pending";
      }
    }
  }
}

async function isCancelled(executionId: string): Promise<boolean> {
  const exec = await db.execution.findUnique({ where: { id: executionId }, select: { cancelRequested: true } });
  return Boolean(exec?.cancelRequested);
}

// ---------------------------------------------------------------------------
// Step persistence
// ---------------------------------------------------------------------------

function buildContext(
  executionId: string,
  node: GraphNode,
  ctxData: ExpressionContextData,
  connections: ConnectionsMap
): NodeExecutionContext {
  return {
    executionId,
    nodeId: node.id,
    nodeType: node.type,
    resolve: (template: string) => {
      const r = resolveTemplate(template, ctxData);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    evaluate: (expr: string) => {
      const r = resolveTemplate(`{{ ${expr} }}`, ctxData);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    ctx: ctxData,
    getConnection: (connectionId: string) => connections.get(connectionId) ?? null,
    log: () => { /* logs are collected from result.logs */ },
    now: () => new Date(),
  };
}

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const truncated = truncateForStorage(value, STEP_JSON_LIMIT);
  return JSON.stringify(truncated);
}

async function createStep(
  executionId: string,
  node: GraphNode,
  itemIndex: number | null,
  status: string,
  input: unknown,
  output: unknown,
  error: { message: string; details?: unknown } | null,
  attempt: number
): Promise<string> {
  const step = await db.executionStep.create({
    data: {
      executionId,
      nodeId: node.id,
      nodeType: node.type,
      status,
      inputData: safeJson(input),
      outputData: safeJson(output),
      error: error ? JSON.stringify(error).slice(0, STEP_JSON_LIMIT) : null,
      attemptNumber: attempt,
      itemIndex,
      startedAt: new Date(),
    },
  });
  return step.id;
}

async function updateStep(
  stepId: string | undefined,
  status: string,
  output: unknown,
  error: { message: string; details?: unknown } | null,
  attempt: number,
  finishedAt: Date
) {
  if (!stepId) return;
  await db.executionStep.update({
    where: { id: stepId },
    data: {
      status,
      outputData: safeJson(output),
      error: error ? JSON.stringify(error).slice(0, STEP_JSON_LIMIT) : null,
      attemptNumber: attempt,
      finishedAt,
      durationMs: finishedAt.getTime() - (await getStepStart(stepId)),
    },
  }).catch(() => {});
}

async function getStepStart(stepId: string): Promise<number> {
  const step = await db.executionStep.findUnique({ where: { id: stepId }, select: { startedAt: true } });
  return step?.startedAt?.getTime() ?? Date.now();
}

export async function logEvent(
  executionId: string,
  nodeId: string | null,
  severity: "debug" | "info" | "warn" | "error",
  eventType: string,
  message: string,
  metadata?: unknown
) {
  try {
    await db.executionEvent.create({
      data: {
        executionId,
        nodeId,
        severity,
        eventType,
        message: message.slice(0, 2000),
        metadata: metadata ? JSON.stringify(metadata).slice(0, 5000) : null,
      },
    });
  } catch (err) {
    console.error("[engine] failed to persist event:", err);
  }
}

async function finalize(
  executionId: string,
  status: string,
  error: { message?: string } | null,
  nodeOps: number
) {
  const finishedAt = new Date();
  const execution = await db.execution.findUnique({ where: { id: executionId } });
  if (!execution) return;
  await db.execution.update({
    where: { id: executionId },
    data: {
      status,
      finishedAt,
      durationMs: execution.startedAt ? finishedAt.getTime() - execution.startedAt.getTime() : null,
      error: error ? JSON.stringify(error) : null,
      waitUntil: null,
    },
  });
  if (nodeOps > 0) await incrementUsage(execution.workspaceId, { nodeOps });

  // notifications (never for test runs)
  if (execution.testMode) return;
  const workflow = await db.workflow.findUnique({ where: { id: execution.workflowId } });
  const workspace = await db.workspace.findUnique({
    where: { id: execution.workspaceId },
    include: { owner: true },
  });
  if (!workflow || !workspace) return;
  if (status === "failed") {
    const recent = await db.execution.findMany({
      where: { workflowId: execution.workflowId },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    const repeated = recent.length === 3 && recent.every((e) => e.status === "failed");
    await notify({
      workspaceId: execution.workspaceId,
      type: repeated ? "execution_failed_repeated" : "execution_failed",
      title: `Workflow failed: ${workflow.name}`,
      body: `Execution failed: ${error?.message ?? "unknown error"}. Open Flow Studio to inspect the failing node.`,
      emailTo: workspace.owner.email,
    });
  } else if (status === "succeeded") {
    await notify({
      workspaceId: execution.workspaceId,
      type: "execution_succeeded",
      title: `Workflow succeeded: ${workflow.name}`,
      body: `Execution completed successfully with ${nodeOps} node operation(s).`,
      emailTo: workspace.owner.email,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
