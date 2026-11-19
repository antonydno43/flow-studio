# API Reference

All routes live under `src/app/api`. Conventions:

- **Response envelope:** success `{ "ok": true, "data": { ... } }`; failure
  `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`.
- **Auth:** unless noted, every route requires a valid `fs_session` httpOnly
  cookie. Unauthenticated calls get `401 UNAUTHENTICATED`. The workspace is
  always resolved server-side from the session.
- **Body validation:** JSON bodies are validated with zod; invalid bodies get
  `400 VALIDATION_ERROR` (with per-field `issues`) or `400 INVALID_JSON`.
- **Ownership:** records belonging to another workspace return `404 NOT_FOUND`.
- **Rate limits (in-memory, per instance):** auth register/login 10/min per IP;
  run 30/min per user; test-node 30/min per user; retry/replay 20/min per user;
  webhooks 60/min per endpoint+IP.

## Auth - `/api/auth`

### POST /api/auth/register
Create an account + its single personal workspace (transactional) + a free
`Subscription` + default notification preferences, then log in.
- Body: `{ email, password (min 8), fullName (2-80), workspaceName? }`
- 201: `{ user: { id, email, fullName, timezone }, workspace: { id, name, planId } }`
- Errors: `409 EMAIL_TAKEN`, `400 VALIDATION_ERROR`, `429 RATE_LIMITED`

### POST /api/auth/login
- Body: `{ email, password }`
- 200: `{ user, workspace }` (same shape as register) + session cookie
- Errors: `401 INVALID_CREDENTIALS`, `500 NO_WORKSPACE` (account missing its workspace)

### POST /api/auth/logout
Deletes the session row and cookie. 200: `{ loggedOut: true }`. No body.

### GET /api/auth/me
- 200: `{ authenticated: boolean, user: SessionUser | null }` where
  `SessionUser = { id, email, fullName, avatarUrl, timezone, workspaceId, workspaceName, planId }`
  (never `401` - unauthenticated returns `authenticated: false`).

### POST /api/auth/password
- Body: `{ currentPassword, newPassword (min 8) }`
- 200: `{ changed: true }`. Invalidates all other sessions, then re-issues one.
- Errors: `400 INVALID_PASSWORD`

## Workflows - `/api/workflows`

### GET /api/workflows
Query params: `status` (default excludes `archived`; `all` includes it),
`search` (name contains).
- 200: `{ workflows: [ { ...workflow, lastExecution, executionCount } ] }`
  (each enriched with the latest execution and total count), ordered by
  `updatedAt desc`.

### POST /api/workflows
- Body: `{ name (1-120), description? (<=500), graph?: { nodes, edges } }`
- 201: `{ workflow: { ...workflow, currentDraftVersionId } }` (status `draft`)
- Errors: `403 PLAN_LIMIT` (workflow quota), `400 VALIDATION_ERROR`

### GET /api/workflows/[id]
- 200: `{ workflow, versions: [ { id, versionNumber, createdAt, publishedAt, isActive } ], executionsCount }`

### PATCH /api/workflows/[id]
Partial update. Body (all optional): `{ name, description, status
(draft|active|inactive|archived), isFavorite, folderId, graph }`.
- `graph` writes the **current draft version only** (published versions are
  immutable).
- Status transitions sync schedules: leaving `active` disables the schedule;
  setting `active` re-syncs it.
- 200: `{ workflow }`

### DELETE /api/workflows/[id]
Cascade-deletes versions, executions, steps, events, schedules and webhook
endpoints. 200: `{ deleted: true }`

### POST /api/workflows/[id]/validate
Validates the draft graph (query `?version=published` to validate the
published one) and stores the result on the version.
- 200: `{ validation: { valid, errors: [], warnings: [] } }` (issues carry
  `nodeId` / `edgeId` / `field` / `code` / `message`)

### POST /api/workflows/[id]/publish  (activate)
Validates the draft; if valid, publishes a new immutable version, sets status
`active`, and syncs the schedule (schedule triggers are gated by the plan's
minimum interval).
- 200: `{ activated: false, validation }` when invalid, or
  `{ activated: true, publishedVersionId, validation }`
- Errors: `400 EMPTY_WORKFLOW`, `400 NO_DRAFT`, `400 INVALID_GRAPH`,
  `403 PLAN_LIMIT` (schedule interval below plan minimum)

