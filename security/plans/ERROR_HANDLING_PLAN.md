# ERROR_HANDLING

## Changes

- `server.ts`: added a `safeError(e, fallback)` helper (logs server-side, returns the safe fallback) and replaced all 12 call sites that previously sent `e.message || fallback` directly to the client (file/project/settings/task/event/team-member/conversation/handover creation, AI chat/search/analyze, and the AI-assistant SSE error event) with `safeError(e, fallback)`.
- `server/oauth.ts`: added the same helper; replaced 4 call sites (token refresh, OAuth connection-finish error page, browse, import).
- `server/sso.ts`: added the same helper; replaced 1 call site (sign-in-failed error page). Left `result.message` (a distinct, non-exception, app-authored string) unchanged after confirming its only real value is safe.
- `server/billing.ts`: no change — confirmed both its catch blocks are already safe (the webhook signature-error response is Stripe-tooling-facing, not end-user-reachable; the handler-error response is already a generic string with no leak).

## New files

None.

## Verification goals

- [x] `tsc --noEmit` passes clean
- [x] All 16 identified `e.message`-to-client leak points replaced with `safeError()`, across all three files
- [x] Every replacement still logs the real error server-side (`console.error`) — the fix doesn't trade information disclosure for lost debuggability
- [x] Confirmed via this audit's own earlier live testing that the leak was real (a raw `NOT NULL constraint failed: handovers.project_id` SQLite error was returned to a client during `FILE_UPLOADS` testing) — the fix directly closes that exact class of leak
- [x] Full-codebase grep swept for any remaining `.message`-to-client pattern with different variable naming — none found
- [x] Confirmed debug/dev error pages are already correctly gated off in production (Vite's dev middleware is `NODE_ENV`-gated; no custom global error handler overrides Express's own safe default)

## Manual verification (for the human)

- None required — every fallback message shown to users is unchanged from what the route already used as its safe fallback; the only behavior change is that the *actual* exception detail no longer overrides it, and now appears in server logs instead.
