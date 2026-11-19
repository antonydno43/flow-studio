# Implementation Plan & Retrospective

## Retrospective: how the build actually happened

The phases below reflect the real construction order. Each phase was verified
before the next began (verification methods in `docs/TESTING.md`).

### Phase 1 - Foundation
- Next.js 16 + TypeScript + Tailwind + shadcn/ui scaffold; standalone output
  config.
- Prisma schema (18 models) with the workspace-ownership design (one
  workspace per owner; `workspaceId` on every scoped table).
- Auth module (bcrypt, sessions, httpOnly cookies) and the API helper layer
  (`handler`, `ApiError`, zod `parseBody`, rate limiting).
- Credential vault (`src/lib/crypto.ts`) and the SSRF guard
  (`src/lib/ssrf.ts`) before any node could make outbound calls.

### Phase 2 - Core engine
- Shared types (`src/core/types.ts`): graph, node contract, execution
  results, expression context.
- Expression engine: tokenizer -> parser -> AST evaluator, 33 functions, no
  eval.
- Graph validator (structure, config, expressions, cycles, reachability).
- Execution engine: checkpointed steps, branch ports + skip cascade, merge
  join, durable waits, invocation budget, retries, cancel.
- Scheduler: cron building/parsing, atomic claim dispatcher,
  waiting-execution resume.

### Phase 3 - Node catalog
- Trigger, HTTP, control, loop, and transformation node definitions (38
  total) with schema-driven config, validators, and output hints.
- Integration nodes (Resend, Slack, Discord, Supabase) following the
  connector pattern with honest CONFIGURATION_REQUIRED failures.
- Registry as the single integration point; client-safe catalog endpoint.
- 10 workflow templates with honest `requiredProviders` metadata.

### Phase 4 - API surface
- All `/api/*` routes: auth, workflows (CRUD/validate/publish/deactivate/
  duplicate/export/import/graph/run/test-node/versions/webhook-info),
  executions (list/detail/cancel/retry/replay), connections (+test),
  schedules, public webhooks, cron dispatch, stats/usage/notifications/
  templates/nodes/settings/billing.
- Plan quota enforcement points wired into the service layer.
- Audit logging on security-relevant actions.

### Phase 5 - Frontend
- Single-page app at `/` with hash-based view routing and zustand store.
- All eight views; React Flow editor (palette, canvas, connections, config
  panel, mapping dialog, autosave, undo/redo, minimap, shortcuts, execution
  panel, validation/version dialogs).
- Dark mode, mobile layout, loading/empty/error states throughout.

### Phase 6 - Verification
- curl-level API smoke tests across every subsystem (auth, CRUD, runs with
  expressions, webhook branching + merge + custom response, loops,
  durable waits + resume, dispatcher claim/next-run, quotas, interval
  gating, cross-customer 404s).
- Browser-level walkthrough of every view including refresh persistence,
  dark mode, and mobile.
- Documentation set (the `docs/` folder you are reading).

## Next engineering tasks

Roughly in priority order:

1. **Postgres migration** for multi-instance/commercial scale: flip the
   Prisma provider + `DATABASE_URL`; schema is provider-agnostic. Pair with
   a hosted instance and re-verify the dispatcher claim under Postgres.
2. **Vitest + Playwright test suites** - the highest-leverage missing piece.
   Start with the expression engine and graph validator (pure functions),
   then executor integration tests against a temp SQLite file, then API
   tests, then e2e (see `docs/TESTING.md` for the recommended breakdown).
3. **Run-from-node resume:** allow retry/replay to start at a chosen node
   using stored upstream outputs, removing the "re-run the whole workflow"
   limitation.
4. **Wait-in-loop support:** persist per-iteration loop state (checkpoint
   `itemIndex`) so a mid-loop wait suspends and resumes exactly where it
   stopped - this also fixes the loop-restart-from-item-0 behavior.
5. **OAuth connectors (Google Workspace, Microsoft 365, Slack app):**
   implement the OAuth code flow behind the reserved env vars, store tokens
   in the vault, add refresh handling and the corresponding connection
   providers/nodes. No UI placeholders exist today; add them with the real
   flow.
6. **Shared rate-limit store** (Redis or Postgres-backed) to replace the
   in-memory limiter before scaling beyond one instance.
7. **Object-storage payloads:** move oversized node inputs/outputs (today
   truncated at 200 KB JSON per step) to S3-compatible storage with
   signed-URL access from the execution detail view; raise the webhook 256
   KB cap accordingly.
8. **Per-workflow notification settings UI:** the preference engine is
   workspace-wide today; add per-workflow overrides (model field + editor
   panel).
9. Smaller items: set `timed_out` for executions that exceed a hard wall
   clock; webhook delivery log viewer in the UI; execution retention job
   honoring `executionHistoryDays`; internationalize the interface.
