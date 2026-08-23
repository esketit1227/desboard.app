/**
 * SQLite persistence layer.
 *
 * Uses better-sqlite3 (a fast, synchronous SQLite driver) to store files,
 * projects, and tags in a local file called `desboard.db` at the project root.
 * Because it's a real database on disk, everything survives a page refresh or
 * a server restart.
 *
 * Multi-tenant: every top-level entity table carries a `workspace_id`, and
 * every read/write function that touches one takes a `workspaceId` argument
 * that's baked directly into the SQL (not just checked in application code).
 * A lookup for the wrong workspace behaves exactly like a lookup for an id
 * that doesn't exist — callers already handle that as a 404. Child tables
 * (handover_comments, portal_events, messages) aren't scoped individually;
 * they inherit protection because routes always resolve their parent
 * (handover/conversation) with a workspace check before touching them.
 * `workspace_id` is deliberately NOT part of the shared types in
 * src/types.ts — same convention as oauth_tokens below: server-internal
 * fields that must never reach the browser stay out of the shared shapes.
 *
 * On first run the tables are created and seeded with the sample data from the
 * prototype, scoped to one bootstrap workspace. Array/object fields (tags,
 * versions, access, team, linked) are stored as JSON strings in TEXT columns
 * and parsed back into real objects by the row-mapping helpers below.
 */
import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  VaultFile,
  ProjectFull,
  Tag,
  ProjectLinked,
  FileVersion,
  FileStatus,
  ProjectStatus,
  Handover,
  HandoverStatus,
  HandoverBranding,
  HandoverComment,
  HandoverApprovals,
  HandoverFileApproval,
  ScopeCreepFlag,
  PortalActivityItem,
  GreetingFact,
  DashboardInsight,
  PendingApproval,
  CompletedApproval,
  StatusTally,
  StudioSettings,
  VaultTask,
  CalendarEvent,
  TeamMember,
  Conversation,
  ConversationMessage,
  WorkspaceRole,
  WorkspaceMember,
  PendingInvite,
  PlanTier,
  HandoverTemplate,
} from "./src/types.ts";
import { computeEffectiveTier, type EffectiveTier, type WorkspaceBillingRow } from "./server/billingCore.ts";
import { TEMPLATES as HANDOVER_TEMPLATES } from "./src/lib/handoverPage.ts";

