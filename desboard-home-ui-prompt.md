# Desboard — Home Screen UI

Part 1 breaks down the reference layout and translates it to Desboard.
Part 2 is the copy-paste prompt for Claude Code.

---

# Part 1 — The reference, decoded

The reference is a three-column agent workspace: navigation rail, central command column, and a right-hand insight rail. What makes it work is not any single element but four decisions:

**A serif display voice against a sans UI.** The greeting is set large in a serif; every functional label is sans. That single contrast does most of the visual work, and it costs nothing to implement.

**The greeting states a fact, not a platitude.** "Next meeting is Backlog Grooming" with the entity underlined. It answers a question before you ask it. A greeting that says "Welcome back" wastes the most prominent space on the screen.

**The command box is the visual center of gravity.** Tall, soft grey, generous placeholder, and a single saturated accent on the submit button — the only strong color anywhere.

**The right rail nags gently and offers one action.** Two items, each ending in a pill button. It surfaces what's slipping without a notification badge.

## Translating to Desboard

| Reference | Desboard |
|---|---|
| New task | New project |
| Brain | Assets (the index) |
| Files | Projects |
| Abilities | Approvals |
| Apps | Connections |
| "Next meeting is Backlog Grooming" | "3 assets need your approval in Aalto Rebrand" |
| Add a task and run it | Ask about your projects, or search everything |
| All / Needs you / Running / Chats | All / Needs you / In review / Delivered |
| Task rows with file chips | Asset and project rows with thumbnail chips |
| "Two threads are quietly slipping" | "One portal unopened, one connection erroring" |

The right rail is the strongest idea to steal. For Desboard it becomes the thing no competitor does: *the client hasn't opened the portal you sent six days ago*, and *your Dropbox connection has been erroring since Tuesday, so search results are stale*. Both end in one action.

## One caution

Use the reference for **layout, hierarchy and interaction patterns** — those aren't ownable. Do not copy its wordmark, illustration style, exact color values or icon set. Desboard should end up recognizably its own product, using the same structural ideas.

---

# Part 2 — Prompt for Claude Code

Paste everything below into Claude Code from the repo root, with the reference screenshot attached.

---

Build the Desboard home screen to match the attached reference layout.

**Context.** Desboard is a creative workspace layer for design studios and agencies. It connects existing cloud storage (Google Drive, Dropbox, OneDrive), links files into projects without duplicating them, and handles search, review, approvals and client handovers. This task is the home screen — the first thing a user sees each morning.

Read the existing codebase first and follow its conventions: routing, component library, styling system, data fetching, auth. Do not introduce a new styling approach or state manager. If a data source you need doesn't exist yet, tell me before inventing an endpoint.

Use the attached screenshot as the reference for **layout, spacing, hierarchy and interaction patterns**. Do not copy its wordmark, illustration, icon set or exact colors — apply Desboard's own brand.

## Layout

Three columns in a single full-height app shell:

**Left sidebar, ~260px, fixed.** Wordmark at top. Two labeled groups with small muted section headers:
- *Main* — New project (plus icon), Search (magnifier icon)
- *Workspace* — Home, Projects, Assets, Approvals, Portals, Connections

Active item gets a soft rounded pill background, not a border or left bar. Below the groups: collapsible *Recent* (last 5 projects) and *Account*, each with a chevron. Pinned to the bottom: *Plan & usage* with a chevron.

**Center column, flexible, max ~760px content width.**

1. **Greeting block.** Two lines in a serif display face. First line muted: "Good morning, {firstName}". Second line in near-black, stating the single most useful fact about their day, generated from real data with priority order: assets awaiting their approval > a client portal opened or downloaded since yesterday > a project with a delivery date this week > recent activity. The entity in the sentence (project or client name) is underlined and links to it. Fall back to a neutral line only when there is genuinely nothing.

2. **Command box.** Large soft-grey rounded container, roughly 180px tall, generous internal padding. Multiline textarea, placeholder "Ask about your projects, or search everything". Bottom row: a small accent-colored mark on the left, and on the right an attach control, a filter/scope control, and a circular submit button in Desboard's accent color with an arrow glyph. Enter submits, Shift+Enter newlines. This is the AI assistant entry point — read the existing assistant API and wire it; the response expands the box in place into a conversation view rather than navigating away. Stream the response with a cancel control.

3. **Filter tabs.** Text-only, no underline or pill: All / Needs you / In review / Delivered. Active is near-black and medium weight, inactive is muted. Selection persists across sessions.

4. **Activity list.** Rows separated by hairline dividers, generous vertical padding. Each row: a checkbox or status marker on the left, a bold single-line title, a muted one-line description below, an optional attachment chip (small thumbnail or file-type icon, filename, format label) and the responsible person's avatar on the right. Rows are clickable to the asset or project. Include a real empty state and a skeleton loading state.

**Right rail, ~340px.** A single bordered rounded card titled in serif with a plain-language summary of what needs attention — e.g. "A quiet day, but two things are slipping". Below it, up to three items, each a short sentence with the relevant entity underlined and linked, followed by one pill action button. Prioritize: connection errors (search results are silently stale), client portals unopened after 3+ days, assets stuck in review over 5 days, and expiring portal links. Actions are inline and optimistic where safe — nudging a client should not navigate away. Hide the card entirely when there is nothing; do not show a smiling empty state.

## Visual language

Near-white background, one soft accent color used only for the submit button and small marks, otherwise a greyscale palette. Serif for the greeting and rail headline only; sans for all UI. Rounded corners around 12–16px on the command box and rail card, hairline borders rather than shadows. Generous whitespace — the screen should feel calm even when full.

## Requirements

1. Every string in the greeting and right rail comes from real data. No hardcoded copy, no fake counts, no placeholder names in production paths.
2. Load progressively. The shell and command box render immediately; greeting, list and rail fill in independently. One slow query must not block the screen.
3. Handle loading, empty, error and no-permission states for each region separately.
4. Permission-scoped throughout: the greeting, list and rail must never reference a project the user cannot access.
5. Fully responsive. Below ~1200px the right rail moves under the center column; below ~768px the sidebar collapses to a drawer and the command box stays usable with a mobile keyboard open.
6. Keyboard accessible: visible focus states, `/` focuses the command box, tab order runs sidebar → command → tabs → list → rail. The streaming response is a polite live region.
7. Instrument command-box submissions, tab usage and rail action clicks so we can tell whether this screen actually works.

## Constraints

TypeScript strict, no `any` in new code. No new dependencies without asking. Components under ~200 lines — extract the sidebar, greeting, command box, activity row and rail card as separate components with their own stories or fixtures. No browser storage APIs if the codebase doesn't already use them.

Show me the component tree, the data requirements per region and the file structure before writing implementation code, then wait for my go-ahead.
