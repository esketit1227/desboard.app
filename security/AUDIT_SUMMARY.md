# Desboard Security Audit — Summary

Full 17-category pass against `AI-CHECKLIST.md` and this project's own `CLAUDE.md` security rules. Each category was investigated independently, its own report and plan written, fixes implemented and live-verified where a real issue was found, then the report updated with results — no category was batched or skipped.

## Results

| # | Category | Status | Report | Plan |
|---|---|---|---|---|
| 1 | Secrets exposure | ✅ PASS | [report](reports/SECRETS_EXPOSURE_REPORT.md) | [plan](plans/SECRETS_EXPOSURE_PLAN.md) |
| 2 | Database access | ✅ PASS | [report](reports/DATABASE_ACCESS_REPORT.md) | [plan](plans/DATABASE_ACCESS_PLAN.md) |
| 3 | Auth middleware | 🟠 MEDIUM (fixed) | [report](reports/AUTH_MIDDLEWARE_REPORT.md) | [plan](plans/AUTH_MIDDLEWARE_PLAN.md) |
| 4 | Access control | ✅ PASS | [report](reports/ACCESS_CONTROL_REPORT.md) | [plan](plans/ACCESS_CONTROL_PLAN.md) |
| 5 | Frontend secrets | ✅ PASS | [report](reports/FRONTEND_SECRETS_REPORT.md) | [plan](plans/FRONTEND_SECRETS_PLAN.md) |
| 6 | SSRF | ✅ PASS (N/A — no URL-fetching feature) | [report](reports/SSRF_REPORT.md) | [plan](plans/SSRF_PLAN.md) |
| 7 | CSRF | ✅ PASS | [report](reports/CSRF_REPORT.md) | [plan](plans/CSRF_PLAN.md) |
| 8 | Security headers | 🔴 HIGH (fixed) | [report](reports/SECURITY_HEADERS_REPORT.md) | [plan](plans/SECURITY_HEADERS_PLAN.md) |
| 9 | CORS | ✅ PASS | [report](reports/CORS_REPORT.md) | [plan](plans/CORS_PLAN.md) |
| 10 | Rate limiting | 🟡 LOW (fixed) | [report](reports/RATE_LIMITING_REPORT.md) | [plan](plans/RATE_LIMITING_PLAN.md) |
| 11 | SQL injection | ✅ PASS | [report](reports/SQL_INJECTION_REPORT.md) | [plan](plans/SQL_INJECTION_PLAN.md) |
| 12 | XSS | 🟡 LOW (fixed) | [report](reports/XSS_REPORT.md) | [plan](plans/XSS_PLAN.md) |
| 13 | Payment webhooks | ✅ PASS | [report](reports/PAYMENT_WEBHOOKS_REPORT.md) | [plan](plans/PAYMENT_WEBHOOKS_PLAN.md) |
| 14 | File uploads | 🟠 MEDIUM (fixed; 1 gap acknowledged) | [report](reports/FILE_UPLOADS_REPORT.md) | [plan](plans/FILE_UPLOADS_PLAN.md) |
| 15 | Error handling | 🟠 MEDIUM (fixed) | [report](reports/ERROR_HANDLING_REPORT.md) | [plan](plans/ERROR_HANDLING_PLAN.md) |
| 16 | Password hashing | ✅ PASS | [report](reports/PASSWORD_HASHING_REPORT.md) | [plan](plans/PASSWORD_HASHING_PLAN.md) |
| 17 | Dependencies | 🟠 MEDIUM (fixed) | [report](reports/DEPENDENCIES_REPORT.md) | [plan](plans/DEPENDENCIES_PLAN.md) |

**9 categories passed outright. 8 had real findings — all 8 fixed and live-verified this pass, with one architectural recommendation (file storage on a separate origin) explicitly not attempted given its scope.**

## Critical issues

No `CRITICAL`-severity finding. Two findings are worth reading in full even so, given their reach or severity:

