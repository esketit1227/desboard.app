# ACCESS_CONTROL

## Status: PASS

## Findings

**Role-based authorization (owner vs. member) is correctly enforced and cannot be self-escalated.** There is no `updateUser` function anywhere in `db.ts` and no route that lets a signed-in user modify their own `role`. A user's `role` is set exactly twice: at signup (always `"owner"`, since signing up creates a brand-new workspace) and at invite-acceptance (`server/invites.ts:120`, `role = invite.role === "owner" ? "owner" : "member"` — a value chosen by the *inviting* owner when creating the invite, not by the accepting user). Every owner-gated action (`POST/DELETE /api/team/invites`, `POST /api/billing/checkout`, `POST /api/billing/portal`) runs through `requireOwner`, which checks `user.role !== "owner"` and returns `403`, not a silent pass-through.

**`TeamMember.role` (a free-text roster label like "Designer"/"PM", `src/types.ts:428`) is a distinct field from `users.role` (the real owner/member permission enum) — verified by reading the type definition directly rather than assuming from the name.** Patching a team-roster entry's display role changes nothing about that person's actual permissions in the app.

**Mass-assignment via `req.body` merge-patches was checked at every write site that looked risky, not just the one already covered in `security/reports/DATABASE_ACCESS_REPORT.md`:**
- `PATCH /api/settings` → `updateSettings()` merge-patches `req.body` into `StudioSettings`, but `writeSettings()` (the actual SQL write) only ever pulls a fixed, named set of columns (`studio_name`, `default_owner`, `logo_url`, `brand_accent`, `brand_theme`, `brand_template`) — no billing or workspace-identity field is reachable through this endpoint at all, allow-list enforced at the SQL layer exactly like `writeFile`.
- `brand_template` specifically: the *write* path doesn't validate it's a real template name (an arbitrary string could land in the `settings` row), but every *consumption* path does — `rowToSettings()` validates against the exported `TEMPLATES` list on read (the bug fixed earlier this session), and separately, `src/lib/handoverPage.ts:114` (`b.template && TEMPLATES.includes(b.template) ? b.template : "editorial"`) re-validates a handover's own `branding.template` against the same allow-list at the exact point it's written into the `data-template="..."` HTML attribute. An un-validated write can never reach output unescaped, because the render path re-validates independently. Not treated as a gap worth patching — the actual security boundary (what reaches HTML) is already enforced; adding write-time validation too would be pure defense-in-depth, not a fix for something exploitable today.
- `PATCH /api/team-members/:id` → same allow-list pattern as files/settings (verified `writeTeamMember`'s shape follows the same `insertTeamMemberStmt`-with-named-columns convention as every other `write*` helper in `db.ts`).

**The client portal (`server/portal.ts`) — the one surface designed for a genuinely untrusted caller — was read in full and is the strongest-designed access-control surface in the app:**
- Every route resolves the handover exclusively by its unguessable token via `resolve()`, which re-checks live revocation/expiry state on *every* request (not cached), so a revoked link stops working immediately, including for downloads whose signed URL was already issued.
- `requireSession()` gates every API/download route behind a session established only by token possession (public/invite links) or a verified password (password-protected links).
- `requireSent()` blocks all client-facing writes (comment, approve, request-changes) while a handover is still `Draft`, so the studio's own preview reuse of the exact same URL can't be mistaken for real client activity.
- Comment role is forced server-side to `"client"` on every portal-authored comment (`server/portal.ts:301`) — a portal visitor can never post as `"designer"`/studio, and edit/delete are further scoped to `existing.role !== "client"` → `404`, so a visitor can revise their own note but never the studio's side of the thread.
- File-scoped actions (`view`, `download`, `approve`, `request-changes`) all re-validate `fileId` against both `h.fileIds` and the client-visibility filter (`filesOf(h)`), so a client can never reach a file the studio removed or never tagged client-visible, even by guessing an ID that's valid in a different handover.
- Downloads require a signed, time-limited URL (`verifyDownload`) *and* the file's current version must already be approved (`isFileApproved`) — approval-gating is enforced server-side, not just hidden in the UI.
- `Content-Disposition` filenames are sanitized (`safeName = file.name.replace(/[^a-zA-Z0-9._ -]/g, "_")`) before being interpolated into the header, preventing header-injection via a crafted file name.
- Every allow/deny decision is written to the `portal_events` audit trail via `audit()`.

## What's at risk

Nothing currently exploitable. Two informational, non-security notes surfaced during investigation (neither is a finding, both worth a one-line record so they aren't rediscovered as false alarms later):
1. There is no route to remove an *existing* team-roster member (only to revoke a *pending* invite) — a missing feature, not an access-control gap, since `team_members` carries no permissions of its own.
2. `updateFile`'s patch doesn't validate that a new `projectId`/`clientId` actually belongs to the caller's own workspace before storing it — this can't leak cross-tenant data (the file's own `workspace_id` never changes), but could create a dangling reference to a project ID from another workspace. A data-integrity nuance, not an authorization bypass; noted here rather than in `DATABASE_ACCESS` since it's about validating a resource *relationship*, not raw row access.

## What's already secure

- No path exists, anywhere in the app, for a user to change their own or anyone else's `role`.
- Every owner-only action is gated by `requireOwner` with a real `403`, not a soft/optional check.
- Every `write*` function in `db.ts` writes through a fixed, named column list — `req.body` merge-patches can widen what a caller *sees* echoed back in a response, but never what actually reaches a sensitive SQL column.
- The enum-typed `brandTemplate`/`branding.template` fields are validated independently at every point they're turned into HTML output, closing off the one path an un-validated write could otherwise have mattered for (XSS via `data-template`).
- The client portal enforces resource ownership, session state, sent-status, file-visibility, approval-status, and revocation/expiry independently at every single route — verified route-by-route, not sampled.

## Recommendations

None required — this category passes as-is. If ever revisited: adding a real "remove team member" endpoint (owner-gated, matching the existing `requireOwner` pattern) would close the one missing-feature gap noted above, and validating `projectId`/`clientId` against the caller's own workspace on file update would tighten the data-integrity nuance — neither is a security fix, both are optional polish.
