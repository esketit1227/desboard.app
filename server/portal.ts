/**
 * Client portal — the ONLY externally-reachable, untrusted surface.
 *
 * A dedicated Express router, structurally separate from the internal
 * /api/handovers routes. Every route resolves a handover exclusively by its
 * unguessable token; there is no path from here to projects, other handovers,
 * or anything org-wide. Responses go through the portal DTOs in portalCore
 * (field allowlist), all visitor actions are rate-limited and written to the
 * portal_events audit trail, and revocation/expiry fail closed everywhere —
 * including on already-issued signed download URLs.
 */
import crypto from "crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import {
  addComment,
  approveFile,
  requestChangesOnFile,
  deleteComment,
  getApprovals,
  getFilesByIds,
  getComments,
  getHandoverByToken,
  isClientVisible,
  isFileApproved,
  logPortalEvent,
  updateCommentBody,
} from "../db.ts";
import type { Handover } from "../src/types.ts";
import { renderHandoverPage } from "../src/lib/handoverPage.ts";
import {
  portalExpiredPage,
  portalNotFoundPage,
  portalPasswordPage,
  portalRevokedPage,
} from "../src/lib/portalStates.ts";
import { hasVersionContent, readContentStream, streamContentWithRange, streamVersionContentWithRange } from "./storage.ts";
import {
  DOWNLOAD_URL_TTL_MS,
  accessState,
  sessionAuditId,
  signDownload,
  signSession,
  toPortalCommentDTO,
  toPortalHandoverDTO,
  verifyDownload,
  verifyPassword,
  verifySession,
  visibleToClient,
} from "./portalCore.ts";

// Sessions are stateless HMAC cookies. Without PORTAL_SECRET in the env the
// secret is per-process, so portal sessions reset on server restart.
const SECRET = process.env.PORTAL_SECRET || crypto.randomBytes(32).toString("hex");
// See server/auth.ts for why this is gated on NODE_ENV rather than always on.
const SECURE_ATTR = process.env.NODE_ENV === "production" ? "; Secure" : "";

const cookieName = (handoverId: string) => `dp_${handoverId}`;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSessionCookie(res: Response, handoverId: string) {
  const value = signSession(handoverId, SECRET);
  res.setHeader(
    "Set-Cookie",
    `${cookieName(handoverId)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${SECURE_ATTR}; Max-Age=${7 * 24 * 3600}`
  );
  return value;
}

function hasSession(req: Request, handoverId: string): boolean {
  return verifySession(readCookie(req, cookieName(handoverId)), handoverId, SECRET);
}

function audit(req: Request, h: Handover, event: string, detail?: string) {
  logPortalEvent({
    handoverId: h.id,
    sessionId: sessionAuditId(readCookie(req, cookieName(h.id))),
    event,
    detail,
    ip: req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
  });
}

/**
 * Resolve the handover by token and enforce live access state. Returns null
 * after responding when the visitor may not proceed. `html` picks the response
 * style (state page vs JSON error).
 */
function resolve(req: Request, res: Response, html: boolean): Handover | null {
  const h = getHandoverByToken(req.params.token ?? "");
  if (!h) {
    if (html) res.status(404).type("html").send(portalNotFoundPage());
    else res.status(404).json({ error: "Not found" });
    return null;
  }
  const state = accessState(h);
  if (state === "revoked") {
    audit(req, h, "denied", "revoked");
    if (html) res.status(410).type("html").send(portalRevokedPage());
    else res.status(410).json({ error: "Access withdrawn" });
    return null;
  }
  if (state === "expired") {
    audit(req, h, "denied", "expired");
    if (html) res.status(410).type("html").send(portalExpiredPage());
    else res.status(410).json({ error: "Link expired" });
    return null;
  }
  return h;
}

/** Session gate for API/download routes (page route has its own flow). */
function requireSession(req: Request, res: Response, h: Handover): boolean {
  if (hasSession(req, h.id)) return true;
  res.status(401).json({ error: "No portal session" });
  return false;
}

/**
 * Blocks the client-facing write actions (comment, approve, request changes)
 * on a Draft — the page itself still renders (the studio's own preview reuses
 * this URL), but nothing should be able to act on a package that hasn't
 * actually been sent, whether that's a client who got the link early or the
 * studio clicking around its own preview.
 */
function requireSent(req: Request, res: Response, h: Handover): boolean {
  if (h.status !== "Draft") return true;
  res.status(403).json({ error: "This delivery hasn't been sent yet." });
  return false;
}

