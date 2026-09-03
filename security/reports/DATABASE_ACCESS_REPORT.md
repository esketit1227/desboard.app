# DATABASE_ACCESS

## Status: PASS

## Findings

**Primary datastore is SQLite via better-sqlite3 (`db.ts`), not Supabase.** Confirmed by reading `db.ts` in full and grepping the whole tree for `.from(` (Supabase's query builder entry point) — zero matches anywhere outside `Buffer.from`/`Array.from` calls. `server/supabase.ts` and `server/supabaseMiddleware.ts` exist but are unused scaffolding: `supabaseSessionMiddleware` is a no-op on every request today (its own doc comment says so explicitly — "there's no login flow wired up yet"), and no code path ever reads or writes a Supabase table. This matters directly for the CLAUDE.md rule requiring RLS on every Supabase table: **there are no Supabase tables in use**, so that rule is currently satisfied vacuously. Flagged under Recommendations so it doesn't get missed if Supabase auth is ever actually wired up later.

**Multi-tenant isolation in the real datastore was verified empirically, not just from the file's own doc comment.** `db.ts`'s header comment claims: every top-level entity table carries `workspace_id`, every read/write function bakes `workspaceId` into the SQL, and child tables (comments, approvals, messages, portal events) inherit protection because routes always resolve their parent with a workspace check first. Checked this claim against the actual code:
- Every exported `get*ById`/`update*`/`delete*` function for a top-level entity (`getFileById`, `getProjectById`, `getHandoverById`, `getTaskById`, `getEventById`, `getTeamMemberById`, `getConversationById`, etc.) takes `workspaceId` and uses it in the `WHERE` clause — spot-verified in `db.ts` directly.
- The unscoped child accessors (`getComments(handoverId)`, `getApprovals(handoverId)`, `getMessages(conversationId)`) are, as claimed, never reachable without a prior workspace-scoped parent lookup. Checked every route in `server.ts` that calls them: `GET /api/handovers/:id/comments`, `GET /api/handovers/:id/approvals`, and `GET /api/conversations/:id/messages` all call `getHandoverById(req.params.id, workspaceOf(req))` / `getConversationById(req.params.id, workspaceOf(req))` first and return 404 before ever touching the child table.
- `getFilesByIds(ids)` (no workspace param) is the one function that looked like it could be an IDOR vector. Traced every caller: it's only ever invoked internally with a handover's own already-workspace-verified `fileIds` array (three call sites inside `db.ts`'s dashboard-insight functions, one in `server/portal.ts`'s token-gated public portal). Never called with attacker-supplied ids directly. Safe.
- `updateFile`'s merge-patch (`{...existing, ...patch, id}`) looked, from an earlier pass, like a mass-assignment risk since `patch` can be a raw `req.body`. Traced it through to the actual SQL write: `writeFile()` re-normalizes through an explicit named-parameter list (`id, workspace_id, name, type, ...`) where `workspace_id` always comes from the function's own `workspaceId` argument (bound to `workspaceOf(req)` from the session), never from the patch object. A malicious body can't inject a `workspace_id` field into the row — the write layer is allow-list based, not a blind spread into SQL. (A narrower, non-leaking data-integrity nuance — whether a patched `projectId`/`clientId` is itself validated to belong to the same workspace — is noted for category 4/ACCESS_CONTROL rather than here, since it's about resource-relationship validation, not raw data-layer access.)

**SQL injection surface at the data-access layer**: every query uses `better-sqlite3`'s prepared statements with `?` placeholders or named parameters (`@col`). Grepped for template-literal SQL containing `${...}` interpolation to find any place a raw value might be concatenated into a query string — every hit is either (a) a hardcoded, code-defined table/column name from a fixed internal list (migration loop over known table names, `updateWorkspaceBilling`'s hardcoded `map` of column names), or (b) dynamic `IN (?,?,?)` placeholder-count generation for array binding, with the actual values still passed through `.run(...)` as bound parameters, never string-concatenated. No user-controlled string ever reaches a query as raw SQL text. (Full pass deferred formally to category 11/SQL_INJECTION, but nothing here contradicts this finding.)

**Minor/informational, not a vulnerability:** `desboard.db`, `.db-wal`, `.db-shm` are created with default `644` permissions (world-readable within the host). Not flagged as a real risk for this app's deployment model (single-tenant container on Railway, no other local OS users), but worth a one-line note.

## What's at risk

Nothing currently exploitable. The only latent risk is architectural drift: if Supabase auth is ever actually wired up in the future (the scaffolding is present and half-built), RLS policies would need to be configured on every table it touches *before* that ships — today there's nothing to misconfigure because there's no Supabase data path at all.

## What's already secure

- Consistent, verified (not assumed) `workspace_id` scoping on every top-level entity table, enforced at the SQL layer, not just in application logic.
- Child-table accessors are safe by construction — every route resolves and workspace-checks the parent before calling them.
- `writeFile`'s allow-list write path prevents `req.body` mass-assignment from reaching the `workspace_id` column even though `updateFile`'s in-memory merge is unrestricted.
- All SQL is parameterized; no string-built queries with user-controlled content anywhere in `db.ts`.
- `updateWorkspaceBilling`'s dynamic `SET` clause is built from a hardcoded column-name map, not from caller-supplied keys, and is reachable only from the signature-verified Stripe webhook handler (verified via `git grep` — exactly two call sites, both in `server/billing.ts`).

## Recommendations

1. If/when Supabase auth is actually activated (`supabaseSessionMiddleware` stops being a no-op and a real login flow is wired to it), revisit this category: enable RLS on any table it then reads/writes, default-deny, explicit policies scoped to `auth.uid()`, per the project's own CLAUDE.md rule. Not applicable today since no such table exists yet — no code change made.
2. No code changes needed otherwise. This category passes as-is.
