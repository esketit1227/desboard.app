# PASSWORD_HASHING

## Changes

None. `crypto.scryptSync` with per-password random salts and constant-time verification is already used consistently everywhere a password is hashed or checked — see `security/reports/PASSWORD_HASHING_REPORT.md`.

## New files

None.

## Verification goals

- [x] Password hashing uses one of bcrypt/Argon2/scrypt (scrypt, confirmed)
- [x] A unique random salt is generated per password, not reused or hardcoded
- [x] Verification uses constant-time comparison
- [x] Every password-hashing/verification call site in the codebase (6 total) routes through the one shared implementation
- [x] No MD5, SHA-1, or plain SHA-256 used for password hashing anywhere; the one SHA-256 usage in the codebase is confirmed unrelated (a session-cookie audit fingerprint, not a password)

## Manual verification (for the human)

- None required — no behavior changed.
