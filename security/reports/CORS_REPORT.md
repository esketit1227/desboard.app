# CORS

## Status: PASS

## Findings

Checked for a `cors` package dependency and for any manual `Access-Control-Allow-*` header being set anywhere in the server code — neither exists. `helmet` (added under `SECURITY_HEADERS`) doesn't set CORS headers either; it's unrelated middleware.

This app serves its frontend (the built React app) and its API from the **same Express server on the same origin** — there is no separate frontend deployment (e.g., a Vercel-hosted SPA calling a different API domain) that would need cross-origin access granted. Every `fetch()` call in `src/lib/api.ts` and every request the client portal page makes both use same-origin relative paths (`/api/...`). Setting no CORS headers at all means the browser's default Same-Origin Policy applies with no exception: no other origin can read a response from this API via a credentialed (or uncredentialed) cross-origin request. This is the strictest possible CORS posture, not an oversight — the two specific misconfigurations CLAUDE.md warns against (`origin: '*'`, and combining a wildcard origin with `credentials: true`) are structurally impossible here, since there's no CORS grant of any kind to misconfigure.

## What's at risk

Nothing.

## What's already secure

No cross-origin access is granted to this API from any domain, by default, with no CORS middleware present to misconfigure.

## Recommendations

None. If a legitimate need for cross-origin access ever arises (e.g., a separate marketing site or a mobile app calling this API directly), apply the `cors` package with an explicit allowlist of real domains at that time — never a wildcard, and never combined with `credentials: true` unless the allowlist is equally explicit — per CLAUDE.md.
