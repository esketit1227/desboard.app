# Desboard — AI-Augmented Workspace Platform

Desboard is a file & project management dashboard for design studios, with a
distinct "Cosmic Slate" desktop-metaphor UI and AI features powered by the
**Anthropic Claude API**. The API key stays on the server — it never reaches the
browser.

This document is the deep dive into the app's architecture, features, and how to
run it.

---

## Quick Start

1. Make sure **Node.js** is installed (this project was built and tested on Node 22).
2. Add your Anthropic API key. A `.env` file already exists at the project root —
   open it and replace the placeholder:

   ```
   ANTHROPIC_API_KEY="sk-ant-...your real key..."
   ```

   Get a key from <https://console.anthropic.com/> → **Settings → API Keys**.
   (`.env` is git-ignored so your key never gets committed. `.env.example` shows
   the expected format.)
3. Install dependencies (already done if you ran `npm install`):

   ```
   npm install
   ```
4. Run everything (frontend + backend together) in dev mode:

   ```
   npm run dev
   ```
5. Open **<http://localhost:3000>** in your browser.

> The app runs even without a key — but the AI features (search, copilots, upload
> tagging) stay disabled, and semantic search degrades to plain keyword matching.
> Add the key and restart to enable them.

Production build (optional): `npm run build` then `npm start`.

---

## 1. Architectural Overview

A unified full-stack monorepo:

- **Frontend:** A single-page app built with **React 18 + Vite** and styled with
  **Tailwind CSS**. UI animation uses **Framer Motion** (`motion/react`). State is
  managed with React hooks.
- **Backend:** A **Node.js / Express** server (`server.ts`) that is both the API
  gateway and the AI compute layer.
- **Database:** A local **SQLite** database (`desboard.db`, via `better-sqlite3`)
  stores files, projects, and tags so data survives a refresh. It is created and
  seeded automatically on first run.
- **Dev/prod:** In development, Vite runs as Express middleware so the frontend
  (with HMR) and the API share one port (3000). In production, `esbuild` bundles
  the server to `dist/server.cjs` and Vite builds the static assets into `dist/`.

---

## 2. Core Intelligent Features (Powered by Anthropic Claude)

The backend uses the official **`@anthropic-ai/sdk`** package and manages
`ANTHROPIC_API_KEY` server-side, so credentials and raw prompts never reach the
client browser.

**Model choice** (verified against Anthropic's current model catalog):

- **`claude-sonnet-4-6`** — File Copilot, Project Copilot, and upload analysis.
- **`claude-haiku-4-5`** — the fast semantic-search endpoint.

### 2.1. Semantic Vault Search (`/api/search`, `claude-haiku-4-5`)
The user's query plus a **compact index** of file names, tags, status, and type is
sent to Claude Haiku, which returns a **ranked JSON array of matching file ids**.
If the AI call fails or no key is configured, the endpoint **falls back to plain
keyword matching** so search always works.

### 2.2. Project Copilot (`/api/chat`, `claude-sonnet-4-6`)
Open the Copilot from any project. The full project object is passed as context so
Claude can draft client update emails, analyze deadlines and timeline risks, and
summarize the project's state.

### 2.3. File Copilot (`/api/chat`, `claude-sonnet-4-6`)
The "AI" tab of the file inspector chats directly about the selected file —
extract action items, generate summaries, or ask questions.

### 2.4. Upload Analysis (`/api/analyze`, `claude-sonnet-4-6`)
On upload, Claude suggests a short summary and 3–5 tags. Images and PDFs are sent
to the model as real content; other file types are analyzed from their name/type.

---

## 3. UI/UX & Design Philosophy

### 3.1. The "Cosmic Slate" Aesthetic
Deep charcoal/near-black panels (`#050505`, `#111`) with soft off-white text
(`#EBE6DD`), a terracotta accent (`#D85E25`), a subtle mesh-gradient background,
and a CSS glass-noise overlay for texture.

### 3.2. Accessibility & Dynamic Theme
A high-contrast light mode is achieved with a single CSS filter
(`invert(1) hue-rotate(180deg)`) applied to the root container — instant, with no
duplicated stylesheets.

### 3.3. Typography
A dual-font system: **Inter / Space Grotesk** for display and body text,
**JetBrains-style monospace** for metadata, timestamps, and tags.

### 3.4. Animation
`motion/react` powers window transitions, staggered lists, and hover
micro-interactions.

---

## 4. Vault & Workspace Workflows

- **Desktop metaphor:** widgets on the dashboard open draggable, minimizable,
  maximizable "OS windows" (Projects, File Vault, Client Portal, Calendar), tracked
  in a bottom dock.
- **Grid / List views** for the vault, with a stateful project/tag filter.
- **Drag-and-drop** files onto project folders (native HTML5 DnD) — moves persist
  to SQLite.
- **File inspector** with Details, Version History (+ comparison), Links, and an AI
  tab.
- **Handovers:** open a project → **Handovers** to assemble delivery packages —
  pick files from the vault, add a note and recipient, advance the status
  (Draft → Sent → Accepted), and copy a share link. Packages persist to SQLite.
- **Branded landing pages:** each handover has a **Customize Page** editor —
  set an accent color, dark/light theme, logo, headline, subheading, and welcome
  message with a live preview. The result is a real, standalone, client-facing
  page served by Express at `/handover/:id` (no app UI, fully shareable). The
  same renderer (`src/lib/handoverPage.ts`) powers both the preview and the
  served page, so they never drift.
- **Shared discussion (meeting ground):** the handover landing page carries a
  live discussion thread. The **client** can leave notes and annotate specific
  files right on the shared page (no login), and the **designer** sees and
  replies from the app (Projects → Handovers → **Discussion**). It's one shared
  conversation persisted to SQLite; the card shows an unread-style comment count.

---

## 5. Project Structure

```
server.ts                     Express server + Anthropic proxy + REST API
db.ts                         SQLite schema, seed data, and query helpers
src/
  types.ts                    Shared TypeScript types (server + client)
  lib/api.ts                  Frontend API client (all calls go to /api/*)
  lib/handoverPage.ts         Shared renderer for the branded handover landing page
                              (used by both the server route and the live preview)
  pages/Dashboard.tsx         Desktop shell (header, widgets, window manager, dock)
  components/
    OSWindow.tsx              Draggable window chrome + app router
    Dock.tsx                  Bottom dock
    WidgetCard.tsx            Reusable dashboard widget card
    Toast.tsx                 Toast notifications
    windowTypes.ts            Window state types
    apps/
      FileVaultApp.tsx        File Vault (grid/list, upload, AI search, inspector)
      ProjectsApp.tsx         Projects list/detail + Project Copilot
      HandoverPanel.tsx       Handover packages for a project (files + status + share link)
      ClientPortalApp.tsx     Brandable client portal
      CalendarApp.tsx         Calendar / collaboration
```

---

## 6. Security

All Anthropic SDK calls happen on the Express server. The `ANTHROPIC_API_KEY` is
read from `.env` (git-ignored) and is never exposed to the browser, preventing key
extraction or quota abuse.

## Getting Started

1. Ensure Node.js is installed.
2. Put your `ANTHROPIC_API_KEY` in the `.env` file at the project root.
3. Install dependencies: `npm install`
4. Run development server: `npm run dev` (Express + Vite middleware on port 3000)
5. Open <http://localhost:3000>
6. Build for production: `npm run build`, then run it with `npm start`