// DATA_DIR lets a deployment point the database at a mounted persistent
// volume (e.g. Railway/Fly) instead of the app's own working directory,
// which is wiped on every deploy. Defaults to cwd for local dev, unchanged
// behavior. See server/storage.ts for the matching uploads-dir setting.
const DB_PATH = path.join(process.env.DATA_DIR || process.cwd(), "desboard.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Schema -----------------------------------------------------------------
// These CREATE TABLE statements define the shape for a brand-new database file.
// For a database that already exists from before multi-tenancy, they're a
// no-op (the tables already exist in the old shape) — the migration block
// below upgrades those in place.

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    created TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'owner',
    created       TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
  CREATE INDEX IF NOT EXISTS idx_users_workspace ON users (workspace_id);

  -- A shareable, single-use token that lets someone join an EXISTING workspace
  -- (as opposed to signup/SSO, which always mint a brand-new one). Deliberately
  -- minimal: no expiry beyond manual revocation, matching the simplicity of the
  -- portal's own invite-by-link model.
  CREATE TABLE IF NOT EXISTS invites (
    token        TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    email        TEXT,
    role         TEXT NOT NULL DEFAULT 'member',
    created_by   TEXT,
    created      TEXT NOT NULL,
    accepted_at  TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_invites_workspace ON invites (workspace_id);

  CREATE TABLE IF NOT EXISTS files (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'file',
    extension    TEXT,
    size         TEXT,
    created      TEXT,
    owner        TEXT,
    source       TEXT,
    status       TEXT,
    project_id   INTEGER,
    client_id    TEXT,
    tags         TEXT NOT NULL DEFAULT '[]',
    versions     TEXT NOT NULL DEFAULT '[]',
    access       TEXT NOT NULL DEFAULT '[]',
    mime         TEXT,
    has_content  INTEGER NOT NULL DEFAULT 0,
    status_changed_at TEXT,
    parent_id    TEXT,
    ord          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    client       TEXT,
    status       TEXT,
    deadline     TEXT,
    owner        TEXT,
    team         TEXT NOT NULL DEFAULT '[]',
    tags         TEXT NOT NULL DEFAULT '[]',
    progress     INTEGER NOT NULL DEFAULT 0,
    linked       TEXT NOT NULL DEFAULT '{}',
    ord          INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tags (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS handovers (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    title         TEXT NOT NULL,
    recipient     TEXT,
    client_name   TEXT,
    client_email  TEXT,
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'Draft',
    file_ids      TEXT NOT NULL DEFAULT '[]',
    created       TEXT,
    branding      TEXT,
    token         TEXT,
    access_mode   TEXT NOT NULL DEFAULT 'invite',
    password_hash TEXT,
    expires_at    TEXT,
    revoked       INTEGER NOT NULL DEFAULT 0,
    revoked_at    TEXT,
    last_reminder_at TEXT,
    ord           INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS handover_comments (
    id            TEXT PRIMARY KEY,
    handover_id   TEXT NOT NULL,
    author        TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'client',
    body          TEXT NOT NULL,
    file_id       TEXT,
    x             REAL,
    y             REAL,
    timecode      REAL,
    version       TEXT,
    created       TEXT NOT NULL,
    internal_only INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_handover_comments_handover ON handover_comments (handover_id);

  -- Per-file review status within one handover: status is 'approved' or
  -- 'changes_requested'; version snapshots the file's version label at the
  -- moment this status was set, so a later content swap can be detected as
  -- stale (see isFileApproved) without ever destroying the historical record
  -- of what was actually approved and when. Not scoped to the file globally
  -- since the same file can appear in multiple handovers independently.
  CREATE TABLE IF NOT EXISTS handover_approvals (
    handover_id TEXT NOT NULL,
    file_id     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'approved',
    approved_by TEXT,
    approved_at TEXT NOT NULL,
    version     TEXT,
    PRIMARY KEY (handover_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS portal_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    handover_id TEXT NOT NULL,
    session_id  TEXT,
    event       TEXT NOT NULL,
    detail      TEXT,
    ip          TEXT,
    user_agent  TEXT,
    created     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_portal_events_handover ON portal_events (handover_id);

  CREATE TABLE IF NOT EXISTS assistant_metrics (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT,
    event        TEXT NOT NULL,
    detail       TEXT,
    created      TEXT NOT NULL
  );

  -- One row per workspace (was a global singleton before multi-tenancy).
  CREATE TABLE IF NOT EXISTS settings (
    workspace_id   TEXT PRIMARY KEY,
    studio_name    TEXT,
    default_owner  TEXT,
    logo_url       TEXT,
    brand_accent   TEXT,
    brand_theme    TEXT,
    brand_template TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    due_date     TEXT,
    assignee     TEXT,
    created      TEXT,
    ord          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id);

  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id   TEXT,
    title        TEXT NOT NULL,
    date         TEXT NOT NULL,
    start_time   TEXT,
    end_time     TEXT,
    created      TEXT,
    ord          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_events_project ON events (project_id);
  CREATE INDEX IF NOT EXISTS idx_events_date ON events (date);

  CREATE TABLE IF NOT EXISTS team_members (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    initials     TEXT NOT NULL,
    role         TEXT,
    email        TEXT,
    color        TEXT NOT NULL DEFAULT '#8C897F',
    ord          INTEGER NOT NULL DEFAULT 0
  );

  -- Live bearer credentials for a connected Drive/Dropbox account. Deliberately
  -- NOT modeled in src/types.ts (the shared client/server type file) — unlike
  -- everything else in this schema, these fields must never reach the browser,
  -- so the record type stays private to this module. Currently unused (no
  -- routes read/write it yet); revisit its uniqueness once a real OAuth
  -- integration lands and needs one connection per (workspace, provider).
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider      TEXT PRIMARY KEY,
    workspace_id  TEXT,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TEXT,
    scope         TEXT,
    account_label TEXT,
    connected_at  TEXT
  );

  -- Links a user to a Google/Microsoft/Apple identity used to sign in. Kept
  -- separate from oauth_tokens above, which is for Drive/Dropbox file access
  -- (a workspace-level integration), not login (a user-level identity).
  CREATE TABLE IF NOT EXISTS oauth_identities (
    provider         TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    email            TEXT,
    created          TEXT NOT NULL,
    PRIMARY KEY (provider, provider_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities (user_id);

  CREATE TABLE IF NOT EXISTS conversations (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL,
    title             TEXT NOT NULL,
    linked_project_id TEXT,
    linked_client     TEXT,
    linked_member_id  TEXT,
    created           TEXT,
    ord               INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    author          TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'me',
    body            TEXT NOT NULL,
    created         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);

  -- Dedup log for Stripe webhook deliveries. Stripe guarantees at-least-once
  -- delivery (network retries, manual "Resend" from the Dashboard both
  -- redeliver the same event id) — claimStripeEvent() does an INSERT OR
  -- IGNORE against this and checks .changes, same idiom linkOAuthIdentity
  -- already uses for the same kind of idempotent-insert problem.
  CREATE TABLE IF NOT EXISTS stripe_events (
    id       TEXT PRIMARY KEY,
    type     TEXT NOT NULL,
    received TEXT NOT NULL
  );
`);

// Migration: add the `branding` column to handovers tables created before the
// branded-landing-page feature existed.
{
  const cols = db.prepare(`PRAGMA table_info(handovers)`).all() as { name: string }[];
  if (!cols.some((col) => col.name === "branding")) {
    db.exec(`ALTER TABLE handovers ADD COLUMN branding TEXT`);
    console.log("[db] Migrated: added handovers.branding column.");
  }
}

// Migration: add the `brand_template` column to settings tables created
// before the multi-template portal page existed.
{
  const cols = db.prepare(`PRAGMA table_info(settings)`).all() as { name: string }[];
  if (cols.length && !cols.some((col) => col.name === "brand_template")) {
    db.exec(`ALTER TABLE settings ADD COLUMN brand_template TEXT`);
    console.log("[db] Migrated: added settings.brand_template column.");
  }
}

/** Unguessable, URL-safe portal token (32 chars of base64url). */
export function makePortalToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// Migration: portal access-control columns + comment visibility, for databases
// created before the client portal existed. Every handover gets a random token.
{
  const cols = db.prepare(`PRAGMA table_info(handovers)`).all() as { name: string }[];
  const add = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE handovers ADD COLUMN ${ddl}`);
  };
  add("token", "token TEXT");
  add("client_name", "client_name TEXT");
  add("client_email", "client_email TEXT");
  add("access_mode", "access_mode TEXT NOT NULL DEFAULT 'invite'");
  add("password_hash", "password_hash TEXT");
  add("expires_at", "expires_at TEXT");
  add("revoked", "revoked INTEGER NOT NULL DEFAULT 0");
  add("revoked_at", "revoked_at TEXT");
  add("last_reminder_at", "last_reminder_at TEXT");

  const ucols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!ucols.some((c) => c.name === "role")) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'`);
    console.log("[db] Migrated: added users.role column (existing users default to 'owner').");
  }

  const apcols = db.prepare(`PRAGMA table_info(handover_approvals)`).all() as { name: string }[];
  if (!apcols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE handover_approvals ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
    console.log("[db] Migrated: added handover_approvals.status column.");
  }
  if (!apcols.some((c) => c.name === "version")) {
    db.exec(`ALTER TABLE handover_approvals ADD COLUMN version TEXT`);
    console.log("[db] Migrated: added handover_approvals.version column.");
  }

  const ccols = db.prepare(`PRAGMA table_info(handover_comments)`).all() as { name: string }[];
  if (!ccols.some((c) => c.name === "internal_only")) {
    db.exec(`ALTER TABLE handover_comments ADD COLUMN internal_only INTEGER NOT NULL DEFAULT 0`);
  }
  if (!ccols.some((c) => c.name === "x")) db.exec(`ALTER TABLE handover_comments ADD COLUMN x REAL`);
  if (!ccols.some((c) => c.name === "y")) db.exec(`ALTER TABLE handover_comments ADD COLUMN y REAL`);
  if (!ccols.some((c) => c.name === "timecode")) {
    db.exec(`ALTER TABLE handover_comments ADD COLUMN timecode REAL`);
    console.log("[db] Migrated: added handover_comments.timecode column.");
  }
  if (!ccols.some((c) => c.name === "version")) {
    db.exec(`ALTER TABLE handover_comments ADD COLUMN version TEXT`);
    console.log("[db] Migrated: added handover_comments.version column.");
  }

  // Real-file-storage columns for databases created before uploads stored bytes.
  const fcols = db.prepare(`PRAGMA table_info(files)`).all() as { name: string }[];
  if (!fcols.some((c) => c.name === "mime")) db.exec(`ALTER TABLE files ADD COLUMN mime TEXT`);
  if (!fcols.some((c) => c.name === "has_content")) {
    db.exec(`ALTER TABLE files ADD COLUMN has_content INTEGER NOT NULL DEFAULT 0`);
  }
  if (!fcols.some((c) => c.name === "status_changed_at")) {
    db.exec(`ALTER TABLE files ADD COLUMN status_changed_at TEXT`);
    console.log("[db] Migrated: added files.status_changed_at column.");
  }
  if (!fcols.some((c) => c.name === "parent_id")) {
    db.exec(`ALTER TABLE files ADD COLUMN parent_id TEXT`);
    console.log("[db] Migrated: added files.parent_id column (real folder nesting).");
  }
  if (!fcols.some((c) => c.name === "size_bytes")) {
    // The existing `size` column is a display-formatted string ("8.3 MB"), not
    // usable for quota math — this is the raw byte count, populated at every
    // content-write site, that storage-quota enforcement sums per workspace.
    db.exec(`ALTER TABLE files ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0`);
    console.log("[db] Migrated: added files.size_bytes column (storage-quota accounting).");
  }

  // Backfill: any handover without a token gets one now.
  const missing = db.prepare(`SELECT id FROM handovers WHERE token IS NULL OR token = ''`).all() as { id: string }[];
  if (missing.length > 0) {
    const set = db.prepare(`UPDATE handovers SET token = ? WHERE id = ?`);
    missing.forEach((r) => set.run(makePortalToken(), r.id));
    console.log(`[db] Migrated: generated portal tokens for ${missing.length} handover(s).`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_handovers_token ON handovers (token)`);
}

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

// Migration: billing/plan-tier columns, for databases created before paid
// plans existed. plan_tier defaults every workspace to 'trial' — see
// billingCore.ts for how trial_ends_at is interpreted (computed live against
// Date.now(), no cron job needed).
{
  const wcols = db.prepare(`PRAGMA table_info(workspaces)`).all() as { name: string }[];
  const add = (name: string, ddl: string) => {
    if (!wcols.some((c) => c.name === name)) db.exec(`ALTER TABLE workspaces ADD COLUMN ${ddl}`);
  };
  add("plan_tier", "plan_tier TEXT NOT NULL DEFAULT 'trial'");
  add("trial_ends_at", "trial_ends_at TEXT");
  add("stripe_customer_id", "stripe_customer_id TEXT");
  add("stripe_subscription_id", "stripe_subscription_id TEXT");
  add("subscription_status", "subscription_status TEXT");
  add("plan_interval", "plan_interval TEXT");
  add("seats", "seats INTEGER NOT NULL DEFAULT 1");
  add("storage_addon_units", "storage_addon_units INTEGER NOT NULL DEFAULT 0");
  add("current_period_end", "current_period_end TEXT");
  add("cancel_at_period_end", "cancel_at_period_end INTEGER NOT NULL DEFAULT 0");

  // Backfill: any workspace that predates this migration (including ones
  // created moments ago by createWorkspace() before this block first ran on
  // a fresh boot) gets a fresh 14-day trial rather than an instantly-expired
  // one — a pre-existing local desboard.db shouldn't get locked out the
  // moment this ships.
  const missingTrial = db.prepare(`SELECT id FROM workspaces WHERE trial_ends_at IS NULL`).all() as { id: string }[];
  if (missingTrial.length > 0) {
    const trialEndsAt = new Date(Date.now() + TRIAL_MS).toISOString();
    const set = db.prepare(`UPDATE workspaces SET trial_ends_at = ? WHERE id = ?`);
    missingTrial.forEach((r) => set.run(trialEndsAt, r.id));
    console.log(`[db] Migrated: started a fresh 14-day trial for ${missingTrial.length} workspace(s).`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_workspaces_stripe_customer ON workspaces (stripe_customer_id)`);
}

// Set by the migration block below when a fresh bootstrap workspace needs
// seed data; actually acted on much further down, once the seed*IfEmpty
// functions and their SEED_* data actually exist (see the bottom of this
// file) — this module is evaluated top-to-bottom, so calling them from
// inside the migration block itself would reference consts that don't have
// a value yet.
let pendingBootstrapWorkspaceId: string | null = null;

/**
 * Migration: multi-tenancy. Databases created before accounts/workspaces
 * existed have all the tables above but none of them have a `workspace_id`
 * column (and `tags`/`settings` are still in their old singleton/global-unique
 * shape). This block:
 *   1. Adds a nullable `workspace_id` column to every simple table that's
 *      missing one (safe: SQLite can't add a NOT NULL column with existing
 *      rows and no default, and the app always supplies workspace_id on every
 *      query anyway, so a stray NULL just becomes an inaccessible orphan row,
 *      never a cross-tenant leak).
 *   2. Rebuilds `tags` (was globally-unique by name) and `settings` (was a
 *      single `id = 1` row) into their per-workspace shapes, since those two
 *      needed a real constraint change, not just a new column.
 *   3. If no workspace exists yet, creates one bootstrap workspace and folds
 *      any pre-existing (legacy, NULL-workspace) rows into it, so upgrading
 *      an existing local desboard.db doesn't lose data.
 */
{
  const addWorkspaceColumn = (table: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "workspace_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT`);
      console.log(`[db] Migrated: added ${table}.workspace_id column.`);
    }
  };
  ["files", "projects", "handovers", "tasks", "events", "team_members", "conversations", "assistant_metrics", "oauth_tokens"].forEach(
    addWorkspaceColumn
  );

  // Only safe to create now that every table above is guaranteed to have the
  // column — on a brand-new database these tables already had it from the
  // CREATE TABLE block, so this is just a (harmless, idempotent) redo there.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_workspace ON files (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_handovers_workspace ON handovers (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_events_workspace ON events (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_workspace ON team_members (workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations (workspace_id);
  `);

  // Rebuild `tags`: was `name TEXT UNIQUE NOT NULL` (global). New shape needs
  // (workspace_id, name) uniqueness so two workspaces can both have a "Brand" tag.
  const tagCols = db.prepare(`PRAGMA table_info(tags)`).all() as { name: string }[];
  if (tagCols.length > 0 && !tagCols.some((c) => c.name === "workspace_id")) {
    db.exec(`ALTER TABLE tags RENAME TO tags_old`);
    db.exec(`
      CREATE TABLE tags (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        name         TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_workspace_name ON tags (workspace_id, name);
    `);
    console.log("[db] Migrated: rebuilt tags for per-workspace uniqueness (data restored below).");
  }
  // Safe now regardless of which branch above ran: a fresh database's `tags`
  // already had workspace_id from the CREATE TABLE block; a migrated one was
  // just rebuilt to have it.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_workspace_name ON tags (workspace_id, name)`);

  // Rebuild `settings`: was a singleton `id = 1` row. New shape is one row
  // per workspace, keyed by workspace_id.
  const settingsCols = db.prepare(`PRAGMA table_info(settings)`).all() as { name: string }[];
  if (settingsCols.some((c) => c.name === "id") && !settingsCols.some((c) => c.name === "workspace_id")) {
    db.exec(`ALTER TABLE settings RENAME TO settings_old`);
    db.exec(`
      CREATE TABLE settings (
        workspace_id  TEXT PRIMARY KEY,
        studio_name   TEXT,
        default_owner TEXT,
        logo_url      TEXT,
        brand_accent  TEXT,
        brand_theme   TEXT
      );
    `);
    console.log("[db] Migrated: rebuilt settings as per-workspace (data restored below).");
  }

  const anyWorkspace = db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as { id: string } | undefined;
  if (!anyWorkspace) {
    const bootstrapId = crypto.randomUUID();
    const created = new Date().toISOString();
    db.prepare(`INSERT INTO workspaces (id, name, created) VALUES (?, ?, ?)`).run(bootstrapId, "Desboard Studio", created);

    ["files", "projects", "handovers", "tasks", "events", "team_members", "conversations", "assistant_metrics", "oauth_tokens"].forEach(
      (table) => {
        const info = db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL`).run(bootstrapId);
        if (info.changes > 0) console.log(`[db] Migrated: backfilled ${info.changes} legacy ${table} row(s) into the bootstrap workspace.`);
      }
    );

    const tagsOld = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tags_old'`).get();
    if (tagsOld) {
      const rows = db.prepare(`SELECT DISTINCT name FROM tags_old`).all() as { name: string }[];
      const insert = db.prepare(`INSERT OR IGNORE INTO tags (workspace_id, name) VALUES (?, ?)`);
      rows.forEach((r) => insert.run(bootstrapId, r.name));
      db.exec(`DROP TABLE tags_old`);
      console.log(`[db] Migrated: restored ${rows.length} tag(s) into the bootstrap workspace.`);
    }

    const settingsOld = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='settings_old'`).get();
    if (settingsOld) {
      const row = db.prepare(`SELECT * FROM settings_old WHERE id = 1`).get() as
        | { studio_name: string | null; default_owner: string | null; logo_url: string | null; brand_accent: string | null; brand_theme: string | null }
        | undefined;
      if (row) {
        db.prepare(
          `INSERT INTO settings (workspace_id, studio_name, default_owner, logo_url, brand_accent, brand_theme) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(bootstrapId, row.studio_name, row.default_owner, row.logo_url, row.brand_accent, row.brand_theme);
      }
      db.exec(`DROP TABLE settings_old`);
      console.log("[db] Migrated: restored settings into the bootstrap workspace.");
    }

    // The seed*IfEmpty() calls themselves are deferred to the bottom of this
    // file (after SEED_FILES etc. and the functions are actually declared) —
    // calling them here would reference consts that haven't been initialized
    // yet in this module's top-to-bottom evaluation order. They're a safe
    // no-op on an upgrade (the backfill above already populated these
    // tables) and only actually insert anything on a truly fresh database.
    pendingBootstrapWorkspaceId = bootstrapId;
  }
}

// Migration: oauth_tokens was keyed by a bare `provider` (global — one
// connection total across every workspace, since PRIMARY KEY on `provider`
// alone can't distinguish tenants). Real OAuth needs one connection per
// (workspace, provider), so rebuild with a composite key, and add
// last_error/last_error_at so a broken connection can surface on the home
// screen's insight rail. Runs after the multi-tenancy block above so
// workspace_id is already backfilled on any pre-existing rows.
{
  const cols = db.prepare(`PRAGMA table_info(oauth_tokens)`).all() as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "last_error")) {
    db.exec(`ALTER TABLE oauth_tokens RENAME TO oauth_tokens_old`);
    db.exec(`
      CREATE TABLE oauth_tokens (
        workspace_id  TEXT NOT NULL,
        provider      TEXT NOT NULL,
        access_token  TEXT NOT NULL,
        refresh_token TEXT,
        expires_at    TEXT,
        scope         TEXT,
        account_label TEXT,
        connected_at  TEXT,
        last_error    TEXT,
        last_error_at TEXT,
        PRIMARY KEY (workspace_id, provider)
      );
    `);
    const oldRows = db.prepare(`SELECT * FROM oauth_tokens_old WHERE workspace_id IS NOT NULL`).all() as {
      workspace_id: string; provider: string; access_token: string; refresh_token: string | null;
      expires_at: string | null; scope: string | null; account_label: string | null; connected_at: string | null;
    }[];
    const insertOld = db.prepare(
      `INSERT OR IGNORE INTO oauth_tokens (workspace_id, provider, access_token, refresh_token, expires_at, scope, account_label, connected_at)
       VALUES (@workspace_id, @provider, @access_token, @refresh_token, @expires_at, @scope, @account_label, @connected_at)`
    );
    oldRows.forEach((r) => insertOld.run(r));
    db.exec(`DROP TABLE oauth_tokens_old`);
    console.log(`[db] Migrated: rebuilt oauth_tokens with a per-workspace composite key (restored ${oldRows.length} row(s)).`);
  }
}

// --- Seed data (from the prototype) -----------------------------------------

const SEED_FILES: VaultFile[] = [
  {
    id: "f1", name: "Brand_Guidelines_v2.pdf", type: "file", extension: "pdf", size: "24 MB",
    created: "2023-10-24", owner: "Elias M.", source: "Drive", tags: ["Guidelines", "Brand"],
    status: "Approved", projectId: 1, clientId: "Nebula Inc.",
    versions: [
      { version: "v2.1", date: "Today, 10:42 AM", author: "Elias M.", latest: true },
      { version: "v2.0", date: "Yesterday, 4:00 PM", author: "Elias M." },
      { version: "v1.0", date: "Oct 15, 2023", author: "Sarah K." },
    ],
    access: ["Team", "Client (Read-only)"],
  },
  {
    id: "f2", name: "Hero_Section_Concepts", type: "folder", created: "2023-11-02", owner: "Design Team",
    source: "Figma", tags: ["UI", "Concept"], status: "Draft", projectId: 2, clientId: "Acme Corp",
    versions: [], access: ["Team"],
  },
  {
    id: "f3", name: "Logo_Assets_Final.ai", type: "file", extension: "ai", size: "156 MB",
    created: "2023-10-20", owner: "Elias M.", source: "Adobe", tags: ["Vector", "Final", "Logo"],
    status: "Delivered", projectId: 1, clientId: "Nebula Inc.",
    versions: [{ version: "v1.0", date: "Oct 20, 2023", author: "Elias M.", latest: true }],
    access: ["Team", "Client (Edit)"],
  },
  {
    id: "f4", name: "Marketing_Site_Copy.docx", type: "file", extension: "docx", size: "1.2 MB",
    created: "2023-11-05", owner: "Sarah K.", source: "Drive", tags: ["Copy", "Website"],
    status: "Review", projectId: 3, clientId: "GlobalNet",
    versions: [{ version: "v1.2", date: "2 hrs ago", author: "Sarah K.", latest: true }],
    access: ["Team"],
  },
];

const SEED_PROJECTS: ProjectFull[] = [
  {
    id: "p1", name: "Nebula Rebranding", client: "Nebula Inc.", status: "In Progress",
    deadline: "Nov 15, 2026", owner: "Elias M.", team: ["EM", "SK", "JD"], tags: ["Brand", "Web", "UI"],
    progress: 65, linked: { files: 12, tasks: 34, messages: 89, handovers: 0 },
  },
  {
    id: "p2", name: "Acme Design System", client: "Acme Corp", status: "Review",
    deadline: "Oct 28, 2026", owner: "Sarah K.", team: ["SK", "EM"], tags: ["Systems", "Figma"],
    progress: 90, linked: { files: 4, tasks: 12, messages: 45, handovers: 1 },
  },
  {
    id: "p3", name: "Global Marketing Campaign", client: "GlobalNet", status: "Planning",
    deadline: "Jan 10, 2027", owner: "John D.", team: ["JD"], tags: ["Marketing", "Copy", "Social"],
    progress: 15, linked: { files: 2, tasks: 8, messages: 14, handovers: 0 },
  },
];

const SEED_HANDOVERS: Handover[] = [
  {
    id: "h1",
    projectId: "p2",
    title: "Acme Design System — Final Handoff",
    recipient: "Acme Corp",
    clientName: "Dana",
    note: "Final design system files, tokens, and component documentation. Let us know if you need source files in another format.",
    status: "Sent",
    fileIds: ["f2"],
    created: "Oct 15, 2023",
    token: "", // generated on write
    accessMode: "invite",
    revoked: false,
  },
];

const SEED_COMMENTS: HandoverComment[] = [
  {
    id: "c1", handoverId: "h1", author: "Elias M.", role: "designer",
    body: "Hi team — the final design system is attached. Let me know if anything needs tweaking before we close this out.",
    fileId: null, created: "2023-10-15T14:02:00.000Z",
  },
  {
    id: "c2", handoverId: "h1", author: "Dana (Acme Corp)", role: "client",
    body: "This looks fantastic! One small thing on the concepts folder — can we get a lighter background variant?",
    fileId: "f2", created: "2023-10-16T09:20:00.000Z",
  },
];

const SEED_TASKS: VaultTask[] = [
  { id: "t1", projectId: "p1", title: "Finalize logo lockup variants", done: true, dueDate: "2026-08-10", assignee: "Elias M.", created: "2026-08-01" },
  { id: "t2", projectId: "p1", title: "Present brand guidelines to client", done: false, dueDate: "2026-09-20", assignee: "Elias M.", created: "2026-08-02" },
  { id: "t3", projectId: "p1", title: "Prep handoff package", done: false, dueDate: null, assignee: "Sarah K.", created: "2026-08-03" },
  { id: "t4", projectId: "p2", title: "Component library audit", done: true, dueDate: "2026-08-05", assignee: "Sarah K.", created: "2026-07-20" },
  { id: "t5", projectId: "p2", title: "Token naming review", done: false, dueDate: "2026-08-25", assignee: "Elias M.", created: "2026-07-22" },
  { id: "t6", projectId: "p3", title: "Draft campaign brief", done: false, dueDate: "2026-09-01", assignee: "John D.", created: "2026-08-05" },
];

const SEED_EVENTS: CalendarEvent[] = [
  { id: "e1", projectId: "p1", title: "Brand Kickoff", date: "2026-08-19", startTime: "14:00", endTime: "15:30", created: "2026-08-12" },
  { id: "e2", projectId: "p2", title: "UI Review", date: "2026-08-20", startTime: "10:00", endTime: null, created: "2026-08-12" },
  { id: "e3", projectId: "p3", title: "Campaign kickoff call", date: "2026-08-25", startTime: "11:00", endTime: "12:00", created: "2026-08-14" },
  { id: "e4", projectId: null, title: "Studio all-hands", date: "2026-08-28", startTime: null, endTime: null, created: "2026-08-14" },
];

const SEED_TEAM: TeamMember[] = [
  { id: "m1", name: "Elias M.", initials: "EM", role: "Founder & Creative Director", email: "elias@desboard.studio", color: "#D85E25" },
  { id: "m2", name: "Sarah K.", initials: "SK", role: "Design Lead", email: "sarah@desboard.studio", color: "#2F9463" },
  { id: "m3", name: "John D.", initials: "JD", role: "Marketing Lead", email: "john@desboard.studio", color: "#4C6B93" },
];

const SEED_CONVERSATIONS: Conversation[] = [
  { id: "cv1", title: "Nebula Inc.", linkedProjectId: "p1", linkedClient: "Nebula Inc.", linkedMemberId: null, created: "2026-08-10T09:00:00.000Z" },
  { id: "cv2", title: "Sarah K.", linkedProjectId: null, linkedClient: null, linkedMemberId: "m2", created: "2026-08-12T11:00:00.000Z" },
];

const SEED_MESSAGES: ConversationMessage[] = [
  { id: "cm1", conversationId: "cv1", author: "Elias M.", role: "me", body: "Hi! Sending over the updated logo lockups today — let me know what you think.", created: "2026-08-10T09:00:00.000Z" },
  { id: "cm2", conversationId: "cv1", author: "Priya (Nebula Inc.)", role: "them", body: "These look great, thank you! One question on the wordmark spacing — can we hop on a call this week?", created: "2026-08-10T13:22:00.000Z" },
  { id: "cm3", conversationId: "cv2", author: "Sarah K.", role: "them", body: "Component audit is done — a few tokens need renaming before we ship. Wrote it up in the design system doc.", created: "2026-08-12T11:05:00.000Z" },
  { id: "cm4", conversationId: "cv2", author: "Elias M.", role: "me", body: "Perfect, I'll take a pass this afternoon.", created: "2026-08-12T11:40:00.000Z" },
];

// --- Row <-> object mapping -------------------------------------------------

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface FileRow {
  id: string; workspace_id: string; name: string; type: string; extension: string | null; size: string | null;
  created: string | null; owner: string | null; source: string | null; status: string | null;
  project_id: number | null; client_id: string | null; tags: string; versions: string; access: string;
  mime: string | null; has_content: number; status_changed_at: string | null; parent_id: string | null;
  size_bytes: number;
}

function rowToFile(r: FileRow): VaultFile {
  return {
    id: r.id,
    name: r.name,
    type: r.type === "folder" ? "folder" : "file",
    extension: r.extension ?? undefined,
    size: r.size ?? undefined,
    created: r.created ?? "",
    owner: r.owner ?? "",
    source: r.source ?? "",
    status: (r.status as FileStatus) ?? "Draft",
    projectId: r.project_id,
    clientId: r.client_id,
    tags: parseJson<string[]>(r.tags, []),
    versions: parseJson<FileVersion[]>(r.versions, []),
    access: parseJson<string[]>(r.access, []),
    mime: r.mime ?? undefined,
    hasContent: r.has_content === 1,
    statusChangedAt: r.status_changed_at ?? undefined,
    parentId: r.parent_id,
    sizeBytes: r.size_bytes,
  };
}

interface ProjectRow {
  id: string; workspace_id: string; name: string; client: string | null; status: string | null; deadline: string | null;
  owner: string | null; team: string; tags: string; progress: number; linked: string;
}

function rowToProject(r: ProjectRow): ProjectFull {
  return {
    id: r.id,
    name: r.name,
    client: r.client ?? "",
    status: (r.status as ProjectStatus) ?? "Planning",
    deadline: r.deadline ?? "",
    owner: r.owner ?? "",
    team: parseJson<string[]>(r.team, []),
    tags: parseJson<string[]>(r.tags, []),
    progress: r.progress ?? 0,
    linked: parseJson<ProjectLinked>(r.linked, { files: 0, tasks: 0, messages: 0, handovers: 0 }),
  };
}

interface HandoverRow {
  id: string; workspace_id: string; project_id: string; title: string; recipient: string | null; client_name: string | null; client_email: string | null; note: string | null;
  status: string | null; file_ids: string; created: string | null; branding: string | null;
  token: string | null; access_mode: string | null; password_hash: string | null;
  expires_at: string | null; revoked: number; revoked_at: string | null; last_reminder_at: string | null;
}

function rowToHandover(r: HandoverRow): Handover {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    recipient: r.recipient ?? "",
    clientName: r.client_name ?? undefined,
    clientEmail: r.client_email ?? undefined,
    note: r.note ?? "",
    status: (r.status as HandoverStatus) ?? "Draft",
    fileIds: parseJson<string[]>(r.file_ids, []),
    created: r.created ?? "",
    branding: r.branding ? parseJson<HandoverBranding | undefined>(r.branding, undefined) : undefined,
    token: r.token ?? "",
    accessMode: r.access_mode === "password" || r.access_mode === "public" ? r.access_mode : "invite",
    passwordHash: r.password_hash,
    expiresAt: r.expires_at,
    revoked: r.revoked === 1,
    revokedAt: r.revoked_at,
    lastReminderAt: r.last_reminder_at,
  };
}

