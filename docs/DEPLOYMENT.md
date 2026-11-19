# Deployment

An honest deployment guide. The current build targets a **single-instance
host** - it was built for and verified on a self-hosted sandbox.

## What you are deploying

- Next.js 16 App Router application (`output: "standalone"` build), served on
  port 3000 by default.
- SQLite database file (`db/custom.db` under the project) via Prisma.
- Session-cookie auth and an in-memory rate limiter (both per-process).
- A central cron dispatcher endpoint meant to be driven by cronjob.org.

## Quick deploy (single instance)

```bash
# 1. Clone and install
git clone <your-repo> flow-studio && cd flow-studio
bun install

# 2. Configure
cp .env.example .env
#   - APP_URL=https://your-domain.example
#   - DATABASE_URL="file:./db/custom.db"
#   - CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   - CRON_SECRET=<long random string>
#   - optional: RESEND_API_KEY, Razorpay keys

# 3. Create the database schema
bun run db:push

# 4a. Development
bun run dev                     # http://localhost:3000

# 4b. Production
bun run build                   # standalone build into .next/standalone
bun run start                   # NODE_ENV=production, port 3000
```

Then:

- Put a reverse proxy with TLS in front (the repo contains a `Caddyfile`
  sample; nginx works equally well).
- Set up the cronjob.org dispatcher:
  `https://your-domain.example/api/cron/dispatch?secret=<CRON_SECRET>` every
  1 minute (see `docs/ENVIRONMENT_SETUP.md`).
- Back up the SQLite file (`db/custom.db`) on a schedule - it is the entire
  datastore, including encrypted credentials.

## Resource reality (observed in testing)

- The **dev server plus a headless Chrome browser on the same 4 GB box can
  OOM**. This was observed during verification. For routine development use
  the dev server alone, or build+start for browser-based checks.
- SQLite keeps memory usage modest for the app itself; the heavy consumers
  are the Next.js dev watcher and any concurrently running browser tooling.
- Node-level workloads matter more than instance size: HTTP nodes allow up to
  120 s timeouts, and executions checkpoint every node, so a small box can
  still run long workflows (they resume across dispatcher ticks).

## Scaling to multiple instances / commercial use

The application logic is ready; three things are not:

1. **Database: switch to Postgres.**
   - In `prisma/schema.prisma`, change the datasource to
     `provider = "postgresql"` and set `DATABASE_URL` to the hosted Postgres
     connection string (Neon, Supabase Postgres, RDS, self-hosted, ...).
   - The schema (models, relations, unique constraints, indexes) is
     provider-agnostic - no model changes are needed. Re-run
     `prisma db push` (or generate a migration) against the new database.
2. **Scheduler: exactly one dispatcher.** The atomic claim (`UPDATE ... WHERE
   nextRunAt = claimed value`) prevents double-firing even if the endpoint is
   called concurrently, so the simplest correct setup is to keep cronjob.org
   as the single cron source while scaling web instances. Alternatively run
   an OS-level cron hitting the dispatcher on exactly one designated
   instance.
3. **Rate limiting: move to a shared store.** The limiter in
   `src/lib/api.ts` is in-memory (per instance). Before running multiple
   instances, replace `rateLimit()` with a Redis-backed implementation - the
   call sites don't change.

Optional at scale: object storage for large node payloads (currently capped
at 200 KB JSON per step / 5 MB per HTTP response), and a queue for
high-fan-out webhook traffic.

## Production checklist

- [ ] `APP_URL` set to the public HTTPS URL (webhook URLs are built from it)
- [ ] `CREDENTIAL_ENCRYPTION_KEY` generated (`openssl rand -hex 32`) and
      backed up **securely** - losing it makes stored credentials
      undecryptable; leaking it exposes them
- [ ] `CRON_SECRET` set to a long random value, never committed
- [ ] `bun run db:push` executed; database file/directory backed up
- [ ] TLS terminating reverse proxy in place; cookies set `Secure`
      (automatic when `NODE_ENV=production`)
- [ ] cronjob.org job created (every 1 minute) and returning 200
- [ ] Firewall: only 80/443 (and SSH) exposed; SQLite port N/A; `/api/cron/
      dispatch` is safe behind its secret but should not be listed publicly
- [ ] `.env` excluded from VCS and images
- [ ] Optional integrations configured or consciously omitted: Resend
      (email), Razorpay keys + plan ids (billing)
- [ ] A test workflow activated end-to-end: register, create workflow with a
      webhook trigger, activate, POST to the webhook URL, inspect the
      execution
- [ ] Log rotation for `dev.log` / `server.log` (the npm scripts tee to them)
- [ ] Monitoring: `GET /api` as an uptime probe; watch cronjob.org job
      history; alert on non-200 dispatcher responses

## Rollback / recovery notes

- Restarts are safe: executions are checkpointed per node; interrupted
  `running` executions can be retried/replayed from their stored trigger
  data.
- Mid-loop interruptions restart that loop from item 0 on resume (documented
  in `docs/WORKFLOW_EXECUTION.md`) - consider this before force-killing the
  process.
- Database restore = copy the SQLite file back (or restore the Postgres
  snapshot after migration).
