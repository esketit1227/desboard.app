/**
 * Studio-auth session tests — the same class of guarantee as
 * portal.test.ts's session tests: a session must be scoped to exactly the
 * user+workspace it was issued for, must fail closed on tampering/forgery,
 * and must expire.
 */
import { describe, expect, it } from "vitest";
import { signAppSession, verifyAppSession } from "./authCore.ts";

const SECRET = "test-secret";

describe("app sessions", () => {
  it("verifies a session issued for a given user and workspace", () => {
    const cookie = signAppSession("u1", "w1", SECRET);
    expect(verifyAppSession(cookie, SECRET)).toEqual({ userId: "u1", workspaceId: "w1" });
  });

  it("rejects tampered and forged cookies", () => {
    const cookie = signAppSession("u1", "w1", SECRET);
    const [payload] = cookie.split(".");
    expect(verifyAppSession(`${payload}.forged`, SECRET)).toBeNull();
    // Re-signed with the wrong secret.
    expect(verifyAppSession(signAppSession("u1", "w1", "other-secret"), SECRET)).toBeNull();
    expect(verifyAppSession(undefined, SECRET)).toBeNull();
  });

  it("rejects a cookie whose payload was swapped for another user/workspace", () => {
    const cookieA = signAppSession("u1", "w1", SECRET);
    const cookieB = signAppSession("u2", "w2", SECRET);
    const [, sigA] = cookieA.split(".");
    const [payloadB] = cookieB.split(".");
    // Mix payload B with signature A — signature won't match, so this must fail closed.
    expect(verifyAppSession(`${payloadB}.${sigA}`, SECRET)).toBeNull();
  });

  it("expires sessions after their max age", () => {
    const old = signAppSession("u1", "w1", SECRET, Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(verifyAppSession(old, SECRET)).toBeNull();
  });

  it("rejects malformed cookies", () => {
    expect(verifyAppSession("not-a-valid-cookie", SECRET)).toBeNull();
    expect(verifyAppSession("", SECRET)).toBeNull();
  });
});
