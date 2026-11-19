# Flow Studio Architecture

Flow Studio is a visual workflow automation SaaS: users design workflows on a canvas
(triggers, HTTP calls, logic, loops, data transforms, integrations), publish them as
immutable versions, and run them via manual runs, inbound webhooks, or schedules.

## Layered overview

```
+--------------------------------------------------------------+
|  Frontend - Next.js App Router, single-page app at "/"       |
|  (client-only; view routing via URL hash, zustand store)     |
+------------------------------+-------------------------------+
                               |  fetch (httpOnly session cookie)
+------------------------------v-------------------------------+
|  API layer - /api/* route handlers (src/app/api)             |
|  handler() wrapper, zod body validation, rate limiting,      |
|  ApiError -> structured { ok, data } | { ok, error } bodies  |
+------------------------------+-------------------------------+
                               |
+------------------------------v-------------------------------+
|  Core engine (src/core, no React, no HTTP)                   |
|   nodes/registry.ts      - node catalog (38 node types)      |
|   nodes/definitions/*    - per-node validate() + execute()   |
|   graph/validator.ts     - graph validation (structure,      |
|                            expressions, cycles, ports)       |
|   expression/engine.ts   - safe expression language          |
|                            (tokenizer + parser, no eval)     |
|   engine/executor.ts     - durable execution engine          |
|   engine/scheduler.ts    - cron dispatcher (claim + resume)  |
|   templates.ts           - 10 workflow templates             |
+------------------------------+-------------------------------+
                               |
+---------------+--------------+--------------+----------------+
|               |                             |                |
+-------v-------+ +----------v--------+ +-----v------+ +-------v--------+
| Prisma +      | | Credential vault  | | SSRF guard | | Notification   |
| SQLite        | | (src/lib/crypto)  | | (lib/ssrf) | | service        |
| (src/lib/db)  | | AES-256-GCM       | | safeFetch  | | (lib/notif.)   |
+---------------+ +-------------------+ +------------+ +----------------+
```

## 1. Frontend

- `src/app/page.tsx` renders one client-only page (dynamic import, `ssr: false`).
  All product UI lives in `src/components/flow-studio/`.
- **Client-side view routing via URL hash.** The zustand store (`store.ts`)
  exposes `navigate(view, params)` which writes `#/<view>` (and
  `#/editor/<workflowId>` / `#/execution-detail/<executionId>`) to the URL;
  `restoreFromHash()` listens to `hashchange` so a browser refresh keeps the
  user in the same view with the same workflow/execution open.
- Views: `dashboard`, `workflows`, `editor`, `executions`, `execution-detail`,
  `connections`, `templates`, `settings`. Unauthenticated users see `AuthView`
  (register/login).
- The editor is built on `@xyflow/react` (React Flow): node palette
  (drag/drop), canvas, port-to-port connections, config panel driven by each
  node's `configSchema`, expression mapping dialog, validation dialog, version
  dialog, execution panel, debounced autosave (1.2 s), undo/redo history,
  keyboard shortcuts (Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo,
  Ctrl+D duplicate node), and a minimap.
- The node catalog is fetched once from `/api/nodes` (client-safe metadata:
  config schema, defaults, ports, output hints - no `execute` functions).

## 2. API layer

- All routes live under `src/app/api/**/route.ts` and use helpers from
  `src/lib/api.ts`:
  - `handler()` - try/catch wrapper mapping thrown `ApiError` (or any object
    with `.status/.code`) to `{ ok: false, error: { code, message, details } }`;
    anything else becomes `500 INTERNAL`.
  - `parseBody(req, zodSchema)` - strict JSON body validation (`400
    VALIDATION_ERROR` / `400 INVALID_JSON`).
  - `enforceRateLimit(req, scope, limit, windowMs)` - in-memory sliding-window
    rate limiter keyed by client IP (per instance; see Deployment for the
    multi-instance caveat).
