/**
 * Studio-side authentication: signup / login / logout / me, plus the
 * `requireAuth` middleware that gates every internal `/api/*` route.
 *
 * Sessions are stateless HMAC cookies — the same shape as the client portal's
 * (see portalCore.ts), just scoped to a user+workspace instead of a single
 * handover. `requireAuth` trusts a valid signature without a database
 * round-trip on every request (same tradeoff the portal already makes for
 * `hasSession()`); only `/api/auth/me` hits the database, to return a fresh
 * name/email/workspace name for display.
 */
import crypto from "crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { hashPassword, verifyPassword } from "./portalCore.ts";
import { SESSION_MAX_AGE_MS, signAppSession, verifyAppSession, type Session } from "./authCore.ts";
import { createUser, createWorkspace, getUserByEmail, getUserById } from "../db.ts";

// Without SESSION_SECRET in the env the secret is per-process, so sessions
// reset on every server restart. Fine for local dev; server.ts refuses to
// boot in production without this set (see the startup guard there).
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "db_auth";

export type { Session };

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Exported so server/sso.ts can write the identical session cookie on a
 * successful SSO login. Uses `append`, not `setHeader` — a plain `setHeader`
 * would silently replace (not add to) any other `Set-Cookie` header already
 * queued on the same response, e.g. sso.ts's callback also needs to clear its
 * state cookie in the same response that sets this one.
 */
export function setSessionCookie(res: Response, userId: string, workspaceId: string) {
  const value = signAppSession(userId, workspaceId, SECRET);
  res.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_MS / 1000}`);
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export interface AuthedRequest extends Request {
  auth?: Session;
}

/**
 * Gate for every internal `/api/*` route (mounted in server.ts after the
 * public auth + portal routers, so it never intercepts those). Attaches
 * `req.auth` on success or responds 401.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const session = verifyAppSession(readCookie(req, COOKIE), SECRET);
  if (!session) return res.status(401).json({ error: "Not signed in" });
  req.auth = session;
  next();
}

/**
 * Non-middleware form of the same check, for routers mounted before the
 * blanket `requireAuth` (portal-style: each route decides its own auth
 * inline) — e.g. the OAuth callback, which needs to redirect on failure
 * rather than respond with a JSON 401 mid-navigation.
 */
export function readAuthSession(req: Request): Session | null {
  return verifyAppSession(readCookie(req, COOKIE), SECRET);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  role: string;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspaceId: user.workspaceId,
    workspaceName: user.workspaceName,
    role: user.role === "member" ? "member" : "owner",
  };
}

export function createAuthRouter(): Router {
  const router = express.Router();
  // Signup/login are the only unauthenticated write surface on the internal
  // API, so they get their own rate limit — mirrors the portal's password
  // gate limiter in server/portal.ts.
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  router.post("/api/auth/signup", authLimiter, (req, res) => {
    const { email, password, name, workspaceName } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      workspaceName?: string;
    };
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "Enter a valid email address" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (getUserByEmail(cleanEmail)) return res.status(409).json({ error: "An account with that email already exists" });

    const workspace = createWorkspace((workspaceName || "").trim() || `${cleanEmail.split("@")[0]}'s studio`);
    const user = createUser({
      workspaceId: workspace.id,
      email: cleanEmail,
      passwordHash: hashPassword(password),
      name: (name || "").trim() || undefined,
    });
    setSessionCookie(res, user.id, workspace.id);
    res.status(201).json(publicUser(user));
  });

  router.post("/api/auth/login", authLimiter, (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || "").trim().toLowerCase();
    const user = getUserByEmail(cleanEmail);
    if (!user || !verifyPassword(password || "", user.passwordHash)) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    setSessionCookie(res, user.id, user.workspaceId);
    res.json(publicUser(user));
  });

  router.post("/api/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/api/auth/me", (req, res) => {
    const session = verifyAppSession(readCookie(req, COOKIE), SECRET);
    if (!session) return res.status(401).json({ error: "Not signed in" });
    const user = getUserById(session.userId);
    if (!user) return res.status(401).json({ error: "Not signed in" });
    res.json(publicUser(user));
  });

  return router;
}
