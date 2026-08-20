/**
 * SSO login security + JWT core — PURE functions only (no Express, no
 * database, no network calls), same convention as portalCore.ts/oauthCore.ts:
 * everything the "Sign in with Google/Microsoft/Apple" flow depends on lives
 * here so it can be unit-tested directly.
 *
 * All three providers are OIDC-compliant, so one shared JWT-verification path
 * (RS256, via each provider's published JWKS) covers Google and Microsoft's
 * id_tokens; Apple's id_token is also RS256 (verified the same way), but
 * Apple additionally requires we mint our OWN JWT-shaped `client_secret`
 * (ES256-signed) to exchange a code for tokens in the first place — that's
 * `appleClientSecret()` below.
 */
import crypto from "crypto";

export type SsoProvider = "google" | "microsoft" | "apple";

export function isSsoProvider(value: string): value is SsoProvider {
  return value === "google" || value === "microsoft" || value === "apple";
}

// --- Signed, short-lived CSRF state (stateless HMAC, same shape as portalCore/oauthCore) ---

export interface SsoStatePayload {
  provider: SsoProvider;
  /** Round-tripped through the provider as the OIDC `nonce` param — binds the returned id_token to this specific flow. */
  nonce: string;
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function hmac(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSsoState(data: SsoStatePayload, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...data, iat: now })).toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function verifySsoState(value: string | undefined, secret: string, now = Date.now()): SsoStatePayload | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<SsoStatePayload> & { iat?: number };
    if (!data.provider || !data.nonce || typeof data.iat !== "number") return null;
    if (now - data.iat > STATE_MAX_AGE_MS) return null;
    return { provider: data.provider, nonce: data.nonce };
  } catch {
    return null;
  }
}

// --- Provider endpoints + authorize URL --------------------------------------

export const AUTHORIZE_URL: Record<SsoProvider, string> = {
  google: "https://accounts.google.com/o/oauth2/v2/auth",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  apple: "https://appleid.apple.com/auth/authorize",
};

export const TOKEN_URL: Record<SsoProvider, string> = {
  google: "https://oauth2.googleapis.com/token",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  apple: "https://appleid.apple.com/auth/token",
};

export const JWKS_URL: Record<SsoProvider, string> = {
  google: "https://www.googleapis.com/oauth2/v3/certs",
  microsoft: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
  apple: "https://appleid.apple.com/auth/keys",
};

export function authorizeUrl(provider: SsoProvider, clientId: string, redirectUri: string, state: string, nonce: string): string {
  const params: Record<string, string> = { client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, nonce };
  if (provider === "apple") {
    // Apple's authorize endpoint doesn't accept "openid" as a scope value,
    // and requesting name/email requires a POSTed (form_post) callback.
    params.scope = "name email";
    params.response_mode = "form_post";
  } else {
    params.scope = "openid email profile";
  }
  return `${AUTHORIZE_URL[provider]}?${new URLSearchParams(params).toString()}`;
}

export interface SsoCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function tokenExchangeBody(creds: SsoCredentials, code: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: creds.redirectUri,
  });
}

// --- JWT decode + RS256 signature verification -------------------------------

export interface DecodedJwt {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

export function decodeJwt(idToken: string): DecodedJwt | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    const signature = Buffer.from(sigB64, "base64url");
    return { header, payload, signingInput: `${headerB64}.${payloadB64}`, signature };
  } catch {
    return null;
  }
}

/** `jwk` is one entry from the provider's published JWKS, matched by `kid` beforehand. */
export function verifyJwtSignature(signingInput: string, signature: Buffer, jwk: JsonWebKey): boolean {
  try {
    const publicKey = crypto.createPublicKey({ format: "jwk", key: jwk as unknown as crypto.JsonWebKeyInput["key"] });
    return crypto.verify("RSA-SHA256", Buffer.from(signingInput), publicKey, signature);
  } catch {
    return false;
  }
}

// --- Claim validation ---------------------------------------------------------

/**
 * Microsoft's `/common` endpoint (required to accept both personal and
 * work/school accounts) embeds the actual signed-in tenant in `iss`
 * (`https://login.microsoftonline.com/{tenant-guid}/v2.0`) — not a single
 * fixed string, so this needs a pattern, not equality, for Microsoft only.
 */
export function issuerCheck(provider: SsoProvider): (iss: string) => boolean {
  if (provider === "google") return (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com";
  if (provider === "apple") return (iss) => iss === "https://appleid.apple.com";
  return (iss) => /^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/.test(iss);
}

export function validateIdTokenClaims(
  payload: Record<string, unknown>,
  opts: { clientId: string; nonce: string; now?: number },
  issOk: (iss: string) => boolean
): "bad_issuer" | "bad_audience" | "expired" | "bad_nonce" | "missing_sub" | null {
  const now = opts.now ?? Date.now();
  if (typeof payload.iss !== "string" || !issOk(payload.iss)) return "bad_issuer";
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.clientId)) return "bad_audience";
  if (typeof payload.exp !== "number" || now / 1000 > payload.exp) return "expired";
  if (payload.nonce !== opts.nonce) return "bad_nonce";
  if (!payload.sub) return "missing_sub";
  return null;
}

/**
 * Provider-specific: Google's `email_verified` is a real boolean. Apple's is
 * the STRING `"true"`/`"false"` (a well-known quirk — comparing with `=== true`
 * is silently always false against a real Apple token). Microsoft's v2.0
 * id_token has no such claim at all; a present `email` is treated as verified
 * by policy (MSA/AAD require a verified email to exist), not a spec guarantee.
 */
export function isEmailVerified(provider: SsoProvider, payload: Record<string, unknown>): boolean {
  if (provider === "google") return payload.email_verified === true;
  if (provider === "apple") return payload.email_verified === "true" || payload.email_verified === true;
  return typeof payload.email === "string" && payload.email.length > 0;
}

// --- Apple's JWT-shaped client_secret ------------------------------------------

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");
}

/**
 * Apple's token endpoint requires a `client_secret` that is itself a
 * short-lived JWT, ES256-signed with the private key from Apple's "Sign in
 * with Apple" key (.p8). Minted fresh per request (5-minute expiry) — no
 * caching or rotation problem since nothing is stored between requests.
 */
export function appleClientSecret(opts: { teamId: string; clientId: string; keyId: string; privateKeyPem: string; now?: number }): string {
  const now = opts.now ?? Date.now();
  const iat = Math.floor(now / 1000);
  const header = { alg: "ES256", kid: opts.keyId, typ: "JWT" };
  const payload = { iss: opts.teamId, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: opts.clientId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const privateKey = crypto.createPrivateKey(opts.privateKeyPem);
  // dsaEncoding: "ieee-p1363" produces the raw r‖s signature format JWTs
  // require directly — the default ("der") would need a manual conversion.
  const signature = crypto.sign(null, Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}
