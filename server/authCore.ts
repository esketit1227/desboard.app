/**
 * Studio-auth session core — PURE functions only (no Express, no database),
 * same convention as portalCore.ts, so the signing/verification logic can be
 * unit-tested directly without spinning up a server.
 */
import crypto from "crypto";

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
  userId: string;
  workspaceId: string;
}

function hmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** A session is scoped to exactly one user, within exactly one workspace. */
export function signAppSession(userId: string, workspaceId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, w: workspaceId, iat: now })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifyAppSession(value: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: string; w?: string; iat?: number };
    if (!data.u || !data.w || typeof data.iat !== "number") return null;
    if (now - data.iat > SESSION_MAX_AGE_MS) return null;
    return { userId: data.u, workspaceId: data.w };
  } catch {
    return null;
  }
}