- Every authenticated route calls `requireWorkspace()` (`src/lib/auth.ts`),
  which resolves the user and workspace **from the session cookie only**. The
  workspace id is never accepted from client input; ownership helpers
  (`getOwnedWorkflow/Execution/Connection`) return `404 NOT_FOUND` when the
  record belongs to another workspace (cross-customer isolation).
- Public (unauthenticated) endpoints: `/api/webhooks/[publicId]` (rate limited,
  optionally HMAC-signed) and `/api/cron/dispatch` (CRON_SECRET protected).

## 3. Core engine

### Node registry (`src/core/nodes/registry.ts`)
- A `Map<type, NodeDefinition>` built at module load; duplicate registrations
  throw. `getCatalog()` exposes client-safe metadata for the editor and
  `/api/nodes`. Adding a node = create a definition + register it; the editor,
  validator and executor pick it up without engine changes.

### Graph validator (`src/core/graph/validator.ts`)
- `parseGraph()` parses/validates the serialized `WorkflowGraph` JSON.
- `validateGraph()` runs node-level checks (unknown types, per-node
  `validate(config)`, expression syntax), edge checks (dangling ids, invalid
  source ports, triggers with inputs, self loops), cycle detection (Kahn's
  algorithm - loops must use Loop nodes, not raw back-edges), reachability
  warnings, Merge needs >= 2 inputs, Loop needs a Loop End.
- Runs before publishing, before every execution, on import, and on demand
  (`POST /api/workflows/[id]/validate`).

### Expression engine (`src/core/expression/engine.ts`)
- Hand-written tokenizer + recursive-descent parser producing an AST; **no
  `eval`, no `new Function`**. Supports literals, paths with `?.` and `[n]`,
  arithmetic/comparison/logical/ternary operators, and 33 allowlisted functions
  (`upper`, `lower`, `trim`, `length`, `string`, `number`, `boolean`, `json`,
  `keys`, `values`, `includes`, `split`, `join`, `replace`, `sum`, `min`,
  `max`, `abs`, `round`, `floor`, `ceil`, `now`, `formatDate`, `timestamp`,
  `uuid`, `random`, `coalesce`, `default`, `contains`, `startsWith`,
  `endsWith`, `matches`, `typeOf`).
- Roots: `$trigger`, `$vars`, `$item`, `$index`, `$items`, `$execution`,
  `$now`, and any upstream **node id** (e.g. `{{ node_abc123.data }}`).
- `resolveTemplate()`: a string that is exactly one `{{ expr }}` returns the
  raw value (object/array/number); otherwise expressions are interpolated into
  the surrounding text.

### Execution engine (`src/core/engine/executor.ts`) - durable model
- **Checkpointing:** every node step is persisted as an `ExecutionStep` row
  (status, input, output, error, attempt count, `itemIndex` for loop
  iterations, duration). On resume the engine rebuilds runtime state from the
  stored steps and continues from the last completed node.
- **Immutable snapshots:** each `Execution` references a `workflowVersionId`.
  Live runs (webhook, schedule, live manual) execute the *published* version;
  test runs execute the current *draft*. Editing a workflow never affects
  in-flight executions.
- **Waits are durable:** when a Wait node fires, the step is marked `waiting`,
  `execution.status = waiting` and `execution.waitUntil` are set, and the HTTP
  request returns. No connection is held open. The execution is resumed later
  by the cron dispatcher or by an opportunistic poll when the user opens the
  execution detail view.
- **Invocation budget:** each `runExecution()` call has a 50-second budget.
  When exceeded, the execution flips to `waiting` (resume in ~3 s) and the
  dispatcher continues it from the last checkpoint.
- **Branch semantics:** IF/Switch return `activatePorts`; downstream nodes
  reachable only through inactive ports are cascade-marked `skipped`. Merge
  waits for all incoming branches to resolve; nodes with multiple incoming
  edges always receive an **array** of branch outputs.
