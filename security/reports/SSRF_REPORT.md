# SSRF

## Status: PASS (N/A — no user-controllable URL-fetching feature exists)

## Findings

Searched the entire server codebase for every outbound HTTP call (`fetch(`, plus a separate check for `http.get`/`https.get`/`axios.` in case a different client was used anywhere) and traced the target of each one:

- `server/email.ts` — hardcoded `https://api.resend.com/emails`.
- `server/sso.ts` — `JWKS_URL[provider]` and `TOKEN_URL[provider]`, both indexed into a hardcoded, code-defined map of provider endpoints (Google/Microsoft/Apple), never a runtime-constructed or user-supplied host.
- `server/oauth.ts` — every call target is either a hardcoded provider-API constant (`TOKEN_URL[provider]`, `https://www.googleapis.com/...`, `https://graph.microsoft.com/...`, `https://api.dropboxapi.com/...`, `https://content.dropboxapi.com/...`) or one of those same hardcoded hosts with a request-scoped value (`fileId`, an OAuth `path`) interpolated only as a `encodeURIComponent()`-escaped path segment or query parameter — never as the scheme or host. Encoding a value into a path segment can't redirect the request to a different host (a crafted `fileId` like `http://evil.com` becomes a literal, harmless encoded path segment, not a new destination).

Searched separately (grep, case-insensitive) for any feature shape where this pattern would actually matter — link previews, an image/URL proxy, a "webhook URL" or "custom domain" field, any user-facing "fetch this URL" input — and found none. The Google/Microsoft/Dropbox integrations are OAuth-authenticated API clients calling fixed, well-known API hosts with the studio's own connected-account token; the user never supplies a URL or hostname that the server then fetches.

## What's at risk

Nothing — the feature category this check exists to protect (server-side fetches of a URL a user supplies) doesn't exist in this app today.

## What's already secure

Every outbound request target in the codebase is a hardcoded, first-party API host. There is no code path where user input determines which host the server connects to.

## Recommendations

None now. If a URL-fetching feature is ever added (link previews, a webhook-URL setting, an image proxy, etc.), apply the CLAUDE.md SSRF rule at that time: block private/internal IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1), allow only `http`/`https` schemes, and resolve + check the IP before connecting — not implemented here since there's nothing to apply it to yet.
