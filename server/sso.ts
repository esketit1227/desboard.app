/**
 * "Sign in with Google / Microsoft / Apple" — a login mechanism, structurally
 * distinct from server/oauth.ts (which connects a Drive/Dropbox account to an
 * already-signed-in workspace, for file browsing). Mirrors oauth.ts's router
 * shape: pure security/JWT logic lives in ssoCore.ts, this file is just the
 * Express wiring. Mounted before the blanket `requireAuth` gate — it
 * fundamentally can't require a prior session, since establishing one is the
 * whole point.
 */
import crypto from "crypto";
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { createUser, createWorkspace, getOAuthIdentity, getUserByEmail, getUserById, linkOAuthIdentity } from "../db.ts";
import { hashPassword } from "./portalCore.ts";
import { setSessionCookie } from "./auth.ts";
import { oauthErrorPage } from "../src/lib/oauthStates.ts";
import {
  JWKS_URL,
  TOKEN_URL,
  appleClientSecret,
  authorizeUrl,
  decodeJwt,
  isEmailVerified,
  isSsoProvider,
  issuerCheck,
  signSsoState,
  tokenExchangeBody,
  validateIdTokenClaims,
  verifyJwtSignature,
  verifySsoState,
  type SsoProvider,
} from "./ssoCore.ts";

const SECRET = process.env.OAUTH_STATE_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const STATE_COOKIE = "db_sso_state";

const PROVIDER_LABEL: Record<SsoProvider, string> = { google: "Google", microsoft: "Microsoft", apple: "Apple" };

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

interface ProviderConfig {
  clientId: string;
  redirectUri: string;
}

/** Google's client id/secret are reused from the existing Drive integration — one Google Cloud OAuth client legitimately supports multiple registered redirect URIs with different scopes requested per authorize-call. */
function getProviderConfig(provider: SsoProvider, req: Request): ProviderConfig | null {
  const redirectUri = `${req.protocol}://${req.get("host")}/api/auth/sso/${provider}/callback`;
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return null;
    return { clientId, redirectUri };
  }
  if (provider === "microsoft") {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId || !process.env.MICROSOFT_CLIENT_SECRET) return null;
    return { clientId, redirectUri };
  }
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId || !process.env.APPLE_TEAM_ID || !process.env.APPLE_KEY_ID || !process.env.APPLE_PRIVATE_KEY) return null;
  return { clientId, redirectUri };
}

/** Called only after getProviderConfig() already confirmed presence, so the `!`s here are safe. */
function getClientSecret(provider: SsoProvider): string {
  if (provider === "google") return process.env.GOOGLE_CLIENT_SECRET!;
  if (provider === "microsoft") return process.env.MICROSOFT_CLIENT_SECRET!;
  const raw = process.env.APPLE_PRIVATE_KEY!;
  const privateKeyPem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  return appleClientSecret({
    teamId: process.env.APPLE_TEAM_ID!,
    clientId: process.env.APPLE_CLIENT_ID!,
    keyId: process.env.APPLE_KEY_ID!,
    privateKeyPem,
  });
}

// Cached per-provider JWKS, so a normal login doesn't hit the provider's key
// endpoint every time. A floor on how often an unrecognized `kid` can force a
// refetch keeps a forged callback from being used to hammer the endpoint.
interface JwksCacheEntry {
  keys: Map<string, JsonWebKey>;
  fetchedAt: number;
}
const jwksCache = new Map<SsoProvider, JwksCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000;

async function getJwk(provider: SsoProvider, kid: string): Promise<JsonWebKey | null> {
  const now = Date.now();
  let entry = jwksCache.get(provider);
  const stale = !entry || now - entry.fetchedAt > JWKS_TTL_MS;
  const unknownKid = !!entry && !entry.keys.has(kid);
  if (stale || (unknownKid && now - (entry?.fetchedAt ?? 0) > JWKS_MIN_REFETCH_MS)) {
    try {
      const res = await fetch(JWKS_URL[provider]);
      if (res.ok) {
        const data = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
        entry = { keys: new Map(data.keys.map((k) => [k.kid, k])), fetchedAt: now };
        jwksCache.set(provider, entry);
      }
    } catch {
      /* fall through to whatever's cached (possibly nothing) */
    }
  }
  return entry?.keys.get(kid) ?? null;
}

/**
 * Resolve a verified provider identity to a Desboard user, creating a new
 * workspace+user on first sign-in, and log them in. Order: existing linked
 * identity → link to an existing password-signup account with the same
 * verified email → brand-new signup.
 */
async function resolveAndLogIn(
  res: Response,
  provider: SsoProvider,
  sub: string,
  email: string | null,
  emailVerified: boolean,
  name: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
  const identity = getOAuthIdentity(provider, sub);
  let user = identity ? getUserById(identity.userId) : undefined;

  if (!user && email && emailVerified) {
    const existing = getUserByEmail(email);
    if (existing) {
      linkOAuthIdentity(provider, sub, existing.id, email);
      user = existing;
    }
  }

  if (!user) {
    if (!email) return { ok: false, message: "This provider didn't share an email address, so an account can't be created." };
    try {
      const workspace = createWorkspace(`${email.split("@")[0]}'s studio`);
      user = createUser({
        workspaceId: workspace.id,
        email,
        // Random, never-known password — this account is SSO-only. Avoids a
        // migration on users.password_hash's NOT NULL constraint.
        passwordHash: hashPassword(crypto.randomBytes(32).toString("hex")),
        name: name || undefined,
      });
      linkOAuthIdentity(provider, sub, user.id, email);
    } catch (e) {
      // idx_users_email is UNIQUE — a concurrent double-submit can race here
      // exactly like /api/auth/signup already can. Recover instead of erroring.
      const raced = getUserByEmail(email);
      if (!raced) throw e;
      linkOAuthIdentity(provider, sub, raced.id, email);
      user = raced;
    }
  }

  setSessionCookie(res, user.id, user.workspaceId);
  return { ok: true };
}

