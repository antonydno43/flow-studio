# Feature Status

Honest completion matrix as of this build. "Complete" means implemented and
verified as described in `docs/TESTING.md`.

## Completion table

| Feature | Status | Notes |
| --- | --- | --- |
| Authentication (register/login/logout/me/password change) | Complete | bcrypt + httpOnly session cookies; rate limited; password change invalidates sessions |
| Single-owner workspaces + isolation | Complete, verified | one workspace per owner (unique `ownerId`); all APIs resolve the workspace from the session; cross-workspace ids return 404 |
| Workflow CRUD | Complete | create/read/update/delete, search/status filters, favorites, folders model |
| Versions + publish/activate + duplicate/export/import | Complete | immutable published snapshots; restore-as-new-draft history; export strips credentials; import validates node types and regenerates ids |
| Visual editor | Complete | palette (38 nodes), canvas, drag/drop, connect (incl. branch ports), config panel (schema-driven, all field types), expression mapping dialog, validation dialog, autosave, undo/redo, minimap, keyboard shortcuts (Ctrl+S/Z/Y/D), import/export, refresh persistence via hash routing |
| Node registry | Complete | 38 node types across 7 categories; duplicate-registration guard; client-safe catalog endpoint |
| Graph validator | Complete | structure, node config, expression syntax, ports, cycles, reachability, merge/loop requirements; runs pre-publish and pre-run |
| Expression engine | Complete | safe hand-written parser (no eval), 33 allowlisted functions, `$trigger`/`$item`/`$index`/`$vars`/`$execution`/node-id roots, ternary/logic/arith operators, interpolation + raw-value semantics |
| Execution engine | Complete | durable per-node checkpoints, branch activation + skip cascade, merge join, loops with per-iteration persistence, retries with backoff (CONFIGURATION_REQUIRED never retried), continueOnFail, 50 s invocation budget with checkpoint resume, cooperative cancel - see documented limitations in `docs/WORKFLOW_EXECUTION.md` |
| Webhook trigger + response | Complete | unique public URLs, optional HMAC signing, 256 KB cap, rate limiting, delivery log, custom status/headers/body responses via Webhook Response node |
| Schedule trigger + central dispatcher | Complete | cron expression builder (6 modes), timezone support, atomic claiming, next-run recalculation, waiting-execution resume. **Needs cronjob.org configured in production** - there is no internal tick |
| Integrations: Resend / Slack / Discord / Supabase | Complete | require user-supplied credentials (or server env for Resend); real provider tests; honest configuration-required failures |
| Microsoft 365 / Google / OAuth connectors | NOT implemented | reserved env vars exist; no fake connection entries. Marked as a coming-soon direction - never presented as available |
| Executions monitoring | Complete | list + filters + pagination, detail with steps/inputs/outputs/errors/events, loop `itemIndex` rows, cancel, retry/replay |
| Notifications | Complete (in-app); email conditional | in-app records + preferences complete; email delivery only when `RESEND_API_KEY` is configured (otherwise honestly recorded as `skipped_no_provider`) |
| Credential vault | Complete | AES-256-GCM, per-credential IV, versioned payload, metadata-only API surface, engine-closure-only decryption |
| Billing | Plan gating complete; checkout conditional | plans + quota enforcement (workflows, executions/month, concurrent runs, connections, schedule interval) complete; Razorpay provider interface complete - checkout requires provider credentials and refuses honestly without them (`503 BILLING_NOT_CONFIGURED`); paid activation completes only after the provider webhook |
| Templates | Complete | 10 templates with honest `requiredProviders` setup notes; ids regenerated on instantiation |
| Dashboard / stats | Complete | all metrics computed from real database rows |
| Usage metering | Complete | monthly UsageRecord per workspace (unique `workspaceId + periodStart`) |
| Schedules management UI | Complete | list, enable/disable (next-run recompute), delete |
| Dark mode, mobile layout | Complete | verified in browser |

## Known limitations

1. **Automated tests were not created** in this environment (Vitest/Playwright
   suites are the top recommended follow-up - see `docs/TESTING.md`).
2. **Wait nodes cannot be used inside loop bodies** - the loop fails with an
   explicit error message; move Wait nodes after the loop.
3. **Mid-loop interruption restarts the loop from item 0** on resume
   (invocation budget exhaustion or process restart). Non-idempotent body
   nodes (send email, insert row) can duplicate side effects.
4. **"Run from a single node" is not implemented** - retry/replay re-run the
   entire workflow from the original trigger data. (Single-node *testing*
   via the editor's Test button / `/test-node` exists.)
5. **Single-instance orientation:** SQLite database, in-memory rate limiting,
   and the dispatcher model assume one deployment; the multi-instance path is
   documented in `docs/DEPLOYMENT.md` (Postgres + shared rate-limit store +
   single dispatcher).
6. **Scheduler needs cronjob.org (or an external cron)** - without it,
   scheduled and waiting executions never fire.
7. **`timed_out` execution status** is modeled but not currently set by the
   engine (budget exhaustion uses the durable `waiting` path instead).
8. **Node output storage is capped** at 200,000 JSON chars per step and HTTP
   responses at 5 MB - larger data is stored truncated (with a marker), not
   fully persisted.
9. **Email/billing providers are optional:** without Resend/Razorpay keys the
   corresponding features show honest configuration notices instead of
   working.
