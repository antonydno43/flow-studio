# Workflow Execution

The execution engine (`src/core/engine/executor.ts`) is a durable, checkpointed
scheduler. This document describes the lifecycle, the scheduling algorithm,
loops, retries, budgets, cancellation - and the honest limitations.

## Execution lifecycle

Statuses (stored on `Execution.status`):

| Status | Meaning |
| --- | --- |
| `queued` | row created, not yet started |
| `running` | actively executing nodes |
| `waiting` | suspended (Wait node or invocation budget exhausted); `waitUntil` holds the resume time; no HTTP connection or worker is held |
| `succeeded` | all nodes finished (or a Stop node stopped with success) |
| `failed` | a node failed (and was not `continueOnFail`), a Stop/Error node fired, or an engine error occurred; `error` holds `{ message, nodeId? }` |
| `cancelled` | user requested cancel; engine finalized after the next check |
| `timed_out` | reserved status (not currently set by the engine; budget exhaustion uses `waiting` instead) |

Step statuses (`ExecutionStep.status`): `pending | running | waiting |
succeeded | failed | skipped | cancelled`.

An execution always pins an **immutable `WorkflowVersion` snapshot**: test
runs execute the current draft; live runs (webhook / schedule / live manual)
execute the published version. Editing the workflow afterwards never affects
an in-flight execution.

## The scheduling algorithm

The engine is a fix-point loop over a runtime node-state map:

1. **Rebuild state from checkpoints.** On (re)entry, all prior
   `ExecutionStep` rows are loaded (loop-iteration rows are skipped - loops
   restart, see below), succeeded outputs are re-published into the expression
   context, and incomplete loops are reset.
2. **Resume elapsed waits.** If the execution was `waiting` and `waitUntil`
   has passed, waiting steps are marked succeeded (with a `resumedAt` output),
   an event `wait_resumed` is logged, and scheduling continues.
3. **Cascade skips.** A pending node is marked `skipped` when *all* of its
   incoming edges are resolved and *none* is active (see below).
4. **Compute ready set.** A node is ready when it is `pending` and either has
   no incoming edges (triggers) or **at least one** active incoming edge and
   no unresolved incoming edges. A node with **multiple** incoming edges
   (Merge) therefore waits until *all* branches have resolved (succeeded,
   failed, or skipped) - that is the join semantics.
5. **Execute ready nodes**, persisting a step per node. Goto 3.

**Branch port activation.** Ordinary nodes activate all their outputs
(`activePorts = null`). IF/Switch return `activatePorts` (`["true"]` /
`["false"]`, or a case index / `"default"`). An incoming edge is *active* only
if its source succeeded **and** the edge's `sourcePort` is in the source's
active set. Nodes reachable solely through inactive ports are cascade-skipped
(three-node skip chains resolve in the fixed-point loop).

**Multi-input nodes always receive arrays.** `resolveInput()` collects the
outputs of all active incoming edges; when a node has more than one incoming
edge, the node receives the **array of branch outputs** (even if only one
branch happened to be active) - so Merge-style nodes behave deterministically.

**Input of a single-input node** is the upstream output (or `null` when no
active input exists).

## Loops

- **Region detection.** The loop body is the set of nodes reachable from the
  loop node's `body` port up to (and including) `loop-end` nodes. Two rules
  are enforced at runtime: the region must contain at least one Loop End
  node, and no node in the region may receive an edge from outside the region
  (other than the loop node's own `body` edge). Violations fail the loop node
  with an explicit error. The graph validator separately rejects raw cycles
  (back-edges) entirely - loops are the only iteration mechanism.
- **Per-item execution.** The loop node's `execute()` resolves `items` (an
  array; optionally read from an object's `data` field; capped by
  `maxIterations` / `maxBatches`), then returns `loop: { items, batchSize,
  continueOnError, delayMs }`. The engine executes the body region once per
  item with `$item` / `$index` / `$items` bound in the expression context
  (restored afterwards), using a fresh per-iteration overlay state map so
  branch skipping works per iteration.
- **Per-iteration persistence.** Every node step inside the loop is persisted
  with `itemIndex` = the iteration number, so the executions view shows each
  iteration's inputs/outputs/durations separately.
