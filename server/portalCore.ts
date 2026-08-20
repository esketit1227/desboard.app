/**
 * Portal security core — PURE functions only (no Express, no database).
 *
 * Everything the portal's trust boundary depends on lives here so it can be
 * unit-tested directly: password hashing, signed session cookies, signed
 * short-lived download URLs, access-state evaluation, and the DTO mappers
 * that are the explicit allowlist of what a client visitor may ever see.
 */
import crypto from "crypto";
import type {
  Handover,
  HandoverComment,
  PortalCommentDTO,
  PortalFileDTO,
  PortalHandoverDTO,
  VaultFile,
} from "../src/types.ts";

// --- Passwords (scrypt) ------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// --- Signed portal sessions (stateless HMAC cookie) --------------------------

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function hmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** A session is scoped to exactly one handover — it authorizes nothing else. */
export function signSession(handoverId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ h: handoverId, iat: now })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySession(
  value: string | undefined,
  handoverId: string,
  secret: string,
  now = Date.now()
): boolean {
  if (!value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { h?: string; iat?: number };
    return data.h === handoverId && typeof data.iat === "number" && now - data.iat < SESSION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Stable, anonymous id for the audit trail (never reveals the cookie itself). */
export function sessionAuditId(value: string | undefined): string | null {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// --- Signed short-lived download URLs ----------------------------------------

export const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

export function signDownload(token: string, fileId: string, exp: number, secret: string): string {
  return hmac(`dl|${token}|${fileId}|${exp}`, secret);
}

/**
 * Signature + expiry check only — the caller MUST additionally re-check the
 * handover's live access state, so a revocation kills outstanding URLs.
 */
export function verifyDownload(
  token: string,
  fileId: string,
  exp: number,
  sig: string,
  secret: string,
  now = Date.now()
): boolean {
  if (!Number.isFinite(exp) || now > exp) return false;
  const expected = signDownload(token, fileId, exp, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Access state ------------------------------------------------------------

export type PortalAccessState = "ok" | "expired" | "revoked";

export function accessState(h: Handover, now = Date.now()): PortalAccessState {
  if (h.revoked) return "revoked";
  if (h.expiresAt) {
    const t = Date.parse(h.expiresAt);
    if (!Number.isNaN(t) && now > t) return "expired";
  }
  return "ok";
}

// --- Portal DTOs (the field allowlist) ---------------------------------------

export function toPortalFileDTO(f: VaultFile): PortalFileDTO {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    extension: f.extension,
    size: f.size,
    status: f.status,
    tags: f.tags,
  };
}

export function toPortalCommentDTO(c: HandoverComment): PortalCommentDTO {
  return {
    id: c.id,
    author: c.author,
    role: c.role,
    body: c.body,
    fileId: c.fileId ?? null,
    x: typeof c.x === "number" ? c.x : null,
    y: typeof c.y === "number" ? c.y : null,
    created: c.created,
  };
}

/** Comments must be pre-filtered by the caller via `visibleToClient`. */
export function toPortalHandoverDTO(h: Handover, files: VaultFile[]): PortalHandoverDTO {
  return {
    title: h.title,
    recipient: h.recipient,
    clientName: h.clientName,
    note: h.note,
    status: h.status,
    created: h.created,
    branding: h.branding,
    files: files.map(toPortalFileDTO),
  };
}

/** The single visibility rule for portal-facing comments. */
export function visibleToClient(c: HandoverComment): boolean {
  return !c.internalOnly;
}