/**
 * The set of a handover's files the portal is actually allowed to show — every
 * download, preview, approve/request-changes, and comment target ultimately
 * resolves through here (not the raw h.fileIds list), so a file the studio
 * never tagged client-visible — or explicitly un-tagged later — genuinely
 * disappears from the portal, not just from the file list UI.
 */
function filesOf(h: Handover) {
  return getFilesByIds(h.fileIds).filter((f) => isClientVisible(f.access));
}

/** A file's current version label, or null for files that predate version tracking — mirrors db.ts's internal currentVersionOf. */
function currentVersionOf(f: { versions: { version: string; latest?: boolean }[] }): string | null {
  return f.versions.find((v) => v.latest)?.version ?? null;
}

function signedDownloadHrefs(h: Handover): Record<string, string> {
  const exp = Date.now() + DOWNLOAD_URL_TTL_MS;
  const hrefs: Record<string, string> = {};
  for (const id of h.fileIds) {
    hrefs[id] = `/portal/${h.token}/file/${id}/download?exp=${exp}&sig=${signDownload(h.token, id, exp, SECRET)}`;
  }
  return hrefs;
}

/**
 * Inline "spectate" URLs — no signature, just the session cookie the browser
 * already sends. Unlike downloads, viewing is never approval-gated: a client
 * has to be able to look at a file before deciding whether to approve it.
 */
function viewHrefs(h: Handover): Record<string, string> {
  const hrefs: Record<string, string> = {};
  for (const id of h.fileIds) {
    hrefs[id] = `/portal/${h.token}/file/${id}/view`;
  }
  return hrefs;
}

