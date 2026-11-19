# Credential Security

How Flow Studio stores, uses, and never leaks customer secrets. The relevant
code: `src/lib/crypto.ts` (vault), `src/lib/auth.ts` (passwords/sessions),
`src/core/engine/executor.ts` (decryption boundary),
`src/app/api/connections/*` (storage/API surface),
`src/app/api/webhooks/[publicId]/route.ts` (webhook signatures).

## The credential vault (AES-256-GCM)

`src/lib/crypto.ts`:

- **Key:** `CREDENTIAL_ENCRYPTION_KEY` environment variable - a 32-byte hex
  string (64 hex chars, generated with `openssl rand -hex 32`). The server
  refuses to store connections without it (`503 VAULT_NOT_CONFIGURED`).
- **Per-credential random IV:** every `encryptSecrets()` call generates a
  fresh 12-byte random IV with `crypto.randomBytes`. Identical credentials
  encrypted twice produce different ciphertexts.
- **Auth tag:** AES-256-GCM's authentication tag is stored alongside the
  ciphertext; `decryptSecrets()` fails closed on any tampering.
- **Versioned payload:** ciphertext is stored as
  `{ "v": 1, "iv": "<hex>", "tag": "<hex>", "data": "<hex>" }`. `v` is checked
  on decrypt (`"Unsupported credential version"`), enabling future key/algorithm
  rotation. The `Connection.encryptionVersion` column mirrors this.
- **Rotation caveat:** rotating the key without re-encryption makes existing
  credentials undecryptable. The engine treats stale/undecryptable rows as
  *missing* (the connection test reports this explicitly and asks the user to
  re-enter credentials).

## Secrets never leave the server

- **Connections list API returns metadata only** (`id, provider,
  providerLabel, name, status, lastTestedAt, lastTestResult, createdAt`).
  There is no code path that returns decrypted credentials from any API.
- **Export strips credential references.** Workflow export sets
  `connection: ""` on every node; imports do the same - shared workflow files
  never contain vault ids or secrets.
- **Never logged.** Credentials are not logged; `crypto.redact()` is provided
  for any future logging needs; response `Authorization` headers are redacted
  by `safeFetch` before storage; webhook request capture excludes `cookie`,
  `authorization`, and `x-flow-signature` headers.
- **Decrypted only inside the engine closure.** `loadConnectionsMap()`
  decrypts the workspace's connections into a `Map` that lives only for the
  duration of `runExecution()`. Nodes receive credentials exclusively through
  `ctx.getConnection(connectionId)`.

## Not exposed to the expression context

The expression context (`ExpressionContextData`) contains `$trigger`, `$vars`,
`$item`, `$index`, `$items`, `$execution`, `$now`, and node *outputs*. It
deliberately has **no access to connections or credentials** - a workflow
expression such as `{{ $connections.resend.apiKey }}` is impossible by
design. A node that needs a secret must fetch it via `ctx.getConnection()`
and decide what (if anything) of it appears in its output. Even then, treat
outputs as user-visible: connector nodes return only provider results
(`messageId`, `delivered: true`, rows), never the credentials used.

## Webhook signing secrets

- Each `WebhookEndpoint` gets a random signing secret
  (`generateSigningSecret`-style random hex), stored **encrypted** in
  `encryptedSecret` with the same vault.
- It is revealed once to the workflow owner via
  `GET /api/workflows/[id]/webhook-info` (required to compute signatures);
  inbound verification uses `X-Flow-Signature: sha256=<hex HMAC-SHA256 of the
  raw body>` and rejects mismatches with `401 INVALID_SIGNATURE`.
- Signature verification is opt-in per workflow (trigger config
  `requireSignature`).

## Passwords and sessions

- **Password hashing:** bcrypt (`bcryptjs`, cost 10). Passwords are never
  stored or logged in plain text; login compares with `bcrypt.compare`.
- **Session tokens:** 32-byte random hex (`crypto.randomBytes(32)`), stored
  in the `Session` table, set as an `fs_session` cookie with `httpOnly`
  (JavaScript cannot read it), `SameSite=Lax`, `path=/`, `Secure` in
  production, 30-day expiry. Logout deletes the session row; password change
  invalidates **all** sessions and re-issues one.
- **Comparison hygiene:** `timingSafeEqual()` is exported for secret
  comparisons (used for webhook-signature-style checks where applicable).
- Rate limiting protects the auth endpoints (10/min per IP) and the public
  webhook endpoint (60/min per endpoint+IP).

## Other protections worth knowing

- All outbound HTTP (nodes, connection tests, notifications, billing) goes
  through the SSRF-guarded `safeFetch` - see `docs/CONNECTOR_DEVELOPMENT.md`.
- Environment-provided keys (`RESEND_API_KEY`, `RAZORPAY_KEY_SECRET`,
  `CRON_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`) are server-side only and never
  sent to the client. The client-safe surface only includes booleans such as
  `vaultConfigured` and `provider.configured`.
- Account deletion cascades to all stored credentials.
