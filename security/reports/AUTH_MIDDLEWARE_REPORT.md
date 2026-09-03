# AUTH_MIDDLEWARE

## Status: MEDIUM (fixed)

## Findings

**Gate ordering and coverage (verified, not just claimed):** `server.ts` mounts `app.use("/api", requireAuth)` at line 305, after every legitimately-public router (`createBillingWebhookRouter`, `createAuthRouter`, `createSsoRouter`, `createPortalRouter`, `createOAuthRouter`, `createInviteAcceptRouter`) and before every internal data router. Checked each pre-gate router individually rather than trusting the inline comments claiming they're safe:
- `server/oauth.ts` — all 6 routes (`status`, `connect`, `callback`, `disconnect`, `browse`, `import`) either self-check via `readAuthSession()` + explicit 401, or (for `/callback` only) authenticate via the signed OAuth state token round-tripped through a cookie, which is the correct mechanism for a provider redirect that can't carry a normal session check.
- `server/invites.ts` mixes two router factories in one file — `createTeamRouter()` (member/invite management, `requireOwner`-gated, mounted **after** `requireAuth`) and `createInviteAcceptRouter()` (public token-based accept flow, mounted **before** it). Verified by reading which function each route is defined inside, not just the route list: `/api/team/*` routes are all inside `createTeamRouter`; only `/api/invites/:token` (view) and `/api/invites/:token/accept` are inside the public one. No accidental leakage of team-management routes into the public router.
- `server/portal.ts`'s router is legitimately public end-to-end (client portal, no studio account involved) — token-scoped, not session-scoped.
- `server/sso.ts` is a pure login-flow router; returns no protected data pre-session by design.

**Live-verified** (real `tsx server.ts` dev server, not just static reading — see Recommendations for why this mattered): unauthenticated `GET /api/files` → `401`; unauthenticated `GET /api/auth/me` → `401 {"error":"Not signed in"}`; a valid session cookie from `/api/auth/signup` then unlocks `200` on `/api/files`.

**Resource-ownership checks are a separate layer from authentication, as CLAUDE.md requires**, and were verified (not just assumed) under `security/reports/DATABASE_ACCESS_REPORT.md` — every workspace-scoped accessor takes and enforces `workspaceId` derived from the session, independent of the `requireAuth` check itself.

**Admin/owner endpoints correctly return 403, not silently allow:** `requireOwner` (`server/invites.ts:34`) checks `user.role !== "owner"` and returns `403` otherwise; used to gate invite creation/deletion and (`requireOwner` reused in `server/billing.ts`) checkout/billing-portal access.

**Real finding — session cookies were missing `Secure` (fixed this pass):** CLAUDE.md states plainly: *"Session cookies MUST set `httpOnly: true`, `secure: true`, and `sameSite: 'lax'`."* Every `Set-Cookie` header in the app set `HttpOnly` and `SameSite=Lax` correctly, but omitted `Secure` entirely (with one exception — the Apple SSO state cookie, which Apple's own `SameSite=None` requirement forces to include `Secure` already). Found and confirmed across 6 call sites in 4 files:
- `server/auth.ts` — the primary studio session cookie (`db_auth`), set and cleared.
- `server/oauth.ts` — the OAuth CSRF-state cookie, set and cleared.
- `server/portal.ts` — the client-portal session cookie (`dp_<handoverId>`).
- `server/sso.ts` — the SSO CSRF-state cookie for Google/Microsoft (Apple's branch already had it).

Without `Secure`, any of these cookies could in principle be transmitted over a plain-HTTP connection (e.g., a protocol-downgrade or a misconfigured proxy hop), exposing a live session token in cleartext. Given `server.ts` already sets `trust proxy` and assumes a TLS-terminating proxy in front of it in production, this was a real gap between stated intent and actual header output, not a hypothetical one.

## What's at risk

Before the fix: session hijacking via cleartext interception, if a request to this app ever transited plain HTTP (downgrade attack, misconfigured load balancer/proxy not enforcing HTTPS end-to-end, or a user manually hitting an `http://` URL that isn't redirected to `https://` upstream). Local dev is unaffected either way, since `http://localhost` traffic isn't meaningfully interceptable in the same way.

## What's already secure

- `requireAuth` is correctly positioned before every internal route, uses a constant-time HMAC comparison (`crypto.timingSafeEqual`) to verify the session signature, and 401s cleanly on missing/invalid/expired sessions.
- Every public-by-design router was individually checked (not assumed) and either does its own explicit auth check per route or has no protected data to leak.
- The `createTeamRouter`/`createInviteAcceptRouter` split correctly separates protected team-management routes from the public invite-accept flow, despite living in the same file.
- `requireOwner` correctly returns 403 (not 401, not a silent no-op) for authenticated-but-non-owner users.
- `SameSite=Lax` was already correct everywhere (and `SameSite=None` + `Secure` was already correct specifically for Apple, which requires it).

## Recommendations

None outstanding — the `Secure` flag gap is fixed (see Plan). One process note: this category is a good example of why the checklist's "investigate thoroughly, do not assume" instruction matters in practice — the missing `Secure` flag was easy to miss from reading `server.ts`'s own confident inline comments alone; it only surfaced from reading every actual `Set-Cookie` string byte-for-byte across all 4 files.
