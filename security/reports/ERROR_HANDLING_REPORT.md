# ERROR_HANDLING

## Status: MEDIUM (fixed)

## Findings

**Real, widespread finding: every route's catch block echoed the raw caught exception's `.message` directly into the API response, with zero server-side logging as a fallback.** Grepped every `catch` block across `server.ts`, `server/oauth.ts`, and `server/sso.ts` for the pattern `error: e.message || "<safe fallback>"` (or the OAuth-error-page/SSE equivalents) — found **16 occurrences**: 12 in `server.ts` (create-file, create-project, save-settings, clear-demo-data, create-task, create-event, create-team-member, create-conversation, create-handover, AI chat/analyze, and the AI-assistant SSE stream), 3 in `server/oauth.ts` (token refresh, connection-finish page, browse/import), 2 in `server/sso.ts` (sign-in-failed page). In every one of these, `e.message` was preferred over the route's own already-safe, already-descriptive fallback string (`"Failed to create file"`, etc.) whenever the exception had a truthy `.message` — which is essentially always, so the safe fallback was practically dead code and the raw exception detail reached the client on every real error.

**Confirmed this was actively exploitable, not theoretical — witnessed it directly during this audit's own testing.** An earlier live test (creating a handover with a missing required field, during `FILE_UPLOADS` verification) returned `{"error":"NOT NULL constraint failed: handovers.project_id"}` — a raw SQLite constraint error naming the real internal table and column, exactly the kind of "SQL errors... library names" CLAUDE.md's rule prohibits. This is a direct, real-world instance of the pattern, not a hypothetical.

**None of these routes logged the error server-side either** — before this fix, the *only* record of what actually went wrong was the message sent to the client. Fixing the leak without adding logging would have made debugging real production issues harder, not just safer.

**Fix**: added a small `safeError(e, fallback)` helper (one per file — `server.ts`, `server/oauth.ts`, `server/sso.ts` — matching this codebase's existing convention of small per-file utility duplication rather than a shared module) that `console.error`s the real exception and returns the route's existing safe fallback string unconditionally. Replaced all 16 call sites. The existing fallback messages (`"Failed to create file"`, `"Failed to analyze"`, etc.) were kept rather than replaced with one blanket `"Something went wrong"` — they're already specific-to-the-action without naming any internal implementation detail, which is better UX than one generic string everywhere while satisfying CLAUDE.md's actual concern (no stack traces, SQL errors, file paths, or library names ever reaching the client).

**Two call sites deliberately left unchanged, on inspection, not by oversight:**
- `server/billing.ts`'s webhook route (`` `Webhook Error: ${err.message}` ``) — this response is consumed by Stripe's own delivery-log tooling, never rendered to an end user or reachable by browsing the app; it's also the exact pattern Stripe's own documentation recommends for signature-verification failures. Its 500-level handler-error catch already returns a fully generic `"Webhook handler failed"` with no leak.
- `server/sso.ts`'s `result.message` (distinct from the `e?.message` case that *was* fixed) — traced to its source and confirmed it's never a raw exception, only one fixed, app-authored string (`"This provider didn't share an email address..."`).

**"Debug mode disabled in production" — already correct, verified.** Vite's dev middleware (which shows detailed in-browser error overlays with stack traces) is gated behind `if (process.env.NODE_ENV !== "production")`; production instead serves pre-built static files via `express.static`. No custom global Express error-handling middleware exists to override Express's own default behavior, which itself already suppresses stack traces from its default error page whenever `NODE_ENV=production` — the standard, expected configuration for a Node/Express deploy (Railway, this app's documented target, sets `NODE_ENV=production` automatically).

## What's at risk

Before the fix: any user (authenticated, since virtually every affected route sits behind `requireAuth`) triggering an error path — a constraint violation, a malformed request, a downstream API failure — learned real internal implementation details: table/column names, library error formats (revealing the SQLite/better-sqlite3 stack), and potentially other library-specific detail depending on what threw. This is reconnaissance-grade information disclosure that helps an attacker map the system's internals for further attacks, even though it doesn't by itself grant access to anything.

## What's already secure

- Debug/dev error pages are correctly disabled in production, with no custom code needed to enforce it beyond the existing `NODE_ENV` gate on Vite's middleware.
- The two call sites that do intentionally return more detail (`billing.ts`'s webhook signature error) are both correctly scoped to non-browser, machine-consumed responses, not end-user-reachable surfaces.

## Recommendations

None outstanding — all 16 identified leak points are fixed, each with server-side logging added so the fix doesn't trade information disclosure for lost observability.
