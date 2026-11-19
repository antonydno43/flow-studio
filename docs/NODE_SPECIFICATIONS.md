# Node Specifications

The node catalog is defined in `src/core/nodes/definitions/*.ts` and registered
in `src/core/nodes/registry.ts`. **38 node types** are available; the
client-safe catalog (no execute functions) is served by `GET /api/nodes` and
drives the editor palette and config panel.

All "source"-style config fields accept expressions (`{{ ... }}`). Leaving a
source empty means "use the previous node's output".

## Triggers (3)

Triggers have no inputs and one `out` port. Exactly one trigger per workflow
(validator-enforced).

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `trigger-manual` | Manual Trigger | Runs on Test/Run button | `sampleInput` (JSON used by test runs) | `{ input: <test input or live trigger payload> }` |
| `trigger-schedule` | Schedule Trigger | Runs on a cron schedule | `mode` (minutes/hourly/daily/weekly/monthly/custom), `minutes`, `hour`, `minute`, `dayOfWeek`, `monthDay`, `cronExpression` (5-field), `timezone` (IANA), `enabled` | `{ scheduledAt, timezone, cron, timestamp }` |
| `trigger-webhook` | Webhook Trigger | Runs on inbound HTTP to the workflow's unique URL | `requireSignature` (X-Flow-Signature HMAC), `sampleInput` (test-run body), `note` (read-only URL hint) | `{ method, headers, query, body, receivedAt }` |

## HTTP & APIs (2)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `http-request` | HTTP Request | Calls any REST API with SSRF protection | `method` (GET/POST/PUT/PATCH/DELETE/HEAD), `url` (required, expression), `headers`, `queryParams`, `bodyType` (none/json/text/form) + `jsonBody`/`textBody`, `authType` (none/basic/bearer/apikey) + credentials, `timeoutMs` (1s-120s, default 30s), `retryMaxTries` (1-5), `retryBackoffMs`, `continueOnFail` | `{ status, ok, headers, data, truncated, requestUrl }` |
| `webhook-response` | Webhook Response | Returns a custom response to the webhook caller | `status` (200-599), `headers`, `bodyType` (json/text), `jsonBody`/`textBody` | `{ responded: true, status }` (ignored when not webhook-triggered) |

## Conditions & Logic (6)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `if` | IF / ELSE | Routes down `true` or `false` branch | `combinator` (and/or), `conditions` [{source, operator, target}] - 15 operators: eq, neq, gt, lt, gte, lte, contains, not_contains, starts_with, ends_with, is_empty, is_not_empty, exists, not_exists, regex | `{ conditionMet: true\|false, input }` |
| `switch` | Switch | Routes to one of 5 case ports or `default` | `source` (expression, required), `cases` (up to 5 values), `useDefault` | `{ matchedCase: <index or 'default'>, value, input }` |
| `filter` | Filter | Keeps array items matching conditions (`$item` binds each item) | `combinator`, `conditions` | `{ data: [...kept], total, kept, tested }` |
| `merge` | Merge | Combines multiple branches (needs >= 2 inputs) | `mode` (append / combine_position (zip) / combine_key / passthrough), `keyField` (default `id`) | `{ merged: [...], branchCount }` |
| `wait` | Wait / Delay | Durable suspension until a time | `mode` (delay / until), `delayValue` + `delayUnit` (seconds/minutes/hours) or `untilDate` (datetime). Max 1 year | `{ resumedAt, waitedMs }` |
| `stop` | Stop / Error | Hard-stops the workflow | `mode` (success / error), `message` | `{ stopped: true, message }` |

## Loops (3)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `loop-items` | Loop Over Items | Runs the body once per item (`$item`/`$index`) | `items` (expression returning array, required), `maxIterations` (default 1000), `continueOnError` | `{ items: [...], count }` then per-iteration body |
| `split-batches` | Split in Batches | Runs the body once per batch (`$item` = batch array) | `items` (required), `batchSize` (default 10), `maxBatches` (default 100), `delayMs`, `continueOnError` | `{ batches, batchSize, totalItems }` |
| `loop-end` | Loop End | Closes the loop body; aggregates iterations | `mode` (collect - array of iteration outputs / last) | `[ ...per-iteration outputs ]` or last output |

