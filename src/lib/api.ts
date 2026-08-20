/**
 * Frontend API client.
 *
 * A thin wrapper around `fetch` for talking to our own Express backend. Every AI
 * call goes through here, which means the browser never touches the Anthropic
 * API key — it only calls same-origin `/api/*` routes on our server.
 */
import type {
  VaultFile,
  ProjectFull,
  Tag,
  AnalyzeResult,
  Handover,
  HandoverComment,
  DashboardData,
  StudioSettings,
  VaultTask,
  CalendarEvent,
  TeamMember,
  Conversation,
  ConversationMessage,
  AuthUser,
  HandoverApprovals,
  OAuthProviderId,
  OAuthStatus,
  OAuthBrowseResult,
  WorkspaceMember,
  PendingInvite,
  InvitePreview,
  WorkspaceRole,
} from "../types";

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
  // --- Auth ---
  signup: (params: { email: string; password: string; name?: string; workspaceName?: string }) =>
    fetch("/api/auth/signup", { method: "POST", headers: jsonHeaders, body: JSON.stringify(params) }).then((r) =>
      toJson<AuthUser>(r)
    ),

  login: (params: { email: string; password: string }) =>
    fetch("/api/auth/login", { method: "POST", headers: jsonHeaders, body: JSON.stringify(params) }).then((r) =>
      toJson<AuthUser>(r)
    ),

  logout: () => fetch("/api/auth/logout", { method: "POST" }).then((r) => r.ok),

  me: () => fetch("/api/auth/me").then((r) => toJson<AuthUser>(r)),

  // --- Studio workspace members & invites (distinct from the /api/team contact directory below) ---
  getWorkspaceMembers: () => fetch("/api/team/members").then((r) => toJson<WorkspaceMember[]>(r)),

  getPendingInvites: () => fetch("/api/team/invites").then((r) => toJson<PendingInvite[]>(r)),

  createInvite: (params: { email?: string; role?: WorkspaceRole }) =>
    fetch("/api/team/invites", { method: "POST", headers: jsonHeaders, body: JSON.stringify(params) }).then((r) =>
      toJson<PendingInvite>(r)
    ),

  revokeInvite: (token: string) => fetch(`/api/team/invites/${token}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Public invite-accept flow (no session yet) ---
  getInvitePreview: (token: string) => fetch(`/api/invites/${token}`).then((r) => toJson<InvitePreview>(r)),

  acceptInvite: (token: string, params: { email: string; password: string; name?: string }) =>
    fetch(`/api/invites/${token}/accept`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(params) }).then(
      (r) => toJson<AuthUser>(r)
    ),

  // --- Data (SQLite) ---
  getFiles: () => fetch("/api/files").then((r) => toJson<VaultFile[]>(r)),

  createFile: (file: VaultFile, content?: string, mimeType?: string) =>
    fetch("/api/files", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(content ? { ...file, content, mimeType } : file),
    }).then((r) => toJson<VaultFile>(r)),

  uploadFileVersion: (id: string, content: string, mimeType: string, author?: string) =>
    fetch(`/api/files/${id}/version`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ content, mimeType, author }),
    }).then((r) => toJson<VaultFile>(r)),

  updateFile: (id: string, patch: Partial<VaultFile>) =>
    fetch(`/api/files/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<VaultFile>(r)
    ),

  restoreFileVersion: (id: string, version: string) =>
    fetch(`/api/files/${id}/version/${encodeURIComponent(version)}/restore`, { method: "POST" }).then((r) =>
      toJson<VaultFile>(r)
    ),

  getProjects: () => fetch("/api/projects").then((r) => toJson<ProjectFull[]>(r)),

  createProject: (project: ProjectFull) =>
    fetch("/api/projects", { method: "POST", headers: jsonHeaders, body: JSON.stringify(project) }).then((r) =>
      toJson<ProjectFull>(r)
    ),

  updateProject: (id: string, patch: Partial<ProjectFull>) =>
    fetch(`/api/projects/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<ProjectFull>(r)
    ),

  getDashboard: () => fetch("/api/dashboard").then((r) => toJson<DashboardData>(r)),

  getTags: () => fetch("/api/tags").then((r) => toJson<Tag[]>(r)),

  // --- Settings ---
  getSettings: () => fetch("/api/settings").then((r) => toJson<StudioSettings>(r)),

  updateSettings: (patch: Partial<StudioSettings>) =>
    fetch("/api/settings", { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<StudioSettings>(r)
    ),

  clearDemoData: () => fetch("/api/settings/clear-demo-data", { method: "POST" }).then((r) => r.ok),

  // --- Tasks ---
  getTasks: (projectId?: string) =>
    fetch(projectId ? `/api/tasks?projectId=${encodeURIComponent(projectId)}` : "/api/tasks").then((r) =>
      toJson<VaultTask[]>(r)
    ),

  createTask: (task: { projectId: string; title: string; dueDate?: string | null; assignee?: string | null }) =>
    fetch("/api/tasks", { method: "POST", headers: jsonHeaders, body: JSON.stringify(task) }).then((r) =>
      toJson<VaultTask>(r)
    ),

  updateTask: (id: string, patch: Partial<VaultTask>) =>
    fetch(`/api/tasks/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<VaultTask>(r)
    ),

  deleteTask: (id: string) => fetch(`/api/tasks/${id}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Calendar ---
  getEvents: (projectId?: string) =>
    fetch(projectId ? `/api/events?projectId=${encodeURIComponent(projectId)}` : "/api/events").then((r) =>
      toJson<CalendarEvent[]>(r)
    ),

  createEvent: (event: {
    projectId?: string | null;
    title: string;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
  }) => fetch("/api/events", { method: "POST", headers: jsonHeaders, body: JSON.stringify(event) }).then((r) => toJson<CalendarEvent>(r)),

  updateEvent: (id: string, patch: Partial<CalendarEvent>) =>
    fetch(`/api/events/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<CalendarEvent>(r)
    ),

  deleteEvent: (id: string) => fetch(`/api/events/${id}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Team ---
  getTeamMembers: () => fetch("/api/team").then((r) => toJson<TeamMember[]>(r)),

  createTeamMember: (member: { name: string; initials: string; role?: string | null; email?: string | null; color?: string }) =>
    fetch("/api/team", { method: "POST", headers: jsonHeaders, body: JSON.stringify(member) }).then((r) =>
      toJson<TeamMember>(r)
    ),

  updateTeamMember: (id: string, patch: Partial<TeamMember>) =>
    fetch(`/api/team/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<TeamMember>(r)
    ),

  deleteTeamMember: (id: string) => fetch(`/api/team/${id}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Messaging ---
  getConversations: () => fetch("/api/conversations").then((r) => toJson<Conversation[]>(r)),

  createConversation: (conversation: {
    title: string;
    linkedProjectId?: string | null;
    linkedClient?: string | null;
    linkedMemberId?: string | null;
  }) =>
    fetch("/api/conversations", { method: "POST", headers: jsonHeaders, body: JSON.stringify(conversation) }).then((r) =>
      toJson<Conversation>(r)
    ),

  updateConversation: (id: string, patch: Partial<Conversation>) =>
    fetch(`/api/conversations/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<Conversation>(r)
    ),

  deleteConversation: (id: string) => fetch(`/api/conversations/${id}`, { method: "DELETE" }).then((r) => r.ok),

  getMessages: (conversationId: string) =>
    fetch(`/api/conversations/${conversationId}/messages`).then((r) => toJson<ConversationMessage[]>(r)),

  addMessage: (conversationId: string, message: { author: string; role: "me" | "them"; body: string }) =>
    fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(message),
    }).then((r) => toJson<ConversationMessage>(r)),

  deleteMessage: (conversationId: string, messageId: string) =>
    fetch(`/api/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" }).then((r) => r.ok),

  // --- Handovers ---
  /** Omit `projectId` for every handover in the workspace (e.g. the Approvals screen). */
  getHandovers: (projectId?: string) =>
    fetch(projectId ? `/api/handovers?projectId=${encodeURIComponent(projectId)}` : "/api/handovers").then((r) =>
      toJson<Handover[]>(r)
    ),

  createHandover: (handover: Handover) =>
    fetch("/api/handovers", { method: "POST", headers: jsonHeaders, body: JSON.stringify(handover) }).then((r) =>
      toJson<Handover>(r)
    ),

  updateHandover: (id: string, patch: Partial<Handover>) =>
    fetch(`/api/handovers/${id}`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(patch) }).then((r) =>
      toJson<Handover>(r)
    ),

  deleteHandover: (id: string) => fetch(`/api/handovers/${id}`, { method: "DELETE" }).then((r) => r.ok),

  remindHandover: (id: string) =>
    fetch(`/api/handovers/${id}/remind`, { method: "POST" }).then((r) => toJson<{ sent: boolean; emailConfigured: boolean }>(r)),

  // --- Handover discussion ---
  getCommentCounts: (projectId: string) =>
    fetch(`/api/handovers/comment-counts?projectId=${encodeURIComponent(projectId)}`).then((r) =>
      toJson<Record<string, number>>(r)
    ),

  getComments: (handoverId: string) =>
    fetch(`/api/handovers/${handoverId}/comments`).then((r) => toJson<HandoverComment[]>(r)),

  getHandoverApprovals: (handoverId: string) =>
    fetch(`/api/handovers/${handoverId}/approvals`).then((r) => toJson<HandoverApprovals>(r)),

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

  // --- OAuth connections (Google Drive / Dropbox) ---
  getOAuthStatus: (provider: OAuthProviderId) => fetch(`/api/oauth/${provider}/status`).then((r) => toJson<OAuthStatus>(r)),

  disconnectOAuth: (provider: OAuthProviderId) =>
    fetch(`/api/oauth/${provider}/disconnect`, { method: "POST" }).then((r) => r.ok),

  browseOAuth: (provider: OAuthProviderId, folder?: string, pageToken?: string) => {
    const params = new URLSearchParams();
    if (folder) params.set("folder", folder);
    if (pageToken) params.set("pageToken", pageToken);
    const qs = params.toString();
    return fetch(`/api/oauth/${provider}/browse${qs ? `?${qs}` : ""}`).then((r) => toJson<OAuthBrowseResult>(r));
  },

  importOAuthFile: (provider: OAuthProviderId, body: { fileId: string; name: string; mimeType: string; projectId?: number | null }) =>
    fetch(`/api/oauth/${provider}/import`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) }).then((r) =>
      toJson<VaultFile>(r)
    ),

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
