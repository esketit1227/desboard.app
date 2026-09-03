# FILE_UPLOADS

## Changes

- `server/storage.ts`: added an `INLINE_SAFE_MIME` allowlist (standard image/video/audio formats plus `application/pdf`) and updated `streamPathWithRange` (the single function `/api/files/:id/content`, the version-download's inline sibling, and the portal's `/file/:fileId/view`/version-view routes all funnel through) to check the file's claimed MIME type against it. A match still serves `Content-Type: <mime>; Content-Disposition: inline` as before; anything else — including a mislabeled `text/html` or `image/svg+xml`, or any type not on the list — is forced to `Content-Type: application/octet-stream; Content-Disposition: attachment` regardless of what was claimed at upload.

## New files

None.

## Verification goals

- [x] `tsc --noEmit` passes clean
- [x] Live exploit reproduction (scratch `DATA_DIR`, no real data touched): a file uploaded with `mimeType: "text/html"` and a `<script>` payload, before the fix, served with `Content-Type: text/html; Content-Disposition: inline`
- [x] Same file, after the fix, serves `Content-Type: application/octet-stream; Content-Disposition: attachment`
- [x] Same test repeated for `image/svg+xml` (the classic image-format XSS vector) — same safe result
- [x] Regression check: a legitimate `image/png` upload still serves `Content-Type: image/png; Content-Disposition: inline` unchanged
- [x] Confirmed all three inline-serving call sites (studio `/content`, portal `/view`, portal version-view) share the one fixed function, so the fix applies everywhere the vulnerability was reachable
- [x] Confirmed download routes (studio and portal) were never vulnerable to this issue and needed no change — already unconditionally `attachment`-disposed with sanitized filenames

## Manual verification (for the human)

- Open the app, upload a real image/video/PDF, and confirm previews still render inline exactly as before (spot-check one of each format your studio actually uses, e.g. a `.mov` or `.webp`, if those aren't already covered by `INLINE_SAFE_MIME` and you rely on them — the list can be extended if a real, safe format is missing).
- Consider the two follow-up recommendations in the report (separate-origin storage; upload-time magic-byte validation) as future hardening — neither is required for the vulnerability found here to be closed, both would add an additional independent layer.