Loop bodies are the region between the loop node's `body` port and Loop End;
no node inside may receive a connection from outside the region (engine-enforced).

## Data Transformation (20)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `set-fields` | Set Fields | Adds/overwrites fields on the input object | `fields` (key + value expression list, required) | `{ ...input, <your fields> }` |
| `edit-fields` | Edit Fields | Set / rename / remove in one op | `operations` (fieldOps: op, key, value, to; required) | `{ ...edited fields }` |
| `rename-fields` | Rename Fields | Renames via from -> to list | `renames` (required) | `{ ...renamed fields }` |
| `remove-fields` | Remove Fields | Deletes listed keys | `keys` (comma-separated, required) | `{ ...remaining fields }` |
| `json-parse` | JSON Parse | Parses a JSON string | `source` (optional; passes objects through) | parsed object / array |
| `json-create` | JSON Create | Builds an object from mapped fields | `fields` (required) | `{ ...mapped fields }` |
| `csv-parse` | CSV Parse | CSV text -> row objects (quote-aware) | `source`, `delimiter` (, / ; / tab), `hasHeaderRow` | `{ data: [ { col: value } ], columns }` |
| `csv-generate` | CSV Generate | Row objects -> CSV text (escapes) | `source`, `delimiter` | `{ csv, rowCount, columns }` |
| `text-formatter` | Text Formatter | Case, trim, truncate, extract JSON, template | `source`, `operation` (uppercase/lowercase/title/capitalize/trim/truncate/extract_json/template), `maxLength`, `template` | `{ text }` or extracted JSON |
| `replace-text` | Replace Text | Find/replace, optional regex | `source`, `find` (required), `replace`, `useRegex`, `caseSensitive` | `{ text }` |
| `split-text` | Split Text | Text -> array by separator | `source`, `separator` (required), `trim` | `{ data: [...], count }` |
| `join-text` | Join Text | Array -> string | `source`, `separator` (default ", ") | `{ text }` |
| `array-aggregator` | Array Aggregator | Collects input into an array | `source`, `fieldName` (default `data`) | `{ data: [...], count }` |
| `object-aggregator` | Object Aggregator | Builds an object from mapped fields | `fields` (required) | `{ ...mapped fields }` |
| `date-formatter` | Date Formatter | Formats a date (ISO/timestamp/now) | `source`, `format` (yyyy-MM-dd, dd/MM/yyyy, yyyy-MM-dd HH:mm:ss, iso, HH:mm, timestamp), `addDays`, `addHours` | `{ date, iso }` |
| `date-diff` | Date Difference | Difference between two dates | `dateA` (required), `dateB` (default now), `unit` (seconds/minutes/hours/days) | `{ difference, unit, dateA, dateB }` |
| `math` | Math Operations | Evaluate a math expression or aggregate an array | `mode` (expression / aggregate), `expression` (e.g. `{{ $item.amount }} * 1.18`), `operation` (sum/avg/min/max/count), `source` | `{ result }` |
| `type-conversion` | Type Conversion | Convert between string/number/boolean/JSON | `source`, `targetType` | `{ value }` or parsed JSON |
| `sort-array` | Sort Array | Sort by field or naturally | `source`, `key`, `order` (asc/desc) | `{ data: [...], count }` |
| `remove-duplicates` | Remove Duplicates | Deduplicate by field or whole item | `source`, `key` | `{ data: [...], count, removed }` |

## Communication (1)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `send-email` | Send Email (Resend) | Sends email through the Resend API | `connection` (resend credential; falls back to server `RESEND_API_KEY`), `from` (falls back to `RESEND_FROM_EMAIL`), `to` (required, comma-separated allowed), `subject` (required), `bodyMode` (html/text) + `html`/`text`, `replyTo` | `{ messageId, status: "sent", to, subject }` |

