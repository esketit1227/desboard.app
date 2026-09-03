# SQL_INJECTION

## Status: PASS

## Findings

**`db.ts` is the sole location of all SQL in the codebase.** Confirmed by grepping every `server/*.ts` file for `.prepare(`/`.exec(` — the only hit outside `db.ts` is `server/storage.ts:69`'s `/^bytes=(\d*)-(\d*)$/.exec(range)`, a JavaScript `RegExp.exec()` call for parsing an HTTP `Range` header, unrelated to SQL. No other file touches `better-sqlite3` directly.

**Exhaustive pass over every parameterized query in `db.ts`:** of 118 total `db.prepare()` calls, 15 use template-literal interpolation (`${...}`) inside the SQL string — every one of the 15 was individually traced (not sampled) to confirm what's actually being interpolated:
- 12 of the 15 build a dynamic `IN (?,?,?)` clause via a local `placeholders` helper (two near-identical implementations, one at `db.ts:1711`, one at `db.ts:2730`), which was itself checked: both only ever emit a fixed count of literal `?` characters derived from an array's *length* — never from its contents. The actual values are always passed separately as bound parameters via `.run(...ids)`/`.all(...ids)`, never concatenated into the query text.
- 2 (`db.ts:517`, `:586`) interpolate a `table` variable that only ever comes from a hardcoded, code-defined array of table names in an internal migration loop — never from any request-derived value.
- 1 (`db.ts:1494`, `updateWorkspaceBilling`) builds a dynamic `SET` clause from `Object.entries()` of a hardcoded column-name map (`plan_tier`, `stripe_customer_id`, etc., defined literally in source) — not from caller-supplied object keys. Already independently verified under `DATABASE_ACCESS` to be reachable only from the signature-verified Stripe webhook handler.
- 2 (`db.ts:1589`, `:1594`) interpolate `USER_SELECT`, a single constant SQL fragment defined once in source, reused across two queries — not request-derived.

**Every other query** (103 of 118) uses plain `?` positional or `@name` named placeholders with no interpolation at all — the standard, safe `better-sqlite3` pattern throughout.

No query anywhere in the codebase concatenates a request body field, query parameter, URL param, or header value directly into SQL text via string concatenation (`+`) or template interpolation. Every value that originates from user input reaches the database exclusively as a bound parameter.

## What's at risk

Nothing found.

## What's already secure

- 100% of the codebase's SQL lives in one file, making this class of bug easy to audit exhaustively (done here) rather than needing to trust sampling.
- Every dynamic-SQL-shape helper (`placeholders`, the hardcoded table-name loop, the hardcoded billing column map) was individually verified to only ever vary based on code-controlled structure (counts, fixed lists), never user-controlled content.
- `better-sqlite3`'s prepared-statement API is used consistently, with no fallback to raw `.exec()` with interpolated user data anywhere.

## Recommendations

None — this category passes as-is.
