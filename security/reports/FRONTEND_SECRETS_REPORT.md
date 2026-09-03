# FRONTEND_SECRETS

## Status: PASS

## Findings

This category checks whether any server-side secret or sensitive internal field ever actually *reaches* the browser at runtime — a narrower, complementary question to `SECRETS_EXPOSURE` (category 1), which checked whether secrets exist in source/config/git history. Every response surface that sends data to a browser was traced individually:

**Studio-side API responses:**
- `publicUser()` (`server/auth.ts:87`) — the shape returned by signup/login/`/api/auth/me` — is a hand-picked field list (`id, email, name, workspaceId, workspaceName, role`). No `passwordHash` field exists on it.
- `getWorkspaceMembers()` (`db.ts:1600`) excludes `password_hash` **at the SQL level** — `SELECT id, email, name, role, created FROM users ...` — the hash is never even pulled out of the database for this query, not just filtered afterward in JS.
- `billingStatusPayload()` (`server/billing.ts:69`) returns `hasStripeCustomer: boolean`, never the raw `stripe_customer_id`, and obviously never `STRIPE_SECRET_KEY` or any Stripe API credential.
- `GET /api/oauth/:provider/status` (`server/oauth.ts:213`) hand-picks `connected, accountLabel, connectedAt, lastError, lastErrorAt, scope` from the `oauth_tokens` row — the raw `access_token`/`refresh_token` are never serialized into any response anywhere in the codebase (grepped every call site of `getOAuthToken`).

**Client portal (the one page rendered as a raw HTML string, not React, so it doesn't get React's normal prop-shape discipline for free):**
- `toPortalHandoverDTO`/`toPortalCommentDTO` (`server/portalCore.ts`) are explicit allow-lists — no `token`... actually `token` intentionally *is* embedded (see below), but no `passwordHash`, `clientEmail`, `revoked`/`revokedAt`, or raw `fileIds` ever appear in either DTO.
- The portal page embeds a JSON blob into an inline `<script>` for client-side JS (via the `jsonScript()` XSS-safe serializer already verified under earlier work this session). Every value fed into it was traced individually in `src/lib/handoverPage.ts`: `handover.token` (not a secret beyond what the visitor already has — it's the same token already present in their own URL), the two API-base URLs derived from it, `handover.clientName`, and three constructed objects (`fileMeta`, `pins`, `videoPins`) that are hand-built with an explicit field list each (`name/kind/viewHref/downloadHref/status/versions/currentVersion` for files; `id/fileId/x/y/author/body/created/version` for pins) — none of which include `passwordHash`, `clientEmail`, internal storage paths, or the `internalOnly` comment flag. `comments` themselves are pre-filtered by the caller (`.filter(visibleToClient)`) before ever reaching the render function, so an internal-only studio note can't leak into the pins/videoPins arrays either.

**Build/bundle-level:**
- `vite.config.ts` has no custom `define` block that could inline arbitrary `process.env` values into the client bundle beyond Vite's own standard `VITE_`-prefix mechanism.
- `index.html` contains no inline secrets.
- Re-confirmed (narrower grep than category 1's) that `import.meta.env.*` is used in exactly two places in `src/`, both the Supabase publishable key/URL already covered under `SECRETS_EXPOSURE`.
- `dist/` (build output) is not committed to git (verified under category 1), so there's no stale bundle anywhere in history to audit separately.

## What's at risk

Nothing found.

## What's already secure

- Every DTO/response-shaping function in the codebase is an explicit allow-list, not a raw object serialization — this held true consistently across the studio API, the billing payload, the OAuth status endpoint, and the portal DTOs.
- The one sensitive-looking value that *is* deliberately embedded client-side in the portal page (`handover.token`) is not a secret in context — it's identical to the token already visible in the visitor's own URL bar, and the portal's real security boundary is server-side (revocation/expiry re-checked live, session-gating, signed downloads), not secrecy of this value.
- Password hashes are excluded at the SQL query level for the one bulk-listing endpoint (`getWorkspaceMembers`) that could plausibly have leaked them, rather than relying on remembering to strip them in application code.
- No custom Vite `define` or other build-time mechanism exists that could inline a server secret into the client bundle outside the standard, already-audited `VITE_` convention.

## Recommendations

None — this category passes as-is.
