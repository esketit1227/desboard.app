# DEPENDENCIES

## Status: MEDIUM (fixed)

## Findings

**`npm audit` found 11 known vulnerabilities (2 low, 4 moderate, 5 high) at the start of this category.** Investigated each rather than blanket-running `audit fix` and trusting the summary line:

- **`react-router`/`react-router-dom` (5 advisories, including an open redirect and an XSS)** — the most severe group, and the easiest real fix: `react-router-dom` is a **direct dependency that is completely unused**. Grepped every `.tsx`/`.ts` file in `src/` for an import from `react-router`/`react-router-dom` — zero matches, confirming this app's own documented design choice (routing is done via manual pathname checks in `App.tsx`, not this library — noted in this session's earlier billing-plan context too). **Removed it entirely** (`npm uninstall react-router-dom`) rather than upgrading a dependency the app doesn't call into — this eliminates the vulnerability outright and trims real, if unused, attack surface and bundle weight, with zero functional risk since nothing references it.
- **`@babel/core`, `browserslist`, `esbuild` (the `tsx`-nested copy), `nanoid`, `postcss`, and `vite`** — all build/dev-tooling dependencies, not part of the deployed production runtime (Vite's dev server and its toolchain never run in production; `express.static` serves pre-built files instead, confirmed under `SECURITY_HEADERS`/`ERROR_HANDLING`). Fixed via `npm audit fix` (non-breaking, patch/minor-only), which resolved all six without any code or behavior change — verified by re-running `tsc --noEmit`, the full `vitest` suite (56/56 passing), and a real `npm run build` afterward, all clean.
- **`qs` (via `body-parser` via `express`, a real runtime dependency)** — the one advisory `npm audit fix` (even with `--force`) couldn't resolve on its own, because the patched version (`qs@6.16.0`, published days before this audit) is newer than what `body-parser@1.20.6`'s own dependency range had resolved to in the existing lock file, even though `^6.15.2` technically permits it. Fixed with a targeted `"overrides": {"qs": "6.16.0"}` in `package.json` — the standard npm mechanism for forcing a transitive dependency to a specific patched version without needing to wait on (or force) a breaking upgrade of the direct dependency that pulls it in.

**Result: `npm audit` now reports 0 vulnerabilities**, down from 11, verified by re-running it after each fix stage, not just once at the end.

**Verified nothing broke** at each stage: `tsc --noEmit` clean, all 56 existing tests passing (`vitest run`), and a full production build (`npm run build`) succeeding and producing the expected `dist/index.html`/`dist/assets/*`/`dist/server.cjs` output, all after the `react-router-dom` removal, the `audit fix` package bumps, and the `qs` override together.

**Lock file was already committed** — `git ls-files package-lock.json` confirms it's tracked, satisfying that part of CLAUDE.md's rule already; no change needed there.

**Version pinning was not followed anywhere — fixed.** CLAUDE.md: *"Pin exact versions in package.json... no `^` or `~` in production."* Before this pass, 32 of 32 runtime/dev dependencies used caret ranges (only the pre-existing `typescript: "~5.8.2"` used a tilde, everything else `^`). Rewrote every entry in both `dependencies` and `devDependencies` to the exact version already resolved in `package-lock.json` (pulled programmatically from the lock file's own resolved-version data, not guessed) — this is a zero-behavior-change pin: `npm install` afterward reported "up to date," installing exactly what was already installed. The forward-looking effect is that a future `npm install`/`npm update` can no longer silently pull in a newer, unreviewed minor/patch release (including a compromised one, in a supply-chain-attack scenario) without an explicit `package.json` edit.

## What's at risk

Before the fix: 11 known vulnerabilities in the dependency tree, including a genuinely-installed-but-unused library carrying an open-redirect and an XSS advisory, and a real runtime dependency (`qs`, reachable via every request `express`/`body-parser` parses) with two moderate-severity DoS-adjacent issues. Caret-range versioning also meant every future `npm install` could silently drift to an unreviewed newer version within the same major — including, in the worst case, a compromised patch release from a supply-chain attack on any of the 32 packages this app depends on.

## What's already secure

- `package-lock.json` was already committed, so builds were already reproducible in the sense that `npm ci` would install exactly what's in the lock file — the caret-range gap in `package.json` only mattered for a fresh `npm install`/`npm update`, not for a locked, repeatable CI/deploy build.
- No dependency in the tree is from an unofficial/unusual registry or an obviously suspicious low-download package — every dependency is a well-known, widely-used library (Express, React, Stripe's official SDK, Anthropic's official SDK, Supabase's official clients, etc.).

## Recommendations

None outstanding — all 11 known vulnerabilities are resolved, the unused vulnerable dependency is removed rather than papered over, and every dependency is now exactly pinned. Ongoing hygiene: re-run `npm audit` periodically (not automated as part of this pass — no CI vulnerability-scanning step exists in this repo today; adding one, e.g. a GitHub Action running `npm audit --audit-level=high` on PRs, would be a reasonable follow-up but is a CI/infrastructure change outside this audit's scope).
