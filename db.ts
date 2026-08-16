/**
 * SQLite persistence layer.
 *
 * Uses better-sqlite3 (a fast, synchronous SQLite driver) to store files,
 * projects, and tags in a local file called `desboard.db` at the project root.
 * Because it's a real database on disk, everything survives a page refresh or
 * a server restart.
 *
 * On first run the tables are created and seeded with the sample data from the
 * prototype. Array/object fields (tags, versions, access, team, linked) are
 * stored as JSON strings in TEXT columns and parsed back into real objects by
 * the row-mapping helpers below.
 */
import Database from "better-sqlite3";
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
} from "./src/types.ts";

const DB_PATH = path.join(process.cwd(), "desboard.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Schema -----------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'file',
    extension  TEXT,
    size       TEXT,
    created    TEXT,
    owner      TEXT,
    source     TEXT,
    status     TEXT,
    project_id INTEGER,
    client_id  TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    versions   TEXT NOT NULL DEFAULT '[]',
    access     TEXT NOT NULL DEFAULT '[]',
    ord        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS projects (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    client    TEXT,
    status    TEXT,
    deadline  TEXT,
    owner     TEXT,
    team      TEXT NOT NULL DEFAULT '[]',
    tags      TEXT NOT NULL DEFAULT '[]',
    progress  INTEGER NOT NULL DEFAULT 0,
    linked    TEXT NOT NULL DEFAULT '{}',
    ord       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS handovers (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title      TEXT NOT NULL,
    recipient  TEXT,
    note       TEXT,
    status     TEXT NOT NULL DEFAULT 'Draft',
    file_ids   TEXT NOT NULL DEFAULT '[]',
    created    TEXT,
    branding   TEXT,
    ord        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS handover_comments (
    id          TEXT PRIMARY KEY,
    handover_id TEXT NOT NULL,
    author      TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'client',
    body        TEXT NOT NULL,
    file_id     TEXT,
    created     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_handover_comments_handover ON handover_comments (handover_id);

  CREATE TABLE IF NOT EXISTS assistant_metrics (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    event   TEXT NOT NULL,
    detail  TEXT,
    created TEXT NOT NULL
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
    progress: 65, linked: { files: 12, tasks: 34, messages: 89, invoices: 2, handovers: 0 },
  },
  {
    id: "p2", name: "Acme Design System", client: "Acme Corp", status: "Review",
    deadline: "Oct 28, 2026", owner: "Sarah K.", team: ["SK", "EM"], tags: ["Systems", "Figma"],
    progress: 90, linked: { files: 4, tasks: 12, messages: 45, invoices: 1, handovers: 1 },
  },
  {
    id: "p3", name: "Global Marketing Campaign", client: "GlobalNet", status: "Planning",
    deadline: "Jan 10, 2027", owner: "John D.", team: ["JD"], tags: ["Marketing", "Copy", "Social"],
    progress: 15, linked: { files: 2, tasks: 8, messages: 14, invoices: 0, handovers: 0 },
  },
];

const SEED_HANDOVERS: Handover[] = [
  {
    id: "h1",
    projectId: "p2",
    title: "Acme Design System — Final Handoff",
    recipient: "Acme Corp",
    note: "Final design system files, tokens, and component documentation. Let us know if you need source files in another format.",
    status: "Sent",
    fileIds: ["f2"],
    created: "Oct 15, 2023",
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
  id: string; name: string; type: string; extension: string | null; size: string | null;
  created: string | null; owner: string | null; source: string | null; status: string | null;
  project_id: number | null; client_id: string | null; tags: string; versions: string; access: string;
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
  };
}

interface ProjectRow {
  id: string; name: string; client: string | null; status: string | null; deadline: string | null;
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
    linked: parseJson<ProjectLinked>(r.linked, { files: 0, tasks: 0, messages: 0, invoices: 0, handovers: 0 }),
  };
}

interface HandoverRow {
  id: string; project_id: string; title: string; recipient: string | null; note: string | null;
  status: string | null; file_ids: string; created: string | null; branding: string | null;
}

function rowToHandover(r: HandoverRow): Handover {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    recipient: r.recipient ?? "",
    note: r.note ?? "",
    status: (r.status as HandoverStatus) ?? "Draft",
    fileIds: parseJson<string[]>(r.file_ids, []),
    created: r.created ?? "",
    branding: r.branding ? parseJson<HandoverBranding | undefined>(r.branding, undefined) : undefined,
  };
}

interface CommentRow {
  id: string; handover_id: string; author: string; role: string; body: string;
  file_id: string | null; created: string;
}

function rowToComment(r: CommentRow): HandoverComment {
  return {
    id: r.id,
    handoverId: r.handover_id,
    author: r.author,
    role: r.role === "designer" ? "designer" : "client",
    body: r.body,
    fileId: r.file_id,
    created: r.created,
  };
}

// --- Write helpers ----------------------------------------------------------

const insertFileStmt = db.prepare(`
  INSERT OR REPLACE INTO files
    (id, name, type, extension, size, created, owner, source, status, project_id, client_id, tags, versions, access, ord)
  VALUES
    (@id, @name, @type, @extension, @size, @created, @owner, @source, @status, @project_id, @client_id, @tags, @versions, @access, @ord)
`);

function writeFile(file: VaultFile, ord: number) {
  insertFileStmt.run({
    id: file.id,
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
    ord,
  });
}

const insertProjectStmt = db.prepare(`
  INSERT OR REPLACE INTO projects
    (id, name, client, status, deadline, owner, team, tags, progress, linked, ord)
  VALUES
    (@id, @name, @client, @status, @deadline, @owner, @team, @tags, @progress, @linked, @ord)
`);

function writeProject(p: ProjectFull, ord: number) {
  insertProjectStmt.run({
    id: p.id,
    name: p.name,
    client: p.client ?? null,
    status: p.status ?? "Planning",
    deadline: p.deadline ?? null,
    owner: p.owner ?? null,
    team: JSON.stringify(p.team ?? []),
    tags: JSON.stringify(p.tags ?? []),
    progress: p.progress ?? 0,
    linked: JSON.stringify(p.linked ?? { files: 0, tasks: 0, messages: 0, invoices: 0, handovers: 0 }),
    ord,
  });
}

const insertTagStmt = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
export function addTag(name: string) {
  const clean = name.trim();
  if (clean) insertTagStmt.run(clean);
}

const insertHandoverStmt = db.prepare(`
  INSERT OR REPLACE INTO handovers
    (id, project_id, title, recipient, note, status, file_ids, created, branding, ord)
  VALUES
    (@id, @project_id, @title, @recipient, @note, @status, @file_ids, @created, @branding, @ord)
`);

function writeHandover(h: Handover, ord: number) {
  insertHandoverStmt.run({
    id: h.id,
    project_id: h.projectId,
    title: h.title,
    recipient: h.recipient ?? null,
    note: h.note ?? null,
    status: h.status ?? "Draft",
    file_ids: JSON.stringify(h.fileIds ?? []),
    created: h.created ?? null,
    branding: h.branding ? JSON.stringify(h.branding) : null,
    ord,
  });
}

const insertCommentStmt = db.prepare(`
  INSERT OR REPLACE INTO handover_comments (id, handover_id, author, role, body, file_id, created)
  VALUES (@id, @handover_id, @author, @role, @body, @file_id, @created)
`);

function writeComment(c: HandoverComment) {
  insertCommentStmt.run({
    id: c.id,
    handover_id: c.handoverId,
    author: c.author,
    role: c.role === "designer" ? "designer" : "client",
    body: c.body,
    file_id: c.fileId ?? null,
    created: c.created,
  });
}

// --- Seed (only if empty) ---------------------------------------------------

function seedIfEmpty() {
  const fileCount = (db.prepare(`SELECT COUNT(*) AS n FROM files`).get() as { n: number }).n;
  if (fileCount === 0) {
    // Seeds keep their prototype order; later uploads (with a larger `ord`)
    // sort ahead of them.
    SEED_FILES.forEach((f, i) => writeFile(f, 1000 - i));
    SEED_PROJECTS.forEach((p, i) => writeProject(p, 1000 - i));
    const tagNames = new Set<string>();
    SEED_FILES.forEach((f) => f.tags.forEach((t) => tagNames.add(t)));
    SEED_PROJECTS.forEach((p) => p.tags.forEach((t) => tagNames.add(t)));
    tagNames.forEach((t) => addTag(t));
    console.log(`[db] Seeded ${SEED_FILES.length} files, ${SEED_PROJECTS.length} projects, ${tagNames.size} tags.`);
  }
}
seedIfEmpty();

// Handovers are seeded independently so they still appear on databases created
// before this feature existed.
function seedHandoversIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM handovers`).get() as { n: number }).n;
  if (n === 0) {
    SEED_HANDOVERS.forEach((h, i) => writeHandover(h, 1000 - i));
    console.log(`[db] Seeded ${SEED_HANDOVERS.length} handover(s).`);
  }
}
seedHandoversIfEmpty();

// Comments are seeded independently for the same reason as handovers.
function seedCommentsIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM handover_comments`).get() as { n: number }).n;
  if (n === 0) {
    SEED_COMMENTS.forEach((c) => writeComment(c));
    console.log(`[db] Seeded ${SEED_COMMENTS.length} handover comment(s).`);
  }
}
seedCommentsIfEmpty();

