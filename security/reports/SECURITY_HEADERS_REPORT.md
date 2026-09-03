# SECURITY_HEADERS

## Status: HIGH (fixed)

## Findings

**Real finding: no security headers were set anywhere in the app, and `helmet` wasn't even a dependency.** Grepped for every header CLAUDE.md requires (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) and for `helmet` itself across `server.ts` and every `server/*.ts` file — zero matches anywhere. Every response (the React app, every internal API route, and the client portal) went out with no CSP, no HSTS, no clickjacking protection, no MIME-sniffing protection, and the browser's default (permissive) referrer behavior.

**Fixed this pass** by adding `helmet` (`^8.3.0`, matching this repo's existing caret-range dependency convention) as a single global middleware, mounted first in `startServer()` before anything else. Two directives deliberately deviate from CLAUDE.md's literal defaults, both because the literal default would have broken real, shipped functionality rather than out of convenience — each is called out with an inline comment at the point of deviation in `server.ts`:

- **`X-Frame-Options: SAMEORIGIN`, not `DENY`.** `src/lib/filePreview.ts`'s `contentUrl()` (`/api/files/:id/content`) is embedded in an `<iframe>` by `FileVaultApp.tsx`, `ProjectFilesPanel.tsx`, and `HandoverFileRow.tsx` for in-app file previews — all same-origin. `DENY` blocks *all* framing, including same-origin, and would have broken every one of those preview panes. `SAMEORIGIN` still blocks the actual threat this header exists for (a third-party site framing this app for clickjacking) while preserving the in-app feature. CSP's `frame-ancestors` was set to `'self'` to match.
- **`script-src`/`style-src` include `'unsafe-inline'`.** The client portal (`src/lib/handoverPage.ts`) is a hand-built HTML string with 4 inline `<script>` blocks and 1 inline `<style>` block, not a bundled/nonced app — there's no nonce plumbing today. Verified this is a real constraint, not a shortcut, by live-testing a strict CSP against the actual dev server first (see Verification). This is flagged in the report as the one place this pass didn't reach full CLAUDE.md compliance, with a concrete follow-up recommendation below.

**Everything else matches CLAUDE.md's stated defaults exactly:** `default-src 'self'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff` (helmet's default), and `Referrer-Policy: strict-origin-when-cross-origin` (explicitly configured — helmet's own default is the stricter `no-referrer`, which doesn't match what CLAUDE.md asks for, so it was overridden explicitly rather than left at helmet's default).

**`connect-src` needed one dev-only carve-out, caught by live-testing rather than assumed away:** the first live browser check (see Verification) surfaced a real regression — Vite's dev-mode HMR client connects over a WebSocket on a separate port, which CSP treats as a different origin even on `localhost`, so the strict `connect-src 'self'` silently broke local hot-reload. Fixed by allowing `ws://localhost:*`/`ws://127.0.0.1:*` only when `NODE_ENV !== "production"` — in production the Vite middleware (and this websocket) doesn't run at all, so this carve-out never widens the actual deployed policy.

## What's at risk

Before the fix: no defense-in-depth against XSS payload behavior (script/resource exfiltration to arbitrary domains), clickjacking, MIME-sniffing-based content-type confusion attacks, or unencrypted-transport downgrade — the app relied entirely on its input-escaping discipline (covered under `XSS`) with no browser-enforced backstop if that discipline ever had a gap.

The one residual gap after the fix: `script-src 'unsafe-inline'` means CSP does **not** block a successful inline-`<script>` XSS injection from executing (only `object-src`, restricted `connect-src`/`img-src`/`frame-ancestors`, and blocking *remote* script loading still apply as a backstop). This is a real, acknowledged limitation of this pass, not an oversight — see Recommendations.

## What's already secure

- All 5 headers now present on every response type verified live: the React app, an internal API route, and the client portal page.
- `X-Content-Type-Options: nosniff` and the corrected `Referrer-Policy: strict-origin-when-cross-origin` apply with no exceptions needed anywhere.
- HSTS is set with the exact `max-age`/`includeSubDomains` CLAUDE.md specifies; it's a no-op over plain HTTP (spec-compliant browsers only act on it over a secure connection), so it doesn't interfere with local dev.
- The two directives that do deviate from CLAUDE.md's literal text (`frame-ancestors`/`X-Frame-Options` scope, and `unsafe-inline` for script/style) were each verified against the actual codebase to be necessary for real, working features — not assumed or guessed.

## Recommendations

1. **Tighten `script-src`/`style-src` off `'unsafe-inline'`** by refactoring `src/lib/handoverPage.ts`'s inline `<script>`/`<style>` blocks to use a per-request CSP nonce (generate one in the portal route, pass it into `renderHandoverPage()`, add `nonce="..."` to each inline tag, and switch the CSP directive from `'unsafe-inline'` to `'nonce-<value>'`). Not attempted in this pass given the portal is this app's most business-critical, most complex-to-safely-modify page, and the risk of a subtle breakage there outweighs finishing this specific hardening step today. Tracked here as the clear next step, not silently dropped.
2. No other changes needed — the rest of the header set is complete and matches CLAUDE.md.
