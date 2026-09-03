# CSRF

## Changes

None. `SameSite=Lax` on every session cookie, combined with no state-changing routes on `GET` and a global auth gate on every mutating route, already closes CSRF for this app — see `security/reports/CSRF_REPORT.md`. No code changes needed.

## New files

None.

## Verification goals

- [x] No `GET` route performs a data mutation, anywhere in the codebase
- [x] Every `POST`/`PATCH`/`DELETE` route on the internal API is registered after the global `requireAuth` gate
- [x] Both session cookies (`db_auth`, `dp_<handoverId>`) are `SameSite=Lax` (verified directly, not assumed, as part of `AUTH_MIDDLEWARE`)
- [x] Confirmed the global `express.urlencoded()` body parser (needed for Apple's SSO callback) doesn't create a usable CSRF path, since the cookie restriction blocks the request before the parsed body matters

## Manual verification (for the human)

- None required — no behavior changed.
