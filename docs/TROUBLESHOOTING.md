# Troubleshooting

Symptom-driven guide to the most common issues.

## The dev server / machine runs out of memory (OOM)

**Symptom:** the dev server or a headless Chrome on the same box dies; the
kernel logs OOM kills.

- The dev watcher plus a headless Chrome on a 4 GB machine can OOM - this was
  observed during testing. Run the dev server alone, or use
  `bun run build && bun run start` for browser-based verification.
- Long node executions do not require more RAM - the engine checkpoints and
  resumes; memory pressure comes from tooling, not workflow size.

## "Save failed" toast in the editor

**Symptom:** autosave or Ctrl+S shows *Save failed*.

- The API server is down or restarting (`PATCH /api/workflows/[id]` failing).
- Check the server process / `dev.log`. Your graph is still in the browser;
  once the server is back, press Ctrl+S. If you must reload first, copy the
  workflow JSON via export (if the server allows) or accept the loss - the
  last autosave (1.2 s debounce) is on the server.

## Webhook returns `409 WORKFLOW_INACTIVE`

**Symptom:** external system posting to your webhook URL gets
`{"error":{"code":"WORKFLOW_INACTIVE"}}`.

- The workflow must be **published AND active** before the endpoint accepts
  requests (test runs work from the editor without activation).
- Fix: open the workflow and click Activate (this publishes a version and
  sets status `active`). Also confirm via
  `GET /api/workflows/[id]/webhook-info` -> `enabled: true`.
- Related codes: `404 NOT_FOUND` (wrong/rotated public id), `404 DISABLED`
  (endpoint disabled), `401 INVALID_SIGNATURE` (signature required but
  missing/wrong - compute `sha256=` + HMAC-SHA256 hex of the raw body with the
  endpoint secret in `X-Flow-Signature`), `413 PAYLOAD_TOO_LARGE` (256 KB
  cap), `429 RATE_LIMITED` (60 req/min per endpoint+IP).

## Schedule never fires

Checklist, in order:

1. **cronjob.org not configured.** Nothing fires without the external
   dispatcher - there is no internal tick. Create the job:
   `{APP_URL}/api/cron/dispatch?secret=<CRON_SECRET>` every 1 minute (see
   `docs/ENVIRONMENT_SETUP.md`). Verify a `200` in the job history.
2. **`CRON_SECRET` mismatch.** The dispatcher returns `401 UNAUTHORIZED`
   (wrong secret) or `503 NOT_CONFIGURED` (missing env).
3. **Plan interval gating.** Activation fails with `403 PLAN_LIMIT` if the
   schedule's smallest interval is below the plan minimum (Free: 60 min).
   Check the Schedules page - the row exists only after successful
   activation.
4. **Workflow not active / schedule disabled.** Schedules are disabled when a
   workflow leaves `active` state; re-activation re-syncs. The Schedules page
   shows `enabled` and `lastDispatchStatus` (e.g.
   `execution_succeeded`, `error: ...`) for diagnosis.
5. **Timezone surprises.** Cron is evaluated in the schedule's timezone
   (default `Asia/Kolkata`) - a "9:00 daily" in IST is 3:30 UTC.

## Send Email fails with a configuration-required message

**Symptom:** step error: *"Resend is not configured. Add a Resend connection
with your API key on the Connections page (or set RESEND_API_KEY on the
server)."*

- This is the honest-failure design, not a bug. Fix by either:
  - creating a **Resend connection** (Connections page -> New -> paste
    `re_...` key) and selecting it in the Send Email node, or
  - setting `RESEND_API_KEY` (+ `RESEND_FROM_EMAIL`) in the server env.
- `from` must be a Resend-verified sender domain, otherwise the provider
  rejects it even with a valid key (check the step's error message for the
  provider response).
- The same pattern applies to Slack/Discord (webhook URL connection) and
  Supabase (url + key connection).

## Expression errors: "Cannot compare ... as a number"

**Symptom:** IF/Filter step fails with e.g.
`Cannot compare "" as a number` or `Cannot compare "undefined" as a number`.

- The condition's left/right expressions resolved to values that are not
  numeric (`gt`, `lt`, `gte`, `lte` compare numerically). Typical cause in
  **test runs**: the trigger body is null/empty because no sample input was
  provided, so `$trigger.body.amount` is undefined.
- Fix: set the trigger node's **sample input** (Manual/Webhook triggers have
  a *Test input / Sample body* field), or make the workflow defensive
  (`{{ number($trigger.body.amount) ?? 0 }}`, or use `default()` /
  `coalesce()`).
- The graph validator catches *syntax* errors at save/publish time, but
  value-shape errors like this only surface at execution - that is expected.

## Workflow import fails

**Symptom:** `400 UNKNOWN_NODE_TYPES: The import file contains unsupported
node types: ...`

- The JSON references node types that don't exist in this registry (e.g. an
  export from a different/older system). Those nodes are **not imported**;
  the rest of the graph is (subject to validation).
- Other import rejections: invalid JSON body (`400 INVALID_JSON`), workflow
  quota reached (`403 PLAN_LIMIT`), graph fails validation (returned in
  `validation` - fix in the editor afterwards).
- Exports always strip `connection` references - re-select connections on
  imported integration nodes.

## Execution stuck in `waiting`

- A `waiting` execution resumes when `waitUntil` passes **and** a resume
  path runs: the cron dispatcher (every minute) or someone opening the
  execution detail page (opportunistic poll).
- If it stays waiting past its `waitUntil`: the dispatcher isn't running -
  check cronjob.org, `CRON_SECRET`, and that `GET
  /api/cron/dispatch?secret=...` returns `200`.
- `waiting` with a far-future `waitUntil` is correct behavior (Wait node).
  Cancel it if unwanted (`POST /api/executions/[id]/cancel`).

## Other quick checks

- **Dispatcher smoke test:**
  `curl -s "$APP_URL/api/cron/dispatch?secret=$CRON_SECRET"` -> expect
  `{"ok":true,...,"claimed":N,"resumed":N}`.
- **Vault status:** `GET /api/connections` -> `vaultConfigured: true`; if
  false, `CREDENTIAL_ENCRYPTION_KEY` is missing/short (needs 64 hex chars).
- **Connection test failing with "could not be decrypted":** the vault key
  was rotated; re-enter the credentials.
- **Isolation sanity check:** logging into a second account and opening
  workflows by id from the first account must return 404 - if it ever returns
  data, that is a security bug.
- **Rate limiting:** repeated 429s during normal use indicate the in-memory
  limiter keyed by IP (behind a proxy, ensure `X-Forwarded-For` is set
  correctly).