interface CommentRow {
  id: string; handover_id: string; author: string; role: string; body: string;
  file_id: string | null; x: number | null; y: number | null; timecode: number | null; version: string | null;
  created: string; internal_only: number;
}

function rowToComment(r: CommentRow): HandoverComment {
  return {
    id: r.id,
    handoverId: r.handover_id,
    author: r.author,
    role: r.role === "designer" ? "designer" : "client",
    body: r.body,
    fileId: r.file_id,
    x: r.x,
    y: r.y,
    timecode: r.timecode,
    version: r.version,
    created: r.created,
    internalOnly: r.internal_only === 1,
  };
}

interface TaskRow {
  id: string; workspace_id: string; project_id: string; title: string; done: number;
  due_date: string | null; assignee: string | null; created: string | null;
}

function rowToTask(r: TaskRow): VaultTask {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    done: r.done === 1,
    dueDate: r.due_date,
    assignee: r.assignee,
    created: r.created ?? "",
  };
}

interface EventRow {
  id: string; workspace_id: string; project_id: string | null; title: string; date: string;
  start_time: string | null; end_time: string | null; created: string | null;
}

function rowToEvent(r: EventRow): CalendarEvent {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    created: r.created ?? "",
  };
}

interface TeamMemberRow {
  id: string; workspace_id: string; name: string; initials: string; role: string | null; email: string | null; color: string;
}

function rowToTeamMember(r: TeamMemberRow): TeamMember {
  return { id: r.id, name: r.name, initials: r.initials, role: r.role, email: r.email, color: r.color || "#8C897F" };
}

interface ConversationRow {
  id: string; workspace_id: string; title: string; linked_project_id: string | null; linked_client: string | null;
  linked_member_id: string | null; created: string | null;
}

function rowToConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    linkedProjectId: r.linked_project_id,
    linkedClient: r.linked_client,
    linkedMemberId: r.linked_member_id,
    created: r.created ?? "",
  };
}

interface MessageRow {
  id: string; conversation_id: string; author: string; role: string; body: string; created: string;
}

function rowToMessage(r: MessageRow): ConversationMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    author: r.author,
    role: r.role === "them" ? "them" : "me",
    body: r.body,
    created: r.created,
  };
}

interface SettingsRow {
  workspace_id: string;
  studio_name: string | null;
  default_owner: string | null;
  logo_url: string | null;
  brand_accent: string | null;
  brand_theme: string | null;
  brand_template: string | null;
}

function rowToSettings(r: Partial<SettingsRow>): StudioSettings {
  return {
    studioName: r.studio_name ?? "",
    defaultOwner: r.default_owner ?? "",
    logoUrl: r.logo_url ?? undefined,
    brandAccent: r.brand_accent ?? "#2c2c2e",
    brandTheme: r.brand_theme === "dark" ? "dark" : "light",
    brandTemplate: HANDOVER_TEMPLATES.includes((r.brand_template ?? "") as HandoverTemplate)
      ? (r.brand_template as HandoverTemplate)
      : "editorial",
  };
}

// --- Write helpers ----------------------------------------------------------

const insertFileStmt = db.prepare(`
  INSERT OR REPLACE INTO files
    (id, workspace_id, name, type, extension, size, created, owner, source, status, project_id, client_id, tags, versions, access, mime, has_content, status_changed_at, parent_id, size_bytes, ord)
  VALUES
    (@id, @workspace_id, @name, @type, @extension, @size, @created, @owner, @source, @status, @project_id, @client_id, @tags, @versions, @access, @mime, @has_content, @status_changed_at, @parent_id, @size_bytes, @ord)
`);

function writeFile(file: VaultFile, ord: number, workspaceId: string) {
  insertFileStmt.run({
    id: file.id,
    workspace_id: workspaceId,
    name: file.name,
    type: file.type,
    extension: file.extension ?? null,
    size: file.size ?? null,
    created: file.created ?? null,
    owner: file.owner ?? null,
    source: file.source ?? null,
    status: file.status ?? "Draft",
    project_id: file.projectId ?? null,
    client_id: file.clientId ?? null,
    tags: JSON.stringify(file.tags ?? []),
    versions: JSON.stringify(file.versions ?? []),
    access: JSON.stringify(file.access ?? []),
    mime: file.mime ?? null,
    has_content: file.hasContent ? 1 : 0,
    status_changed_at: file.statusChangedAt ?? null,
    parent_id: file.parentId ?? null,
    size_bytes: file.sizeBytes ?? 0,
    ord,
  });
}

const insertProjectStmt = db.prepare(`
  INSERT OR REPLACE INTO projects
    (id, workspace_id, name, client, status, deadline, owner, team, tags, progress, linked, ord)
  VALUES
    (@id, @workspace_id, @name, @client, @status, @deadline, @owner, @team, @tags, @progress, @linked, @ord)
`);

function writeProject(p: ProjectFull, ord: number, workspaceId: string) {
  insertProjectStmt.run({
    id: p.id,
    workspace_id: workspaceId,
    name: p.name,
    client: p.client ?? null,
    status: p.status ?? "Planning",
    deadline: p.deadline ?? null,
    owner: p.owner ?? null,
    team: JSON.stringify(p.team ?? []),
    tags: JSON.stringify(p.tags ?? []),
    progress: p.progress ?? 0,
    linked: JSON.stringify(p.linked ?? { files: 0, tasks: 0, messages: 0, handovers: 0 }),
    ord,
  });
}

