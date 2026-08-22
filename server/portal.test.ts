/**
 * Security-boundary tests for the client portal core.
 *
 * These are the tests that matter: sessions must be scoped to exactly one
 * handover, expired/revoked links must fail closed, signed download URLs must
 * not survive tampering or outlive their expiry, and the portal DTOs must
 * never serialize excluded fields (password hashes, internal comments, ids of
 * anything outside the handover).
 */
import { describe, expect, it } from "vitest";
import type { Handover, HandoverComment, VaultFile } from "../src/types.ts";
import {
  accessState,
  hashPassword,
  sessionAuditId,
  signDownload,
  signSession,
  toPortalCommentDTO,
  toPortalFileDTO,
  toPortalHandoverDTO,
  verifyDownload,
  verifyPassword,
  verifySession,
  visibleToClient,
} from "./portalCore.ts";

const SECRET = "test-secret";

const handover: Handover = {
  id: "h1",
  projectId: "p2",
  title: "Final Handoff",
  recipient: "Acme Corp",
  clientName: "Dana",
  note: "Here you go",
  status: "Sent",
  fileIds: ["f2"],
  created: "Oct 15, 2023",
  token: "tok_abc",
  accessMode: "invite",
  passwordHash: "salt:beef",
  expiresAt: null,
  revoked: false,
  revokedAt: null,
};

const file: VaultFile = {
  id: "f2",
  name: "Hero_Section_Concepts",
  type: "folder",
  created: "2023-11-02",
  owner: "Design Team",
  source: "Figma",
  tags: ["UI"],
  status: "Draft",
  projectId: 2,
  clientId: "Acme Corp",
  versions: [],
  access: ["Team"],
};

describe("passwords", () => {
  it("verifies the right password and rejects wrong/empty/malformed hashes", () => {
    const hash = hashPassword("hunter2");
    expect(verifyPassword("hunter2", hash)).toBe(true);
    expect(verifyPassword("hunter3", hash)).toBe(false);
    expect(verifyPassword("hunter2", null)).toBe(false);
    expect(verifyPassword("hunter2", "garbage")).toBe(false);
  });
});

describe("portal sessions", () => {
  it("accepts a session only for the handover it was issued for", () => {
    const cookie = signSession("h1", SECRET);
    expect(verifySession(cookie, "h1", SECRET)).toBe(true);
    // The structural isolation guarantee: same cookie, different handover — no.
    expect(verifySession(cookie, "h2", SECRET)).toBe(false);
  });

  it("rejects tampered and forged cookies", () => {
    const cookie = signSession("h1", SECRET);
    const [payload] = cookie.split(".");
    expect(verifySession(`${payload}.forged`, "h1", SECRET)).toBe(false);
    // Re-signed with the wrong secret
    expect(verifySession(signSession("h1", "other-secret"), "h1", SECRET)).toBe(false);
    expect(verifySession(undefined, "h1", SECRET)).toBe(false);
  });

  it("expires sessions after their max age", () => {
    const old = signSession("h1", SECRET, Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(verifySession(old, "h1", SECRET)).toBe(false);
  });

  it("audit ids never reveal the cookie value", () => {
    const cookie = signSession("h1", SECRET);
    const id = sessionAuditId(cookie);
    expect(id).toHaveLength(12);
    expect(cookie).not.toContain(id!);
  });
});

describe("signed download URLs", () => {
  it("verifies a fresh signature and fails after expiry", () => {
    const exp = Date.now() + 60_000;
    const sig = signDownload("tok_abc", "f2", exp, SECRET);
    expect(verifyDownload("tok_abc", "f2", exp, sig, SECRET)).toBe(true);
    expect(verifyDownload("tok_abc", "f2", exp, sig, SECRET, exp + 1)).toBe(false);
  });

  it("fails closed on any tampering (file, token, exp, sig)", () => {
    const exp = Date.now() + 60_000;
    const sig = signDownload("tok_abc", "f2", exp, SECRET);
    expect(verifyDownload("tok_abc", "f1", exp, sig, SECRET)).toBe(false); // other file
    expect(verifyDownload("tok_xyz", "f2", exp, sig, SECRET)).toBe(false); // other handover
    expect(verifyDownload("tok_abc", "f2", exp + 9999, sig, SECRET)).toBe(false); // stretched expiry
    expect(verifyDownload("tok_abc", "f2", exp, "bogus", SECRET)).toBe(false);
    expect(verifyDownload("tok_abc", "f2", Number.NaN, sig, SECRET)).toBe(false);
  });
});

describe("access state fails closed", () => {
  it("revoked wins over everything", () => {
    expect(accessState({ ...handover, revoked: true })).toBe("revoked");
    expect(accessState({ ...handover, revoked: true, expiresAt: "2099-01-01" })).toBe("revoked");
  });

  it("expiry is enforced", () => {
    expect(accessState({ ...handover, expiresAt: "2000-01-01T00:00:00Z" })).toBe("expired");
    expect(accessState({ ...handover, expiresAt: "2099-01-01T00:00:00Z" })).toBe("ok");
    expect(accessState({ ...handover, expiresAt: null })).toBe("ok");
  });
});

describe("portal DTOs — the field allowlist", () => {
  it("handover DTO serializes exactly the allowed keys and nothing internal", () => {
    const dto = toPortalHandoverDTO(handover, [file]);
    expect(Object.keys(dto).sort()).toEqual(
      ["branding", "clientName", "created", "files", "note", "recipient", "status", "title"].sort()
    );
    const json = JSON.stringify(dto);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("tok_abc"); // token never round-trips in a body
    expect(json).not.toContain("p2"); // no project id
    expect(json).not.toContain("h1"); // no internal handover id
  });

  it("file DTO excludes owner, source, access and project linkage, but includes versions for the picker", () => {
    const dto = toPortalFileDTO(file);
    expect(Object.keys(dto).sort()).toEqual(["extension", "id", "name", "size", "status", "tags", "type", "versions"].sort());
    const json = JSON.stringify(dto);
    expect(json).not.toContain("Design Team"); // owner
    expect(json).not.toContain("Figma"); // provider/source
    expect(json).not.toContain("Acme Corp"); // client linkage
  });

  it("comment DTO excludes handover linkage and the internal flag", () => {
    const c: HandoverComment = {
      id: "c9",
      handoverId: "h1",
      author: "Dana",
      role: "client",
      body: "Looks great",
      fileId: "f2",
      created: "2023-10-16T09:20:00.000Z",
      internalOnly: false,
    };
    const dto = toPortalCommentDTO(c);
    expect(Object.keys(dto).sort()).toEqual(
      ["author", "body", "created", "fileId", "id", "role", "timecode", "version", "x", "y"].sort()
    );
    expect(JSON.stringify(dto)).not.toContain("handoverId");
  });

  it("internal-only comments are invisible to the client", () => {
    const internal: HandoverComment = {
      id: "c1", handoverId: "h1", author: "Elias", role: "designer",
      body: "internal: client is late on invoices", created: "2023-10-16", internalOnly: true,
    };
    const visible: HandoverComment = { ...internal, id: "c2", body: "Here's the update", internalOnly: false };
    const filtered = [internal, visible].filter(visibleToClient);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("c2");
  });
});
