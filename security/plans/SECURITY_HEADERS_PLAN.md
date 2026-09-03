# SECURITY_HEADERS

## Changes

- Added `helmet` (`^8.3.0`) to `package.json` dependencies.
- `server.ts`: mounted `helmet(...)` as the very first middleware in `startServer()`, before the Stripe webhook router and every other route, configuring:
  - `contentSecurityPolicy`: `default-src 'self'`; `script-src`/`style-src` with `'unsafe-inline'` (required by the portal's hand-built inline `<script>`/`<style>`, see report); `style-src`/`font-src` allowlisting `fonts.googleapis.com`/`fonts.gstatic.com` (both already used by `src/index.css` and `src/lib/handoverPage.ts`); `img-src`/`media-src` allowing `data:`/`blob:` (used by file previews and base64 uploads); `object-src 'none'`; `base-uri`/`form-action 'self'`; `frame-ancestors 'self'`; `connect-src 'self'` in production, widened to also allow `ws://localhost:*`/`ws://127.0.0.1:*` outside production for Vite's HMR websocket only.
  - `frameguard: { action: "sameorigin" }` (not helmet's option to fully deny, since same-origin file-preview iframes need to keep working).
  - `hsts: { maxAge: 31536000, includeSubDomains: true }`.
  - `referrerPolicy: { policy: "strict-origin-when-cross-origin" }` (overriding helmet's stricter `no-referrer` default to match CLAUDE.md exactly).

## New files

None.

## Verification goals

- [x] `tsc --noEmit` passes clean
- [x] All 5 required headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) present on responses from the React app root, an internal API route, and the client portal page — verified live via `curl -I` against a real `tsx server.ts` instance
- [x] `Referrer-Policy` is exactly `strict-origin-when-cross-origin`, not helmet's `no-referrer` default
- [x] Live browser check (Playwright, against a scratch `DATA_DIR` so no real data was touched) of the React app root: zero CSP-related console errors
- [x] Live browser check of a real seeded portal page: zero console/page errors, Google Fonts (`Inter`) correctly applied as the computed `font-family`, inline portal `<script>` confirmed executing
- [x] Caught and fixed a real regression during verification: Vite's dev-mode HMR websocket was blocked by `connect-src 'self'` — fixed with a `NODE_ENV`-gated dev-only carve-out that doesn't affect the production policy
- [x] Same-origin file-preview iframes (`/api/files/:id/content` embedded by `FileVaultApp.tsx` et al.) are preserved by using `SAMEORIGIN` instead of `DENY`

## Manual verification (for the human)

- In your actual production deployment, confirm the CSP doesn't block anything this test pass didn't cover — open the browser devtools console on the real production domain (studio app, portal page, and the OAuth/SSO connect flows) and watch for any `Refused to ...` CSP violation messages, since production origin/CDN specifics (if any change later) could differ from what was tested here on `localhost`.
- Consider the nonce-based refactor noted in the report's Recommendations to drop `'unsafe-inline'` from `script-src`/`style-src` — a real hardening step intentionally deferred, not forgotten.
- Two test-data artifacts were created and fully cleaned up during this verification (test users/workspaces/projects/handovers were written to your real `desboard.db` during an earlier, separate `AUTH_MIDDLEWARE` live check, and again briefly during this category's `connect-src` debugging, before switching to a scratch `DATA_DIR`). Verified via direct query that zero rows referencing the test email addresses remain. No action needed, noted for transparency.
