/**
 * Shared file-preview + version-staleness helpers, used by both FileVaultApp
 * (the file browser) and HandoverPanel (the package editor's file checklist)
 * so the two surfaces agree on what "previewable" and "still approved" mean.
 */
import type { HandoverFileApproval, VaultFile } from "../types";

export type PreviewKind = "image" | "pdf" | "video";

/** Real inline preview only when Desboard holds the bytes and the format is one browsers render natively. */
export function previewableKind(file: VaultFile): PreviewKind | null {
  if (!file.hasContent) return null;
  const mime = file.mime || "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  return null;
}

export const contentUrl = (file: VaultFile) => `/api/files/${file.id}/content`;

/** Mirrors db.ts's private currentVersionOf — the frontend can't import a backend-only module. */
export function currentVersionOf(file: VaultFile): string | null {
  return file.versions.find((v) => v.latest)?.version ?? null;
}

/**
 * Mirrors db.ts's isFileApproved semantics: an approval is only current if
 * it was recorded against the file's present version. Files that predate
 * version tracking (no `latest` entry, `currentVersionOf` returns null)
 * never get blocked on this — same bypass db.ts's own check makes.
 */
export function isApprovalCurrent(approval: HandoverFileApproval | undefined, file: VaultFile | undefined): boolean {
  if (!approval) return false;
  const current = file ? currentVersionOf(file) : null;
  if (current === null) return true;
  return approval.version === current;
}