- **File uploads (`MEDIUM`) — a real stored-XSS path, reproduced live.** A file's MIME type was 100% trusted from what the uploader's browser claimed, with zero server-side validation, and served back `Content-Disposition: inline`. Uploading a file labeled `text/html` (regardless of its real extension) and opening its preview would have executed arbitrary script under this app's own origin, with the viewer's session cookie automatically attached to anything that script did. Reproduced the exploit against a real running instance, then fixed with a content-type allowlist gate, and reproduced again post-fix to confirm it's closed — full detail in the report.
- **Security headers (`HIGH`) — completely absent, app-wide.** No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` was ever set, on any response. Fixed with `helmet`, tuned to this app's actual architecture (verified live in a real browser, including catching and fixing a Vite-HMR regression the naive strict policy introduced).

Everything else fixed this pass was `MEDIUM` or lower — still real, but narrower in reach or harder to exploit (see each category's own report for the specific risk).

## What was fixed

- **Auth middleware**: session cookies (studio, portal, OAuth/SSO state) were missing `Secure`; now set in production, gated by `NODE_ENV` so local dev is unaffected.
- **Security headers**: `helmet` added as global middleware with a CSP tuned to this app's real inline-script/Google-Fonts needs; `X-Frame-Options: SAMEORIGIN` (not `DENY`) to preserve working same-origin file-preview iframes.
- **Rate limiting**: the OAuth and SSO *callback* routes had no rate limiter (their `/start`/action siblings did); now covered.
- **XSS**: one of four hand-rolled HTML escapers (`server/email.ts`) was missing quote-escaping, a real attribute-breakout gap in the reminder email's link.
- **File uploads**: content-type-confusion stored-XSS path closed with a server-side inline-render allowlist, independent of what an uploader claims.
- **Error handling**: 16 call sites across 3 files were echoing raw exception messages (SQL errors, library internals) straight into API responses — confirmed exploitable via this audit's own testing. All now log server-side and return the route's existing safe fallback instead.
- **Dependencies**: 11 known vulnerabilities (`npm audit`) resolved to 0 — one unused vulnerable package removed outright, six dev-tooling issues patched, one runtime `qs` issue closed via a targeted override. All 32 dependencies now exactly pinned per CLAUDE.md's rule (previously all caret-ranged).

## What was already solid

Worth naming, not just the gaps: multi-tenant `workspace_id` scoping was verified correct everywhere, not assumed; the client portal (the one genuinely untrusted, external-facing surface) had exceptionally careful, independently-checked access control at every route; SQL injection surface is fully parameterized and was checked exhaustively (all 118 queries, not sampled); password hashing was already correct (scrypt, salted, constant-time) everywhere; Stripe webhook signature verification, idempotency, and event handling were all correct and proven with a live signature-rejection test; and CSRF is soundly closed by `SameSite=Lax` plus the absence of any state-changing `GET` route.

## Remaining manual verification

Aggregated from every category's plan — nothing here blocks anything, but these need a human's eyes or a live account this audit didn't have:

- **Production deploy**: confirm `NODE_ENV=production` is actually set on your host (Railway), and that `db_auth`/portal/OAuth cookies show the `Secure` flag in browser devtools after a real HTTPS login.
- **CSP in the real deployed environment**: open devtools console on the live studio app, the portal page, and each OAuth/SSO connect flow, watching for any `Refused to ...` CSP violation this local test pass didn't cover (this pass tested on `localhost` only).
- **Stripe test-mode round-trip**: this pass proved signature verification live (a rejected unsigned request) but didn't run a full `stripe listen` + real test checkout — do that once to confirm the end-to-end webhook flow, replay-idempotency via the Dashboard's "Resend," and a declined-card path.
- **File-preview regression check**: upload a real image/video/PDF of each format your studio actually uses and confirm previews still render inline (the fix's allowlist covers common formats; extend `INLINE_SAFE_MIME` in `server/storage.ts` if a real, safe format you rely on isn't covered).
- **Two acknowledged, not-fixed recommendations**: migrating uploaded-file storage to a separate origin (S3/R2/GCS) per CLAUDE.md's literal rule, and refactoring the portal page's inline `<script>`/`<style>` to use CSP nonces instead of `'unsafe-inline'` — both are real, described in their reports, and both were judged out of proportion for this pass's blast radius versus value; worth scheduling as deliberate follow-up work, not accidental gaps.
- **Dependency-scanning in CI**: no automated `npm audit`/Dependabot-style check exists in this repo; consider adding one so a future new vulnerability surfaces on its own rather than only during an audit like this one.
- **Two small, unrelated things noticed in passing, not part of this audit's scope**: `POST /api/projects` appears to echo back the request body without an `id` (found while constructing test fixtures for `FILE_UPLOADS`/`SECURITY_HEADERS` verification) — worth a look, unrelated to security. Also, this session observed what looked like concurrent edits to `FileVaultApp.tsx` landing mid-session (most likely your own editor autosaving, based on the timing) — nothing from this audit touched that file, flagging only so it isn't mistaken for something this pass did.
