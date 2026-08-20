/**
 * OAuth security + request-shaping core — PURE functions only (no Express, no
 * database, no network calls), same convention as portalCore.ts/authCore.ts:
 * everything the connect/callback flow depends on lives here so it can be
 * unit-tested directly.
 */
import crypto from "crypto";

export type OAuthProvider = "google" | "dropbox" | "onedrive";

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "dropbox" || value === "onedrive";
}

// --- Signed, short-lived CSRF state (stateless HMAC, same shape as portal sessions) ---

export interface OAuthStatePayload {
  provider: OAuthProvider;
  workspaceId: string;
  userId: string;
  /** Where to send the browser back to inside the SPA once the dance completes. */
  returnTo: string;
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // consent screens are quick; 10 minutes is generous

function hmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signOAuthState(data: OAuthStatePayload, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...data, iat: now })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifyOAuthState(value: string | undefined, secret: string, now = Date.now()): OAuthStatePayload | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<OAuthStatePayload> & { iat?: number };
    if (!data.provider || !data.workspaceId || !data.userId || typeof data.iat !== "number") return null;
    if (now - data.iat > STATE_MAX_AGE_MS) return null;
    return { provider: data.provider, workspaceId: data.workspaceId, userId: data.userId, returnTo: data.returnTo || "/" };
  } catch {
    return null;
  }
}

// --- Token refresh timing -----------------------------------------------------

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** True once a token is within 5 minutes of expiring, already expired, or has no known expiry. */
export function needsRefresh(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return now >= t - REFRESH_MARGIN_MS;
}

// --- Provider request shaping --------------------------------------------------

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Read-only, narrowest scopes that support "browse + import a copy" — this
// integration never writes back to Drive/Dropbox/OneDrive, so it never asks to.
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DROPBOX_SCOPE = "files.metadata.read files.content.read account_info.read";
// offline_access is required explicitly for Microsoft to issue a refresh_token
// (Google/Dropbox get one implicitly from access_type=offline / token_access_type).
const ONEDRIVE_SCOPE = "Files.Read offline_access";

export function authorizeUrl(provider: OAuthProvider, creds: ProviderCredentials, state: string): string {
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPE,
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
  if (provider === "onedrive") {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: "code",
      scope: ONEDRIVE_SCOPE,
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    response_type: "code",
    token_access_type: "offline",
    scope: DROPBOX_SCOPE,
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

export const TOKEN_URL: Record<OAuthProvider, string> = {
  google: "https://oauth2.googleapis.com/token",
  dropbox: "https://api.dropboxapi.com/oauth2/token",
  onedrive: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

export function tokenExchangeBody(creds: ProviderCredentials, code: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: creds.redirectUri,
  });
}

export function tokenRefreshBody(creds: ProviderCredentials, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
}

// --- Google-native file export mapping -----------------------------------------
// Docs/Sheets/Slides/Drawings have no raw bytes to download — they must be
// exported to a real format. Every target here is something Desboard can
// already preview, so an imported file behaves exactly like an uploaded one.

const GOOGLE_EXPORT_TARGETS: Record<string, { mime: string; extension: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", extension: "pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/pdf", extension: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", extension: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "image/png", extension: "png" },
};

export function googleExportTarget(mimeType: string): { mime: string; extension: string } | null {
  return GOOGLE_EXPORT_TARGETS[mimeType] ?? null;
}
