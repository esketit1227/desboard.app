# SQL_INJECTION

## Changes

None. Exhaustive review of all 118 `db.prepare()` calls in `db.ts` (the sole location of all SQL in the codebase) found zero instances of user-controlled data reaching a query as raw text — see `security/reports/SQL_INJECTION_REPORT.md`.

## New files

None.

## Verification goals

- [x] Confirmed `db.ts` is the only file touching the database directly
- [x] All 15 template-literal-interpolated queries individually traced; every interpolation is either a fixed placeholder-count generator, a hardcoded table/column name, or a constant SQL fragment — never user input
- [x] The remaining 103 queries use `?`/`@name` parameter binding with no interpolation
- [x] No `+`-based string concatenation into any SQL string anywhere

## Manual verification (for the human)

- None required — no behavior changed.
