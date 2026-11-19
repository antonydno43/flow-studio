# Database Schema

Source of truth: `prisma/schema.prisma`. Provider: **sqlite** (`DATABASE_URL`,
default `file:./db/custom.db`), client generated via `prisma-client-js`,
accessed through the singleton in `src/lib/db.ts`.

Conventions:

- All primary keys are cuid strings (`@id @default(cuid())`).
- Every workspace-scoped table carries `workspaceId` with `onDelete: Cascade`
  to `Workspace`, so deleting a workspace (or its owner) removes all data.
- Timestamps are stored as UTC `DateTime`.

## Model reference (18 models)

### User
One registered account. `email` is `@unique` (case-normalized to lowercase at
registration). `passwordHash` is bcrypt (10 rounds).

| Field | Purpose |
| --- | --- |
| `email` / `passwordHash` / `fullName` / `avatarUrl` | identity |
| `timezone` | user display timezone (default `Asia/Kolkata`) |

Relations: `sessions Session[]`, `auditLogs AuditLog[]`, `workspace Workspace?`
(one-to-one, see below).

### Session
Server-side session store for cookie auth. `token` is `@unique` (32-byte hex
random); `expiresAt` (30 days). Index: `@@index([userId])`. Logout deletes the
row; expired sessions are lazily removed on read.

### Workspace
Exactly **one personal workspace per owner** - enforced by `ownerId @unique`.
This is the ownership root every other workspace-scoped table references.

| Field | Purpose |
| --- | --- |
| `ownerId` (unique) | 1:1 with User; uniqueness enforces one-workspace-per-owner |
| `name` / `timezone` | display settings (timezone default `Asia/Kolkata`) |
| `planId` | `free` \| `starter` \| `pro` - drives all plan gating (`src/config/branding.ts`) |

Relations: `workflows`, `connections`, `webhookEndpoints`, `schedules`,
`executions`, `folders`, `notificationPrefs`, `usageRecords`,
`notifications`, `auditLogs`, `subscription` (1:1).

### WorkflowFolder
Optional grouping for workflows.

- Unique constraint: `@@unique([workspaceId, name])` - folder names unique per
  workspace.

### Workflow
The user-visible workflow entity. Statuses: `draft | active | inactive |
archived` (default `draft`).

| Field | Purpose |
| --- | --- |
| `status` | only `active` workflows accept webhook/schedule/live triggers |
| `isFavorite` | dashboard pinning |
| `currentDraftVersionId` | version the editor edits / test runs execute |
| `publishedVersionId` | immutable version live triggers execute |

Index: `@@index([workspaceId, status])`.

### WorkflowVersion
Immutable snapshots of the graph. `graphDefinition` is the serialized
`WorkflowGraph` JSON (`{ nodes, edges }`); `validationResult` stores the last
validation result JSON.

- Unique constraint: `@@unique([workflowId, versionNumber])`.
- Publishing copies the draft into a **new** version row marked `isActive`
  with `publishedAt` set - published versions are never mutated, so executions
  pinned to them are reproducible (retry/replay re-run the same snapshot).
- Restoring an old version creates a new draft from the old snapshot (history
  is append-only).

### Connection
Stored third-party credentials (the credential vault rows).

| Field | Purpose |
| --- | --- |
| `provider` | `resend` \| `slack-webhook` \| `discord-webhook` \| `supabase` \| `http-basic` \| `http-bearer` |
| `encryptedCredentials` | AES-256-GCM ciphertext JSON `{ v, iv, tag, data }` - never returned by any API |
| `encryptionVersion` | payload version marker (currently `1`) |
| `status` | `untested \| connected \| failed \| config_required` |
| `lastTestedAt` / `lastTestResult` | outcome of the real provider test |

Index: `@@index([workspaceId])`. Quota: plan `maxConnections` enforced at
creation (`403 PLAN_LIMIT`).

### WebhookEndpoint
Per-workflow public webhook endpoint (provisioned lazily by
`/api/workflows/[id]/webhook-info`).

| Field | Purpose |
| --- | --- |
| `publicIdentifier` (`@unique`) | random public id in the URL - no internal ids leak |
| `encryptedSecret` | HMAC signing secret, encrypted with the vault key |
| `method` / `enabled` | accepted method (default POST) and on/off switch |

Index: `@@index([workflowId])`.

### WebhookDelivery
Audit log of every inbound webhook request: `receivedAt`, `status`
(`accepted | rejected | error`), `statusCode`, `contentType`, `sizeBytes`,
optional `executionId`, `message`. Used for troubleshooting rejected deliveries
(invalid signature, oversized payload, inactive workflow).

### Schedule
One row per scheduled workflow - **unique on `workflowId`** (`@@unique([workflowId])`),
i.e. a workflow has at most one schedule (matching the one-trigger rule).

| Field | Purpose |
| --- | --- |
| `cronExpression` / `timezone` | 5-field cron evaluated with timezone support |
| `nextRunAt` | the dispatcher's claim token + due time |
| `lastRunAt` / `enabled` | pause/resume (re-enabling recomputes `nextRunAt` from now, skipping missed runs) |
| `lastDispatchStatus` / `lastDispatchAt` | observability (`execution_succeeded`, `error: ...`) |
| `workflowVersionId` | pinned published version the schedule runs |

