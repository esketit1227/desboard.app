/**
 * Team invites — the missing piece that lets more than one person actually
 * work in the same studio workspace. Every other signup path (email/password,
 * SSO) always mints a brand-new workspace; this is the only path that joins
 * an EXISTING one. Two route groups:
 *   - /api/team/invites* — studio-authenticated, owner-only management
 *     (create/list/revoke), mounted behind the app's normal requireAuth gate.
 *   - /api/invites/:token* — public, token-only, the same "possession is the
 *     credential" trust model as the client portal, since whoever's accepting
 *     an invite has no session yet.
 */
import { hashPassword } from "./portalCore.ts";
import { setSessionCookie, type AuthedRequest } from "./auth.ts";
import express, { type NextFunction, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createInvite,
  createUser,
  getInviteByToken,
  getPendingInvites,
  getUserByEmail,
  getUserById,
  getWorkspaceMembers,
  markInviteAccepted,
  revokeInvite,
} from "../db.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite management is owner-only — a member shouldn't be able to grant themselves or others broader access. */
function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = req.auth && getUserById(req.auth.userId);
  if (!user || user.role !== "owner") return res.status(403).json({ error: "Only the studio owner can manage invites" });
  next();
}

export function createTeamRouter(): Router {
  const router = express.Router();

  router.get("/api/team/members", (req: AuthedRequest, res) => {
    res.json(getWorkspaceMembers(req.auth!.workspaceId));
  });

  router.get("/api/team/invites", requireOwner, (req: AuthedRequest, res) => {
    res.json(getPendingInvites(req.auth!.workspaceId));
  });

  router.post("/api/team/invites", requireOwner, (req: AuthedRequest, res) => {
    const { email, role } = req.body as { email?: string; role?: string };
    const cleanEmail = (email || "").trim().toLowerCase();
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address" });
    const invite = createInvite(req.auth!.workspaceId, {
      email: cleanEmail || null,
      role: role === "owner" ? "owner" : "member",
      createdBy: req.auth!.userId,
    });
    res.status(201).json(invite);
  });

  router.delete("/api/team/invites/:token", requireOwner, (req: AuthedRequest, res) => {
    const ok = revokeInvite(req.params.token, req.auth!.workspaceId);
    if (!ok) return res.status(404).json({ error: "Invite not found" });
    res.status(204).end();
  });

  return router;
}

export function createInviteAcceptRouter(): Router {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  router.get("/api/invites/:token", limiter, (req, res) => {
    const invite = getInviteByToken(req.params.token);
    const valid = !!invite && !invite.revoked && !invite.accepted_at;
    res.json({ workspaceName: invite?.workspaceName ?? "", email: invite?.email ?? null, valid });
  });

  router.post("/api/invites/:token/accept", limiter, (req, res) => {
    const invite = getInviteByToken(req.params.token);
    if (!invite || invite.revoked || invite.accepted_at) {
      return res.status(410).json({ error: "This invite is no longer valid" });
    }
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address" });
    if (invite.email && invite.email !== cleanEmail) {
      return res.status(403).json({ error: `This invite was sent to ${invite.email}` });
    }
    if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    if (getUserByEmail(cleanEmail)) {
      return res.status(409).json({ error: "An account with that email already exists — sign in instead" });
    }

    const role = invite.role === "owner" ? "owner" : "member";
    const user = createUser({
      workspaceId: invite.workspace_id,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      name: (name || "").trim() || undefined,
      role,
    });
    markInviteAccepted(invite.token);
    setSessionCookie(res, user.id, user.workspaceId);
    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      workspaceId: user.workspaceId,
      workspaceName: user.workspaceName,
      role: user.role,
    });
  });

  return router;
}