- **Loops:** Loop Over Items / Split in Batches detect their body region
  (between the loop node's `body` port and Loop End, no outside connections
  allowed) and execute it per item with `$item` / `$index` bound, persisting a
  step per node per iteration (`itemIndex`).
- **Retries:** per-node `retryMaxTries` (1-5) with exponential backoff + jitter;
  `CONFIGURATION_REQUIRED` errors are never retried; `continueOnFail` turns a
  node failure into a succeeded step carrying the error.
- **Cancel:** `cancelRequested` flag checked between nodes, between loop
  iterations, and before finalization.
- See `docs/WORKFLOW_EXECUTION.md` for the full lifecycle and limitations.

### Scheduler (`src/core/engine/scheduler.ts`)
- A single central dispatcher: `dispatchDueSchedules()` claims due schedules
  **atomically** (conditional `UPDATE ... WHERE nextRunAt = <the value just
  read>` via `updateMany`), so two dispatchers can never double-fire the same
  run. It then creates an execution from the schedule's pinned
  `workflowVersionId`, runs it, recomputes `nextRunAt` with timezone support
  (cron-parser, from the claimed time to avoid drift), and finally resumes
  waiting executions whose `waitUntil` has elapsed.
- Exposed at `/api/cron/dispatch` (GET or POST, protected by `CRON_SECRET`).
  In production a single external cron service (cronjob.org, every minute)
  drives all schedules and waits for all customers - there are no per-customer
  cron jobs.

## 4. Database

- Prisma ORM with **SQLite** (`file:./db/custom.db`), 18 models - see
  `docs/DATABASE_SCHEMA.md`.
- Every workspace-scoped table carries `workspaceId`; all deletes cascade from
  `Workspace`.

## 5. Credential vault

- `src/lib/crypto.ts`: AES-256-GCM with a key from `CREDENTIAL_ENCRYPTION_KEY`
  (32-byte hex), per-credential random 12-byte IV, auth tag, versioned payload
  `{ v, iv, tag, data }`. See `docs/CREDENTIAL_SECURITY.md`.

## 6. Notifications

- `src/lib/notifications.ts`: in-app `NotificationRecord`s plus optional email
  via Resend. When `RESEND_API_KEY` is absent the email status is recorded as
  `skipped_no_provider` - never faked. Test-mode executions never notify.

## Intentional stack deviation (important for operators)

The original sketch targeted a Supabase/Vercel-style stack. **This build
intentionally uses Prisma + SQLite and session-cookie auth (bcrypt +
`httpOnly` cookies) instead**, because it targets a self-hosted sandbox that
must run as a single Node process without external auth or database services.

Swap points if you move to managed infrastructure:

| Concern | Current | Postgres / managed swap |
| --- | --- | --- |
| Database | `prisma/schema.prisma` `datasource db { provider = "sqlite" }` + `DATABASE_URL="file:./db/custom.db"` | change `provider = "postgresql"` and set `DATABASE_URL` to the hosted Postgres URL; the schema (models, relations, indexes) is provider-agnostic - no model changes required |
| Auth boundary | `src/lib/auth.ts` (`requireUser` / `requireWorkspace` / `createSession` backed by `Session` table + `fs_session` cookie) | the rest of the app only calls these three functions, so an external identity provider (Supabase Auth, NextAuth, etc.) can be swapped in by re-implementing this module's exports; all API routes and ownership checks stay unchanged |
| Rate limiting | in-memory per instance (`src/lib/api.ts`) | move to a shared store (Redis) before running multiple instances |
| Scheduler | cronjob.org hits `/api/cron/dispatch` | keep cronjob.org as the single dispatcher, or run a system cron on exactly one instance |

The atomic schedule claim (`UPDATE ... WHERE nextRunAt = claimed value`) makes
the dispatcher safe even if called concurrently, but for clean operations you
should still have exactly one cron source in production.