export function createSsoRouter(): Router {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  router.get("/api/auth/sso/:provider/start", limiter, (req, res) => {
    const provider = req.params.provider;
    if (!isSsoProvider(provider)) {
      return res.status(404).send(oauthErrorPage("Unknown sign-in method", "This sign-in method isn't supported."));
    }
    const config = getProviderConfig(provider, req);
    if (!config) {
      return res
        .status(503)
        .send(
          oauthErrorPage(
            `Sign in with ${PROVIDER_LABEL[provider]} isn't set up yet`,
            `This Desboard server is missing its ${PROVIDER_LABEL[provider]} sign-in credentials. Ask whoever runs this workspace to add them, or sign in with email instead.`
          )
        );
    }
    const nonce = crypto.randomBytes(16).toString("base64url");
    const state = signSsoState({ provider, nonce }, SECRET);
    // Apple's callback is a cross-site top-level POST — a SameSite=Lax cookie
    // (fine for Google/Microsoft's GET callback) is never sent on that, so
    // the CSRF check below would fail on every real Apple login without this.
    const cookieAttrs = provider === "apple" ? "HttpOnly; Secure; SameSite=None" : "HttpOnly; SameSite=Lax";
    res.setHeader("Set-Cookie", `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; ${cookieAttrs}; Max-Age=600`);
    res.redirect(authorizeUrl(provider, config.clientId, config.redirectUri, state, nonce));
  });

  const handleCallback = async (req: Request, res: Response) => {
    const provider = req.params.provider;
    if (!isSsoProvider(provider)) {
      return res.status(404).send(oauthErrorPage("Unknown sign-in method", "This sign-in method isn't supported."));
    }

    // Apple's response_mode=form_post delivers code/state in the body; Google/Microsoft use query params.
    const source: Record<string, unknown> = provider === "apple" ? req.body ?? {} : req.query;
    const cookieState = readCookie(req, STATE_COOKIE);
    res.append("Set-Cookie", `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

    const queryState = typeof source.state === "string" ? source.state : undefined;
    const state = queryState && queryState === cookieState ? verifySsoState(queryState, SECRET) : null;
    if (!state || state.provider !== provider) {
      return res.status(400).send(oauthErrorPage("Sign-in failed", "This sign-in attempt couldn't be verified. Please try again."));
    }

    const code = typeof source.code === "string" ? source.code : null;
    if (!code) {
      return res.status(400).send(oauthErrorPage("Sign-in cancelled", "The sign-in was cancelled or didn't complete."));
    }

    const config = getProviderConfig(provider, req);
    if (!config) {
      return res
        .status(503)
        .send(oauthErrorPage(`Sign in with ${PROVIDER_LABEL[provider]} isn't set up yet`, "This server is missing its sign-in credentials."));
    }

    try {
      const tokenRes = await fetch(TOKEN_URL[provider], {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenExchangeBody({ clientId: config.clientId, clientSecret: getClientSecret(provider), redirectUri: config.redirectUri }, code),
      });
      if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
      const tokenData = (await tokenRes.json()) as { id_token?: string };
      if (!tokenData.id_token) throw new Error("No id_token returned");

      const decoded = decodeJwt(tokenData.id_token);
      if (!decoded || !decoded.header.kid) throw new Error("Malformed id_token");
      const jwk = await getJwk(provider, decoded.header.kid);
      if (!jwk || !verifyJwtSignature(decoded.signingInput, decoded.signature, jwk)) {
        throw new Error("id_token signature verification failed");
      }
      const claimError = validateIdTokenClaims(decoded.payload, { clientId: config.clientId, nonce: state.nonce }, issuerCheck(provider));
      if (claimError) throw new Error(`id_token rejected: ${claimError}`);

      const sub = String(decoded.payload.sub);
      const email = typeof decoded.payload.email === "string" ? decoded.payload.email : null;
      const emailVerified = isEmailVerified(provider, decoded.payload);

      // Apple only ever sends the real name once, as a JSON string in the
      // form body, on the browser's first-ever authorization for this
      // Services ID — capture it now or it's gone permanently.
      let name: string | null = typeof decoded.payload.name === "string" ? decoded.payload.name : null;
      if (provider === "apple" && typeof req.body?.user === "string") {
        try {
          const appleUser = JSON.parse(req.body.user) as { name?: { firstName?: string; lastName?: string } };
          if (appleUser.name) name = [appleUser.name.firstName, appleUser.name.lastName].filter(Boolean).join(" ") || null;
        } catch {
          /* malformed/absent — fine, just no name captured */
        }
      }

      const result = await resolveAndLogIn(res, provider, sub, email, emailVerified, name);
      if (result.ok === false) return res.status(400).send(oauthErrorPage("Sign-in failed", result.message));
      res.redirect("/");
    } catch (e: any) {
      res.status(502).send(oauthErrorPage("Sign-in failed", e?.message || "Something went wrong signing you in. Please try again."));
    }
  };

  router.get("/api/auth/sso/:provider/callback", handleCallback);
  router.post("/api/auth/sso/:provider/callback", handleCallback);

  return router;
}
