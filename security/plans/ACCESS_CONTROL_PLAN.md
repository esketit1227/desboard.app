# ACCESS_CONTROL

## Changes

None. Investigation found no authorization vulnerability — see `security/reports/ACCESS_CONTROL_REPORT.md`. Role escalation, mass-assignment into sensitive columns, and the client portal's full route surface were all checked directly against the code, not assumed from naming or comments. No code changes needed.

## New files

None.

## Verification goals

- [x] No route allows a user to change their own or another user's `role` (no `updateUser` function exists; role is set only at signup or invite-acceptance, both server-controlled)
- [x] Every owner-gated action (`requireOwner`) returns `403` for non-owners, not a silent pass
- [x] `TeamMember.role` confirmed to be a display-only field, unrelated to the real permission system
- [x] Every `write*` function in `db.ts` writes through a fixed, named column list — `req.body` merge-patches cannot reach `workspace_id`, billing columns, or `users.role`
- [x] Enum-typed template fields (`brand_template`, `branding.template`) are validated at every point they're turned into HTML output, independent of whether the write path validates them
- [x] Every route in `server/portal.ts` (the untrusted external surface) independently enforces: token resolution, live revocation/expiry, session state, sent-status, file-visibility, approval-status, and comment-role scoping — checked route-by-route
- [x] Signed download URLs are time-limited, signature-verified, and approval-gated server-side
- [x] `Content-Disposition` filenames are sanitized before header interpolation

## Manual verification (for the human)

- None required — no behavior changed.
- Two non-security polish items surfaced (see report's "What's at risk"): no endpoint to remove an existing team-roster member, and file updates don't validate `projectId`/`clientId` belongs to the caller's own workspace. Neither is a security gap; fix at your discretion if useful.