- **Aggregation.** Each Loop End's per-iteration output is collected; after
  the loop, the first Loop End gets a final aggregated output - `collect`
  mode produces the array of iteration outputs, `last` passes through the
  final iteration's output. Remaining region nodes are marked succeeded in
  the main state so they never re-execute outside the loop.
- **Stop node inside a loop** stops the whole workflow. **continueOnError**
  keeps iterating after a failed iteration (event `loop_item_failed`);
  otherwise the loop (and execution) fails.
- **Budget handling inside loops:** exceeding the invocation budget throws
  mid-loop; on resume the incomplete loop is **reset and re-run from item 0**
  (see limitations).

## Retries

- Config: `retryMaxTries` (clamped to 1-5; default 1 = no retry) and
  `retryBackoffMs` (clamped to <= 30,000 ms). Currently surfaced on the HTTP
  Request node; the engine honors it for any node.
- Backoff: `min(backoffMs * 2^(attempt-1), 15,000 ms) + jitter (0-250 ms)`.
  Each retry logs a `node_retry` event; the step's `attemptNumber` records the
  final attempt.
- **`CONFIGURATION_REQUIRED` errors are never retried** - a missing
  credential will not succeed on attempt 2, so the engine fails immediately.
- **`continueOnFail`**: when a node still fails after retries, the node is
  marked *succeeded* with output `{ error, continued: true }` and the
  workflow proceeds (event `node_continue_on_fail`).

## Invocation budget (durable long runs)

- Each `runExecution()` invocation has a **50-second budget**
  (`MAX_INVOCATION_MS`). Node outputs/steps are additionally capped at
  200,000 JSON chars (oversized outputs are stored truncated with a
  `_truncated` marker).
- On budget exhaustion the engine throws `BudgetExceeded`, sets the execution
  to `waiting` with `waitUntil = now + 3 s`, logs
  `invocation_budget_exceeded`, and returns. The cron dispatcher (or the
  opportunistic poll when someone opens the execution detail page) resumes it
  **from the last checkpoint** - completed nodes are not re-executed.
- Guards: max 10,000 scheduling iterations per invocation, 1,000 iterations
  of any single loop body, and a 100-cycle bound on skip cascades - runaway
  graphs fail instead of spinning.

## Cancellation

`POST /api/executions/[id]/cancel` sets `cancelRequested` (allowed only from
`queued/running/waiting`). The engine polls the flag:

- between scheduling iterations,
- between loop iterations,
- after each node execution (a node completing during a cancel request is
  marked `cancelled`).

Pending nodes are marked `cancelled` and the execution finalizes as
`cancelled`. Because the checks are cooperative, a long-running single node
(e.g. an HTTP request with a 120 s timeout) delays cancellation until it
finishes.

## Resume paths for `waiting` executions

1. The cron dispatcher (`/api/cron/dispatch`, every minute via cronjob.org)
   resumes up to 25 waiting executions per pass.
2. **Opportunistic poll:** `GET /api/executions/[id]` resumes an elapsed wait
   inline before returning the detail payload - so a user watching the
   execution view unblocks it without waiting for the dispatcher.

## Documented limitations

- **Wait nodes are not supported inside loop bodies.** A Wait firing inside a
  loop region fails the loop node with: *"Wait nodes are not supported inside
  loop bodies in this version. Move the Wait node after the loop."* (The
  per-item overlay state has no durable representation for a mid-loop wait.)
- **Mid-loop interruption restarts the loop from item 0 on resume.** If the
  invocation budget expires (or the process restarts) mid-loop, the resumed
  execution re-runs the *entire loop* from the first item, even for items
  that already completed. For non-idempotent body nodes (e.g. "Send Email",
  "Insert row") this can duplicate side effects. Prefer idempotent operations
  or loops that finish within the 50-second budget.
- **"Run from a single node" is not implemented.** Retry/replay always create
  a new execution that re-runs the **whole workflow** from the same trigger
  data and the same version snapshot. (The `test-node` endpoint executes one
  node standalone with a supplied input, but it does not persist an execution
  or resume mid-workflow.)
- Scheduling is single-instance: the engine relies on cooperative flags and
  per-process state; run one instance (or split web/dispatcher roles) as
  described in `docs/DEPLOYMENT.md`.
