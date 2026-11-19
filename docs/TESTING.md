# Testing Report

An honest account of what was actually verified in this build. No automated
test suites were created in this environment (per build constraints) - all
verification below was performed interactively against a running server
(curl-level API tests) and in a real browser.

## What was NOT done

- **No Vitest (or other) unit/integration test suite** exists in the repo.
- **No Playwright/Cypress e2e suite** exists in the repo.
- The `tests/` directory contains sandbox infrastructure scripts, not
  application tests.

## API-level smoke tests (curl against a running dev server)

All of the following were exercised end-to-end and observed to behave as
implemented:

| Area | Verified |
| --- | --- |
| Registration | `POST /api/auth/register` creates user + workspace + subscription, logs in, returns 201; duplicate email returns `409 EMAIL_TAKEN` |
| Login | `POST /api/auth/login` sets the session cookie; wrong password returns `401 INVALID_CREDENTIALS` |
| Workflow CRUD | create, list (with last-execution enrichment), get detail (versions + counts), rename/update graph via PATCH, delete with cascades |
| Manual run with expressions | a multi-node manual test run resolving `{{ $trigger... }}` and `{{ nodeId.field }}` expressions across nodes, with per-step outputs inspected |
| Webhook trigger + branching + response | publish + activate a webhook workflow with an IF node, both branches, a Merge node, and a Webhook Response node; POST to `/api/webhooks/<id>` returned the **custom HTTP 201 + JSON body** configured in the Webhook Response node; step statuses showed branch activation, skip cascade, and merge of both branches |
| Loop over items | Loop Over Items with a body node per item; ExecutionSteps persisted **per iteration with `itemIndex`**; Loop End aggregated iteration outputs |
| Durable Wait + resume | a Wait node flipped the execution to `waiting` with `waitUntil`; after the delay elapsed, the poll of `GET /api/executions/[id]` (opportunistic resume) continued it to `succeeded` |
| Cron dispatcher | `GET /api/cron/dispatch?secret=...` claimed a due schedule (atomic claim), created + ran the execution, and recomputed `nextRunAt` (verified next-run recalculation and `lastDispatchStatus`); wrong/missing secret rejected (`401` / `503`) |
| Plan quota enforcement | exceeding the free plan's workflow limit returns `403 PLAN_LIMIT`; exceeding monthly executions returns `403 PLAN_LIMIT`; concurrent-run limit returns `429 CONCURRENCY_LIMIT` |
| Schedule interval gating | activating a schedule below the plan's minimum interval returns `403 PLAN_LIMIT` at activation time |
| Cross-customer isolation | requesting another workspace's workflow / execution / connection by id returns **404** (not 403, not data) |
| Honest failures | Send Email without any Resend credential fails with the configuration-required message; billing purchase without Razorpay keys returns `503 BILLING_NOT_CONFIGURED`; connection tests report real provider outcomes |

## Browser-level verification

Manual walkthrough of the single-page app (login through every view):

- **Login/register** flows and the authenticated session restore on refresh.
- **Dashboard** renders real statistics computed from the database (counts,
  success rate, 14-day chart, recent/favorite workflows, connections health,
  usage vs plan).
- **Editor:** palette (all categories), canvas, drag-and-drop node creation,
  drag node-to-node and port-specific connections (true/false/case/body),
  debounced autosave, undo/redo, config panel (all field types incl.
  conditions/fields/credential pickers), expression mapping dialog, test run
  (with the execution panel showing steps), validation dialog, version
  history/restore, webhook URL + signing secret display, activate/deactivate.
- **Refresh persistence via hash routing:** reloading `#/editor/<id>` and
  `#/execution-detail/<id>` restores the exact view and context.
- **Executions list + detail:** filtering, step inspection (inputs, outputs,
  errors, `itemIndex` rows for loops, attempt numbers), event log, cancel,
  retry.
- **Templates gallery:** all 10 templates listed with honest
  required-connection notices; instantiation creates a valid draft.
- **Connections:** create/edit/delete, provider field forms, real "Test
  connection" outcomes and status badges.
- **Settings / billing:** profile + workspace updates, password change,
  account deletion (with cascade confirmation), plan display and the honest
  billing-configuration notice when Razorpay is absent.
- **Dark mode** and the **mobile viewport** layout, plus the sticky footer.

## Recommended test suite to add

Priority order:

1. **Unit - expression engine** (`src/core/expression/engine.ts`): parser
   edge cases, all 33 functions, error messages, interpolation vs
   full-expression semantics. Highest value: it is pure and used by every
   node.
2. **Unit - graph validator:** each error code (cycles, ports, triggers,
   merge/loop requirements, expression syntax in configs).
3. **Unit - scheduler:** `scheduleConfigToCron` for every mode,
   `computeNextRun` with timezones, `cronIntervalMinutes` for plan gating.
4. **Integration - executor with a test database:** branch skip cascade,
   merge join semantics, loop region detection (including invalid regions),
   retry/backoff (with faked timers), `CONFIGURATION_REQUIRED` never
   retried, budget-exceeded checkpoint/resume, cancel between nodes, wait +
   dispatcher resume.
5. **Integration - API routes with an authenticated client:** CRUD, quota
   enforcement (403/429), cross-workspace 404 isolation, webhook guards
   (signature, size cap, rate limit, `WORKFLOW_INACTIVE` 409), cron dispatch
   auth, connections never returning credentials.
6. **E2E - Playwright:** register -> create workflow from a template ->
   edit/autosave -> test run -> inspect execution -> activate -> fire
   webhook -> observe execution; plus settings/billing pages.

Suggested tooling: Vitest + `@vitest/coverage-v8` for units,
`vitest --environment node` with a temp SQLite file for integrations,
Playwright for browser e2e, and `msw` or `undici` interception for outbound
HTTP node tests.
