# DATABASE_ACCESS

## Changes

None. Investigation found no vulnerability — see `security/reports/DATABASE_ACCESS_REPORT.md`. The multi-tenant `workspace_id` scoping pattern was verified empirically (not assumed from comments) across every top-level entity accessor, every child-table route, and the one function that looked like a potential IDOR (`getFilesByIds`). No code, schema, or query changes needed.

## New files

None.

## Verification goals

- [x] Every top-level entity accessor (`get*ById`, `update*`, `delete*`) takes and enforces `workspaceId` in its `WHERE` clause
- [x] Every route calling an unscoped child-table accessor (`getComments`, `getApprovals`, `getMessages`) first resolves its parent through a workspace-scoped lookup and 404s on mismatch
- [x] `getFilesByIds` (the one unscoped-by-id function) is never reachable with attacker-controlled ids — traced every call site
- [x] `req.body` merge-patches (`updateFile` et al.) cannot inject or override the `workspace_id` column — verified the SQL write layer is allow-list based
- [x] No SQL query concatenates user-controlled input into query text; all queries use `?`/named-parameter binding
- [x] `updateWorkspaceBilling`'s dynamic `SET` clause is built from a fixed, code-defined column map, not caller-supplied keys, and is reachable only from the Stripe webhook handler
- [x] Confirmed whether any Supabase table is actually in use (it is not) — so the CLAUDE.md RLS requirement has nothing to apply to today

## Manual verification (for the human)

- None required for this category — no behavior changed.
- Worth bookmarking for later: if you ever wire up real Supabase-backed auth or data (the `server/supabase.ts` / `supabaseMiddleware.ts` scaffolding is already half-built), re-open this category and add explicit RLS policies before that ships, per the project's own CLAUDE.md rule.