export function createPortalRouter(): Router {
  const router = express.Router();

  const pageLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
  const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const commentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const downloadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  // Higher than a single-shot image view needs: scrubbing a video issues a
  // fresh Range request on every seek (often dozens in one review session),
  // all against an already session-gated, same-visitor connection.
  const viewLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false });
  const approveLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  // Portal pages are private-by-link: never indexed.
  router.use(["/portal", "/api/portal"], (_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // --- The portal page -------------------------------------------------------
  router.get("/portal/:token", pageLimiter, (req, res) => {
    const h = resolve(req, res, true);
    if (!h) return;

    if (h.accessMode === "password" && !hasSession(req, h.id)) {
      return res.status(401).type("html").send(portalPasswordPage(h.token));
    }
    // Invite links and public links authenticate by possession of the token.
    if (h.accessMode !== "password") setSessionCookie(res, h.id);

    // A Draft hasn't been sent — the studio's own "preview" reuses this exact
    // URL (see HandoverPanel's openLandingPage), so the page still needs to
    // render for that. What it must not do is look like real client activity:
    // logging a "view" here would surface as "<client> viewed the delivery"
    // on the studio's Home feed for a package nobody actually sent yet.
    if (h.status !== "Draft") audit(req, h, "view");
    const comments = getComments(h.id).filter(visibleToClient);
    res.type("html").send(
      renderHandoverPage({
        handover: h,
        files: filesOf(h),
        comments,
        downloadHrefs: signedDownloadHrefs(h),
        viewHrefs: viewHrefs(h),
        approvals: getApprovals(h.id),
      })
    );
  });

  // --- Password gate ---------------------------------------------------------
  router.post("/portal/:token/access", passwordLimiter, express.urlencoded({ extended: false }), (req, res) => {
    const h = resolve(req, res, true);
    if (!h) return;
    if (h.accessMode !== "password") return res.redirect(`/portal/${h.token}`);

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!verifyPassword(password, h.passwordHash)) {
      audit(req, h, "denied", "wrong_password");
      return res.status(401).type("html").send(portalPasswordPage(h.token, { error: true }));
    }
    setSessionCookie(res, h.id);
    audit(req, h, "granted", "password");
    res.redirect(`/portal/${h.token}`);
  });

  // --- Portal API (DTOs only) ------------------------------------------------
  router.get("/api/portal/:token/handover", (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h)) return;
    res.json(toPortalHandoverDTO(h, filesOf(h)));
  });

  router.get("/api/portal/:token/comments", (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h)) return;
    res.json(getComments(h.id).filter(visibleToClient).map(toPortalCommentDTO));
  });

  router.post("/api/portal/:token/comments", commentLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h) || !requireSent(req, res, h)) return;
    const { author, body, fileId, x, y, timecode, version } = req.body as {
      author?: string;
      body?: string;
      fileId?: string | null;
      x?: unknown;
      y?: unknown;
      timecode?: unknown;
      version?: unknown;
    };
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const targetFile = fileId ? filesOf(h).find((f) => f.id === fileId) : undefined;
    const validFileId = targetFile ? targetFile.id : null;

    // A pin only makes sense attached to a specific file, and only within
    // the 0-100 percentage range the client-side pin picker can ever send.
    const validCoord = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    const pinX = validFileId ? validCoord(x) : null;
    const pinY = validFileId ? validCoord(y) : null;
    // A video timecode pin — mutually exclusive with an x/y spatial pin, and
    // only meaningful once we have a spot to attach it to.
    const pinTimecode =
      validFileId && typeof timecode === "number" && Number.isFinite(timecode) && timecode >= 0 ? timecode : null;
    // Which round this pin is actually about — the version the client had open
    // when they left it, not necessarily whatever's current by the time it's
    // read back. Falls back to current for anything that doesn't name a real
    // version of the file (older clients, general notes).
    const pinVersion =
      targetFile && typeof version === "string" && targetFile.versions.some((v) => v.version === version)
        ? version
        : targetFile
          ? currentVersionOf(targetFile)
          : null;

    // Role and visibility are forced server-side: a portal visitor can only
    // ever write a client-visible client comment.
    const comment = addComment({
      id: "c" + Date.now() + Math.floor(Math.random() * 1000),
      handoverId: h.id,
      author: (author || "").trim().slice(0, 120) || "Client",
      role: "client",
      body: body.trim().slice(0, 4000),
      fileId: validFileId,
      x: pinX !== null && pinY !== null ? pinX : null,
      y: pinX !== null && pinY !== null ? pinY : null,
      timecode: pinX === null && pinY === null ? pinTimecode : null,
      version: pinVersion,
      created: new Date().toISOString(),
      internalOnly: false,
    });
    audit(req, h, "comment", comment.id);
    res.status(201).json(toPortalCommentDTO(comment));
  });

  // Editing/deleting is scoped to role: 'client' only — a portal visitor can
  // revise their own note, never the studio's side of the thread. There's no
  // real per-visitor identity behind a shared link (same as posting itself),
  // so this is the same trust boundary the rest of the portal already runs
  // on, not a stronger one.
  router.patch("/api/portal/:token/comments/:commentId", commentLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h)) return;
    const existing = getComments(h.id).find((c) => c.id === req.params.commentId);
    if (!existing || existing.role !== "client") return res.status(404).json({ error: "Note not found" });
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const updated = updateCommentBody(existing.id, body.trim().slice(0, 4000));
    if (!updated) return res.status(404).json({ error: "Note not found" });
    audit(req, h, "comment_edit", updated.id);
    res.json(toPortalCommentDTO(updated));
  });

  router.delete("/api/portal/:token/comments/:commentId", commentLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h)) return;
    const existing = getComments(h.id).find((c) => c.id === req.params.commentId);
    if (!existing || existing.role !== "client") return res.status(404).json({ error: "Note not found" });
    deleteComment(existing.id);
    audit(req, h, "comment_delete", existing.id);
    res.status(204).end();
  });

  // --- Approvals ---------------------------------------------------------
  router.get("/api/portal/:token/approvals", (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h)) return;
    res.json(getApprovals(h.id));
  });

  router.post("/api/portal/:token/file/:fileId/approve", approveLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h) || !requireSent(req, res, h)) return;
    const fileId = req.params.fileId;
    if (!h.fileIds.includes(fileId)) return res.status(404).json({ error: "File not found in this delivery" });
    const file = filesOf(h).find((f) => f.id === fileId);
    if (!file) return res.status(404).json({ error: "File not found in this delivery" });
    const { approvedBy } = req.body as { approvedBy?: string };
    const approval = approveFile(h.id, fileId, (approvedBy || "").trim().slice(0, 120) || null, currentVersionOf(file));
    audit(req, h, "approve", fileId);
    res.status(201).json(approval);
  });

  // The client's explicit "no, send this back" action — distinct from just
  // leaving a comment, so the studio can tell "still under first review" from
  // "the client rejected this" without reading prose.
  router.post("/api/portal/:token/file/:fileId/request-changes", approveLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h || !requireSession(req, res, h) || !requireSent(req, res, h)) return;
    const fileId = req.params.fileId;
    if (!h.fileIds.includes(fileId)) return res.status(404).json({ error: "File not found in this delivery" });
    const file = filesOf(h).find((f) => f.id === fileId);
    if (!file) return res.status(404).json({ error: "File not found in this delivery" });
    const { requestedBy, body } = req.body as { requestedBy?: string; body?: string };
    const author = (requestedBy || "").trim().slice(0, 120) || "Client";
    const status = requestChangesOnFile(h.id, fileId, author, currentVersionOf(file));
    // The reason is required and stored as a normal comment, so it shows up
    // in the same Discussion thread instead of living only as a status flip.
    const noteBody = (body || "").trim();
    if (noteBody) {
      addComment({
        id: "c" + Date.now() + Math.floor(Math.random() * 1000),
        handoverId: h.id,
        author,
        role: "client",
        body: noteBody.slice(0, 4000),
        fileId,
        created: new Date().toISOString(),
        internalOnly: false,
      });
    }
    audit(req, h, "request_changes", fileId);
    res.status(201).json(status);
  });

  // --- Inline view ("spectate") -----------------------------------------
  // Never approval-gated — a client has to see a file to decide whether to
  // approve it. Session-gated like the comments API, no signature needed
  // since it's a same-origin cookie request, not a persisted/shareable link.
  router.get("/portal/:token/file/:fileId/view", viewLimiter, (req, res) => {
    const h = resolve(req, res, false);
    if (!h) return;
    if (!hasSession(req, h.id)) return res.status(401).type("text").send("Session expired — reopen the delivery link.");
    const fileId = req.params.fileId;
    if (!h.fileIds.includes(fileId)) return res.status(404).type("text").send("File not found in this delivery.");
    const file = filesOf(h).find((f) => f.id === fileId);
    if (!file) return res.status(404).type("text").send("File not found in this delivery.");

    // ?v= requests a specific past round instead of the current blob — what
    // the version picker uses so a client can review or compare an earlier
    // version, not just whatever's latest.
    const version = typeof req.query.v === "string" ? req.query.v : null;
    if (version) {
      if (!file.versions.some((v) => v.version === version)) return res.status(404).type("text").send("Version not found.");
      if (!hasVersionContent(file.id, version)) return res.status(404).type("text").send("No stored content for this version.");
      audit(req, h, "view_file", `${file.name} (${version})`);
      return streamVersionContentWithRange(req, res, file.id, version, file.mime || "application/octet-stream");
    }

    if (!file.hasContent) return res.status(404).type("text").send("No preview available for this file.");
    audit(req, h, "view_file", file.name);
    streamContentWithRange(req, res, file.id, file.mime || "application/octet-stream");
  });

  // --- Downloads (signed, short-lived, revocation-aware) ---------------------
  router.get("/portal/:token/file/:fileId/download", downloadLimiter, (req, res) => {
    // Live access state is re-checked first, so revocation immediately kills
    // outstanding signed URLs.
    const h = resolve(req, res, true);
    if (!h) return;
    if (!hasSession(req, h.id)) return res.status(401).type("text").send("Session expired — reopen the delivery link.");

    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? "");
    const fileId = req.params.fileId;
    if (!verifyDownload(h.token, fileId, exp, sig, SECRET)) {
      audit(req, h, "denied", "bad_download_sig");
      return res.status(403).type("text").send("This download link has expired — reload the page and try again.");
    }
    if (!h.fileIds.includes(fileId)) return res.status(404).type("text").send("File not found in this delivery.");
    const file = filesOf(h).find((f) => f.id === fileId);
    if (!file) return res.status(404).type("text").send("File not found.");
    if (!isFileApproved(h.id, fileId, currentVersionOf(file))) {
      audit(req, h, "denied", "not_approved");
      return res
        .status(403)
        .type("text")
        .send("Approve this file's current version on the delivery page before downloading it.");
    }

    audit(req, h, "download", file.name);
    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._ -]/g, "_");
    if (file.hasContent) {
      // The real bytes, streamed from Desboard's local storage.
      res.setHeader("Content-Type", file.mime || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      return readContentStream(file.id).on("error", () => res.status(404).end()).pipe(res);
    }
    const body =
      `${file.name}\n${"=".repeat(Math.max(file.name.length, 3))}\n\n` +
      `Delivered via Desboard handover: ${h.title}\n` +
      `Recipient: ${h.recipient || "-"}\n` +
      `Type: ${file.type === "folder" ? "Folder" : (file.extension || "file").toUpperCase()}\n` +
      `Size: ${file.size || "-"}\n` +
      `Status: ${file.status || "-"}\n` +
      `Tags: ${(file.tags || []).join(", ") || "-"}\n\n` +
      `Note: This file's original content isn't available for download right now.\n` +
      `Contact the studio if you need it re-sent.\n`;
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.txt"`);
    res.type("text/plain; charset=utf-8").send(body);
  });

  return router;
}
