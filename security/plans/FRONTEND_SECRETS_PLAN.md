# FRONTEND_SECRETS

## Changes

None. Investigation found no server-side secret or sensitive internal field reaching the browser at runtime — see `security/reports/FRONTEND_SECRETS_REPORT.md`. Every response-shaping function (studio API DTOs, billing payload, OAuth status, portal DTOs, and the portal page's embedded JSON) was traced individually and confirmed to be an explicit allow-list. No code changes needed.

## New files

None.

## Verification goals

- [x] No API response includes `passwordHash`, raw OAuth `access_token`/`refresh_token`, or `STRIPE_SECRET_KEY`/any Stripe API credential
- [x] `getWorkspaceMembers` excludes `password_hash` at the SQL query level
- [x] Billing status payload exposes only `hasStripeCustomer: boolean`, never the raw Stripe customer ID
- [x] Portal DTOs (`toPortalHandoverDTO`, `toPortalCommentDTO`) never include `token`'s backing secret material, `passwordHash`, `clientEmail`, `revoked`/`revokedAt`, or raw `fileIds`
- [x] The portal page's embedded `<script>` JSON blob was traced value-by-value in `handoverPage.ts` — no internal-only comment, storage path, or credential is embedded
- [x] `vite.config.ts` has no custom `define` block inlining arbitrary `process.env` values into the client bundle
- [x] Only the two already-audited `VITE_` vars (Supabase URL/publishable key) are referenced via `import.meta.env` anywhere in `src/`

## Manual verification (for the human)

- None required — no behavior changed.