### POST /api/workflows/[id]/deactivate
Sets status `inactive` and disables the schedule. 200: `{ deactivated: true }`

### POST /api/workflows/[id]/duplicate
Creates a draft copy (`"<name> (copy)"`) from the source's draft (or published)
graph. 201: `{ workflow }`. Errors: `403 PLAN_LIMIT`.

### GET /api/workflows/[id]/export
Downloads a portable JSON (`Content-Disposition: attachment;
filename="<slug>.flow.json"`). Payload: `{ format: "flow-studio-workflow",
version: 1, exportedAt, workflow: { name, description, versionNumber }, graph,
validationSummary }`. **Connection references are stripped** (`connection: ""`)
- no credential ids ever leave the server.

### GET /api/workflows/[id]/graph
- 200: `{ graph: { nodes, edges } }` (current draft, falling back to published;
  empty graph when none)

### POST /api/workflows/[id]/run
- Body: `{ mode: "test" | "live" (default test), input?: any }`
- `test`: executes the **draft** (`testMode=true`, no notifications). `live`:
  executes the **published** version of an active workflow.
- Trigger data: manual trigger falls back to the node's configured
  `sampleInput`; webhook test runs wrap the sample as a webhook body; schedule
  test runs get `{ scheduledAt, timezone, testRun }`.
- 200: `{ ran: false, validation }` when invalid, or
  `{ ran: true, executionId, status, error }` (`status` may be `waiting`)
- Errors: `400 NOT_ACTIVE` (live run of inactive workflow), `400 INVALID_GRAPH`,
  `403 PLAN_LIMIT`, `429 CONCURRENCY_LIMIT`, `429 RATE_LIMITED`

### POST /api/workflows/[id]/test-node
Executes a **single node** standalone (does not persist an execution).
- Body: `{ nodeId, input?, triggerSample? }`
- 200: `{ result: NodeExecutionResult }` (status `succeeded|failed|skipped`,
  `output`, `error`). Errors: `404 NODE_NOT_FOUND`, `400 UNKNOWN_NODE_TYPE`,
  `400 EMPTY`.

### GET /api/workflows/[id]/versions
- 200: `{ versions: [ { id, versionNumber, createdAt, publishedAt, isActive,
  isDraft, isPublished, nodeCount } ] }` (newest first)

### POST /api/workflows/[id]/versions  (restore)
- Body: `{ versionId }`
- 200: `{ restored: true, draftVersionId, versionNumber }` - creates a
  **new draft version** from the old snapshot (history stays append-only).
- Errors: `404 NOT_FOUND`

### GET /api/workflows/[id]/webhook-info
Lazily provisions the webhook endpoint for workflows containing a
`trigger-webhook` node.
- 200: `{ hasWebhook: true, url: "<APP_URL>/api/webhooks/<publicIdentifier>",
  secret, enabled, publicIdentifier, note }` or `{ hasWebhook: false, url: null,
  secret: null, enabled: false }` when no webhook trigger exists.
  `enabled` requires both the endpoint flag and workflow `active` status.
- Errors: `400 EMPTY`, `404 NOT_FOUND`

### POST /api/workflows/import
- Body: `{ name?, payload: { format?, graph: { nodes, edges } } }`
- Validates node types against the registry, regenerates all node/edge ids,
  merges configs with defaults, strips `connection` references, validates the
  graph, creates a draft workflow.
- 201: `{ workflow, validation }`
- Errors: `400 UNKNOWN_NODE_TYPES` (unsupported types are listed and not
  imported), `403 PLAN_LIMIT`

## Executions - `/api/executions`

### GET /api/executions
Query params: `status` (default `all`), `workflowId`, `search` (execution id or
workflow name), `from`, `to` (dates), `limit` (<=100, default 25), `offset`.
- 200: `{ executions: [ { id, workflowId, workflowName, status, triggerType,
  testMode, startedAt, finishedAt, durationMs, createdAt, error } ], total,
  limit, offset }`

### GET /api/executions/[id]
Full execution detail. **Opportunistic durable-resume:** if the execution is
`waiting` and `waitUntil` has passed, it is continued inline before responding
(the cron dispatcher also does this).
- 200: `{ execution: { ...execution, triggerData, error, workflowName },
  steps: [ { id, nodeId, nodeType, status, inputData, outputData, itemIndex,
  attemptNumber, startedAt, finishedAt, durationMs, error } ],
  events: [ last 100 events ] }`

