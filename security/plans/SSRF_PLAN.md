# SSRF

## Changes

None. No user-controllable URL-fetching feature exists in this codebase — see `security/reports/SSRF_REPORT.md`. Every outbound `fetch()` call targets a hardcoded, first-party API host.

## New files

None.

## Verification goals

- [x] Every outbound HTTP call in the server codebase was enumerated and its target traced
- [x] Confirmed no call target is built from unescaped user input at the scheme/host level
- [x] Confirmed no link-preview, URL-proxy, webhook-URL, or custom-domain feature exists that would take a user-supplied URL

## Manual verification (for the human)

- None required today. If you add a feature that fetches a user-supplied URL in the future, re-open this category and implement the private-IP-range blocklist + scheme allowlist + resolve-before-connect pattern from CLAUDE.md before shipping it.
