# PASSWORD_HASHING

## Status: PASS

## Findings

**Single source of truth, correctly implemented.** `server/portalCore.ts`'s `hashPassword`/`verifyPassword` pair uses `crypto.scryptSync` — one of the three CLAUDE.md-approved algorithms — with a fresh random 16-byte salt per password (`crypto.randomBytes(16)`), stored alongside the hash (`salt:hash` hex format, the standard non-secret-salt pattern), and constant-time comparison on verify (`crypto.timingSafeEqual`, guarding against timing-attack-based hash guessing). Node's `scryptSync` defaults (N=16384, r=8, p=1 when unspecified, as here) are the standard recommended cost parameters — no manual tuning needed or missing.

**Every password-hashing call site in the codebase goes through this one pair** — traced all 6: `server.ts:873` (password change), `server/auth.ts` (signup and login), `server/invites.ts` (setting a password on invite acceptance), `server/portal.ts` (the client portal's own password-gated handover links), and `server/sso.ts` (SSO-only accounts get `hashPassword(crypto.randomBytes(32)...)` — a random, never-known password, since the account can only ever authenticate via the provider, not local credentials — still routed through the same safe function rather than a shortcut or a null/placeholder hash).

**No weak algorithm usage anywhere.** Grepped the whole codebase for `createHash("md5")`/`createHash("sha1")` — zero matches. The one `createHash("sha256")` call in the codebase (`portalCore.ts:74`, `sessionAuditId`) is unrelated to password hashing — it's a one-way, truncated fingerprint of a session cookie value used only to correlate audit-log entries from the same visitor, without storing or revealing the actual session token. Appropriate use of SHA-256 for a non-password, non-secret-verification purpose; not a violation of the rule against using it for passwords.

## What's at risk

Nothing found.

## What's already secure

- scrypt with a unique random salt per password and constant-time verification, exactly matching CLAUDE.md's requirement.
- One implementation, reused everywhere a password is hashed or verified — no risk of a second, weaker path having been added by accident.

## Recommendations

None — this category passes as-is.