const insertTagStmt = db.prepare(`INSERT OR IGNORE INTO tags (workspace_id, name) VALUES (?, ?)`);
export function addTag(name: string, workspaceId: string) {
  const clean = name.trim();
  if (clean) insertTagStmt.run(workspaceId, clean);
}

const insertHandoverStmt = db.prepare(`
  INSERT OR REPLACE INTO handovers
    (id, workspace_id, project_id, title, recipient, client_name, client_email, note, status, file_ids, created, branding,
     token, access_mode, password_hash, expires_at, revoked, revoked_at, last_reminder_at, ord)
  VALUES
    (@id, @workspace_id, @project_id, @title, @recipient, @client_name, @client_email, @note, @status, @file_ids, @created, @branding,
     @token, @access_mode, @password_hash, @expires_at, @revoked, @revoked_at, @last_reminder_at, @ord)
`);

function writeHandover(h: Handover, ord: number, workspaceId: string) {
  insertHandoverStmt.run({
    id: h.id,
    workspace_id: workspaceId,
    project_id: h.projectId,
    title: h.title,
    recipient: h.recipient ?? null,
    client_name: h.clientName ?? null,
    client_email: h.clientEmail ?? null,
    note: h.note ?? null,
    status: h.status ?? "Draft",
    file_ids: JSON.stringify(h.fileIds ?? []),
    created: h.created ?? null,
    branding: h.branding ? JSON.stringify(h.branding) : null,
    token: h.token && h.token.length > 0 ? h.token : makePortalToken(),
    access_mode: h.accessMode ?? "invite",
    password_hash: h.passwordHash ?? null,
    expires_at: h.expiresAt ?? null,
    revoked: h.revoked ? 1 : 0,
    revoked_at: h.revokedAt ?? null,
    last_reminder_at: h.lastReminderAt ?? null,
    ord,
  });
}

const insertCommentStmt = db.prepare(`
  INSERT OR REPLACE INTO handover_comments (id, handover_id, author, role, body, file_id, x, y, timecode, version, created, internal_only)
  VALUES (@id, @handover_id, @author, @role, @body, @file_id, @x, @y, @timecode, @version, @created, @internal_only)
`);

function writeComment(c: HandoverComment) {
  insertCommentStmt.run({
    id: c.id,
    handover_id: c.handoverId,
    author: c.author,
    role: c.role === "designer" ? "designer" : "client",
    body: c.body,
    file_id: c.fileId ?? null,
    x: typeof c.x === "number" ? c.x : null,
    y: typeof c.y === "number" ? c.y : null,
    timecode: typeof c.timecode === "number" ? c.timecode : null,
    version: c.version ?? null,
    created: c.created,
    internal_only: c.internalOnly ? 1 : 0,
  });
}

// Idempotent on (status, version): re-submitting the same status for the same
// file version is a no-op that keeps the original timestamp. Anything that
// actually changes (approved -> changes_requested, or a newer version being
// reviewed) updates the row in place — one current status per file, with the
// row's own history implicitly bounded to "since the last real change".
const setReviewStatusStmt = db.prepare(`
  INSERT INTO handover_approvals (handover_id, file_id, status, approved_by, approved_at, version)
  VALUES (@handover_id, @file_id, @status, @approved_by, @approved_at, @version)
  ON CONFLICT(handover_id, file_id) DO UPDATE SET
    status = excluded.status,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    version = excluded.version
  WHERE handover_approvals.status IS NOT excluded.status OR handover_approvals.version IS NOT excluded.version
`);

const upsertSettingsStmt = db.prepare(`
  INSERT INTO settings (workspace_id, studio_name, default_owner, logo_url, brand_accent, brand_theme, brand_template)
  VALUES (@workspace_id, @studio_name, @default_owner, @logo_url, @brand_accent, @brand_theme, @brand_template)
  ON CONFLICT(workspace_id) DO UPDATE SET
    studio_name = @studio_name, default_owner = @default_owner, logo_url = @logo_url,
    brand_accent = @brand_accent, brand_theme = @brand_theme, brand_template = @brand_template
`);

function writeSettings(s: StudioSettings, workspaceId: string) {
  upsertSettingsStmt.run({
    workspace_id: workspaceId,
    studio_name: s.studioName ?? null,
    default_owner: s.defaultOwner ?? null,
    logo_url: s.logoUrl ?? null,
    brand_accent: s.brandAccent ?? null,
    brand_theme: s.brandTheme ?? null,
    brand_template: s.brandTemplate ?? null,
  });
}

const insertTaskStmt = db.prepare(`
  INSERT OR REPLACE INTO tasks (id, workspace_id, project_id, title, done, due_date, assignee, created, ord)
  VALUES (@id, @workspace_id, @project_id, @title, @done, @due_date, @assignee, @created, @ord)
`);

function writeTask(t: VaultTask, ord: number, workspaceId: string) {
  insertTaskStmt.run({
    id: t.id,
    workspace_id: workspaceId,
    project_id: t.projectId,
    title: t.title,
    done: t.done ? 1 : 0,
    due_date: t.dueDate ?? null,
    assignee: t.assignee ?? null,
    created: t.created ?? null,
    ord,
  });
}

const insertEventStmt = db.prepare(`
  INSERT OR REPLACE INTO events (id, workspace_id, project_id, title, date, start_time, end_time, created, ord)
  VALUES (@id, @workspace_id, @project_id, @title, @date, @start_time, @end_time, @created, @ord)
`);

function writeEvent(e: CalendarEvent, ord: number, workspaceId: string) {
  insertEventStmt.run({
    id: e.id,
    workspace_id: workspaceId,
    project_id: e.projectId ?? null,
    title: e.title,
    date: e.date,
    start_time: e.startTime ?? null,
    end_time: e.endTime ?? null,
    created: e.created ?? null,
    ord,
  });
}

const insertTeamMemberStmt = db.prepare(`
  INSERT OR REPLACE INTO team_members (id, workspace_id, name, initials, role, email, color, ord)
  VALUES (@id, @workspace_id, @name, @initials, @role, @email, @color, @ord)
`);

function writeTeamMember(m: TeamMember, ord: number, workspaceId: string) {
  insertTeamMemberStmt.run({
    id: m.id,
    workspace_id: workspaceId,
    name: m.name,
    initials: m.initials,
    role: m.role ?? null,
    email: m.email ?? null,
    color: m.color || "#8C897F",
    ord,
  });
}

const insertConversationStmt = db.prepare(`
  INSERT OR REPLACE INTO conversations (id, workspace_id, title, linked_project_id, linked_client, linked_member_id, created, ord)
  VALUES (@id, @workspace_id, @title, @linked_project_id, @linked_client, @linked_member_id, @created, @ord)
`);

function writeConversation(c: Conversation, ord: number, workspaceId: string) {
  insertConversationStmt.run({
    id: c.id,
    workspace_id: workspaceId,
    title: c.title,
    linked_project_id: c.linkedProjectId ?? null,
    linked_client: c.linkedClient ?? null,
    linked_member_id: c.linkedMemberId ?? null,
    created: c.created ?? null,
    ord,
  });
}

const insertMessageStmt = db.prepare(`
  INSERT OR REPLACE INTO messages (id, conversation_id, author, role, body, created)
  VALUES (@id, @conversation_id, @author, @role, @body, @created)
`);

function writeMessage(m: ConversationMessage) {
  insertMessageStmt.run({
    id: m.id,
    conversation_id: m.conversationId,
    author: m.author,
    role: m.role === "them" ? "them" : "me",
    body: m.body,
    created: m.created,
  });
}

// --- Seed (only if empty for the given workspace) ---------------------------

function seedIfEmpty(workspaceId: string) {
  const fileCount = (db.prepare(`SELECT COUNT(*) AS n FROM files WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (fileCount === 0) {
    // Seeds keep their prototype order; later uploads (with a larger `ord`)
    // sort ahead of them.
    SEED_FILES.forEach((f, i) => writeFile(f, 1000 - i, workspaceId));
    SEED_PROJECTS.forEach((p, i) => writeProject(p, 1000 - i, workspaceId));
    const tagNames = new Set<string>();
    SEED_FILES.forEach((f) => f.tags.forEach((t) => tagNames.add(t)));
    SEED_PROJECTS.forEach((p) => p.tags.forEach((t) => tagNames.add(t)));
    tagNames.forEach((t) => addTag(t, workspaceId));
    console.log(`[db] Seeded ${SEED_FILES.length} files, ${SEED_PROJECTS.length} projects, ${tagNames.size} tags.`);
  }
}

// Handovers are seeded independently so they still appear on databases created
// before this feature existed.
function seedHandoversIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM handovers WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    SEED_HANDOVERS.forEach((h, i) => writeHandover(h, 1000 - i, workspaceId));
    console.log(`[db] Seeded ${SEED_HANDOVERS.length} handover(s).`);
  }
}

// Comments are seeded independently for the same reason as handovers. Scoped
// implicitly through their (already workspace-scoped) parent handover.
function seedCommentsIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM handover_comments`).get() as { n: number }).n;
  if (n === 0) {
    SEED_COMMENTS.forEach((c) => writeComment(c));
    console.log(`[db] Seeded ${SEED_COMMENTS.length} handover comment(s).`);
  }
}

// Settings is seeded independently for the same reason as handovers. The
// seeded studio name matches handoverPage.ts's own hardcoded fallback, so
// seeding it changes nothing visible until the user actually edits Settings.
function seedSettingsIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    writeSettings({ studioName: "Desboard Studio", defaultOwner: "You", brandAccent: "#D85E25", brandTheme: "dark", brandTemplate: "editorial" }, workspaceId);
    console.log("[db] Seeded studio settings.");
  }
}

// Tasks are seeded independently for the same reason as handovers.
function seedTasksIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    SEED_TASKS.forEach((t, i) => writeTask(t, 1000 - i, workspaceId));
    console.log(`[db] Seeded ${SEED_TASKS.length} task(s).`);
  }
}

// Events are seeded independently for the same reason as handovers.
function seedEventsIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    SEED_EVENTS.forEach((e, i) => writeEvent(e, 1000 - i, workspaceId));
    console.log(`[db] Seeded ${SEED_EVENTS.length} event(s).`);
  }
}

// Team is seeded independently for the same reason as handovers.
function seedTeamIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM team_members WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    SEED_TEAM.forEach((m, i) => writeTeamMember(m, 1000 - i, workspaceId));
    console.log(`[db] Seeded ${SEED_TEAM.length} team member(s).`);
  }
}

