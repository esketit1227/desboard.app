# CORS

## Changes

None. No CORS middleware or headers exist, and none are needed — the app serves frontend and API from a single origin. See `security/reports/CORS_REPORT.md`.

## New files

None.

## Verification goals

- [x] No `cors` package dependency exists
- [x] No manual `Access-Control-Allow-*` header is set anywhere in the codebase
- [x] Confirmed the frontend and API share one origin, so no legitimate cross-origin access need exists today

## Manual verification (for the human)

- None required. If you ever add a separate frontend deployment or third-party integration that needs cross-origin API access, come back to this category and add an explicit domain allowlist rather than a wildcard.
