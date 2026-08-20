/**
 * SSO core tests. Two things matter most here: the state cookie must fail
 * closed exactly like the app/portal sessions do (same class of guarantee as
 * authCore.test.ts/portal.test.ts), and the JWT crypto — RS256 verification
 * for provider id_tokens, ES256 signing for Apple's client_secret — must
 * actually round-trip against real keys, not just "not throw."
 */
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  appleClientSecret,
  decodeJwt,
  isEmailVerified,
  issuerCheck,
  signSsoState,
  validateIdTokenClaims,
  verifyJwtSignature,
  verifySsoState,
} from "./ssoCore.ts";

const SECRET = "test-secret";

function makeRsaJwt(payload: object, kid = "test-kid") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const header = { alg: "RS256", kid, typ: "JWT" };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  const jwt = `${signingInput}.${signature.toString("base64url")}`;
  const jwk = publicKey.export({ format: "jwk" });
  return { jwt, jwk };
}

describe("SSO state", () => {
  it("round-trips a signed state and rejects tampering", () => {
    const state = signSsoState({ provider: "google", nonce: "n1" }, SECRET);
    expect(verifySsoState(state, SECRET)).toEqual({ provider: "google", nonce: "n1" });
    const [payload] = state.split(".");
    expect(verifySsoState(`${payload}.forged`, SECRET)).toBeNull();
    expect(verifySsoState(undefined, SECRET)).toBeNull();
  });

  it("expires after the 10-minute window", () => {
    const state = signSsoState({ provider: "apple", nonce: "n1" }, SECRET, Date.now() - 11 * 60 * 1000);
    expect(verifySsoState(state, SECRET)).toBeNull();
  });
});

describe("JWT decode + RS256 verification (Google/Microsoft/Apple id_token shape)", () => {
  it("verifies a validly-signed token against the matching JWK", () => {
    const { jwt, jwk } = makeRsaJwt({ iss: "https://accounts.google.com", aud: "client1", sub: "u1", exp: 9999999999, nonce: "n1" });
    const decoded = decodeJwt(jwt)!;
    expect(decoded.header.kid).toBe("test-kid");
    expect(verifyJwtSignature(decoded.signingInput, decoded.signature, jwk as JsonWebKey)).toBe(true);
  });

  it("rejects a token verified against the wrong key", () => {
    const { jwt } = makeRsaJwt({ iss: "https://accounts.google.com" });
    const { jwk: otherJwk } = makeRsaJwt({ iss: "unrelated" });
    const decoded = decodeJwt(jwt)!;
    expect(verifyJwtSignature(decoded.signingInput, decoded.signature, otherJwk as JsonWebKey)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(decodeJwt("not.a.jwt.at.all")).toBeNull();
    expect(decodeJwt("only-one-part")).toBeNull();
  });
});

describe("issuer checks", () => {
  it("accepts Google's two documented issuer forms", () => {
    const ok = issuerCheck("google");
    expect(ok("https://accounts.google.com")).toBe(true);
    expect(ok("accounts.google.com")).toBe(true);
    expect(ok("https://evil.example.com")).toBe(false);
  });

  it("matches Microsoft's tenant-embedded issuer by pattern, not equality", () => {
    const ok = issuerCheck("microsoft");
    expect(ok("https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0")).toBe(true);
    expect(ok("https://login.microsoftonline.com/common/v2.0")).toBe(true);
    expect(ok("https://login.microsoftonline.com/v2.0")).toBe(false);
    expect(ok("https://not-microsoft.com/tenant/v2.0")).toBe(false);
  });

  it("requires an exact match for Apple", () => {
    const ok = issuerCheck("apple");
    expect(ok("https://appleid.apple.com")).toBe(true);
    expect(ok("https://appleid.apple.com/")).toBe(false);
  });
});

describe("validateIdTokenClaims", () => {
  const issOk = () => true;
  const base = { iss: "x", aud: "client1", sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600, nonce: "n1" };

  it("passes a well-formed, matching token", () => {
    expect(validateIdTokenClaims(base, { clientId: "client1", nonce: "n1" }, issOk)).toBeNull();
  });

  it("catches audience mismatch, expiry, nonce mismatch, and a missing sub independently", () => {
    expect(validateIdTokenClaims(base, { clientId: "wrong-client", nonce: "n1" }, issOk)).toBe("bad_audience");
    expect(validateIdTokenClaims({ ...base, exp: 1 }, { clientId: "client1", nonce: "n1" }, issOk)).toBe("expired");
    expect(validateIdTokenClaims(base, { clientId: "client1", nonce: "wrong" }, issOk)).toBe("bad_nonce");
    expect(validateIdTokenClaims({ ...base, sub: undefined }, { clientId: "client1", nonce: "n1" }, issOk)).toBe("missing_sub");
    expect(validateIdTokenClaims(base, { clientId: "client1", nonce: "n1" }, () => false)).toBe("bad_issuer");
  });

  it("accepts an array-valued aud that contains the client id", () => {
    expect(validateIdTokenClaims({ ...base, aud: ["other", "client1"] }, { clientId: "client1", nonce: "n1" }, issOk)).toBeNull();
  });
});

describe("isEmailVerified", () => {
  it("treats Google's claim as a real boolean", () => {
    expect(isEmailVerified("google", { email_verified: true })).toBe(true);
    expect(isEmailVerified("google", { email_verified: "true" })).toBe(false);
  });

  it("treats Apple's claim as the documented string quirk", () => {
    expect(isEmailVerified("apple", { email_verified: "true" })).toBe(true);
    expect(isEmailVerified("apple", { email_verified: "false" })).toBe(false);
  });

  it("treats a present email as verified for Microsoft (no such claim exists there)", () => {
    expect(isEmailVerified("microsoft", { email: "a@example.com" })).toBe(true);
    expect(isEmailVerified("microsoft", {})).toBe(false);
  });
});

describe("appleClientSecret", () => {
  it("mints a well-formed, ES256-signed 3-part JWT with the correct claim shape", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const now = Date.now();
    const jwt = appleClientSecret({
      teamId: "TEAM123456",
      clientId: "com.desboard.web",
      keyId: "KEY1234567",
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      now,
    });

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "KEY1234567", typ: "JWT" });
    expect(payload.iss).toBe("TEAM123456");
    expect(payload.sub).toBe("com.desboard.web");
    expect(payload.aud).toBe("https://appleid.apple.com");
    expect(payload.exp - payload.iat).toBe(300);

    // The actual point of this test: the signature must verify against the
    // real public key using the same raw-r‖s (ieee-p1363) encoding a real
    // JWT consumer expects — not just "some bytes were produced."
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], "base64url");
    const valid = crypto.verify(null, Buffer.from(signingInput), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
    expect(valid).toBe(true);
  });
});
