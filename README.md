# Flow Studio

Visual workflow automation. Design workflows on a canvas - triggers, HTTP
calls, conditions, loops, data transformations, and integrations - publish
them as immutable versions, and run them via manual runs, inbound webhooks,
or cron schedules. Every node step is checkpointed, so long-running and
waiting executions resume safely.

> Screenshots: to be added (`docs/screenshots/` is reserved for editor,
> dashboard, executions, and connections captures).

## Feature highlights

- **Visual editor** (React Flow): drag-and-drop palette with 38 node types,
  port-aware connections (IF true/false, Switch cases, loop bodies),
  schema-driven config panel, expression mapping helper, autosave,
  undo/redo, minimap, keyboard shortcuts, import/export.
- **Triggers:** manual (with sample input), webhook (unique URL, optional
  HMAC signature, custom response via Webhook Response node), and schedule
  (cron with timezone support).
- **Durable execution engine:** per-node checkpoints, branch activation +
  skip cascade, merge joins, per-item loops with `$item`/`$index`,
  exponential-backoff retries, 50-second invocation budget with automatic
  checkpoint-resume, cooperative cancellation.
- **Safe expression language:** hand-written parser (no eval), 33 allowlisted
  functions, `{{ $trigger.body.x }}` / `{{ nodeId.field }}` references.
- **Integrations:** Resend (email), Slack, Discord, Supabase (PostgREST CRUD
  + RPC) - using your own credentials, stored in an AES-256-GCM vault and
  never returned by any API.
- **Executions monitoring:** list/detail views with step inputs, outputs,
  errors, retry attempts, loop iterations, and event logs; cancel, retry,
  replay.
- **Plans & quotas:** free/starter/pro plans with server-side enforcement of
  workflow, execution, connection, concurrency, and schedule-interval
  limits; Razorpay billing interface that honestly refuses without provider
  credentials.
- **Templates:** 10 ready-made workflows with honest setup requirements.
- **In-app notifications** (email delivery when Resend is configured),
  usage metering, dashboard stats computed from real data.

## Quick start

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env        # fill in APP_URL, CREDENTIAL_ENCRYPTION_KEY, CRON_SECRET
bun run db:push             # create the SQLite schema
bun run dev                 # open http://localhost:3000
```

Generate the encryption key with `openssl rand -hex 32`. See
`docs/ENVIRONMENT_SETUP.md` for every variable.

## Tech stack

- **Frontend:** Next.js 16 (App Router, standalone build), React 19,
  TypeScript, Tailwind CSS 4, shadcn/ui, `@xyflow/react` (React Flow),
  Zustand, Recharts, react-hook-form, zod.
- **Backend:** Next.js route handlers (`/api/*`), Prisma ORM + SQLite
  (`prisma/schema.prisma`), bcryptjs, cron-parser.
- **Core engine (framework-free):** node registry, graph validator,
  expression engine, durable executor, cron dispatcher
  (`src/core/**`).
- **Security:** AES-256-GCM credential vault, SSRF-guarded outbound HTTP
  (`safeFetch`), httpOnly session cookies, in-memory rate limiting.
- **Tooling:** Bun scripts (`dev`, `build`, `start`, `db:push`, `db:generate`,
  `db:migrate`, `db:reset`), ESLint 9.

## cronjob.org setup (required for schedules and waits)

The platform has no internal tick - one external dispatcher drives all
schedules and resumes waiting executions:

1. Create a free cron job at [cronjob.org](https://cronjob.org).
2. URL: `{APP_URL}/api/cron/dispatch?secret=YOUR_CRON_SECRET`, schedule:
   every 1 minute.
3. Done - the dispatcher claims due schedules atomically (no double fires),
   computes next runs with timezone support, and resumes waiting executions
   from their checkpoints.

Details: `docs/ENVIRONMENT_SETUP.md`.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layered architecture, durable execution model, stack deviation & Postgres swap points |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | All 18 Prisma models, constraints, indexes, ownership isolation |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every route: auth, request/response shapes, error codes |
| [docs/NODE_SPECIFICATIONS.md](docs/NODE_SPECIFICATIONS.md) | All 38 node types + the node contract and how to add nodes |
| [docs/WORKFLOW_EXECUTION.md](docs/WORKFLOW_EXECUTION.md) | Execution lifecycle, scheduling algorithm, loops, retries, budgets, limitations |
| [docs/CONNECTOR_DEVELOPMENT.md](docs/CONNECTOR_DEVELOPMENT.md) | Integration pattern, SSRF guard, connection providers, adding connectors |
| [docs/CREDENTIAL_SECURITY.md](docs/CREDENTIAL_SECURITY.md) | Credential vault design and secret-handling rules |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Every environment variable + cronjob.org setup |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Single-instance deployment, multi-instance scaling, production checklist |
| [docs/TESTING.md](docs/TESTING.md) | Honest verification report + recommended test suite |
| [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) | Feature completion matrix + known limitations |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Build retrospective + next engineering tasks |

## Honest limitations

- **Single-instance build:** SQLite, in-memory rate limiting; the multi-instance
  path (Postgres + shared limiter + single dispatcher) is documented but not
  wired up.
- **Schedules/waits need cronjob.org** (or any external cron) - nothing fires
  without it.
- **Wait nodes are not supported inside loop bodies**; loops interrupted
  mid-way (budget/process restart) re-run from item 0 on resume - beware with
  non-idempotent nodes.
- **"Run from a single node" is not implemented** - retry/replay re-run the
  whole workflow from the same trigger data.
- **No automated test suites** (Vitest/Playwright) were created in this
  environment; verification was curl- and browser-based (see
  `docs/TESTING.md`).
- **OAuth connectors (Google/Microsoft/Slack apps) are not implemented** -
  reserved for the future, with no fake connection entries.
- **Email and billing are optional** and report honest configuration notices
  when their provider keys are absent.
- Node outputs are capped (200 KB JSON per step; 5 MB per HTTP response) and
  stored truncated beyond that.

## License

MIT for the code in this repository (see your repository's license file).

Third-party notices: this project builds on open-source packages - in
particular **React Flow (`@xyflow/react`)**, MIT licensed, copyright
(c) webkid, haynise, and contributors (https://reactflow.dev), plus the
Node.js/React/Next.js/Pr ecosystems and the `prisma`, `next`, `react`,
`zod`, `zustand`, `cron-parser`, `bcryptjs`, `recharts`, and `shadcn/ui`
packages (MIT/Apache-2.0 as applicable). Respect each package's license and
attribution requirements when redistributing.