## Integrations (3)

| Type | Name | Purpose | Key config fields | Output hint |
| --- | --- | --- | --- | --- |
| `slack-message` | Send Slack Message | Posts via Slack incoming webhook | `connection` (slack-webhook) or `webhookUrl` (one required), `text` (required) | `{ delivered: true, response }` |
| `discord-message` | Send Discord Message | Posts via Discord channel webhook | `connection` (discord-webhook) or `webhookUrl` (one required), `content` (required), `username` | `{ delivered: true }` |
| `supabase` | Supabase | Select/insert/update/upsert/delete/RPC on your Supabase project (PostgREST) | `connection` (supabase, required), `operation` (select/insert/update/upsert/delete/rpc), per-op `table*` / `rpcName`, `columns` (default `*`), `filters` [{column, op, value}] (PostgREST ops: eq, neq, gt, lt, gte, lte, like, ilike, is, in), `limit`, `orderBy`, `data*` (JSON, expressions), `onConflict`, `rpcParams`, `continueOnFail` | `{ data: [...rows] }` / `{ data, inserted }` etc. |

## The node contract

`NodeDefinition` (`src/core/types.ts`) - every node implements:

```ts
interface NodeDefinition {
  type: string;          // unique registry key, e.g. "http-request"
  version: number;       // definition version (bump on behavior changes)
  name: string;          // palette label
  description: string;
  category: string;      // one of NODE_CATEGORIES
  icon: string;          // lucide icon name
  kind: "trigger" | "action" | "logic";
  inputs: number;        // input port count (0 for triggers)
  outputs: OutputPort[]; // [{ id, label, color? }] - port ids become edge sourcePorts
  configSchema: ConfigField[]; // drives the dynamic config panel
  defaultConfig: Record<string, unknown>;
  outputHint?: string;   // shown in the mapping UI
  validate(config): ValidationIssue[];        // editor-time checks
  execute(ctx, config, input): Promise<NodeExecutionResult>; // run-time
}
```

- `ConfigField` supports 18 field types (text, textarea, number, password,
  select, multiselect, boolean, radio, json, code, expression, credential,
  date, datetime, fields, conditions, cases, filters, fieldOps, renames), plus
  `showIf` conditional visibility and `credentialProvider` filtering for
  credential pickers.
- `NodeExecutionContext` gives `execute()` everything it may touch:
  `resolve(template)` / `evaluate(expr)` (expression engine), `ctx`
  (the raw expression context: `$trigger`, `$item`, node outputs, ...),
  `getConnection(connectionId)` (decrypted credentials, server-side only),
  `log()`, `now()`.
- `NodeExecutionResult` can set: `status` (succeeded/failed/skipped),
  `output`, `error`, `logs`, `activatePorts` (branching), `waitUntil`
  (durable wait), `stopExecution` (Stop node), `webhookResponse`, and `loop`
  (per-item/batch region execution).

## Adding a new node

1. **Create the definition.** Add a `NodeDefinition` export in the fitting
   file under `src/core/nodes/definitions/` (e.g. `integrations.ts`) or a new
   file. Reuse helpers from `src/core/nodes/utils.ts` (`requireFields`,
   `rstr`/`rnum`/`rbool`/`rval` for expression-resolved config values,
   `resolveFieldList`, `resolveJsonObject`, `truncateForStorage`,
   `evaluateConditions`). Outbound HTTP must go through `safeFetch`
   (`src/lib/ssrf.ts`).
2. **Register it.** Import and add it to the `definitions` array in
   `src/core/nodes/registry.ts`. The registry throws on duplicate types.
3. **Done.** The node automatically appears in the editor palette (via
   `/api/nodes`), is accepted by the graph validator (ports, config
   validation, expression checks), executes in the engine (including inside
   loop bodies), validates on import, and can be used in templates.

No engine, validator, or frontend changes are required - the registry is the
single integration point.