### POST /api/executions/[id]/cancel
- Body: none.
- 200: `{ cancelling: true }` - sets `cancelRequested`; the engine stops at the
  next check (between nodes / loop iterations) and finalizes as `cancelled`.
- Errors: `400 NOT_CANCELLABLE` (already finished)

### POST /api/executions/[id]/retry
### POST /api/executions/[id]/replay
Both create a **new execution** from the original's trigger data and pinned
workflow version, then run it. (Body `{ mode }` accepted for symmetry; retry
and replay behave identically - the whole workflow re-runs from the same
trigger data. "Run from a single node" is not implemented.)
- 200: `{ executionId, status, error }`
- Errors: `403 PLAN_LIMIT`, `429 CONCURRENCY_LIMIT`, `429 RATE_LIMITED`

## Connections - `/api/connections`

### GET /api/connections
- 200: `{ connections: [ metadata only - id, provider, providerLabel, name,
  status, lastTestedAt, lastTestResult, createdAt ] (never credentials),
  providers: [ { id, label, description, docsUrl, fields } ], vaultConfigured }`

Supported providers (`CONNECTION_PROVIDERS`): `resend` (apiKey), `slack-webhook`
(webhookUrl), `discord-webhook` (webhookUrl), `supabase` (url + apiKey),
`http-basic` (username + password), `http-bearer` (token).

### POST /api/connections
- Body: `{ provider, name (1-80), credentials: { ...fields } }`
- Credentials are AES-256-GCM encrypted before storage.
- 201: `{ connection: { id, provider, name, status: "untested", createdAt } }`
- Errors: `503 VAULT_NOT_CONFIGURED` (no `CREDENTIAL_ENCRYPTION_KEY`),
  `400 UNKNOWN_PROVIDER`, `400 MISSING_FIELD`, `403 PLAN_LIMIT`

### PATCH /api/connections/[id]
- Body: `{ name?, credentials? }` - credential updates merge with the stored
  values and reset status to `untested`.
- 200: `{ connection: { id, name, status } }`

### DELETE /api/connections/[id]
- 200: `{ deleted: true }`

### POST /api/connections/[id]/test
Runs a **real** provider call and stores the outcome:
- `resend`: `GET api.resend.com/domains` with the key - 200 = connected,
  401/403 = rejected.
- `slack-webhook`: posts a visible test message to the channel - 2xx + `ok`
  body = connected.
- `discord-webhook`: posts a visible test message - 2xx = connected.
- `supabase`: `GET <url>/rest/v1/` with the key - 200 = connected, 401 =
  rejected.
- `http-basic` / `http-bearer`: no automated test (per-request credentials) -
  returns `untested` with an explanatory message.
- 200: `{ status: "connected" | "failed" | "untested", message }`

## Schedules - `/api/schedules`

### GET /api/schedules
- 200: `{ schedules: [ { id, workflowId, workflowName, workflowStatus,
  cronExpression, timezone, nextRunAt, lastRunAt, enabled, lastDispatchStatus,
  lastDispatchAt } ] }` (ordered by next run)

### PATCH /api/schedules/[id]
- Body: `{ enabled: boolean }` - re-enabling recomputes `nextRunAt` from now
  (missed runs while paused are skipped).
- 200: `{ schedule: { id, enabled, nextRunAt } }`

### DELETE /api/schedules/[id]
- 200: `{ deleted: true }`

## Webhooks (public) - `/api/webhooks/[publicId]`

### POST /api/webhooks/[publicId]  (and GET)
**No authentication.** Accepts an inbound webhook for an active, published
workflow.

Guards, in order: unknown endpoint `404 NOT_FOUND`; disabled endpoint `404
DISABLED`; workflow not active `409 WORKFLOW_INACTIVE`; rate limit 60/min per
endpoint+IP `429 RATE_LIMITED`; body cap 256 KB `413 PAYLOAD_TOO_LARGE`;
invalid JSON (when `Content-Type: application/json`) `400 INVALID_JSON`;
optional `X-Flow-Signature: sha256=<hex hmac>` verification when the trigger
requires it `401 INVALID_SIGNATURE`.

