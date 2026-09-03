# CSRF

## Status: PASS

## Findings

This app authenticates state-changing requests entirely via cookies (`db_auth` for the studio API, `dp_<handoverId>` for the client portal — both reviewed under `AUTH_MIDDLEWARE`), which is exactly the pattern CSRF attacks target. Checked for the two things that actually matter for whether that's exploitable:

**1. Every state-changing route requires the session cookie, and none of them run on GET.** Enumerated every `app.get`/`router.get` in the codebase (see `security/reports/CSRF_REPORT.md`'s sibling categories for the full route list) — none perform a data mutation; the only GET routes that touch cookies at all are the OAuth/SSO connect-flow routes (which set a short-lived CSRF-state cookie as part of the login/connect handshake itself, already covered under `AUTH_MIDDLEWARE`) and the portal page route (which establishes a portal session from token *possession* — not a cross-site-forgeable action, since the token is the credential and an attacker gains nothing by getting a victim to visit a URL the attacker already has full access to). Separately confirmed every `app.post`/`app.patch`/`app.delete` route in `server.ts` is registered after `app.use("/api", requireAuth)` (line 305) — none slip through unauthenticated.

**2. The session cookie is `SameSite=Lax`.** Verified directly in `server/auth.ts` and `server/portal.ts` (and now also carries `Secure` in production, per the `AUTH_MIDDLEWARE` fix). `SameSite=Lax` is sent by the browser on a same-site request and on a top-level cross-site *navigation* (a plain link or `GET` form), but is **withheld** by the browser on a cross-site `POST`/`PATCH`/`DELETE` — which is exactly the request shape a CSRF attack needs to submit a forged form or `fetch()` from another origin. Because (1) confirms no mutation happens on GET, the one case where `SameSite=Lax` still allows the cookie through cross-site never lines up with an action worth forging. This is the standard, currently-recommended browser-native CSRF defense for cookie-authenticated APIs (introduced specifically to make CSRF tokens unnecessary for this exact case), and it's applied uniformly — not just on some routes.

**3. Checked whether global body-parsing middleware could still let a cross-site form deliver a usable payload.** `server.ts` mounts `express.urlencoded({ extended: false })` globally (needed for Apple's `response_mode=form_post` SSO callback), meaning a classic `<form>`-based CSRF POST *would* have its body parsed. This doesn't matter in practice: even if the body parses, the request still won't carry the `db_auth`/`dp_*` cookie cross-site (per point 2), so `requireAuth`/`requireSession` reject it before the parsed body is ever used. The two layers are independent — either one alone would already block the attack.

## What's at risk

Nothing found. No explicit anti-CSRF token exists, but none is needed given `SameSite=Lax` + cookie-only auth + no state-changing GET routes — adding one would be redundant defense-in-depth, not a fix for a real gap.

## What's already secure

- Every mutating route requires a same-site-only session cookie.
- No route performs a mutation on `GET`, closing the one request shape `SameSite=Lax` still permits cross-site.
- The one cross-site-reachable body-parsing surface (`express.urlencoded`, needed for Apple's callback) is neutralized by the same cookie restriction, so it isn't actually usable as a CSRF vector even though it exists.

## Recommendations

None required — this category passes as-is.
