/**
 * Google Drive / Dropbox connections — connect, browse, and import a copy of
 * a file into Desboard's own storage. No writes back to the provider, and no
 * continuous sync: a connection is used on demand, when a studio member
 * chooses to browse or import.
 *
 * Structurally mirrors portal.ts: pure security/shaping logic lives in
 * oauthCore.ts, this file is just the Express wiring. Mounted before the
 * blanket `requireAuth` gate (like portal.ts and auth.ts) because /callback
 * is a full-page browser redirect that must fail with an HTML page, not a
 * JSON 401 — every other route here checks the studio session itself, the
 * same way GET /api/auth/me does inside auth.ts.
 */
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import {
  deleteOAuthToken,
  getOAuthToken,
  saveOAuthConnection,
  setOAuthError,
  updateOAuthTokens,
} from "../db.ts";
import { readAuthSession } from "./auth.ts";
import { writeContent } from "./storage.ts";
import { createFile } from "../db.ts";
import {
  TOKEN_URL,
  authorizeUrl,
  googleExportTarget,
  isOAuthProvider,
  needsRefresh,
  signOAuthState,
  tokenExchangeBody,
  tokenRefreshBody,
  verifyOAuthState,
  type OAuthProvider,
  type ProviderCredentials,
} from "./oauthCore.ts";
import { oauthErrorPage } from "../src/lib/oauthStates.ts";
import crypto from "crypto";

const SECRET = process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const STATE_COOKIE = "db_oauth_state";

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function getCredentials(provider: OAuthProvider, req: Request): ProviderCredentials | null {
  const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/${provider}/callback`;
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri };
  }
  if (provider === "onedrive") {
    // Reuses the same Azure app registration as "Sign in with Microsoft"
    // (server/sso.ts) — one app, multiple redirect URIs, different scope
    // requested per authorize-call, same pattern as Google's dual purpose.
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri };
  }
  const clientId = process.env.DROPBOX_APP_KEY;
  const clientSecret = process.env.DROPBOX_APP_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google Drive", dropbox: "Dropbox", onedrive: "OneDrive" };
const PROVIDER_ENV_HINT: Record<OAuthProvider, string> = {
  google: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET",
  dropbox: "DROPBOX_APP_KEY/DROPBOX_APP_SECRET",
  onedrive: "MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET",
};

/**
 * Returns a live access token, refreshing first if it's due to expire. Null
 * means "not connected" or "refresh failed" — callers distinguish those via
 * getOAuthToken()/the stamped last_error, not via this return value alone.
 */
async function ensureAccessToken(workspaceId: string, provider: OAuthProvider, req: Request): Promise<string | null> {
  const token = getOAuthToken(workspaceId, provider);
  if (!token) return null;
  if (!needsRefresh(token.expiresAt)) return token.accessToken;
  if (!token.refreshToken) {
    setOAuthError(workspaceId, provider, "Connection expired and can't refresh automatically — reconnect required.");
    return null;
  }
  const creds = getCredentials(provider, req);
  if (!creds) {
    setOAuthError(workspaceId, provider, `${PROVIDER_LABEL[provider]} isn't configured on this server.`);
    return null;
  }
  try {
    const res = await fetch(TOKEN_URL[provider], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRefreshBody(creds, token.refreshToken),
    });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    updateOAuthTokens(workspaceId, provider, data.access_token, expiresAt, data.refresh_token ?? null);
    return data.access_token;
  } catch (e: any) {
    setOAuthError(workspaceId, provider, e?.message || "Token refresh failed — reconnect required.");
    return null;
  }
}

interface BrowseItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: string | null;
  modifiedAt: string | null;
}

