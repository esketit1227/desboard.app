# AUTH_MIDDLEWARE

## Changes

Added a `Secure` attribute to every session/state cookie the app sets, gated on `process.env.NODE_ENV === "production"` (matching the codebase's existing production-only-check convention at `server.ts:132`) so local HTTP dev is unaffected:

- `server/auth.ts` — new `SECURE_ATTR` constant; applied to `setSessionCookie` and `clearSessionCookie` (the `db_auth` studio session cookie).
- `server/oauth.ts` — new `SECURE_ATTR` constant; applied to both the OAuth CSRF-state cookie set and its clear on callback.
- `server/portal.ts` — new `SECURE_ATTR` constant; applied to the client-portal session cookie (`dp_<handoverId>`).
- `server/sso.ts` — new `SECURE_ATTR` constant; applied to the non-Apple branch of the SSO CSRF-state cookie (Apple's branch already hardcoded `Secure`, required by its own `SameSite=None`) and to the generic state-cookie clear on callback.

No behavior change in local dev (`NODE_ENV` unset there); in production, every cookie now carries `Secure` alongside the `HttpOnly`/`SameSite=Lax` it already had — satisfying the project's own CLAUDE.md rule in full.

## New files

None.

## Verification goals

- [x] Every `Set-Cookie` header in the codebase includes `HttpOnly`, `SameSite=Lax` (or `SameSite=None` only where a provider mandates it), and now `Secure` when `NODE_ENV=production`
- [x] `tsc --noEmit` passes clean after the change
- [x] Live dev-mode check: `POST /api/auth/signup` on a real `tsx server.ts` instance without `NODE_ENV` set returns a `Set-Cookie` with `HttpOnly; SameSite=Lax` and no `Secure` (dev over HTTP still works)
- [x] Live prod-mode check: the same request with `NODE_ENV=production` (and required `SESSION_SECRET`/`PORTAL_SECRET`) returns a `Set-Cookie` including `; Secure`
- [x] Unauthenticated requests to protected `/api/*` routes still return 401 (`GET /api/files`, `GET /api/auth/me` both verified live)
- [x] `requireAuth` gate ordering unchanged: mounted after every public router, before every internal route
- [x] `requireOwner` still returns 403 for authenticated non-owners (read, not re-tested live — no code touched in this path)

## Manual verification (for the human)

- Deploy to your actual production host (Railway) with `NODE_ENV=production` set (it should already be, since the app refuses to boot in production without `SESSION_SECRET`/`PORTAL_SECRET` — this pass didn't change that guard) and confirm in browser devtools (Application → Cookies) that `db_auth` shows the "Secure" flag after logging in over HTTPS.
- If you ever terminate TLS somewhere unusual (a CDN or proxy that talks plain HTTP to this app internally), double check `app.set("trust proxy", 1)` still correctly reflects `req.secure`/`NODE_ENV` for your setup — this fix trusts `NODE_ENV=production` as the signal, not `req.secure`, so it doesn't depend on proxy header trust for this particular decision.