Index: `@@index([enabled, nextRunAt])` - the dispatcher's due-scan.

### Execution
One workflow run.

| Field | Purpose |
| --- | --- |
| `triggerType` | `manual \| webhook \| schedule \| retry \| replay` |
| `triggerData` | JSON trigger payload (capped at 200,000 chars) - also the input for retry/replay |
| `testMode` | test runs skip notifications |
| `status` | `queued \| running \| waiting \| succeeded \| failed \| cancelled \| timed_out` |
| `cancelRequested` | cooperative cancel flag polled by the engine |
| `waitUntil` | resume-at time set by Wait nodes / budget exhaustion |
| `startedAt` / `finishedAt` / `durationMs` / `error` (JSON) | timing + failure info |

Indexes: `@@index([workspaceId, createdAt])`, `@@index([workflowId, createdAt])`,
`@@index([status])`, `@@index([status, waitUntil])` (dispatcher resume scan).

### ExecutionStep
Per-node checkpoint rows - the durable-execution substrate.

| Field | Purpose |
| --- | --- |
| `nodeId` / `nodeType` | which node |
| `status` | `pending \| running \| waiting \| succeeded \| failed \| skipped \| cancelled` |
| `inputData` / `outputData` / `error` | JSON (each capped at 200,000 chars; larger outputs are stored truncated with a `_truncated` marker) |
| `itemIndex` | null for main-flow steps; the loop iteration number for loop-body steps |
| `attemptNumber` / `startedAt` / `finishedAt` / `durationMs` | retry + timing info |

Index: `@@index([executionId, nodeId])`.

### ExecutionEvent
Structured engine log: `severity` (`debug|info|warn|error`), `eventType`
(`node_retry`, `node_failed`, `wait_resumed`, `loop_completed`,
`invocation_budget_exceeded`, `execution_suspended`, `cancel_requested`, ...),
`message` (2,000 chars), `metadata` JSON (5,000 chars).
Index: `@@index([executionId, createdAt])`.

### NotificationPreference
Per-workspace notification toggles.
Unique constraint: `@@unique([workspaceId, notificationType])` - one row per
(workspace, type). Types: `execution_succeeded`, `execution_failed`,
`execution_failed_repeated`, `integration_alert`, `usage_limit`, `billing`.

### NotificationRecord
In-app notifications (`type`, `title`, `body`, `channel` `in_app` or
`email+in_app`, `emailStatus` `sent | failed | skipped_no_provider`, `readAt`).
Index: `@@index([workspaceId, createdAt])`.

### UsageRecord
Monthly metering. **Unique constraint: `@@unique([workspaceId, periodStart])`**
- one row per workspace per calendar month (UTC month boundaries). Counters:
`executionCount` (incremented when an execution is created),
`nodeOperationCount` (incremented at finalization). This row is what
`assertExecutionQuota` checks against `plan.limits.maxExecutionsPerMonth`.

### Subscription
Billing state, 1:1 with workspace (`workspaceId @unique`). `provider`
(default `razorpay`), `planId`, `status` (`active | past_due | cancelled`,
plus `pending_activation` after checkout is created), provider ids, period
bounds.

### AuditLog
Security-relevant actions (`auth.register`, `workflow.create/delete/activate`,
`connection.create/delete`, ...). `workspaceId`/`userId` are nullable
(`SetNull` for the user relation).
Index: `@@index([workspaceId, createdAt])`.

## Ownership-isolation model

1. **Session, not client input, determines the workspace.**
   `requireWorkspace()` (`src/lib/auth.ts`) resolves the user from the
   `fs_session` cookie and then loads `Workspace` by `ownerId` - the unique
   owner relation guarantees a single workspace. No API route accepts a
   `workspaceId` parameter.
2. **All reads/writes are workspace-scoped.** Service helpers
   (`src/lib/workflow-service.ts`): `getOwnedWorkflow`, `getOwnedExecution`,
   `getOwnedConnection`, plus a local `getOwnedSchedule` in the schedules
   route. Each does `findUnique({ id })` and then compares `workspaceId`; a
   mismatch throws `404 NOT_FOUND` (not `403`, so ids from other workspaces are
   indistinguishable from nonexistent ones).
3. **Every list query filters by `workspaceId`** before any pagination,
   search, or status filter is applied.
4. **Cross-customer access returns 404.** This was verified during testing:
   requesting another workspace's workflow/execution/connection by id yields
   `404 NOT_FOUND`.
5. **Cascade deletes** from `Workspace`/`User` mean account deletion removes
   workflows, versions, executions, steps, events, schedules, webhook
   endpoints/deliveries, connections, notifications, usage records, and audit
   logs in one shot.

## Plan limits (enforcement points)

| Limit | Where enforced |
| --- | --- |
| `maxWorkflows` | `assertWorkflowQuota` on create / duplicate / import / template use |
| `maxConnections` | `assertConnectionQuota` on connection create |
| `maxExecutionsPerMonth` | `assertExecutionQuota` on run / webhook / retry / replay (reads `UsageRecord`) |
| `maxConcurrentRuns` | `assertExecutionQuota` counts `queued/running/waiting` executions (`429 CONCURRENCY_LIMIT`) |
| `minScheduleIntervalMinutes` | activation (`publish`) compares the cron's smallest interval via `cronIntervalMinutes` (`403 PLAN_LIMIT`) |
