# SECRETS_EXPOSURE

## Status: PASS

## Findings

Investigated:
- `.gitignore` — `.env*` is excluded with an explicit `!.env.example` carve-out, alongside `*.db*`, `uploads/`, `public/fonts/`, `.claude/settings.local.json`.
- `git ls-files | grep -iE "\.env"` — only `.env.example` is tracked. The real `.env` has never been committed.
- `git log --all --full-history -- .env` and `git log --all --diff-filter=A --name-only` — `.env` has never existed in any commit, on any branch, at any point in history. Nothing to purge.
- `git log --all -p` grepped for `sk_live_`, `sk_test_`, `AKIA[0-9A-Z]{16}`, `whsec_` — zero matches across the full commit history (including diffs of deleted/changed lines).
- Full tracked-source grep (`git grep`) for `sk_live_`, `sk_test_`, `AKIA...`, `whsec_...`, PEM private-key headers, and generic `password|secret|apikey = "<12+ char literal>"` assignment patterns — zero matches anywhere in the repo.
- `git grep "sk-ant-|sk_live|sk_test|pk_live"` (broader net) — the only two hits are `.env.example`'s own placeholder text (`sk-ant-your-key-here`) and `server.ts:116`, which *compares against* that literal placeholder string to detect an unconfigured key (`apiKey !== "sk-ant-your-key-here"`), not a real credential.
- Every `VITE_`-prefixed variable actually referenced in source (`src/lib/supabaseClient.ts`, `server/supabase.ts`) is `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. This is Supabase's publishable/anon key, which is designed to be shipped to the browser and is safe there because access is enforced by Supabase Row Level Security, not by keeping the key secret. `.env.example` itself already carries an explicit inline warning: *"never put a service_role/secret key behind this prefix."* No `SERVICE_ROLE` key exists anywhere in the codebase (`git grep -n "SERVICE_ROLE"` returns nothing) — the app doesn't hold one at all, client or server.
- `.env.example` read in full (109 lines): every one of the ~20 documented variables (Anthropic, `PORTAL_SECRET`/`SESSION_SECRET`, `DATA_DIR`, `APP_BASE_URL`, Resend, Supabase, Google/Dropbox/Microsoft/Apple OAuth, Stripe) is an empty string or an obvious placeholder. No real credential present.
- `railway.json` — build/deploy config only (Nixpacks builder, `npm run build`/`npm start`, restart policy). No secrets, no inlined env values.
- Searched repo root for stray credential-shaped files (`*.pem`, `*.p12`, `id_rsa`, `*service-account*.json`, `*credentials*.json`) and for other deploy config files (`Dockerfile`, `docker-compose*`, `vercel.json`, `netlify.toml`) — none exist.
- No secrets are tracked in any built/bundled output (`git ls-files | grep "^dist/"` is empty — build output isn't committed at all).

## What's at risk

Nothing found. The one item worth naming explicitly so it isn't mistaken for a gap on a future pass: the server-side Supabase client (`server/supabase.ts`) uses the same publishable/anon key as the browser, rather than a `service_role` key. That's a legitimate architecture choice (RLS enforced uniformly for both client and server) rather than a leaked-secret issue, but it means Supabase RLS policies are the *only* access-control boundary on that data path — this is cross-referenced for verification under category 2 (DATABASE_ACCESS), not re-litigated here.

## What's already secure

- `.env` is git-ignored and has never been committed, on any branch, ever.
- `.env.example` contains only placeholders, with unusually thorough inline documentation of what each variable is, where to get it, and — for the Supabase keys specifically — an explicit warning against putting a secret key behind a `VITE_` prefix.
- No hardcoded credentials, API keys, tokens, or private keys exist anywhere in tracked source, current or historical.
- The only `VITE_`-prefixed variables in use are a URL and a publishable key that are safe-by-design to expose client-side.
- `railway.json` and all other deploy config are secret-free; real values are expected to be injected via the hosting platform's env var UI, never committed.

## Recommendations

None required — this category passes as-is. Optional hardening (not a finding, just worth naming): consider a pre-commit hook (e.g. `gitleaks` or `git-secrets`) to catch any future accidental secret commit before it happens, given the project has no such automated guard today. Not implementing this now since it's outside the scope of what the checklist asks this pass to fix, and no incident motivates it.