async function browseGoogle(accessToken: string, folderId: string | undefined, pageToken: string | undefined) {
  const params = new URLSearchParams({
    q: `'${folderId || "root"}' in parents and trashed = false`,
    fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
    pageSize: "50",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Drive listing failed (${res.status})`);
  const data = (await res.json()) as {
    nextPageToken?: string;
    files: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[];
  };
  const items: BrowseItem[] = data.files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
    size: f.size ?? null,
    modifiedAt: f.modifiedTime ?? null,
  }));
  return { items, nextPageToken: data.nextPageToken ?? null };
}

async function browseDropbox(accessToken: string, folderPath: string | undefined) {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: folderPath || "" }),
  });
  if (!res.ok) throw new Error(`Dropbox listing failed (${res.status})`);
  const data = (await res.json()) as {
    entries: { ".tag": string; id: string; name: string; path_lower: string; size?: number; server_modified?: string }[];
  };
  const items: BrowseItem[] = data.entries.map((e) => ({
    id: e.path_lower,
    name: e.name,
    mimeType: e[".tag"] === "folder" ? "application/vnd.dropbox.folder" : "application/octet-stream",
    isFolder: e[".tag"] === "folder",
    size: typeof e.size === "number" ? String(e.size) : null,
    modifiedAt: e.server_modified ?? null,
  }));
  return { items, nextPageToken: null };
}

/**
 * One page (50 items) per request — same simplification the Dropbox browser
 * above already makes. Graph's real pagination token (`@odata.nextLink`) is a
 * full continuation URL, not an opaque token like Google's; not worth the
 * added shape complexity for this "browse + import a copy" scope.
 */
async function browseOneDrive(accessToken: string, folderId: string | undefined) {
  const path = folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : "/me/drive/root/children";
  const params = new URLSearchParams({ $top: "50", $select: "id,name,size,lastModifiedDateTime,folder,file" });
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`OneDrive listing failed (${res.status})`);
  const data = (await res.json()) as {
    value: { id: string; name: string; size?: number; lastModifiedDateTime?: string; folder?: unknown; file?: { mimeType?: string } }[];
  };
  const items: BrowseItem[] = data.value.map((it) => ({
    id: it.id,
    name: it.name,
    mimeType: it.file?.mimeType || (it.folder ? "application/vnd.onedrive.folder" : "application/octet-stream"),
    isFolder: !!it.folder,
    size: typeof it.size === "number" ? String(it.size) : null,
    modifiedAt: it.lastModifiedDateTime ?? null,
  }));
  return { items, nextPageToken: null };
}

export function createOAuthRouter(): Router {
  const router = express.Router();
  const actionLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

  router.get("/api/oauth/:provider/status", (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).json({ error: "Unknown provider" });
    const session = readAuthSession(req);
    if (!session) return res.status(401).json({ error: "Not signed in" });
    const token = getOAuthToken(session.workspaceId, provider);
    if (!token) return res.json({ connected: false });
    res.json({
      connected: true,
      accountLabel: token.accountLabel,
      connectedAt: token.connectedAt,
      lastError: token.lastError,
      lastErrorAt: token.lastErrorAt,
      scope: token.scope,
    });
  });

  router.get("/api/oauth/:provider/connect", (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).send(oauthErrorPage("Unknown connection", "This provider isn't supported."));
    const session = readAuthSession(req);
    if (!session) return res.status(401).send(oauthErrorPage("Sign in required", "Sign in to Desboard first, then try connecting again."));
    const creds = getCredentials(provider, req);
    if (!creds) {
      return res
        .status(503)
        .send(
          oauthErrorPage(
            `${PROVIDER_LABEL[provider]} isn't set up yet`,
            `This Desboard server is missing its ${PROVIDER_ENV_HINT[provider]} environment variables. Ask whoever runs this workspace to add them.`
          )
        );
    }
    const state = signOAuthState({ provider, workspaceId: session.workspaceId, userId: session.userId, returnTo: "/" }, SECRET);
    res.setHeader("Set-Cookie", `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
    res.redirect(authorizeUrl(provider, creds, state));
  });

  router.get("/api/oauth/:provider/callback", async (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).send(oauthErrorPage("Unknown connection", "This provider isn't supported."));

    const cookieState = readCookie(req, STATE_COOKIE);
    const queryState = typeof req.query.state === "string" ? req.query.state : undefined;
    // The state travels both ways (query param round-tripped by the provider,
    // and our own cookie) so a forged callback can't be replayed cross-session.
    const state = queryState && queryState === cookieState ? verifyOAuthState(queryState, SECRET) : null;
    res.setHeader("Set-Cookie", `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

    if (!state || state.provider !== provider) {
      return res.status(400).send(oauthErrorPage("Connection failed", "This connection attempt couldn't be verified. Please try connecting again."));
    }
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) {
      return res.redirect(`${state.returnTo}?oauth_error=denied`);
    }
    const creds = getCredentials(provider, req);
    if (!creds) {
      return res.status(503).send(oauthErrorPage(`${PROVIDER_LABEL[provider]} isn't set up yet`, "This server is missing its OAuth credentials."));
    }

    try {
      const tokenRes = await fetch(TOKEN_URL[provider], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenExchangeBody(creds, code),
      });
      if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
      const data = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
      const accountLabel = await fetchAccountLabel(provider, data.access_token);

      saveOAuthConnection(state.workspaceId, provider, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt,
        scope: data.scope ?? null,
        accountLabel,
      });
      res.redirect(`${state.returnTo}?oauth=${provider}_connected`);
    } catch (e: any) {
      res.status(502).send(oauthErrorPage("Connection failed", e?.message || "Something went wrong finishing the connection. Please try again."));
    }
  });

  router.post("/api/oauth/:provider/disconnect", actionLimiter, async (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).json({ error: "Unknown provider" });
    const session = readAuthSession(req);
    if (!session) return res.status(401).json({ error: "Not signed in" });
    deleteOAuthToken(session.workspaceId, provider);
    res.status(204).end();
  });

  router.get("/api/oauth/:provider/browse", actionLimiter, async (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).json({ error: "Unknown provider" });
    const session = readAuthSession(req);
    if (!session) return res.status(401).json({ error: "Not signed in" });

    const accessToken = await ensureAccessToken(session.workspaceId, provider, req);
    if (!accessToken) return res.status(502).json({ error: "reconnect_required" });

    const folder = typeof req.query.folder === "string" ? req.query.folder : undefined;
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    try {
      const result =
        provider === "google"
          ? await browseGoogle(accessToken, folder, pageToken)
          : provider === "onedrive"
            ? await browseOneDrive(accessToken, folder)
            : await browseDropbox(accessToken, folder);
      res.json(result);
    } catch (e: any) {
      setOAuthError(session.workspaceId, provider, e?.message || "Couldn't list files.");
      res.status(502).json({ error: "reconnect_required" });
    }
  });

  router.post("/api/oauth/:provider/import", actionLimiter, async (req, res) => {
    const provider = req.params.provider;
    if (!isOAuthProvider(provider)) return res.status(404).json({ error: "Unknown provider" });
    const session = readAuthSession(req);
    if (!session) return res.status(401).json({ error: "Not signed in" });

    const { fileId, name, mimeType, projectId } = req.body as {
      fileId?: string;
      name?: string;
      mimeType?: string;
      projectId?: number | null;
    };
    if (!fileId || !name) return res.status(400).json({ error: "fileId and name are required" });

    const accessToken = await ensureAccessToken(session.workspaceId, provider, req);
    if (!accessToken) return res.status(502).json({ error: "reconnect_required" });

    try {
      const { buffer, finalMime, finalName } = await downloadOrExport(provider, accessToken, fileId, name, mimeType || "");
      const base64 = buffer.toString("base64");
      const newFileId = `oauth_${provider}_${Date.now()}`;
      writeContent(newFileId, base64);
      const created = createFile(
        {
          id: newFileId,
          name: finalName,
          type: "file",
          extension: finalName.includes(".") ? finalName.split(".").pop() : undefined,
          created: new Date().toISOString(),
          owner: "You",
          source: provider === "google" ? "Drive" : provider === "onedrive" ? "OneDrive" : "Dropbox",
          status: "Draft",
          tags: [],
          projectId: projectId ?? null,
          versions: [],
          access: [],
          mime: finalMime,
          hasContent: true,
        },
        session.workspaceId
      );
      res.status(201).json(created);
    } catch (e: any) {
      res.status(502).json({ error: e?.message || "Import failed" });
    }
  });

  return router;
}