- Body: JSON, form-urlencoded, or raw text (parsed accordingly). Sensitive
  headers (`cookie`, `authorization`, `x-flow-signature`) are excluded from the
  trigger payload; query params are captured.
- Runs the published version synchronously. If the workflow contains a
  **Webhook Response** node, its configured status/headers/body are returned to
  the caller (e.g. a custom `201` JSON); otherwise `202 Accepted` with
  `{ ok: true, received: true, executionId, status }`.
- Every delivery is recorded in `WebhookDelivery`.

## Cron dispatcher - `/api/cron/dispatch`

### GET /api/cron/dispatch?secret=CRON_SECRET  (and POST)
**Protected by `CRON_SECRET`** (query `secret`, `Authorization: Bearer`, or
`x-cron-secret` header). Called by cronjob.org every minute in production.

- 200: `{ dispatched: true, claimed, started, failed, resumed, errors: [],
  at: <ISO time> }`
- Errors: `503 NOT_CONFIGURED` (no `CRON_SECRET` on the server), `401
  UNAUTHORIZED`

Work: claims due schedules atomically (conditional update on `nextRunAt`),
creates + runs executions from each schedule's pinned version, recomputes
next runs (timezone aware), and resumes waiting executions whose wait elapsed.

## Stats / usage / notifications / templates / nodes / settings / billing

### GET /api/stats
Dashboard data: `{ stats: { totalWorkflows, activeWorkflows,
inactiveWorkflows, totalExecutions, succeededExecutions, failedExecutions,
runningExecutions, successRate }, chart: [ 14 days of { date, total,
succeeded, failed } ], recentWorkflows (5), favoriteWorkflows (5),
recentExecutions (8), connectionsHealth, usage }` - all computed from real
database rows for the caller's workspace.

### GET /api/usage
Current billing period: `{ period: { start, end }, usage: { executions,
nodeOperations, workflows, connections }, limits, plan, subscription }`

### GET /api/notifications
`{ notifications: [ last 50 ], unreadCount, preferences: [ { id, label,
enabled } ] }` (defaults lazily ensured).

### PATCH /api/notifications
Body: `{ markAllRead?: true }` or `{ type, enabled }` (toggle one preference).
200: `{ updated: true }`

### GET /api/templates
`{ templates: [ { id, name, description, category, icon, requiredProviders,
nodeCount } ] }` - 10 templates.

### POST /api/templates/[id]/use
Instantiates a template as a new draft workflow (ids regenerated, expression
references remapped, graph validated).
- 201: `{ workflow, validation, requiredProviders, setupNotes }`
- Errors: `404 NOT_FOUND`, `403 PLAN_LIMIT`

### GET /api/nodes
Client-safe node catalog (38 entries: type, version, name, description,
category, icon, kind, inputs, outputs, configSchema, defaultConfig,
outputHint). No execute functions are serialized.

### GET /api/settings
`{ settings: { timezone, sessionCount, plan: { id, name, limits } } }`

### PATCH /api/settings
Body (optional): `{ fullName, timezone, workspaceName, workspaceTimezone }`.
Workspace timezone changes re-sync all active schedules' next runs.

### DELETE /api/settings
Deletes the account (cascades to workspace and all data) and clears the
session. 200: `{ deleted: true }`

### GET /api/billing
`{ plans: [ all plans with limits/features/prices from branding config ],
currentPlanId, subscription, provider: { id: "razorpay", configured } }`

### POST /api/billing
Body: `{ planId: "free" | "starter" | "pro" }`
- Same plan: `{ changed: false, message }`
- Downgrade to free: applied immediately, `{ changed: true, planId: "free" }`
- Paid plans **require** `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (and
  `RAZORPAY_PLAN_<STARTER|PRO>` plan ids); without them: `503
  BILLING_NOT_CONFIGURED` - the server never simulates a successful purchase.
- With credentials: creates a real Razorpay subscription and returns
  `{ changed: false, subscriptionId, checkoutRequired: true, message }` - the
  workspace plan updates only after the provider webhook confirms payment.
- Errors: `502 PROVIDER_ERROR`

### GET /api  (root)
Health check: `{ message: "Hello, world!" }` - useful for uptime monitors.
