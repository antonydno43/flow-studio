# Environment Setup

Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.

## Required variables

| Variable | Purpose | Required | How to obtain | Client-safe? | How to test |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | SQLite database location for Prisma | Yes | Default `file:./db/custom.db` (relative to `prisma/`); any writable path works | N/A | `bun run db:push` creates the file without errors |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for the AES-256-GCM credential vault | Yes | `openssl rand -hex 32` | No (server only) | `GET /api/connections` returns `vaultConfigured: true`; creating a connection works instead of `503 VAULT_NOT_CONFIGURED` |
| `CRON_SECRET` | Secret protecting `/api/cron/dispatch` | Yes (for schedules/waits) | Any long random string, e.g. `openssl rand -hex 24` | No | `curl "$APP_URL/api/cron/dispatch?secret=$CRON_SECRET"` returns `{ ok: true, dispatched: true, ... }`; a wrong secret returns `401 UNAUTHORIZED` |
| `APP_URL` | Public base URL; used to build webhook URLs and links | Yes | Your deployment URL; `http://localhost:3000` for local dev | Yes (public) | `GET /api/workflows/[id]/webhook-info` returns a URL starting with `APP_URL` |

Note: without `CRON_SECRET`, the dispatcher endpoint responds
`503 NOT_CONFIGURED` and schedules/waiting executions never fire - that is an
explicit failure, not a silent skip.

## Optional variables

| Variable | Purpose | Required | How to obtain | Client-safe? | How to test |
| --- | --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | Email delivery (Send Email node + email notifications) | No | resend.com -> API keys | No | Create a Resend connection or set the key, then send a test email; without it the node fails with a configuration-required message and notifications record `skipped_no_provider` |
| `RESEND_FROM_EMAIL` | Verified sender address (default `onboarding@resend.dev`) | No | Resend -> Domains | No | Send an email and inspect the `from` in the received message |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Billing provider credentials for paid-plan checkout | No | Razorpay dashboard | No | `GET /api/billing` shows `provider.configured`; with keys, `POST /api/billing` creates a real subscription (`checkoutRequired: true`) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature verification (reserved for the payment webhook) | No | Razorpay dashboard -> Webhooks | No | Provider webhook confirmation path |
| `RAZORPAY_PLAN_STARTER` / `RAZORPAY_PLAN_PRO` | Razorpay plan ids used at subscription creation | No | Razorpay dashboard -> Plans | No | Inspect the created subscription's `plan_id` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Reserved for future Google OAuth connectors (not implemented) | No | Google Cloud console | No | N/A - variables are placeholders only |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_CLIENT_TENANT_ID` | Reserved for future Microsoft 365 OAuth connectors (not implemented) | No | Azure portal | No | N/A |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Reserved for future Slack OAuth connector (not implemented) | No | Slack app config | No | N/A |

Optional-variable honesty: when `RESEND_API_KEY` is missing, email features
fail with a configuration notice; when Razorpay keys are missing, the billing
page shows a configuration notice and paid-plan purchase returns `503
BILLING_NOT_CONFIGURED`. Nothing is faked.

## Local quick start

```bash
bun install
cp .env.example .env        # fill in APP_URL, CREDENTIAL_ENCRYPTION_KEY, CRON_SECRET
bun run db:push             # create the SQLite schema
bun run dev                 # http://localhost:3000
```

For local testing of schedules/waits without cronjob.org, poll the dispatcher
manually:

```bash
watch -n 30 'curl -s "http://localhost:3000/api/cron/dispatch?secret=YOUR_CRON_SECRET" | head -c 400'
```

## cronjob.org setup (production scheduler)

Flow Studio has no internal tick - a single external dispatcher drives all
schedules and waiting-execution resumes for all customers:

1. Create a free account at [cronjob.org](https://cronjob.org).
2. Create a new cron job:
   - **URL:** `{APP_URL}/api/cron/dispatch?secret=YOUR_CRON_SECRET`
     (replace with your real `APP_URL` and `CRON_SECRET`)
   - **Schedule:** every **1 minute**
   - Method GET (POST with `Authorization: Bearer <secret>` also works).
3. Save and enable it. Watch the job's history for `200 OK` responses.

What one invocation does:

- **Claims due schedules atomically.** It reads due schedules
  (`enabled = true, nextRunAt <= now`, up to 25), then performs a conditional
  update `UPDATE schedule ... WHERE id = ? AND nextRunAt = <the value just
  read>`. If another dispatcher instance won the race, `count = 0` and the
  run is skipped - duplicate executions are impossible even if the endpoint
  is called concurrently.
- **Creates and runs executions** from each schedule's pinned workflow
  version (with timezone-aware cron evaluation via cron-parser), recording
  `lastDispatchStatus` per schedule for observability.
- **Computes next runs with timezone support:** the next `nextRunAt` is
  computed *from the claimed time*, not from "now", so long dispatcher gaps
  don't cause missed or duplicated runs.
- **Resumes waiting executions** whose `waitUntil` has elapsed (up to 25 per
  pass), continuing them from their last checkpoint.

## Plan interval gating

The Free plan enforces a **60-minute minimum** between scheduled runs
(Starter: 15 min, Pro: 5 min). The check runs at activation time
(`POST /api/workflows/[id]/publish`): the schedule trigger's cron is analyzed
for its smallest interval between the next two runs; below the plan minimum,
activation fails with `403 PLAN_LIMIT`. cronjob.org itself may call the
dispatcher every minute regardless - that cadence only controls *checking*
for due work, not how often any single workflow may fire.