// Conversations/messages are seeded independently for the same reason as handovers.
function seedConversationsIfEmpty(workspaceId: string) {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE workspace_id = ?`).get(workspaceId) as { n: number }).n;
  if (n === 0) {
    SEED_CONVERSATIONS.forEach((c, i) => writeConversation(c, 1000 - i, workspaceId));
    console.log(`[db] Seeded ${SEED_CONVERSATIONS.length} conversation(s).`);
  }
}

function seedMessagesIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number }).n;
  if (n === 0) {
    SEED_MESSAGES.forEach((m) => writeMessage(m));
    console.log(`[db] Seeded ${SEED_MESSAGES.length} message(s).`);
  }
}

// Only actually inserts anything if these tables were empty to begin with (a
// truly fresh database) — on an upgrade, the migration block's backfill
// already populated them, so every seed*IfEmpty() call here is a safe no-op.
if (pendingBootstrapWorkspaceId) {
  seedIfEmpty(pendingBootstrapWorkspaceId);
  seedHandoversIfEmpty(pendingBootstrapWorkspaceId);
  seedCommentsIfEmpty();
  seedSettingsIfEmpty(pendingBootstrapWorkspaceId);
  seedTasksIfEmpty(pendingBootstrapWorkspaceId);
  seedEventsIfEmpty(pendingBootstrapWorkspaceId);
  seedTeamIfEmpty(pendingBootstrapWorkspaceId);
  seedConversationsIfEmpty(pendingBootstrapWorkspaceId);
  seedMessagesIfEmpty();
}

// --- Auth: workspaces & users -------------------------------------------------

export interface WorkspaceRecord {
  id: string;
  name: string;
  created: string;
}

export function createWorkspace(name: string): WorkspaceRecord {
  const id = crypto.randomUUID();
  const created = new Date().toISOString();
  // plan_tier takes its SQL-level DEFAULT ('trial'); trial_ends_at is stamped
  // explicitly here since a new workspace's first boot may be well after the
  // migration block above last ran (that block only backfills rows that
  // predate this feature, not ones created afterward).
  const trialEndsAt = new Date(Date.now() + TRIAL_MS).toISOString();
  db.prepare(`INSERT INTO workspaces (id, name, created, trial_ends_at) VALUES (?, ?, ?, ?)`).run(id, name, created, trialEndsAt);
  // Without this, Settings -> Studio profile's "Studio name" field starts
  // blank even though the workspace itself is already named — the studio
  // name typed at signup would otherwise never reach handover branding
  // until someone happens to retype it in Settings.
  writeSettings({ studioName: name, defaultOwner: "", brandAccent: "#2c2c2e", brandTheme: "light", brandTemplate: "editorial" }, id);
  return { id, name, created };
}

/** For the background reminder sweep, which has to check every workspace, not one at a time from a request. */
export function getAllWorkspaceIds(): string[] {
  return (db.prepare(`SELECT id FROM workspaces`).all() as { id: string }[]).map((r) => r.id);
}

interface WorkspaceBillingSqlRow {
  plan_tier: PlanTier;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  plan_interval: "month" | "year" | null;
  seats: number;
  storage_addon_units: number;
  current_period_end: string | null;
  cancel_at_period_end: number;
}

function getWorkspaceBillingRow(workspaceId: string): WorkspaceBillingSqlRow | undefined {
  return db
    .prepare(
      `SELECT plan_tier, trial_ends_at, stripe_customer_id, stripe_subscription_id, subscription_status,
              plan_interval, seats, storage_addon_units, current_period_end, cancel_at_period_end
       FROM workspaces WHERE id = ?`
    )
    .get(workspaceId) as WorkspaceBillingSqlRow | undefined;
}

function toBillingCoreRow(row: WorkspaceBillingSqlRow): WorkspaceBillingRow {
  return {
    planTier: row.plan_tier,
    trialEndsAt: row.trial_ends_at,
    subscriptionStatus: row.subscription_status,
    planInterval: row.plan_interval,
    seats: row.seats,
    storageAddonUnits: row.storage_addon_units,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
  };
}

/**
 * The one function every gating check (and BillingGate) calls to learn what
 * a workspace is currently entitled to. A missing row (shouldn't happen —
 * every workspace gets billing defaults at creation) fails closed as an
 * expired trial rather than throwing, so a gate can never accidentally grant
 * access on a lookup miss.
 */
export function getEffectiveTier(workspaceId: string): EffectiveTier {
  const row = getWorkspaceBillingRow(workspaceId);
  if (!row) return computeEffectiveTier({ planTier: "trial", trialEndsAt: new Date(0).toISOString(), subscriptionStatus: null, planInterval: null, seats: 1, storageAddonUnits: 0, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  return computeEffectiveTier(toBillingCoreRow(row));
}

/** Raw billing fields for the /api/billing/status response — everything getEffectiveTier's caller needs to also show, beyond just the computed entitlement. */
export function getWorkspaceBillingInfo(workspaceId: string): WorkspaceBillingRow & { hasStripeCustomer: boolean } {
  const row = getWorkspaceBillingRow(workspaceId);
  if (!row) {
    return { planTier: "trial", trialEndsAt: null, subscriptionStatus: null, planInterval: null, seats: 1, storageAddonUnits: 0, currentPeriodEnd: null, cancelAtPeriodEnd: false, hasStripeCustomer: false };
  }
  return { ...toBillingCoreRow(row), hasStripeCustomer: !!row.stripe_customer_id };
}

export function getWorkspaceStripeCustomerId(workspaceId: string): string | null {
  const row = db.prepare(`SELECT stripe_customer_id FROM workspaces WHERE id = ?`).get(workspaceId) as { stripe_customer_id: string | null } | undefined;
  return row?.stripe_customer_id ?? null;
}

export function setWorkspaceStripeCustomerId(workspaceId: string, stripeCustomerId: string): void {
  db.prepare(`UPDATE workspaces SET stripe_customer_id = ? WHERE id = ?`).run(stripeCustomerId, workspaceId);
}

/** Fallback lookup for webhook events — the primary path is the workspaceId already embedded in the subscription's own metadata (set at checkout time), this is only for the rare case that's missing. */
export function getWorkspaceIdByStripeCustomerId(stripeCustomerId: string): string | null {
  const row = db.prepare(`SELECT id FROM workspaces WHERE stripe_customer_id = ?`).get(stripeCustomerId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Applies a Stripe subscription's state to a workspace. Called from exactly
 * one place: the signature-verified webhook handler in server/billing.ts.
 *
 * DELIBERATELY not wired to any route that forwards req.body — every other
 * `update*` in this file merge-patches a client-supplied patch object
 * straight into the row (see updateFile/updateHandover), which is exactly
 * the wrong shape here: a signed-in user must never be able to influence
 * their own plan_tier, or they could grant themselves Studio for free.
 */
export function updateWorkspaceBilling(
  workspaceId: string,
  patch: Partial<{
    planTier: PlanTier;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    subscriptionStatus: string | null;
    planInterval: "month" | "year" | null;
    seats: number;
    storageAddonUnits: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    plan_tier: patch.planTier,
    stripe_customer_id: patch.stripeCustomerId,
    stripe_subscription_id: patch.stripeSubscriptionId,
    subscription_status: patch.subscriptionStatus,
    plan_interval: patch.planInterval,
    seats: patch.seats,
    storage_addon_units: patch.storageAddonUnits,
    current_period_end: patch.currentPeriodEnd,
    cancel_at_period_end: patch.cancelAtPeriodEnd === undefined ? undefined : patch.cancelAtPeriodEnd ? 1 : 0,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(val);
  }
  if (sets.length === 0) return;
  values.push(workspaceId);
  db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** Sum of current-version file bytes for a workspace — see files.size_bytes's migration comment for why this exists alongside the display-formatted `size` column. */
export function getWorkspaceStorageBytes(workspaceId: string): number {
  const row = db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE workspace_id = ?`).get(workspaceId) as { total: number };
  return row.total;
}

/** "Active" = actually shared with a client, not still-in-prep — every handover starts as Draft (see HandoverPanel.tsx's handleCreate). */
export function getActiveHandoverCount(workspaceId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM handovers WHERE workspace_id = ? AND revoked = 0 AND status IN ('Sent','Accepted')`)
    .get(workspaceId) as { n: number };
  return row.n;
}

export function getWorkspaceMemberCount(workspaceId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE workspace_id = ?`).get(workspaceId) as { n: number };
  return row.n;
}

/**
 * Idempotent webhook-delivery claim: Stripe guarantees at-least-once
 * delivery (retries, manual "Resend" from the Dashboard both redeliver the
 * same event id). Returns true the first time an event id is seen (caller
 * should process it), false on every redelivery (caller should ack 200 and
 * no-op) — same INSERT-OR-IGNORE-and-check-.changes idiom linkOAuthIdentity
 * already uses for the same class of problem.
 */
export function claimStripeEvent(eventId: string, type: string): boolean {
  const result = db
    .prepare(`INSERT OR IGNORE INTO stripe_events (id, type, received) VALUES (?, ?, ?)`)
    .run(eventId, type, new Date().toISOString());
  return result.changes > 0;
}

/** A user record including the password hash — only for internal auth checks, never returned to a route response as-is. */
export interface AuthUserRecord {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  name: string | null;
  passwordHash: string;
  role: WorkspaceRole;
}

interface UserJoinRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
}

function rowToAuthUser(r: UserJoinRow): AuthUserRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    role: r.role === "member" ? "member" : "owner",
  };
}

const USER_SELECT = `SELECT u.*, w.name AS workspace_name FROM users u JOIN workspaces w ON w.id = u.workspace_id`;

/** `role` defaults to 'owner' — every normal signup/SSO login creates its own new workspace, so the creator is always its owner. Invite acceptance explicitly passes 'member'. */
export function createUser(params: {
  workspaceId: string;
  email: string;
  passwordHash: string;
  name?: string;
  role?: WorkspaceRole;
}): AuthUserRecord {
  const id = crypto.randomUUID();
  const created = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, workspace_id, email, password_hash, name, role, created) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    params.workspaceId,
    params.email,
    params.passwordHash,
    params.name ?? null,
    params.role ?? "owner",
    created
  );
  return getUserById(id)!;
}

export function getUserByEmail(email: string): AuthUserRecord | undefined {
  const row = db.prepare(`${USER_SELECT} WHERE u.email = ?`).get(email) as UserJoinRow | undefined;
  return row ? rowToAuthUser(row) : undefined;
}

export function getUserById(id: string): AuthUserRecord | undefined {
  const row = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserJoinRow | undefined;
  return row ? rowToAuthUser(row) : undefined;
}

// --- Team & invites -----------------------------------------------------------

export function getWorkspaceMembers(workspaceId: string): WorkspaceMember[] {
  const rows = db
    .prepare(`SELECT id, email, name, role, created FROM users WHERE workspace_id = ? ORDER BY created ASC`)
    .all(workspaceId) as { id: string; email: string; name: string | null; role: string; created: string }[];
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role === "member" ? "member" : "owner", created: r.created }));
}

interface InviteRow {
  token: string;
  workspace_id: string;
  email: string | null;
  role: string;
  created_by: string | null;
  created: string;
  accepted_at: string | null;
  revoked: number;
}

/** Unguessable, URL-safe invite token — same shape as a portal token, deliberately, since it's the same class of "possession is the credential" link. */
function makeInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function createInvite(workspaceId: string, params: { email?: string | null; role?: WorkspaceRole; createdBy?: string }): PendingInvite {
  const token = makeInviteToken();
  const created = new Date().toISOString();
  const role: WorkspaceRole = params.role === "owner" ? "owner" : "member";
  db.prepare(`INSERT INTO invites (token, workspace_id, email, role, created_by, created) VALUES (?, ?, ?, ?, ?, ?)`).run(
    token,
    workspaceId,
    params.email?.trim().toLowerCase() || null,
    role,
    params.createdBy ?? null,
    created
  );
  return { token, email: params.email?.trim().toLowerCase() || null, role, created };
}

export function getPendingInvites(workspaceId: string): PendingInvite[] {
  const rows = db
    .prepare(`SELECT token, email, role, created FROM invites WHERE workspace_id = ? AND accepted_at IS NULL AND revoked = 0 ORDER BY created DESC`)
    .all(workspaceId) as { token: string; email: string | null; role: string; created: string }[];
  return rows.map((r) => ({ token: r.token, email: r.email, role: r.role === "owner" ? "owner" : "member", created: r.created }));
}

/** Not workspace-scoped by design — the /join/:token page is reached by an unauthenticated visitor who has only the token, the same trust model as the portal's own tokens. */
export function getInviteByToken(token: string): (InviteRow & { workspaceName: string }) | undefined {
  const row = db
    .prepare(
      `SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?`
    )
    .get(token) as (InviteRow & { workspace_name: string }) | undefined;
  if (!row) return undefined;
  return { ...row, workspaceName: row.workspace_name };
}

export function markInviteAccepted(token: string): void {
  db.prepare(`UPDATE invites SET accepted_at = ? WHERE token = ?`).run(new Date().toISOString(), token);
}

export function revokeInvite(token: string, workspaceId: string): boolean {
  const info = db.prepare(`UPDATE invites SET revoked = 1 WHERE token = ? AND workspace_id = ?`).run(token, workspaceId);
  return info.changes > 0;
}

export interface OAuthIdentityRecord {
  provider: string;
  providerUserId: string;
  userId: string;
  email: string | null;
  created: string;
}

export function getOAuthIdentity(provider: string, providerUserId: string): OAuthIdentityRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?`)
    .get(provider, providerUserId) as
    | { provider: string; provider_user_id: string; user_id: string; email: string | null; created: string }
    | undefined;
  if (!row) return undefined;
  return { provider: row.provider, providerUserId: row.provider_user_id, userId: row.user_id, email: row.email, created: row.created };
}

/** Idempotent — a duplicate/replayed callback for the same identity is a silent no-op. */
export function linkOAuthIdentity(provider: string, providerUserId: string, userId: string, email: string | null): void {
  db.prepare(
    `INSERT OR IGNORE INTO oauth_identities (provider, provider_user_id, user_id, email, created) VALUES (?, ?, ?, ?, ?)`
  ).run(provider, providerUserId, userId, email, new Date().toISOString());
}

// --- Public query API -------------------------------------------------------

export function getFiles(workspaceId: string): VaultFile[] {
  const rows = db.prepare(`SELECT * FROM files WHERE workspace_id = ? ORDER BY ord DESC`).all(workspaceId) as FileRow[];
  return rows.map(rowToFile);
}

export function getFileById(id: string, workspaceId: string): VaultFile | undefined {
  const row = db.prepare(`SELECT * FROM files WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as FileRow | undefined;
  return row ? rowToFile(row) : undefined;
}

/**
 * Portal-only: files by id, unscoped by workspace. Safe because the only
 * caller (the client portal) exclusively passes a handover's own `fileIds`
 * allowlist, which was set by that handover's own workspace when it was
 * created — the portal has no other path to a file id. Everywhere else in
 * the app must go through the workspace-scoped `getFileById`/`getFiles`.
 */
export function getFilesByIds(ids: string[]): VaultFile[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...ids) as FileRow[];
  return rows.map(rowToFile);
}

export function createFile(file: VaultFile, workspaceId: string): VaultFile {
  writeFile(file, Date.now(), workspaceId);
  file.tags.forEach((t) => addTag(t, workspaceId));
  return getFileById(file.id, workspaceId)!;
}

