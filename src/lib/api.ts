/**
 * Frontend API client.
 *
 * A thin wrapper around `fetch` for talking to our own Express backend. Every AI
 * call goes through here, which means the browser never touches the Anthropic
 * API key — it only calls same-origin `/api/*` routes on our server.
 */
import type { VaultFile, ProjectFull, Tag, AnalyzeResult, Handover, HandoverComment } from "../types";

async function toJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { "Content-Type": "application/json" };

export const api = {
  // --- Data (SQLite) ---
  getFiles: () => fetch("/api/files").then((r) => toJson<VaultFile[]>(r)),

  createFile: (file: VaultFile) =>
    fetch("/api/files", { method: "POST", headers: jsonHeaders, body: JSON.stringify(file) }).then((r) =>
      toJson<VaultFile>(r)
    ),

  updateFile: (id: string, patch: Partial<VaultFile>) =>
    fetch(`/api/files/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<VaultFile>(r)
    ),

  getProjects: () => fetch("/api/projects").then((r) => toJson<ProjectFull[]>(r)),

  createProject: (project: ProjectFull) =>
    fetch("/api/projects", { method: "POST", headers: jsonHeaders, body: JSON.stringify(project) }).then((r) =>
      toJson<ProjectFull>(r)
    ),

  getTags: () => fetch("/api/tags").then((r) => toJson<Tag[]>(r)),

  // --- Handovers ---
  getHandovers: (projectId: string) =>
    fetch(`/api/handovers?projectId=${encodeURIComponent(projectId)}`).then((r) => toJson<Handover[]>(r)),

  createHandover: (handover: Handover) =>
    fetch("/api/handovers", { method: "POST", headers: jsonHeaders, body: JSON.stringify(handover) }).then((r) =>
      toJson<Handover>(r)
    ),

  updateHandover: (id: string, patch: Partial<Handover>) =>
    fetch(`/api/handovers/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<Handover>(r)
    ),

  deleteHandover: (id: string) => fetch(`/api/handovers/${id}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Handover discussion ---
  getCommentCounts: (projectId: string) =>
    fetch(`/api/handovers/comment-counts?projectId=${encodeURIComponent(projectId)}`).then((r) =>
      toJson<Record<string, number>>(r)
    ),

  getComments: (handoverId: string) =>
    fetch(`/api/handovers/${handoverId}/comments`).then((r) => toJson<HandoverComment[]>(r)),

  addComment: (
    handoverId: string,
    comment: { author: string; role: "client" | "designer"; body: string; fileId?: string | null }
  ) =>
    fetch(`/api/handovers/${handoverId}/comments`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(comment),
    }).then((r) => toJson<HandoverComment>(r)),

  deleteComment: (handoverId: string, commentId: string) =>
    fetch(`/api/handovers/${handoverId}/comments/${commentId}`, { method: "DELETE" }).then((r) => r.ok),

  // --- AI (proxied to Anthropic) ---
  search: (query: string, files: VaultFile[]) =>
    fetch("/api/search", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ query, files }) }).then((r) =>
      toJson<string[]>(r)
    ),

  chat: (prompt: string, fileContext?: unknown) =>
    fetch("/api/chat", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ prompt, fileContext }) })
      .then((r) => toJson<{ text: string }>(r))
      .then((d) => d.text),

  analyze: (fileName: string, fileContent: string, mimeType: string) =>
    fetch("/api/analyze", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ fileName, fileContent, mimeType }),
    }).then((r) => toJson<AnalyzeResult>(r)),
};
