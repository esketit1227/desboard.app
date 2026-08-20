/**
 * Local file-content storage.
 *
 * Desboard stores uploaded bytes on disk under uploads/ (gitignored), keyed by
 * file id — one "current" binary per vault file, mirroring whatever version is
 * latest. Each version's bytes are ALSO kept independently (keyed by
 * `<fileId>__v<version>`) so old versions stay downloadable/restorable forever,
 * not just the current one. Metadata stays in SQLite; this module only handles
 * the bytes.
 */
import fs from "fs";
import path from "path";

// DATA_DIR lets a deployment point uploads at a mounted persistent volume
// (e.g. Railway/Fly) instead of the app's own working directory, which is
// wiped on every deploy. Defaults to cwd for local dev, unchanged behavior.
const UPLOADS_DIR = path.join(process.env.DATA_DIR || process.cwd(), "uploads");

/** File/version ids are server-generated, but sanitize anyway — they become filenames. */
function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function contentPath(fileId: string): string {
  return path.join(UPLOADS_DIR, sanitize(fileId));
}

function versionPath(fileId: string, version: string): string {
  return path.join(UPLOADS_DIR, `${sanitize(fileId)}__v${sanitize(version)}`);
}

/** Write a base64 payload as the "current" blob; returns the byte size written. */
export function writeContent(fileId: string, base64: string): number {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const buf = Buffer.from(base64, "base64");
  fs.writeFileSync(contentPath(fileId), buf);
  return buf.length;
}

export function hasStoredContent(fileId: string): boolean {
  return fs.existsSync(contentPath(fileId));
}

export function readContentStream(fileId: string): fs.ReadStream {
  return fs.createReadStream(contentPath(fileId));
}

export function deleteContent(fileId: string): void {
  fs.rmSync(contentPath(fileId), { force: true });
}

/** Persist a version's bytes independently of the "current" blob. */
export function writeVersionContent(fileId: string, version: string, base64: string): number {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const buf = Buffer.from(base64, "base64");
  fs.writeFileSync(versionPath(fileId, version), buf);
  return buf.length;
}

export function hasVersionContent(fileId: string, version: string): boolean {
  return fs.existsSync(versionPath(fileId, version));
}

export function readVersionContentStream(fileId: string, version: string): fs.ReadStream {
  return fs.createReadStream(versionPath(fileId, version));
}

/**
 * Bring an old version's bytes back as the new "current" blob, and also store
 * them under the new version's own key — restoring never deletes history, it
 * just makes the old content the latest again under a fresh version label.
 */
export function restoreVersionContent(fileId: string, fromVersion: string, asNewVersion: string): number {
  const buf = fs.readFileSync(versionPath(fileId, fromVersion));
  fs.writeFileSync(contentPath(fileId), buf);
  fs.writeFileSync(versionPath(fileId, asNewVersion), buf);
  return buf.length;
}

/** "24 MB" style display size, matching the seed data's format. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
