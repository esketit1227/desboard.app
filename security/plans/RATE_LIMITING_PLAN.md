# RATE_LIMITING

## Changes

- `server/oauth.ts`: applied the existing `actionLimiter` (60/10min) to `GET /api/oauth/:provider/callback`, which previously had no rate limiting at all.
- `server/sso.ts`: applied the existing `limiter` (30/15min) to both `GET` and `POST /api/auth/sso/:provider/callback`, which previously had no rate limiting at all.

Both reuse an already-defined limiter from the same file rather than introducing a new one, matching the codebase's existing per-file convention.

## New files

None.

## Verification goals

- [x] Every studio-auth, portal, invite, and OAuth/SSO route enumerated and matched to its rate limiter (or confirmed N/A, for password reset)
- [x] `trust proxy` set to a specific hop count (`1`), not the unsafe `true`, matching the real single-reverse-proxy production topology
- [x] SSO callback (`/api/auth/sso/:provider/callback`, both methods) now rate-limited
- [x] OAuth callback (`/api/oauth/:provider/callback`) now rate-limited
- [x] `tsc --noEmit` passes clean after the change

## Manual verification (for the human)

- None required — this only adds a request-volume ceiling to two routes that already validate the actual request cryptographically; no legitimate login/connect flow should ever approach these limits in normal use.