/** Update a subset of a file's fields (project move, tag edits, status, etc.). */
export function updateFile(id: string, patch: Partial<VaultFile>, workspaceId: string): VaultFile | undefined {
  const existing = getFileById(id, workspaceId);
  if (!existing) return undefined;
  const merged: VaultFile = { ...existing, ...patch, id };
  if (patch.status !== undefined && patch.status !== existing.status) {
    merged.statusChangedAt = new Date().toISOString();
  }
  // Preserve the existing sort position on update.
  const ordRow = db.prepare(`SELECT ord FROM files WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeFile(merged, ordRow.ord, workspaceId);
  merged.tags.forEach((t) => addTag(t, workspaceId));
  return getFileById(id, workspaceId);
}

/**
 * Deletes one file/folder row. Deleting a folder never destroys what's inside
 * it — its direct children are re-parented up to the folder's own parent
 * (or the root, if it had none), the same way deleting a directory's entry
 * without `-r` would leave its contents in place one level up.
 */
export function deleteFile(id: string, workspaceId: string): boolean {
  const existing = getFileById(id, workspaceId);
  if (!existing) return false;
  if (existing.type === "folder") {
    const children = db.prepare(`SELECT id FROM files WHERE parent_id = ? AND workspace_id = ?`).all(id, workspaceId) as { id: string }[];
    const reparent = db.prepare(`UPDATE files SET parent_id = ? WHERE id = ? AND workspace_id = ?`);
    children.forEach((c) => reparent.run(existing.parentId ?? null, c.id, workspaceId));
  }
  const info = db.prepare(`DELETE FROM files WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

export function getProjects(workspaceId: string): ProjectFull[] {
  const rows = db.prepare(`SELECT * FROM projects WHERE workspace_id = ? ORDER BY ord DESC`).all(workspaceId) as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProjectById(id: string, workspaceId: string): ProjectFull | undefined {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as ProjectRow | undefined;
  return row ? rowToProject(row) : undefined;
}

export function createProject(p: ProjectFull, workspaceId: string): ProjectFull {
  writeProject(p, Date.now(), workspaceId);
  p.tags.forEach((t) => addTag(t, workspaceId));
  return p;
}

/** Update a subset of a project's fields (edit form, status cycling, progress). */
export function updateProject(id: string, patch: Partial<ProjectFull>, workspaceId: string): ProjectFull | undefined {
  const existing = getProjectById(id, workspaceId);
  if (!existing) return undefined;
  const merged: ProjectFull = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM projects WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeProject(merged, ordRow.ord, workspaceId);
  merged.tags.forEach((t) => addTag(t, workspaceId));
  return getProjectById(id, workspaceId);
}

export function getTags(workspaceId: string): Tag[] {
  return db.prepare(`SELECT id, name FROM tags WHERE workspace_id = ? ORDER BY name ASC`).all(workspaceId) as Tag[];
}

export function getHandovers(workspaceId: string, projectId?: string): Handover[] {
  const rows = projectId
    ? (db.prepare(`SELECT * FROM handovers WHERE workspace_id = ? AND project_id = ? ORDER BY ord DESC`).all(workspaceId, projectId) as HandoverRow[])
    : (db.prepare(`SELECT * FROM handovers WHERE workspace_id = ? ORDER BY ord DESC`).all(workspaceId) as HandoverRow[]);
  return rows.map(rowToHandover);
}

export function getHandoverById(id: string, workspaceId: string): Handover | undefined {
  const row = db.prepare(`SELECT * FROM handovers WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as HandoverRow | undefined;
  return row ? rowToHandover(row) : undefined;
}

/** True once a file carries any tag starting with "Client" — the only ones the portal treats as client-visible. */
export function isClientVisible(access: string[]): boolean {
  return access.some((a) => a.startsWith("Client"));
}

/**
 * A file only reaches the client portal if it's explicitly tagged client-visible
 * (see isClientVisible / the portal's filesOf filter) — so the moment a file is
 * put into a handover, it's tagged automatically. This is what makes "Access
 * Control" tags a real, enforced permission instead of decoration: adding a
 * file to a delivery is the one action that's supposed to make it client-facing,
 * so that's exactly when the tag gets set. Removing the tag afterward (from the
 * file's own Access Control list) genuinely revokes it from every portal it's
 * in — nothing here re-adds it.
 */
function ensureClientVisible(fileIds: string[], workspaceId: string): void {
  for (const fileId of fileIds) {
    const file = getFileById(fileId, workspaceId);
    if (file && !isClientVisible(file.access)) {
      updateFile(fileId, { access: [...file.access, "Client (Read-only)"] }, workspaceId);
    }
  }
}

export function createHandover(h: Handover, workspaceId: string): Handover {
  writeHandover(h, Date.now(), workspaceId);
  ensureClientVisible(h.fileIds, workspaceId);
  return getHandoverById(h.id, workspaceId)!;
}

export function updateHandover(id: string, patch: Partial<Handover>, workspaceId: string): Handover | undefined {
  const existing = getHandoverById(id, workspaceId);
  if (!existing) return undefined;
  const merged: Handover = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM handovers WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeHandover(merged, ordRow.ord, workspaceId);
  if (patch.fileIds) ensureClientVisible(patch.fileIds, workspaceId);
  return getHandoverById(id, workspaceId);
}

export function deleteHandover(id: string, workspaceId: string): boolean {
  const info = db.prepare(`DELETE FROM handovers WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

/**
 * The ONLY lookup the portal surface may use: by unguessable token. There is
 * deliberately no workspace parameter and no portal-side path from a
 * handover to its project, its workspace, or any other handover.
 */
export function getHandoverByToken(token: string): Handover | undefined {
  if (!token) return undefined;
  const row = db.prepare(`SELECT * FROM handovers WHERE token = ?`).get(token) as HandoverRow | undefined;
  return row ? rowToHandover(row) : undefined;
}

/**
 * Recent portal visitor activity for the studio's dashboard feed — joined with
 * handover titles and, for comments, the author's name. Denials are audit-only
 * and excluded here. Scoped to the caller's workspace via the handovers join.
 */
export function getPortalActivity(workspaceId: string, limit = 12): PortalActivityItem[] {
  return db
    .prepare(
      `SELECT pe.id, pe.event, pe.detail, pe.created,
              pe.handover_id AS handoverId, h.title AS handoverTitle, h.project_id AS projectId,
              hc.author AS commentAuthor
       FROM portal_events pe
       JOIN handovers h ON h.id = pe.handover_id
       LEFT JOIN handover_comments hc ON hc.id = pe.detail AND pe.event = 'comment'
       WHERE pe.event IN ('view', 'download', 'comment', 'granted') AND h.workspace_id = ?
       ORDER BY pe.id DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as PortalActivityItem[];
}

/** Audit-trail entry for a portal visitor action (view / download / comment / denied). */
export function logPortalEvent(e: {
  handoverId: string;
  sessionId?: string | null;
  event: string;
  detail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  db.prepare(
    `INSERT INTO portal_events (handover_id, session_id, event, detail, ip, user_agent, created)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.handoverId,
    e.sessionId ?? null,
    e.event,
    e.detail ?? null,
    e.ip ?? null,
    (e.userAgent ?? "").slice(0, 300) || null,
    new Date().toISOString()
  );
}

/** Append an assistant usage event (question volume / suggestion click-through), tagged by workspace for future per-tenant AI cost metering. */
export function logAssistantMetric(workspaceId: string, event: string, detail?: string) {
  db.prepare(`INSERT INTO assistant_metrics (workspace_id, event, detail, created) VALUES (?, ?, ?, ?)`).run(
    workspaceId,
    event,
    detail ?? null,
    new Date().toISOString()
  );
}

export function getComments(handoverId: string): HandoverComment[] {
  const rows = db
    .prepare(`SELECT * FROM handover_comments WHERE handover_id = ? ORDER BY created ASC`)
    .all(handoverId) as CommentRow[];
  return rows.map(rowToComment);
}

export function addComment(c: HandoverComment): HandoverComment {
  writeComment(c);
  return getComments(c.handoverId).find((x) => x.id === c.id)!;
}

/** Edits a note's body in place — position (x/y/timecode), author, and role are untouched. */
export function updateCommentBody(id: string, body: string): HandoverComment | undefined {
  const row = db.prepare(`SELECT * FROM handover_comments WHERE id = ?`).get(id) as CommentRow | undefined;
  if (!row) return undefined;
  const merged = rowToComment(row);
  merged.body = body;
  writeComment(merged);
  return merged;
}

export function deleteComment(id: string): boolean {
  const info = db.prepare(`DELETE FROM handover_comments WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Comment counts per handover, for handovers belonging to a given project in the caller's workspace. */
export function getCommentCounts(projectId: string, workspaceId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT hc.handover_id AS handoverId, COUNT(*) AS n
       FROM handover_comments hc
       JOIN handovers h ON h.id = hc.handover_id
       WHERE h.project_id = ? AND h.workspace_id = ?
       GROUP BY hc.handover_id`
    )
    .all(projectId, workspaceId) as { handoverId: string; n: number }[];
  const result: Record<string, number> = {};
  rows.forEach((r) => {
    result[r.handoverId] = r.n;
  });
  return result;
}

interface ApprovalRow {
  file_id: string;
  status: string;
  approved_by: string | null;
  approved_at: string;
  version: string | null;
}

function rowToApproval(r: ApprovalRow): HandoverFileApproval {
  return {
    status: r.status === "changes_requested" ? "changes_requested" : "approved",
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    version: r.version,
  };
}

/** A file's current version label, or null for files that predate version tracking. */
function currentVersionOf(f: VaultFile): string | null {
  return f.versions.find((v) => v.latest)?.version ?? null;
}

/** Current review status for every file in a handover that has one, keyed by fileId. A file with no entry has never been reviewed. */
export function getApprovals(handoverId: string): HandoverApprovals {
  const rows = db
    .prepare(`SELECT file_id, status, approved_by, approved_at, version FROM handover_approvals WHERE handover_id = ?`)
    .all(handoverId) as ApprovalRow[];
  const result: HandoverApprovals = {};
  rows.forEach((r) => {
    result[r.file_id] = rowToApproval(r);
  });
  return result;
}

/**
 * True only when the file is currently approved AND that approval was for
 * the file's current version — replacing a file's content after approval
 * makes this false again (re-approval required) without erasing the
 * approval record itself, which getApprovals still returns for the audit
 * trail (see the design-studio "approved v3, claims they approved v5"
 * scenario this exists to prevent).
 */
export function isFileApproved(handoverId: string, fileId: string, currentVersion: string | null): boolean {
  const row = db
    .prepare(`SELECT status, version FROM handover_approvals WHERE handover_id = ? AND file_id = ?`)
    .get(handoverId, fileId) as { status: string; version: string | null } | undefined;
  if (!row || row.status !== "approved") return false;
  if (currentVersion === null) return true; // predates version tracking — don't block on it
  return row.version === currentVersion;
}

function setFileReviewStatus(
  handoverId: string,
  fileId: string,
  status: "approved" | "changes_requested",
  by: string | null,
  version: string | null
): HandoverFileApproval {
  setReviewStatusStmt.run({
    handover_id: handoverId,
    file_id: fileId,
    status,
    approved_by: by,
    approved_at: new Date().toISOString(),
    version,
  });
  const row = db
    .prepare(`SELECT status, approved_by, approved_at, version FROM handover_approvals WHERE handover_id = ? AND file_id = ?`)
    .get(handoverId, fileId) as { status: string; approved_by: string | null; approved_at: string; version: string | null };
  return rowToApproval({ file_id: fileId, ...row });
}

/** Idempotent on (status, version) — see setReviewStatusStmt. */
export function approveFile(handoverId: string, fileId: string, approvedBy: string | null, version: string | null): HandoverFileApproval {
  return setFileReviewStatus(handoverId, fileId, "approved", approvedBy, version);
}

/** The client's "no, send this back" action — distinct from silence or a plain comment. */
export function requestChangesOnFile(
  handoverId: string,
  fileId: string,
  requestedBy: string | null,
  version: string | null
): HandoverFileApproval {
  return setFileReviewStatus(handoverId, fileId, "changes_requested", requestedBy, version);
}

// --- Home-screen greeting + insights ----------------------------------------

/**
 * Non-draft, non-revoked handovers with at least one still-unapproved file,
 * ordered most-recent-first (same `ord DESC` convention as `getHandovers`).
 * Shared by the greeting (tier 1), the insight rail, and the Messaging app's
 * handovers section so all three agree on exactly what "pending approval" means.
 */
export function getPendingApprovalSummary(workspaceId: string): PendingApproval[] {
  const result: PendingApproval[] = [];
  for (const h of getHandovers(workspaceId)) {
    if (h.status === "Draft" || h.revoked || h.fileIds.length === 0) continue;
    const approvals = getApprovals(h.id);
    const files = getFilesByIds(h.fileIds);
    const approvedFiles = h.fileIds.filter((id) => {
      const a = approvals[id];
      if (!a || a.status !== "approved") return false;
      const f = files.find((x) => x.id === id);
      const current = f ? currentVersionOf(f) : null;
      return current === null || a.version === current;
    }).length;
    if (approvedFiles === h.fileIds.length) continue;
    result.push({
      handoverId: h.id,
      handoverTitle: h.title,
      projectId: h.projectId,
      recipient: h.recipient,
      clientName: h.clientName,
      totalFiles: h.fileIds.length,
      approvedFiles,
      created: h.created,
    });
  }
  return result;
}

/**
 * Non-draft, non-revoked handovers whose every file is currently approved
 * (same staleness-aware "current" check as getPendingApprovalSummary — a
 * version bump since approval doesn't count), ordered by completion time
 * (the latest per-file approvedAt) most-recent-first. Feeds the home-screen
 * celebration banner: the frontend diffs this against what it's already shown.
 */
export function getRecentlyCompletedApprovals(workspaceId: string): CompletedApproval[] {
  const result: CompletedApproval[] = [];
  for (const h of getHandovers(workspaceId)) {
    if (h.status === "Draft" || h.revoked || h.fileIds.length === 0) continue;
    const approvals = getApprovals(h.id);
    const files = getFilesByIds(h.fileIds);
    let completedAt: string | null = null;
    let allApproved = true;
    for (const id of h.fileIds) {
      const a = approvals[id];
      const f = files.find((x) => x.id === id);
      const current = f ? currentVersionOf(f) : null;
      const isCurrent = !!a && a.status === "approved" && (current === null || a.version === current);
      if (!isCurrent) {
        allApproved = false;
        break;
      }
      if (completedAt === null || Date.parse(a.approvedAt) > Date.parse(completedAt)) completedAt = a.approvedAt;
    }
    if (!allApproved || completedAt === null) continue;
    result.push({
      handoverId: h.id,
      handoverTitle: h.title,
      projectId: h.projectId,
      recipient: h.recipient,
      clientName: h.clientName,
      completedAt,
    });
  }
  result.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return result;
}

/**
 * Files whose client feedback arrived after they were already approved, on
 * the SAME version — a version bump since approval is a normal new revision
 * round, not scope creep, and is excluded here on purpose.
 */
export function getScopeCreepFlags(workspaceId: string): ScopeCreepFlag[] {
  const flags: ScopeCreepFlag[] = [];
  for (const h of getHandovers(workspaceId)) {
    if (h.revoked || h.fileIds.length === 0) continue;
    const approvals = getApprovals(h.id);
    const files = getFilesByIds(h.fileIds);
    const comments = getComments(h.id);
    for (const fileId of h.fileIds) {
      const approval = approvals[fileId];
      if (!approval || approval.status !== "approved") continue;
      const file = files.find((f) => f.id === fileId);
      if (!file || currentVersionOf(file) !== approval.version) continue; // new version uploaded — not scope creep
      const later = comments.filter(
        (c) => c.fileId === fileId && c.role === "client" && Date.parse(c.created) > Date.parse(approval.approvedAt)
      );
      if (later.length === 0) continue;
      flags.push({
        handoverId: h.id,
        handoverTitle: h.title,
        projectId: h.projectId,
        fileId,
        fileName: file.name,
        approvedAt: approval.approvedAt,
        approvedBy: approval.approvedBy,
        laterComments: later.map((c) => ({ id: c.id, author: c.author, body: c.body, created: c.created })),
      });
    }
  }
  return flags;
}

/** Per-file review status counts across every non-revoked, non-draft handover, for the at-a-glance dashboard tally. */
export function getStatusTally(workspaceId: string): StatusTally {
  const tally: StatusTally = { approved: 0, awaitingClient: 0, changesRequested: 0, internalDraft: 0 };
  for (const h of getHandovers(workspaceId)) {
    if (h.revoked) continue;
    if (h.status === "Draft") {
      tally.internalDraft += h.fileIds.length;
      continue;
    }
    const approvals = getApprovals(h.id);
    const files = getFilesByIds(h.fileIds);
    for (const fileId of h.fileIds) {
      const a = approvals[fileId];
      const f = files.find((x) => x.id === fileId);
      const current = f ? currentVersionOf(f) : null;
      if (a?.status === "changes_requested") tally.changesRequested += 1;
      else if (a?.status === "approved" && (current === null || a.version === current)) tally.approved += 1;
      else tally.awaitingClient += 1;
    }
  }
  return tally;
}

function daysAgoLabel(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

interface RecentPortalEventRow {
  event: string;
  detail: string | null;
  created: string;
  handoverTitle: string;
  projectId: string;
  clientName: string | null;
  recipient: string | null;
}

function latestPortalEvent(workspaceId: string): RecentPortalEventRow | undefined {
  return db
    .prepare(
      `SELECT pe.event, pe.detail, pe.created, h.title AS handoverTitle, h.project_id AS projectId,
              h.client_name AS clientName, h.recipient AS recipient
       FROM portal_events pe
       JOIN handovers h ON h.id = pe.handover_id
       WHERE h.workspace_id = ? AND pe.event IN ('view', 'download')
       ORDER BY pe.id DESC
       LIMIT 1`
    )
    .get(workspaceId) as RecentPortalEventRow | undefined;
}

function portalEventVerb(row: RecentPortalEventRow): string {
  return row.event === "download" ? `downloaded ${row.detail || "a file"} from` : "viewed the delivery in";
}

/**
 * The one fact-driven line in the home-screen greeting. First match wins,
 * in priority order: a handover awaiting client approval, a client's portal
 * visit in the last day, an upcoming (or overdue) deadline, any past portal
 * visit, then a content-free fallback for an empty or activity-less workspace.
 */
export function getGreetingFact(workspaceId: string): GreetingFact {
  const pending = getPendingApprovalSummary(workspaceId);
  if (pending.length > 0) {
    const p = pending[0];
    const project = getProjectById(p.projectId, workspaceId);
    const clientDisplay = p.clientName || p.recipient || "your client";
    const remaining = p.totalFiles - p.approvedFiles;
    return {
      kind: "approval",
      lead: `${remaining} asset${remaining === 1 ? " is" : "s are"} still awaiting ${clientDisplay}'s approval in`,
      entityLabel: project?.name ?? p.handoverTitle,
      trail: ".",
      projectId: p.projectId,
      openHandovers: true,
    };
  }

  const latest = latestPortalEvent(workspaceId);
  if (latest && Date.now() - Date.parse(latest.created) <= 86_400_000) {
    const project = getProjectById(latest.projectId, workspaceId);
    const clientDisplay = latest.clientName || latest.recipient || "Your client";
    return {
      kind: "portal_activity",
      lead: `${clientDisplay} ${portalEventVerb(latest)}`,
      entityLabel: project?.name ?? latest.handoverTitle,
      trail: ".",
      projectId: latest.projectId,
      openHandovers: true,
    };
  }

  const activeProjects = getProjects(workspaceId).filter((p) => p.status !== "Archived");
  const deadlines = activeProjects
    .map((p) => ({ id: p.id, name: p.name, ts: Date.parse(p.deadline) }))
    .filter((d) => !Number.isNaN(d.ts))
    .sort((a, b) => a.ts - b.ts);
  if (deadlines.length > 0) {
    const d = deadlines[0];
    const daysLeft = Math.ceil((d.ts - Date.now()) / 86_400_000);
    const trail =
      daysLeft === 0
        ? " is due today."
        : daysLeft === 1
          ? " is due tomorrow."
          : daysLeft < 0
            ? ` was due ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago.`
            : ` is due in ${daysLeft} days.`;
    return { kind: "deadline", lead: "", entityLabel: d.name, trail, projectId: d.id };
  }

  if (latest) {
    const project = getProjectById(latest.projectId, workspaceId);
    const clientDisplay = latest.clientName || latest.recipient || "Your client";
    return {
      kind: "activity",
      lead: `${clientDisplay} ${portalEventVerb(latest)}`,
      entityLabel: project?.name ?? latest.handoverTitle,
      trail: ` ${daysAgoLabel(latest.created)}.`,
      projectId: latest.projectId,
      openHandovers: true,
    };
  }

  if (activeProjects.length > 0) {
    return {
      kind: "neutral",
      lead: `You have ${activeProjects.length} active project${activeProjects.length === 1 ? "" : "s"}.`,
      entityLabel: null,
      trail: "",
      projectId: null,
    };
  }
  return {
    kind: "neutral",
    lead: "Create your first project to get started.",
    entityLabel: null,
    trail: "",
    projectId: null,
  };
}

const REVIEW_STUCK_DAYS = 5;
const PORTAL_UNOPENED_DAYS = 3;
const LINK_EXPIRING_WINDOW_DAYS = 3;

/** Files sitting in Review for 5+ days, worst (oldest) first. */
function getReviewStuckInsights(workspaceId: string): DashboardInsight[] {
  const projects = getProjects(workspaceId);
  const projectByNumericId = new Map(projects.map((p) => [Number(p.id.replace(/^p/, "")), p]));
  const stuck = getFiles(workspaceId)
    .filter((f) => f.status === "Review" && f.statusChangedAt && f.projectId != null && projectByNumericId.has(f.projectId))
    .map((f) => ({ f, days: Math.floor((Date.now() - Date.parse(f.statusChangedAt!)) / 86_400_000) }))
    .filter((x) => x.days >= REVIEW_STUCK_DAYS)
    .sort((a, b) => b.days - a.days);
  return stuck.map(({ f, days }) => ({
    category: "review_stuck" as const,
    lead: "",
    entityLabel: f.name,
    trail: ` has been in review for ${days} days.`,
    action: { kind: "open" as const, projectId: projectByNumericId.get(f.projectId!)!.id, fileId: f.id },
  }));
}

/** Sent handovers the client hasn't opened, or hasn't reopened in 3+ days, worst (staleest) first. */
function getPortalUnopenedInsights(workspaceId: string): DashboardInsight[] {
  const sent = getHandovers(workspaceId).filter((h) => h.status === "Sent" && !h.revoked);
  const candidates = sent
    .map((h) => {
      const lastView = db
        .prepare(`SELECT created FROM portal_events WHERE handover_id = ? AND event = 'view' ORDER BY id DESC LIMIT 1`)
        .get(h.id) as { created: string } | undefined;
      const daysSinceView = lastView ? Math.floor((Date.now() - Date.parse(lastView.created)) / 86_400_000) : null;
      return { h, daysSinceView };
    })
    .filter((x) => x.daysSinceView === null || x.daysSinceView >= PORTAL_UNOPENED_DAYS)
    .sort((a, b) => (b.daysSinceView ?? Infinity) - (a.daysSinceView ?? Infinity));
  return candidates.map(({ h, daysSinceView }) => {
    const clientDisplay = h.clientName || h.recipient || "Your client";
    return {
      category: "portal_unopened",
      lead: `${clientDisplay} hasn't ${daysSinceView === null ? "opened" : "reopened"}`,
      entityLabel: h.title,
      trail: daysSinceView === null ? " since it was sent." : ` in ${daysSinceView} days.`,
      action: { kind: "copy_link", href: `/portal/${h.token}` },
    };
  });
}

const REMINDER_UNOPENED_DAYS = 5;
const REMINDER_COOLDOWN_DAYS = 5;

export interface ReminderCandidate {
  handoverId: string;
  handoverTitle: string;
  clientEmail: string;
  token: string;
  daysSinceView: number | null;
}

/**
 * Sent, non-revoked handovers with a client email on file that either were
 * never opened or have gone quiet for REMINDER_UNOPENED_DAYS+, and haven't
 * already been reminded in the last REMINDER_COOLDOWN_DAYS — the same
 * staleness signal as the "unopened" insight, plus the two guards (email
 * present, cooldown respected) needed before this can safely be automatic.
 */
export function getReminderCandidates(workspaceId: string): ReminderCandidate[] {
  const now = Date.now();
  return getHandovers(workspaceId)
    .filter((h) => h.status === "Sent" && !h.revoked && !!h.clientEmail)
    .map((h) => {
      const lastView = db
        .prepare(`SELECT created FROM portal_events WHERE handover_id = ? AND event = 'view' ORDER BY id DESC LIMIT 1`)
        .get(h.id) as { created: string } | undefined;
      const daysSinceView = lastView ? Math.floor((now - Date.parse(lastView.created)) / 86_400_000) : null;
      const daysSinceReminder = h.lastReminderAt ? Math.floor((now - Date.parse(h.lastReminderAt)) / 86_400_000) : null;
      return { h, daysSinceView, daysSinceReminder };
    })
    .filter((x) => (x.daysSinceView === null || x.daysSinceView >= REMINDER_UNOPENED_DAYS))
    .filter((x) => x.daysSinceReminder === null || x.daysSinceReminder >= REMINDER_COOLDOWN_DAYS)
    .map(({ h, daysSinceView }) => ({
      handoverId: h.id,
      handoverTitle: h.title,
      clientEmail: h.clientEmail!,
      token: h.token,
      daysSinceView,
    }));
}

export function markReminderSent(handoverId: string, workspaceId: string): void {
  db.prepare(`UPDATE handovers SET last_reminder_at = ? WHERE id = ? AND workspace_id = ?`).run(
    new Date().toISOString(),
    handoverId,
    workspaceId
  );
}

/** Handovers whose portal link has expired (or expires within 3 days), soonest/most-expired first. */
function getLinkExpiringInsights(workspaceId: string): DashboardInsight[] {
  const candidates = getHandovers(workspaceId)
    .filter((h) => h.expiresAt && !h.revoked)
    .map((h) => ({ h, daysUntil: Math.ceil((Date.parse(h.expiresAt!) - Date.now()) / 86_400_000) }))
    .filter((x) => x.daysUntil <= LINK_EXPIRING_WINDOW_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil);
  return candidates.map(({ h, daysUntil }) => {
    const clientDisplay = h.clientName || h.recipient || "Your client";
    const trail =
      daysUntil < 0
        ? ` expired ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} ago.`
        : daysUntil === 0
          ? " expires today."
          : ` expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`;
    return {
      category: "link_expiring",
      lead: `${clientDisplay}'s link to`,
      entityLabel: h.title,
      trail,
      action: { kind: "extend_expiry", handoverId: h.id, newExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    };
  });
}

/**
 * Up to 3 actionable lines for the home-screen insight rail, one per category,
 * in fixed priority order. `connection_error` is wired up but always empty
 * until real OAuth connections exist to report on.
 */
/** Scope-creep flags, worst (oldest feedback-after-approval) first. */
function getScopeCreepInsights(workspaceId: string): DashboardInsight[] {
  return getScopeCreepFlags(workspaceId)
    .sort((a, b) => Date.parse(a.laterComments[0]?.created ?? a.approvedAt) - Date.parse(b.laterComments[0]?.created ?? b.approvedAt))
    .map((flag) => ({
      category: "scope_creep" as const,
      lead: "New feedback arrived on the already-approved",
      entityLabel: flag.fileName,
      trail: ` (approved ${daysAgoLabel(flag.approvedAt)}) — outside the approved version.`,
      action: { kind: "open" as const, projectId: flag.projectId, fileId: flag.fileId },
    }));
}

export function getDashboardInsights(workspaceId: string): DashboardInsight[] {
  const insights: DashboardInsight[] = [];
  const categories: (() => DashboardInsight[])[] = [
    () => [],
    () => getScopeCreepInsights(workspaceId),
    () => getPortalUnopenedInsights(workspaceId),
    () => getReviewStuckInsights(workspaceId),
    () => getLinkExpiringInsights(workspaceId),
  ];
  for (const fetchCategory of categories) {
    if (insights.length >= 3) break;
    const candidates = fetchCategory();
    if (candidates.length > 0) insights.push(candidates[0]);
  }
  return insights;
}

// --- OAuth connections (Google Drive / Dropbox) ------------------------------
// Deliberately not modeled in src/types.ts — these fields (tokens especially)
// must never reach the browser. server/oauth.ts is the only caller.

interface OAuthTokenRow {
  workspace_id: string; provider: string; access_token: string; refresh_token: string | null;
  expires_at: string | null; scope: string | null; account_label: string | null; connected_at: string | null;
  last_error: string | null; last_error_at: string | null;
}

export interface OAuthTokenRecord {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  accountLabel: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

function rowToOAuthToken(r: OAuthTokenRow): OAuthTokenRecord {
  return {
    provider: r.provider,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    scope: r.scope,
    accountLabel: r.account_label,
    connectedAt: r.connected_at,
    lastError: r.last_error,
    lastErrorAt: r.last_error_at,
  };
}

export function getOAuthToken(workspaceId: string, provider: string): OAuthTokenRecord | undefined {
  const row = db
    .prepare(`SELECT * FROM oauth_tokens WHERE workspace_id = ? AND provider = ?`)
    .get(workspaceId, provider) as OAuthTokenRow | undefined;
  return row ? rowToOAuthToken(row) : undefined;
}

/** First-time connect (or full reconnect) — replaces any existing row for this (workspace, provider). */
export function saveOAuthConnection(
  workspaceId: string,
  provider: string,
  data: { accessToken: string; refreshToken: string | null; expiresAt: string | null; scope: string | null; accountLabel: string | null }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO oauth_tokens
       (workspace_id, provider, access_token, refresh_token, expires_at, scope, account_label, connected_at, last_error, last_error_at)
     VALUES (@workspace_id, @provider, @access_token, @refresh_token, @expires_at, @scope, @account_label, @connected_at, NULL, NULL)`
  ).run({
    workspace_id: workspaceId,
    provider,
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
    expires_at: data.expiresAt,
    scope: data.scope,
    account_label: data.accountLabel,
    connected_at: new Date().toISOString(),
  });
}

/** Silent token refresh — updates the live credentials, leaves connected_at/account_label alone, clears any prior error. */
export function updateOAuthTokens(
  workspaceId: string,
  provider: string,
  accessToken: string,
  expiresAt: string | null,
  refreshToken?: string | null
): void {
  db.prepare(
    `UPDATE oauth_tokens
     SET access_token = ?, expires_at = ?, refresh_token = COALESCE(?, refresh_token), last_error = NULL, last_error_at = NULL
     WHERE workspace_id = ? AND provider = ?`
  ).run(accessToken, expiresAt, refreshToken ?? null, workspaceId, provider);
}

export function setOAuthError(workspaceId: string, provider: string, message: string): void {
  db.prepare(`UPDATE oauth_tokens SET last_error = ?, last_error_at = ? WHERE workspace_id = ? AND provider = ?`).run(
    message.slice(0, 500),
    new Date().toISOString(),
    workspaceId,
    provider
  );
}

export function deleteOAuthToken(workspaceId: string, provider: string): boolean {
  const info = db.prepare(`DELETE FROM oauth_tokens WHERE workspace_id = ? AND provider = ?`).run(workspaceId, provider);
  return info.changes > 0;
}

export function getTasks(workspaceId: string, projectId?: string): VaultTask[] {
  const rows = projectId
    ? (db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND project_id = ? ORDER BY ord DESC`).all(workspaceId, projectId) as TaskRow[])
    : (db.prepare(`SELECT * FROM tasks WHERE workspace_id = ? ORDER BY ord DESC`).all(workspaceId) as TaskRow[]);
  return rows.map(rowToTask);
}

export function getTaskById(id: string, workspaceId: string): VaultTask | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as TaskRow | undefined;
  return row ? rowToTask(row) : undefined;
}

export function createTask(t: VaultTask, workspaceId: string): VaultTask {
  writeTask(t, Date.now(), workspaceId);
  return getTaskById(t.id, workspaceId)!;
}

export function updateTask(id: string, patch: Partial<VaultTask>, workspaceId: string): VaultTask | undefined {
  const existing = getTaskById(id, workspaceId);
  if (!existing) return undefined;
  const merged: VaultTask = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM tasks WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeTask(merged, ordRow.ord, workspaceId);
  return getTaskById(id, workspaceId);
}

export function deleteTask(id: string, workspaceId: string): boolean {
  const info = db.prepare(`DELETE FROM tasks WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

export function getEvents(workspaceId: string, projectId?: string): CalendarEvent[] {
  const rows = projectId
    ? (db.prepare(`SELECT * FROM events WHERE workspace_id = ? AND project_id = ? ORDER BY date ASC`).all(workspaceId, projectId) as EventRow[])
    : (db.prepare(`SELECT * FROM events WHERE workspace_id = ? ORDER BY date ASC`).all(workspaceId) as EventRow[]);
  return rows.map(rowToEvent);
}

export function getEventById(id: string, workspaceId: string): CalendarEvent | undefined {
  const row = db.prepare(`SELECT * FROM events WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as EventRow | undefined;
  return row ? rowToEvent(row) : undefined;
}

export function createEvent(e: CalendarEvent, workspaceId: string): CalendarEvent {
  writeEvent(e, Date.now(), workspaceId);
  return getEventById(e.id, workspaceId)!;
}

export function updateEvent(id: string, patch: Partial<CalendarEvent>, workspaceId: string): CalendarEvent | undefined {
  const existing = getEventById(id, workspaceId);
  if (!existing) return undefined;
  const merged: CalendarEvent = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM events WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeEvent(merged, ordRow.ord, workspaceId);
  return getEventById(id, workspaceId);
}

export function deleteEvent(id: string, workspaceId: string): boolean {
  const info = db.prepare(`DELETE FROM events WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

export function getTeamMembers(workspaceId: string): TeamMember[] {
  const rows = db.prepare(`SELECT * FROM team_members WHERE workspace_id = ? ORDER BY ord DESC`).all(workspaceId) as TeamMemberRow[];
  return rows.map(rowToTeamMember);
}

export function getTeamMemberById(id: string, workspaceId: string): TeamMember | undefined {
  const row = db.prepare(`SELECT * FROM team_members WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as TeamMemberRow | undefined;
  return row ? rowToTeamMember(row) : undefined;
}

export function createTeamMember(m: TeamMember, workspaceId: string): TeamMember {
  writeTeamMember(m, Date.now(), workspaceId);
  return getTeamMemberById(m.id, workspaceId)!;
}

export function updateTeamMember(id: string, patch: Partial<TeamMember>, workspaceId: string): TeamMember | undefined {
  const existing = getTeamMemberById(id, workspaceId);
  if (!existing) return undefined;
  const merged: TeamMember = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM team_members WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeTeamMember(merged, ordRow.ord, workspaceId);
  return getTeamMemberById(id, workspaceId);
}

export function deleteTeamMember(id: string, workspaceId: string): boolean {
  const info = db.prepare(`DELETE FROM team_members WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

/** Sorted by most-recently-active first (last message, falling back to created
 * for a message-less conversation) — the "real inbox" feel. */
export function getConversations(workspaceId: string): Conversation[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.workspace_id = ?
       GROUP BY c.id
       ORDER BY COALESCE(MAX(m.created), c.created) DESC`
    )
    .all(workspaceId) as ConversationRow[];
  return rows.map(rowToConversation);
}

export function getConversationById(id: string, workspaceId: string): Conversation | undefined {
  const row = db.prepare(`SELECT * FROM conversations WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as ConversationRow | undefined;
  return row ? rowToConversation(row) : undefined;
}

export function createConversation(c: Conversation, workspaceId: string): Conversation {
  writeConversation(c, Date.now(), workspaceId);
  return getConversationById(c.id, workspaceId)!;
}

export function updateConversation(id: string, patch: Partial<Conversation>, workspaceId: string): Conversation | undefined {
  const existing = getConversationById(id, workspaceId);
  if (!existing) return undefined;
  const merged: Conversation = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM conversations WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as { ord: number };
  writeConversation(merged, ordRow.ord, workspaceId);
  return getConversationById(id, workspaceId);
}

/**
 * Deliberate exception to the no-cascade norm used elsewhere in this schema
 * (deleting a handover already orphans its comments) — this is new code, not
 * a retrofit, so there's no reason to reproduce that gap on purpose.
 */
export function deleteConversation(id: string, workspaceId: string): boolean {
  const owned = getConversationById(id, workspaceId);
  if (!owned) return false;
  db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
  const info = db.prepare(`DELETE FROM conversations WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
  return info.changes > 0;
}

export function getMessages(conversationId: string): ConversationMessage[] {
  const rows = db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created ASC`)
    .all(conversationId) as MessageRow[];
  return rows.map(rowToMessage);
}

export function addMessage(m: ConversationMessage): ConversationMessage {
  writeMessage(m);
  return getMessages(m.conversationId).find((x) => x.id === m.id)!;
}

export function deleteMessage(id: string): boolean {
  const info = db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function getSettings(workspaceId: string): StudioSettings {
  const row = db.prepare(`SELECT * FROM settings WHERE workspace_id = ?`).get(workspaceId) as SettingsRow | undefined;
  return row ? rowToSettings(row) : rowToSettings({});
}

export function updateSettings(patch: Partial<StudioSettings>, workspaceId: string): StudioSettings {
  const merged: StudioSettings = { ...getSettings(workspaceId), ...patch };
  writeSettings(merged, workspaceId);
  return getSettings(workspaceId);
}

/**
 * Remove the fictional bootstrap content (Nebula/Acme/GlobalNet and their
 * files/handover/comments) a real user won't want to keep, scoped to the
 * caller's own workspace. Deliberately scoped to just the original seed ids,
 * not a blanket wipe — anything the user created for real is left alone.
 * Every later feature that adds its own seed data should extend this with one
 * more `DELETE ... WHERE workspace_id = ? AND project_id IN (...)` line.
 */
export function clearDemoData(workspaceId: string): void {
  const seedProjectIds = SEED_PROJECTS.map((p) => p.id);
  const seedFileIds = SEED_FILES.map((f) => f.id);
  const seedHandoverIds = SEED_HANDOVERS.map((h) => h.id);
  const seedCommentIds = SEED_COMMENTS.map((c) => c.id);
  const seedTaskIds = SEED_TASKS.map((t) => t.id);
  const seedEventIds = SEED_EVENTS.map((e) => e.id);
  const seedConversationIds = SEED_CONVERSATIONS.map((c) => c.id);
  const seedMessageIds = SEED_MESSAGES.map((m) => m.id);
  const placeholders = (n: number) => Array(n).fill("?").join(",");

  if (seedMessageIds.length) {
    db.prepare(`DELETE FROM messages WHERE id IN (${placeholders(seedMessageIds.length)})`).run(...seedMessageIds);
  }
  if (seedConversationIds.length) {
    db.prepare(`DELETE FROM conversations WHERE workspace_id = ? AND id IN (${placeholders(seedConversationIds.length)})`).run(
      workspaceId,
      ...seedConversationIds
    );
  }
  if (seedEventIds.length) {
    db.prepare(`DELETE FROM events WHERE workspace_id = ? AND id IN (${placeholders(seedEventIds.length)})`).run(workspaceId, ...seedEventIds);
  }
  if (seedTaskIds.length) {
    db.prepare(`DELETE FROM tasks WHERE workspace_id = ? AND id IN (${placeholders(seedTaskIds.length)})`).run(workspaceId, ...seedTaskIds);
  }
  if (seedCommentIds.length) {
    db.prepare(`DELETE FROM handover_comments WHERE id IN (${placeholders(seedCommentIds.length)})`).run(...seedCommentIds);
  }
  if (seedHandoverIds.length) {
    db.prepare(`DELETE FROM portal_events WHERE handover_id IN (${placeholders(seedHandoverIds.length)})`).run(...seedHandoverIds);
    db.prepare(`DELETE FROM handovers WHERE workspace_id = ? AND id IN (${placeholders(seedHandoverIds.length)})`).run(
      workspaceId,
      ...seedHandoverIds
    );
  }
  if (seedFileIds.length) {
    db.prepare(`DELETE FROM files WHERE workspace_id = ? AND id IN (${placeholders(seedFileIds.length)})`).run(workspaceId, ...seedFileIds);
  }
  if (seedProjectIds.length) {
    db.prepare(`DELETE FROM projects WHERE workspace_id = ? AND id IN (${placeholders(seedProjectIds.length)})`).run(
      workspaceId,
      ...seedProjectIds
    );
  }
  console.log("[db] Cleared demo/seed data.");
}

// One-time backfill for the "Access Control" tags becoming a real, enforced
// permission (see ensureClientVisible) instead of decoration: any file that
// was already part of a handover before this shipped needs the client tag
// applied now, or it would silently vanish from an already-sent portal link
// the moment enforcement went live. Cheap and idempotent — safe to run on
// every boot, across every workspace.
for (const workspaceId of getAllWorkspaceIds()) {
  for (const h of getHandovers(workspaceId)) {
    ensureClientVisible(h.fileIds, workspaceId);
  }
}

export default db;
