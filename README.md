# Desboard — AI-Augmented Client-Delivery Workspace

Desboard is a multi-tenant SaaS platform for design studios: a project & file
workspace for the team, paired with a token-only client portal for review,
approval, and delivery — with **Anthropic Claude** woven in for search,
copiloting, and upload triage. It's a full product now, not a demo: real
signup/SSO auth, Stripe billing with plan-gated features, per-workspace data
isolation, and a marketing site, all running on one small Express server.

This document is the deep dive into the app's architecture, features, and how
to run it.

---

## Quick Start

1. **Node.js 22** (see `engines` in `package.json`).
2. Copy `.env.example` to `.env`. Only `ANTHROPIC_API_KEY` matters for local
   dev — every other variable (Stripe, OAuth, SSO, Resend, Supabase) is
   optional and the app degrades gracefully without it. Each block in
   `.env.example` explains exactly what it unlocks and how to obtain it.
3. Install dependencies:
   ```
   npm install
   ```
4. Run frontend + backend together (Vite as Express middleware, one port):
   ```
   npm run dev
   ```
5. Open **<http://localhost:3000>**.

Every new workspace (signup, invite-accept, or SSO) starts on a **14-day
trial** with the full Studio feature set at trial-sized volume caps — no
credit card required. See [§5 Billing & Plans](#5-billing--plans).

Other scripts: `npm run build` (Vite build + esbuild server bundle) → `npm
start` (production). `npm run lint` (`tsc --noEmit`). `npm test` (Vitest).

---

## 1. Architecture

- **Frontend:** React 19 + Vite 6, Tailwind CSS 4 (CSS-first `@theme`
  config), `motion/react` for animation. No router — the dashboard is a
  single-page "desktop" shell with its own internal window/dock navigation;
  `/pricing` and `/join/:token` are the only two real cold-landable URLs,
  handled as plain path checks in `App.tsx`.
- **Backend:** Node.js + Express (`server.ts`), organized as one slim
  entrypoint that mounts focused routers from `server/`: `auth.ts` (session
  auth), `sso.ts` ("Sign in with Google/Microsoft/Apple"), `oauth.ts`
  (Drive/Dropbox/OneDrive file import), `portal.ts` (the client-facing
  surface), `billing.ts` (Stripe), `invites.ts` (team invites), `email.ts`
  (Resend), `storage.ts` (file bytes + version bytes on disk).
- **Database:** SQLite via `better-sqlite3` (`desboard.db`), created and
  migrated automatically on first run (`ALTER TABLE` migrations logged to the
  console, so upgrading an existing local database is a non-event).
- **Testing:** Vitest. The gating/entitlement/crypto logic that most needs to
  be provably correct is split into dependency-free "core" modules
  (`authCore.ts`, `portalCore.ts`, `oauthCore.ts`, `ssoCore.ts`,
  `billingCore.ts`) so it can be unit-tested without spinning up Express or
  SQLite.

---

## 2. Multi-Tenancy & Auth

Every row in the database is scoped to a `workspace_id` — studios never see
each other's data. A **user** belongs to exactly one workspace with a role of
`owner` or `member`.

- **Sign up / log in:** email + password (`server/auth.ts`), or **SSO** with
  Google, Microsoft, or Apple (`server/sso.ts`) — both mint a session cookie
  the same way. Signing up always creates a brand-new workspace; there's no
  path to "join" one except an explicit invite.
- **Team invites:** an owner generates a single-use link (`Team` app →
  `server/invites.ts`); accepting it (`/join/:token`) adds the person to the
  *existing* workspace as a `member`, gated by that plan's seat cap.
- **Client portal auth is a separate, structurally distinct trust boundary**
  (`server/portal.ts`) — a token-only surface that never checks a studio
  session. Each handover gets its own shareable link with one of three access
  modes: **public** (anyone with the link), **password**-gated, or
  **invite**-only (a specific client email). Links can expire or be revoked.
  Everything the client can see is filtered server-side through explicit DTOs
  (`server/portalCore.ts`) — the portal is handed exactly the fields it's
  allowed to see, never a raw internal record.

---

## 3. Billing & Plans

Stripe-backed subscription billing (`server/billing.ts`,
`server/billingCore.ts`) with plan-gated features enforced server-side on
every relevant write, not just in the UI:

| | **Trial** | **Freelance** | **Studio** | **Enterprise** |
|---|---|---|---|---|
| Duration | 14 days | — | — | — |
| Seats | 3 | 1 | Unlimited | Unlimited |
| Storage | 5GB | 100GB | 1TB (+ $15/100GB add-on) | Unlimited |
| Active handovers | 2 | 5 | Unlimited | Unlimited |
| Folder nesting / bulk actions / multi-upload | ✓ | — | ✓ | ✓ |
| AI features | ✓ | — | ✓ | ✓ |

`computeEffectiveTier()` in `billingCore.ts` is the single source of truth
every gating check calls — it resolves trial expiry live against the current
time (no cron job to go stale), and a canceled subscription stays blocked
permanently rather than quietly reverting to a fresh trial. Checkout and the
billing portal are real Stripe Checkout/Billing Portal sessions; plan
changes land via a signature-verified webhook
(`POST /api/billing/webhook`). Without `STRIPE_SECRET_KEY` set, trials and
`/pricing` still work fully — only checkout itself is disabled.

---

## 4. Core Intelligent Features (Anthropic Claude)

The backend uses the official **`@anthropic-ai/sdk`**; `ANTHROPIC_API_KEY`
never reaches the browser. Every AI route checks a nullable client and
returns a friendly `503` if no key is configured — the frontend reads that
state from `GET /api/ai/status` and degrades its own UI honestly (e.g.
semantic search visibly falls back to keyword matching) rather than pretending
AI is available.

- **`claude-sonnet-4-6`** — File Copilot, Project Copilot, upload analysis,
  and the streaming home-screen Assistant.
- **`claude-haiku-4-5`** — fast semantic Vault search.

| Feature | Route | Model |
|---|---|---|
| Semantic Vault search | `POST /api/search` | Haiku |
| Project Copilot | `POST /api/chat` | Sonnet |
| File Copilot | `POST /api/chat` | Sonnet |
| Upload tagging & summary | `POST /api/analyze` | Sonnet |
| Home Assistant (streaming, SSE) | `POST /api/assistant` | Sonnet |

The home-screen **Assistant** is read-only by design: it answers over a
compact index of the workspace's real data and cites sources structurally
(real file ids resolved server-side, never parsed back out of its prose) — it
never performs writes, and is instructed to redirect write requests to the
right screen instead.

---

## 5. Client Portal & Proofing

The part clients actually touch, and the product's core differentiator:

- **Branded landing page per handover** — accent color, theme, logo,
  headline, welcome note, all live-previewed in the app and served standalone
  at `/portal/:token` (no app chrome). One shared renderer
  (`src/lib/handoverPage.ts`) powers both the live preview and the real page,
  so they can't drift.
- **Visual proofing that's actually useful, not just a comment box:**
  - **Image pins** — click anywhere on an image to drop a positioned,
    percentage-based comment pin.
  - **Video timecode pins** — a real custom `<video>` player (HTTP Range /
    206 Partial Content support for seeking) with click-to-pin commenting at
    an exact timecode.
  - Every pin is **editable and deletable by its author**, and a **side
    panel** lists every timestamp/position with its note, bidirectionally
    linked to the on-media markers — click a pin to jump to its note, or vice
    versa.
  - **Version-aware:** pins carry the file version they were left on; a
    version picker on the portal switches media in place, and older-version
    pins render in the panel (not as stale on-media markers) when you're
    viewing a different version.
- **Approvals:** clients can approve a file or request changes; the studio
  side sees status at a glance (`getPendingApprovalSummary`).
- **Access control:** files are only client-visible if explicitly tagged so
  (`isClientVisible`) — internal working files never leak into a handover by
  accident, even if they're technically attached to the project.
- **Reminders:** a background sweep finds handovers a client hasn't opened in
  N days and emails a nudge (via Resend, if configured — otherwise logged to
  the console, nothing breaks).

---

## 6. File Vault

- **Real folder nesting** — breadcrumb navigation, drag-and-drop, cascading
  project moves (moving a folder moves its whole subtree), with a
  cycle-safe guard against nesting a folder into its own descendant.
  Plan-gated (Studio/Enterprise).
- **Multi-file upload** with a lightweight progress queue, and **bulk
  actions** — multi-select (checkbox or shift-click range), bulk tag, move,
  download, delete. Plan-gated.
- **Version history** with restore, and a real side-by-side/slider version
  compare.
- **Cloud import** — connect Google Drive, Dropbox, or OneDrive
  (`server/oauth.ts`, Settings → Connections) and browse/import files
  directly, for studios whose source-of-truth lives elsewhere.
- **AI-assisted upload tagging & semantic search** (plan-gated; see §4).

---

## 7. The Workspace

One desktop-metaphor shell (`src/pages/Dashboard.tsx`) with a dock of
independent apps:

| App | What it's for |
|---|---|
| **Home** | Activity feed, insight rail, and the streaming AI Assistant |
| **Projects** | Project list/detail, tasks, deadlines, Project Copilot |
| **File Vault** | Everything in §6 |
| **Client Portal** | Manage handovers — assemble, brand, send, track status/approvals |
| **Calendar** | Team scheduling/events |
| **Messaging** | Internal team conversations |
| **Team** | Members, roles, invites, seat usage |
| **Connections** | Cloud storage OAuth connections (Drive/Dropbox/OneDrive) |
| **Settings** | Workspace settings, billing, demo-data reset |

---

## 8. Design System

A cool-neutral, white-dominant "elevated white" aesthetic (macOS
Finder/Sequoia-inspired) — flat grey canvas (`--color-paper`), white cards
raised on shadow rather than color-fill, near-black ink text, a muted
moss/slate accent family. Inter carries the dashboard end-to-end; the
marketing site (`/`, `/pricing`) switches to a distinct "editorial" system —
Instrument Sans, near-monochrome, hairline dividers, real product screenshots
doing the visual work (no stock photography, no fabricated logos/testimonials).
A high-contrast mode is available via a single CSS filter on the root
container.

---

## 9. Project Structure

```
server.ts                       Express entrypoint — mounts routers, Anthropic proxy, core REST API
db.ts                           SQLite schema, migrations, seed data, query helpers
server/
  auth.ts / authCore.ts         Email/password session auth (+ pure, testable core)
  sso.ts / ssoCore.ts           "Sign in with Google/Microsoft/Apple"
  oauth.ts / oauthCore.ts       Cloud storage connections (Drive/Dropbox/OneDrive)
  portal.ts / portalCore.ts     Client portal — token auth, comments, approvals, DTOs
  billing.ts / billingCore.ts   Stripe checkout/portal/webhook + plan entitlement math
  invites.ts                    Team invite links
  email.ts                      Transactional email (Resend)
  storage.ts                    File + version byte storage, HTTP Range streaming
  supabase*.ts                  Supabase client scaffolding (not wired into the active auth path)
  *.test.ts                     Vitest suites for the pure "core" modules above
src/
  types.ts                      Shared TypeScript types (server + client)
  App.tsx                       Top-level path routing (/, /pricing, /join/:token, dashboard)
  lib/
    api.ts                      Frontend API client (all calls go to /api/*)
    assistant.ts                Streaming (SSE) client for the home Assistant
    handoverPage.ts             Shared renderer for the branded portal page (preview + live route)
    filePreview.ts, utils.ts, oauthStates.ts, portalStates.ts
  pages/
    Dashboard.tsx                Desktop shell (dock, window manager, app router)
    PricingPage.tsx               Standalone /pricing page
  components/
    apps/                        One component per dock app (see §7)
    assistant/                   Home Assistant UI (box, thread, suggestion chips)
    auth/                        AuthGate, BillingGate, JoinInvite, landing page chrome
    home/                        Activity list, insight rail, celebration banner
    PricingCards.tsx, MarketingPricingCards.tsx
```

---

## 10. Security

- All Anthropic/Stripe SDK calls happen server-side; secrets are read from
  `.env` (git-ignored) and never reach the browser.
- Session and portal cookies are HMAC-signed with `SESSION_SECRET` /
  `PORTAL_SECRET` — the production server refuses to boot without them set,
  so a restart can't silently invalidate every signed-in session or
  outstanding client link with a rotating default.
- The client portal is a hard trust boundary: token-scoped access, explicit
  DTO allowlists (never raw internal records), and per-route rate limiting
  (page views, password attempts, comments, downloads, approvals each have
  their own limiter).
- File access respects plan entitlements and explicit client-visibility
  tagging — nothing reaches a client by accident.

---

## Environment Variables

See `.env.example` — every variable is documented inline with what it
unlocks and exactly how to obtain it. Only `ANTHROPIC_API_KEY` is needed for
local dev; everything else (Stripe, Google/Microsoft/Apple OAuth & SSO,
Resend, Supabase, `DATA_DIR` for persistent-volume hosts) is optional and
fails gracefully when unset.
