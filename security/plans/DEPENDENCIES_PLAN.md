# DEPENDENCIES

## Changes

- Removed `react-router-dom` (unused direct dependency, carried the most severe advisories: open redirect, XSS, others) via `npm uninstall`.
- Ran `npm audit fix` (non-breaking) to resolve 6 build/dev-tooling vulnerabilities (`@babel/core`, `browserslist`, `esbuild`, `nanoid`, `postcss`, `vite`).
- Added `"overrides": {"qs": "6.16.0"}` to `package.json` to force the one remaining runtime vulnerability (`qs`, via `body-parser`/`express`) to its patched version, which `body-parser`'s own dependency range permits but hadn't yet resolved to.
- Rewrote every entry in `dependencies` and `devDependencies` to an exact pinned version (stripped `^`/`~` from all 32), matching what was already resolved in `package-lock.json` — a zero-behavior-change pin, not a version bump.

## New files

None.

## Verification goals

- [x] `npm audit` reports 0 vulnerabilities (down from 11: 2 low, 4 moderate, 5 high)
- [x] Confirmed `react-router-dom` had zero imports anywhere in `src/` before removing it
- [x] `tsc --noEmit` passes clean after all dependency changes
- [x] Full `vitest` suite passes (56/56) after all dependency changes
- [x] A real `npm run build` succeeds and produces the expected `dist/` output after all dependency changes
- [x] `npm install` after the exact-pin rewrite reports "up to date" — confirms the pin matches what was already installed, not a silent version change
- [x] `package-lock.json` confirmed already committed (`git ls-files`)

## Manual verification (for the human)

- Boot the app normally (`npm run dev`) and click through the areas that depend on the packages that were bumped by `audit fix` (mainly the Vite/Tailwind build pipeline and `esbuild`'s server bundling) — already smoke-tested here (dev boot, build, tests) but worth your own pass given this touched the build toolchain.
- Consider adding `npm audit` (or a dedicated tool like Dependabot/Renovate) to CI so future vulnerabilities surface automatically rather than only during an audit like this one — not implemented here, noted as a process recommendation.
