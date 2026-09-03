# RATE_LIMITING

## Status: LOW (fixed)

## Findings

Enumerated every `rateLimit(` call in the codebase and mapped each to the routes it actually guards, rather than trusting route-adjacent comments:

- **Studio signup/login** (`server/auth.ts`): `authLimiter` (20/15min) on both `POST /api/auth/signup` and `POST /api/auth/login`.
- **Password reset**: doesn't exist as a feature — the "Forgot password" link in `src/components/auth/AuthForm.tsx` shows a "not set up yet" notice and makes no request at all. N/A per the checklist's own allowance for a not-yet-built feature; nothing to rate-limit.
- **Client portal** (`server/portal.ts`): six purpose-sized limiters — `pageLimiter` (300/10min, the page itself), `passwordLimiter` (10/15min, the portal's own password gate — this is this app's other real "login" surface besides studio auth, and it's covered), `commentLimiter` (20/10min), `downloadLimiter` (60/10min), `viewLimiter` (1000/10min, deliberately high since video scrubbing issues many Range requests per session), `approveLimiter` (30/10min). All six routes checked individually — every one has its limiter as route middleware, not just declared and unused.
- **Team invites** (`server/invites.ts`): `limiter` (20/15min) on the public `GET /api/invites/:token` and `POST /api/invites/:token/accept` — the accept endpoint is effectively a second registration-adjacent surface (turns a token into workspace membership) and is covered.
- **SSO login start** (`server/sso.ts`): `limiter` (30/15min) on `GET /api/auth/sso/:provider/start`.
- **OAuth connect actions** (`server/oauth.ts`): `actionLimiter` (60/10min) on disconnect/browse/import.

**Real gap found and fixed:** the SSO and OAuth **callback** routes — `GET/POST /api/auth/sso/:provider/callback` and `GET /api/oauth/:provider/callback` — had no rate limiter at all, unlike their corresponding `/start`/action routes. The SSO callback in particular is a genuine login endpoint ("Sign in with Google/Microsoft/Apple" completes here) and falls squarely under CLAUDE.md's "login... endpoints MUST have rate limiting" rule; the two callbacks also both make an outbound request to the provider's token-exchange endpoint, so an unbounded volume of callback hits is a real (if provider-cushioned) resource-consumption vector even though the `state`/`code` values themselves aren't brute-forceable (signed HMAC state, one-time provider-issued code). Fixed by applying each file's existing limiter to its callback route (`actionLimiter` in `oauth.ts`, `limiter` in `sso.ts`, both GET and POST variants where applicable) — reusing the established limiter in each file rather than inventing a new one.

**`trust proxy` is configured correctly for rate-limiting purposes.** `server.ts` sets `app.set("trust proxy", 1)` — trusting exactly one hop, matching this app's actual production topology (a single reverse proxy in front of it, e.g. Railway's edge, per `railway.json`/the `DATA_DIR` deploy notes in `.env.example`). This is the specific, minimal form CLAUDE.md's own caveat permits ("behind a trusted reverse proxy") — not the unsafe `trust proxy: true`, which would trust an attacker-supplied `X-Forwarded-For` prefix of arbitrary length and let a client spoof its own rate-limit key. `express-rate-limit`'s default `keyGenerator` uses `req.ip`, which respects this setting, so every limiter above keys correctly off the real client IP in production.

## What's at risk

Before the fix: the two OAuth/SSO callback endpoints could absorb unlimited request volume, each triggering an outbound call to a third-party token endpoint (Google/Microsoft/Apple/Dropbox) per hit that carries a syntactically plausible `state`/`code` — a moderate resource-exhaustion/abuse vector, not a credential-brute-force one (the underlying secrets aren't guessable regardless of request volume).

## What's already secure

- Every studio-auth, portal, invite, and OAuth-action endpoint that plausibly needs rate limiting already had it, correctly wired as route middleware (not just declared and orphaned).
- `trust proxy` is scoped to exactly the real proxy topology, not blindly trusting.

## Recommendations

None outstanding — the callback-route gap is fixed. If a password-reset flow is ever built, give it its own limiter matching `authLimiter`'s shape at that time.