// --- Public query API -------------------------------------------------------

export function getFiles(): VaultFile[] {
  const rows = db.prepare(`SELECT * FROM files ORDER BY ord DESC`).all() as FileRow[];
  return rows.map(rowToFile);
}

export function getFileById(id: string): VaultFile | undefined {
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as FileRow | undefined;
  return row ? rowToFile(row) : undefined;
}

export function createFile(file: VaultFile): VaultFile {
  writeFile(file, Date.now());
  file.tags.forEach(addTag);
  return getFileById(file.id)!;
}

/** Update a subset of a file's fields (project move, tag edits, status, etc.). */
export function updateFile(id: string, patch: Partial<VaultFile>): VaultFile | undefined {
  const existing = getFileById(id);
  if (!existing) return undefined;
  const merged: VaultFile = { ...existing, ...patch, id };
  // Preserve the existing sort position on update.
  const ordRow = db.prepare(`SELECT ord FROM files WHERE id = ?`).get(id) as { ord: number };
  writeFile(merged, ordRow.ord);
  merged.tags.forEach(addTag);
  return getFileById(id);
}

export function getProjects(): ProjectFull[] {
  const rows = db.prepare(`SELECT * FROM projects ORDER BY ord DESC`).all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function createProject(p: ProjectFull): ProjectFull {
  writeProject(p, Date.now());
  p.tags.forEach(addTag);
  return p;
}

export function getTags(): Tag[] {
  return db.prepare(`SELECT id, name FROM tags ORDER BY name ASC`).all() as Tag[];
}

export function getHandovers(projectId?: string): Handover[] {
  const rows = projectId
    ? (db.prepare(`SELECT * FROM handovers WHERE project_id = ? ORDER BY ord DESC`).all(projectId) as HandoverRow[])
    : (db.prepare(`SELECT * FROM handovers ORDER BY ord DESC`).all() as HandoverRow[]);
  return rows.map(rowToHandover);
}

export function getHandoverById(id: string): Handover | undefined {
  const row = db.prepare(`SELECT * FROM handovers WHERE id = ?`).get(id) as HandoverRow | undefined;
  return row ? rowToHandover(row) : undefined;
}

export function createHandover(h: Handover): Handover {
  writeHandover(h, Date.now());
  return getHandoverById(h.id)!;
}

export function updateHandover(id: string, patch: Partial<Handover>): Handover | undefined {
  const existing = getHandoverById(id);
  if (!existing) return undefined;
  const merged: Handover = { ...existing, ...patch, id };
  const ordRow = db.prepare(`SELECT ord FROM handovers WHERE id = ?`).get(id) as { ord: number };
  writeHandover(merged, ordRow.ord);
  return getHandoverById(id);
}

export function deleteHandover(id: string): boolean {
  const info = db.prepare(`DELETE FROM handovers WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Append an assistant usage event (question volume / suggestion click-through). */
export function logAssistantMetric(event: string, detail?: string) {
  db.prepare(`INSERT INTO assistant_metrics (event, detail, created) VALUES (?, ?, ?)`).run(
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

export function deleteComment(id: string): boolean {
  const info = db.prepare(`DELETE FROM handover_comments WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Comment counts per handover, for handovers belonging to a given project. */
export function getCommentCounts(projectId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT hc.handover_id AS handoverId, COUNT(*) AS n
       FROM handover_comments hc
       JOIN handovers h ON h.id = hc.handover_id
       WHERE h.project_id = ?
       GROUP BY hc.handover_id`
    )
    .all(projectId) as { handoverId: string; n: number }[];
  const result: Record<string, number> = {};
  rows.forEach((r) => {
    result[r.handoverId] = r.n;
  });
  return result;
}

export default db;
