# Connector Development

How Flow Studio integrates with third-party services, and how to add a new
connector.

## The integration pattern

Every integration node (Send Email / Resend, Slack message, Discord message,
Supabase) follows the same pattern, defined in
`src/core/nodes/definitions/integrations.ts`:

1. **Credential resolution via `ctx.getConnection`.** The node config holds a
   connection id (picked from the credential dropdown in the config panel,
   filtered by `credentialProvider`). At execution time the engine passes the
   node a `getConnection(connectionId)` function that reads from the
   connections map **pre-decrypted inside the engine closure** - decryption
   never happens in the node, in an API route, or anywhere a request context
   could leak it. Credentials are never exposed to the expression context.
   Some nodes also accept a direct value (e.g. a webhook URL field) or fall
   back to a server environment key (`RESEND_API_KEY`).
2. **Real HTTP through `safeFetch`.** All outbound calls go through
   `src/lib/ssrf.ts` (see below) - never raw `fetch`.
3. **Honest `CONFIGURATION_REQUIRED` failures.** When no credential is
   available, the node fails immediately with a clear message and a
   `CONFIGURATION_REQUIRED` code in `error.details` - which also tells the
   engine **not to retry**. Connectors never pretend to succeed.
4. **Per-node `continueOnFail`** (where offered) lets the workflow proceed
   with the error captured in the node output.

## The SSRF guard (`src/lib/ssrf.ts`)

`safeFetch(url, options)` - used by every outbound HTTP node and by
connection tests / notifications / billing:

- **Scheme allowlist:** only `http:` and `https:`.
- **DNS resolution check:** the hostname is resolved (`dns.lookup`) and every
  resulting address is checked against blocked ranges: loopback (`127.0.0.0/8`,
  `::1`), private (`10/8`, `172.16/12`, `192.168/16`), link-local
  (`169.254.0.0/16` including the cloud metadata IP `169.254.169.254`, and
  `fe80::/10`), CGNAT (`100.64/10`), unique-local (`fc00::/7`), multicast /
  reserved (`224+`), plus hardcoded metadata hostnames
  (`metadata.google.internal`, `metadata.goog`). IPv4-mapped IPv6 is
  normalized and re-checked.
- **Redirect re-validation:** redirects are followed manually (max 3); every
  hop's `Location` is re-resolved and re-checked against the same rules, so a
  public URL cannot bounce to an internal address. (On redirect the request
  degrades to GET without headers/body.)
- **Response cap:** bodies are streamed with a **5 MB cap** (`truncated: true`
  when exceeded).
- **Timeouts:** per-request timeout via `AbortController` (default 30 s).
- **Header hygiene:** `Authorization` response headers are redacted in the
  captured output.

## Connection providers

Defined in `src/app/api/connections/route.ts` (`CONNECTION_PROVIDERS`) - this
is the single list that drives the Connections page, the credential dropdowns,
and the test endpoint:

| Provider id | Label | Credential fields | What "Test connection" really does |
| --- | --- | --- | --- |
| `resend` | Resend | `apiKey` (password) | `GET https://api.resend.com/domains` with the key; 200 = connected, 401/403 = rejected |
| `slack-webhook` | Slack (incoming webhook) | `webhookUrl` (password) | Posts a real, visible test message to the channel; 2xx + `ok` = connected |
| `discord-webhook` | Discord (channel webhook) | `webhookUrl` (password) | Posts a real, visible test message; 2xx = connected |
| `supabase` | Supabase | `url` (text) + `apiKey` (password) | `GET <url>/rest/v1/` with the key; 200 = connected, 401 = rejected |
| `http-basic` | HTTP Basic auth | `username` + `password` | No automated test (credentials are per-request); returns `untested` with guidance |
| `http-bearer` | HTTP Bearer token | `token` (password) | No automated test (per-request); returns `untested` with guidance |

A test only ever reports `connected` when the provider itself confirms the
credentials work. Test results (status + message) are stored on the
connection row.

## Adding a new connector node

1. **(If new provider) extend `CONNECTION_PROVIDERS`** in
   `src/app/api/connections/route.ts`: provider id, label, description, docs
   URL, and the credential fields (text/password, required). Add a real test
   branch in `src/app/api/connections/[id]/test/route.ts` if the provider has
   a cheap verification endpoint - or leave it returning `untested` with an
   honest message.
2. **Create the node definition** in
   `src/core/nodes/definitions/integrations.ts`:
   - `category: "Integrations"` (or `"Communication"` for email), `kind:
     "action"`, one `out` port.
   - First config field: `{ key: "connection", type: "credential",
     credentialProvider: "<provider id>" }` so the panel only offers matching
     connections.
   - `validate()`: require the payload fields; if a credential or direct
     value is mandatory, return a `CONFIGURATION_REQUIRED` issue when absent.
   - `execute()`:
     ```ts
     const conn = ctx.getConnection(String(config.connection || ""));
     if (!conn) {
       return { status: "failed", error: { message: "... connection not found. Create it on the Connections page.",
         details: { code: "CONFIGURATION_REQUIRED", field: "connection" } } };
     }
     // build request from conn.credentials + resolved config values
     const res = await safeFetch(url, { method, headers, body, timeoutMs });
     ```
   - Map provider responses to a small output object (`{ delivered: true }`,
     `{ data: ... }`); include the provider's error text on failure.
3. **Register** the definition in `src/core/nodes/registry.ts`.
4. Optional: add a template in `src/core/templates.ts` that uses the node,
   declaring `requiredProviders` so the UI shows honest setup requirements.

Do not add placeholder/fake connectors. Nodes that cannot run without user
credentials must fail with `CONFIGURATION_REQUIRED` - that behavior is
intentional and tested (see `docs/TESTING.md`).

## Current integration status

Implemented: Resend (email), Slack (webhook), Discord (webhook), Supabase
(PostgREST CRUD + RPC) - all requiring user-supplied credentials.

Not implemented: Microsoft 365, Google Workspace, and OAuth-based Slack
connectors. The environment template reserves `GOOGLE_*`, `MICROSOFT_*`, and
`SLACK_CLIENT_*` variables for future OAuth flows, but there are no fake
connection entries for them anywhere in the product.
