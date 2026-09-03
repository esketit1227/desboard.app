# XSS

## Changes

- `server/email.ts`: `reminderEmailHtml()`'s local `esc()` now also escapes `"` and `'`, matching the complete implementation already used in `src/lib/handoverPage.ts`, `src/lib/portalStates.ts`, and `src/lib/oauthStates.ts`. Closes an attribute-breakout gap where `params.portalUrl` (built from the client-controllable `Host` header) is inserted into an `href="..."` attribute.

## New files

None.

## Verification goals

- [x] No `dangerouslySetInnerHTML` anywhere in the React app
- [x] Every leaf-level user-data insertion point in `handoverPage.ts` traced to confirm it's wrapped in `esc()` (HTML context) or `jsonScript()` (inline-`<script>` JSON context)
- [x] Non-text contexts in `handoverPage.ts` (CSS color, image URL, template enum) use allow-list validation rather than escaping, matched to what each context actually needs
- [x] All 4 hand-rolled `esc()` implementations in the codebase enumerated; 3 were already complete (`&`, `<`, `>`, `"`, `'`), the 4th (`server/email.ts`) fixed to match
- [x] Every other `req.protocol`/`req.get("host")` usage in the codebase traced to confirm none of the others land in HTML this app renders
- [x] `tsc --noEmit` passes clean after the change

## Manual verification (for the human)

- None required — the fix only widens an existing escaper's character set; no behavior changes for any legitimate (non-malicious) input.