async function fetchAccountLabel(provider: OAuthProvider, accessToken: string): Promise<string | null> {
  try {
    if (provider === "google") {
      const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
      return data.user?.emailAddress ?? data.user?.displayName ?? null;
    }
    if (provider === "onedrive") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
      return data.mail ?? data.userPrincipalName ?? data.displayName ?? null;
    }
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string; name?: { display_name?: string } };
    return data.email ?? data.name?.display_name ?? null;
  } catch {
    return null;
  }
}

async function downloadOrExport(
  provider: OAuthProvider,
  accessToken: string,
  fileId: string,
  name: string,
  sourceMime: string
): Promise<{ buffer: Buffer; finalMime: string; finalName: string }> {
  if (provider === "google") {
    const exportTarget = googleExportTarget(sourceMime);
    const url = exportTarget
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportTarget.mime)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Google Drive download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const finalName = exportTarget && !name.endsWith(`.${exportTarget.extension}`) ? `${name}.${exportTarget.extension}` : name;
    return { buffer, finalMime: exportTarget?.mime || sourceMime || "application/octet-stream", finalName };
  }
  if (provider === "onedrive") {
    // OneDrive stores real file bytes (even for Office docs) — no export
    // mapping needed the way Google-native files require.
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`OneDrive download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, finalMime: sourceMime || "application/octet-stream", finalName: name };
  }
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Dropbox-API-Arg": JSON.stringify({ path: fileId }) },
  });
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, finalMime: sourceMime || "application/octet-stream", finalName: name };
}
