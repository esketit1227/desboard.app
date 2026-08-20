/**
 * Desboard backend — Node.js + Express.
 *
 * Responsibilities:
 *  1. Serve the React frontend (via Vite middleware in dev, static files in prod).
 *  2. Expose a small, workspace-scoped REST API over the SQLite database
 *     (files / projects / tags / handovers / tasks / events / team / …).
 *  3. Proxy every AI call to the Anthropic Claude API using the official SDK, so
 *     the ANTHROPIC_API_KEY lives only on the server and never reaches the browser.
 *
 * Auth: every /api/* route except /api/auth/* and the client portal's own
 * /api/portal/* routes requires a signed-in session (see server/auth.ts). The
 * portal is a structurally separate, token-only surface (server/portal.ts)
 * with its own trust model — it never gates on a studio session.
 *
 * Models (see README "Model choice"):
 *   - claude-sonnet-4-6  -> File Copilot + Project Copilot chat, and upload analysis
 *   - claude-haiku-4-5   -> fast semantic search
 * Both model IDs were verified against Anthropic's current model catalog.
 */
import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  getFiles,
  createFile,
  updateFile,
  getProjects,
  createProject,
  getTags,
  getHandovers,
  getHandoverById,
  createHandover,
  updateHandover,
  deleteHandover,
  getComments,
  addComment,
  deleteComment,
  getCommentCounts,
  getApprovals,
  logAssistantMetric,
  updateProject,
  getPortalActivity,
  getGreetingFact,
  getDashboardInsights,
  getPendingApprovalSummary,
  getRecentlyCompletedApprovals,
  getStatusTally,
  getReminderCandidates,
  markReminderSent,
  getAllWorkspaceIds,
  getFileById,
  getSettings,
  updateSettings,
  clearDemoData,
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  getTeamMembers,
  getTeamMemberById,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  getConversations,
  getConversationById,
  createConversation,
  updateConversation,
  deleteConversation,
  getMessages,
  addMessage,
  deleteMessage,
} from "./db.ts";
import type { DashboardData, Handover, VaultFile } from "./src/types.ts";
import { createPortalRouter } from "./server/portal.ts";
import { createOAuthRouter } from "./server/oauth.ts";
import { createSsoRouter } from "./server/sso.ts";
import { createTeamRouter, createInviteAcceptRouter } from "./server/invites.ts";
import { sendEmail, reminderEmailHtml, emailConfigured } from "./server/email.ts";
import { createAuthRouter, requireAuth, type AuthedRequest } from "./server/auth.ts";
import { hashPassword } from "./server/portalCore.ts";
import {
  formatBytes,
  readContentStream,
  writeContent,
  writeVersionContent,
  hasVersionContent,
  readVersionContentStream,
  restoreVersionContent,
} from "./server/storage.ts";

const CHAT_MODEL = "claude-sonnet-4-6"; // File & Project Copilot + upload analysis
const SEARCH_MODEL = "claude-haiku-4-5"; // fast semantic search

// The SDK reads ANTHROPIC_API_KEY from the environment automatically. We keep a
// nullable client so the data/UI still works even before a key is configured;
// AI routes return a friendly 503 in that case instead of crashing.
const apiKey = process.env.ANTHROPIC_API_KEY;
const hasKey = !!apiKey && apiKey !== "sk-ant-your-key-here";
const anthropic = hasKey ? new Anthropic({ apiKey }) : null;

if (!hasKey) {
  console.warn(
    "\n[Desboard] WARNING: No ANTHROPIC_API_KEY found in .env — the app runs, but AI\n" +
      "           features (search, copilots, upload tagging) stay disabled until you\n" +
      "           add your key to the .env file and restart.\n"
  );
}

// Portal sessions (PORTAL_SECRET) and studio-side auth sessions (SESSION_SECRET)
// each fall back to a random per-process secret when unset — fine for local
// dev, but that means every restart invalidates every session, and a
// multi-process deployment wouldn't share one secret across processes. Both
// are required once this runs as a real, deployed service.
if (process.env.NODE_ENV === "production") {
  const missing = ["PORTAL_SECRET", "SESSION_SECRET"].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `\n[Desboard] FATAL: ${missing.join(" and ")} must be set in production — refusing to start.\n` +
        "           Without them, every server restart silently invalidates all client\n" +
        "           portal links and all signed-in studio sessions.\n"
    );
    process.exit(1);
  }
}

// --- Small helpers -----------------------------------------------------------

/** Join all text blocks of a Claude response into one string. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Pull a JSON value out of a model's text response, tolerating markdown code
 * fences or a little surrounding prose. Returns null if nothing parses.
 */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const direct = tryParse(t);
  if (direct !== null) return direct;

  // Fall back to slicing from the first bracket to its matching last bracket.
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  let start = -1;
  let close = "";
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    close = "]";
  } else if (firstObj !== -1) {
    start = firstObj;
    close = "}";
  }
  if (start === -1) return null;
  const end = t.lastIndexOf(close);
  if (end > start) return tryParse(t.slice(start, end + 1));
  return null;
}

/** Plain keyword matching over name + tags — used as the search fallback. */
function keywordSearch(query: string, files: VaultFile[]): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files
    .map((f) => {
      const haystack = `${f.name} ${f.tags.join(" ")} ${f.status} ${f.extension ?? ""}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
      return { id: String(f.id), score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.id);
}

/** Every route below runs after requireAuth, so req.auth is always populated. */
function workspaceOf(req: AuthedRequest): string {
  return req.auth!.workspaceId;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  app.use(express.json({ limit: "50mb" }));
  // Apple's Sign in with Apple callback uses response_mode=form_post — a
  // real application/x-www-form-urlencoded POST body, not JSON.
  app.use(express.urlencoded({ extended: false }));
  // Redirect URIs for both the SSO and Drive/Dropbox flows are built from
  // req.protocol/req.get("host"); behind any TLS-terminating proxy, without
  // this, req.protocol reports "http" and the built redirect_uri won't
  // exactly match what's registered with the provider (Apple in particular
  // validates this strictly and hard-fails).
  app.set("trust proxy", 1);

  // =========================================================================
  // Public surfaces — must be mounted before the auth gate below, since that
  // gate applies to every /api/* route registered after it.
  // =========================================================================

  // Studio-side signup/login/logout/me. Unauthenticated by design.
  app.use(createAuthRouter());

  // "Sign in with Google/Microsoft/Apple" — a login mechanism, so it
  // necessarily runs before any session exists. Each route verifies what it
  // needs itself (state cookie, id_token signature) rather than relying on
  // the blanket gate below.
  app.use(createSsoRouter());

  // Client portal — the untrusted external surface. A dedicated router with
  // token-only lookup, DTO responses, rate limits and audit logging. Never
  // gated by requireAuth: a client visitor has no studio account.
  app.use(createPortalRouter());

  // Google Drive / Dropbox connect + browse + import. Each route checks the
  // studio session itself (see server/oauth.ts) rather than relying on the
  // blanket gate below, since /callback is a browser redirect that must fail
  // with an HTML page, not a JSON 401.
  app.use(createOAuthRouter());

  // Accepting a team invite happens with no session yet, same token-only
  // trust model as the portal — must be public too.
  app.use(createInviteAcceptRouter());

  // Everything registered from here on is internal, workspace-scoped API and
  // requires a signed-in studio session.
  app.use("/api", requireAuth);
  app.use(createTeamRouter());

  // =========================================================================
  // Data API (SQLite-backed) — survives refresh
  // =========================================================================

  app.get("/api/files", (req: AuthedRequest, res) => {
    res.json(getFiles(workspaceOf(req)));
  });

  // Create a file. When `content` (base64) is included, the bytes are stored on
  // disk so the file gets real previews and downloads.
  app.post("/api/files", (req: AuthedRequest, res) => {
    try {
      const { content, mimeType, ...file } = req.body as VaultFile & { content?: string; mimeType?: string };
      if (typeof content === "string" && content.length > 0) {
        const bytes = writeContent(file.id, content);
        const initialVersion = file.versions?.[0]?.version || "v1.0";
        writeVersionContent(file.id, initialVersion, content);
        file.hasContent = true;
        file.mime = mimeType || "application/octet-stream";
        file.size = formatBytes(bytes);
      }
      const created = createFile(file, workspaceOf(req));
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create file" });
    }
  });

  app.patch("/api/files/:id", (req: AuthedRequest, res) => {
    const updated = updateFile(req.params.id, req.body, workspaceOf(req));
    if (!updated) return res.status(404).json({ error: "File not found" });
    res.json(updated);
  });

  /** Inline stream of a file's stored bytes — powers real previews. */
  app.get("/api/files/:id/content", (req: AuthedRequest, res) => {
    const file = getFileById(req.params.id, workspaceOf(req));
    if (!file || !file.hasContent) return res.status(404).json({ error: "No stored content for this file" });
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    readContentStream(file.id).on("error", () => res.status(404).end()).pipe(res);
  });

  /** Studio-side download: the real bytes when stored, a delivery note otherwise. */
  app.get("/api/files/:id/download", (req: AuthedRequest, res) => {
    const file = getFileById(req.params.id, workspaceOf(req));
    if (!file) return res.status(404).json({ error: "File not found" });
    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._ -]/g, "_");
    if (file.hasContent) {
      res.setHeader("Content-Type", file.mime || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      return readContentStream(file.id).on("error", () => res.status(404).end()).pipe(res);
    }
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.txt"`);
    res
      .type("text/plain; charset=utf-8")
      .send(`${file.name}\n\nThis file predates stored uploads — no binary is attached to it yet.\nUpload a new version from the File Vault to attach real content.\n`);
  });

  /** Upload a new version: becomes the current blob, and keeps its own retrievable copy. */
  app.post("/api/files/:id/version", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    const file = getFileById(req.params.id, workspaceId);
    if (!file) return res.status(404).json({ error: "File not found" });
    const { content, mimeType, author } = req.body as { content?: string; mimeType?: string; author?: string };
    if (!content) return res.status(400).json({ error: "Missing content" });
    const bytes = writeContent(file.id, content);
    const versions = file.versions.map((v) => ({ ...v, latest: false }));
    const newLabel = `v${versions.length + 1}.0`;
    writeVersionContent(file.id, newLabel, content);
    versions.unshift({
      version: newLabel,
      date: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      author: (author || "").trim() || "Elias M.",
      latest: true,
    });
    const updated = updateFile(
      file.id,
      { versions, hasContent: true, mime: mimeType || file.mime || "application/octet-stream", size: formatBytes(bytes) },
      workspaceId
    );
    res.json(updated);
  });

  /** Download one specific historical version's bytes (not necessarily current). */
  app.get("/api/files/:id/version/:version/download", (req: AuthedRequest, res) => {
    const file = getFileById(req.params.id, workspaceOf(req));
    if (!file) return res.status(404).json({ error: "File not found" });
    const version = req.params.version;
    if (!file.versions.some((v) => v.version === version)) {
      return res.status(404).json({ error: "Version not found" });
    }
    if (!hasVersionContent(file.id, version)) {
      return res.status(404).json({ error: "No stored content for this version" });
    }
    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._ -]/g, "_");
    res.setHeader("Content-Type", file.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${version}-${safeName}"`);
    readVersionContentStream(file.id, version)
      .on("error", () => res.status(404).end())
      .pipe(res);
  });

  /** Bring an old version's content back as the new latest version. */
  app.post("/api/files/:id/version/:version/restore", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    const file = getFileById(req.params.id, workspaceId);
    if (!file) return res.status(404).json({ error: "File not found" });
    const version = req.params.version;
    if (!hasVersionContent(file.id, version)) {
      return res.status(404).json({ error: "No stored content for this version" });
    }
    const versions = file.versions.map((v) => ({ ...v, latest: false }));
    const newLabel = `v${versions.length + 1}.0`;
    const bytes = restoreVersionContent(file.id, version, newLabel);
    versions.unshift({
      version: newLabel,
      date: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      author: "Elias M.",
      latest: true,
    });
    const updated = updateFile(file.id, { versions, hasContent: true, size: formatBytes(bytes) }, workspaceId);
    res.json(updated);
  });

  app.get("/api/projects", (req: AuthedRequest, res) => {
    res.json(getProjects(workspaceOf(req)));
  });

  app.post("/api/projects", (req: AuthedRequest, res) => {
    try {
      const created = createProject(req.body, workspaceOf(req));
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create project" });
    }
  });

  app.patch("/api/projects/:id", (req: AuthedRequest, res) => {
    const updated = updateProject(req.params.id, req.body, workspaceOf(req));
    if (!updated) return res.status(404).json({ error: "Project not found" });
    res.json(updated);
  });

  /**
   * Everything the home screen shows live, in one call: real widget data,
   * upcoming deadlines, and the recent portal activity feed.
   */
  app.get("/api/dashboard", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    const projects = getProjects(workspaceId).filter((p) => p.status !== "Archived");
    const files = getFiles(workspaceId);
    const handovers = getHandovers(workspaceId);
    const now = Date.now();
    const deadlines = projects
      .map((p) => ({ id: p.id, name: p.name, client: p.client, deadline: p.deadline, ts: Date.parse(p.deadline) }))
      .filter((d) => !Number.isNaN(d.ts))
      .sort((a, b) => a.ts - b.ts)
      .map(({ ts, ...rest }) => ({ ...rest, daysLeft: Math.ceil((ts - now) / 86_400_000) }));
    const latestFile = files[0];
    const latestHandover = handovers[0];
    const data: DashboardData = {
      projectCount: projects.length,
      deadlines: deadlines.slice(0, 4),
      latestFile: latestFile ? { name: latestFile.name, created: latestFile.created, status: latestFile.status } : null,
      latestHandover: latestHandover
        ? {
            title: latestHandover.title,
            status: latestHandover.status,
            recipient: latestHandover.recipient,
            clientName: latestHandover.clientName,
          }
        : null,
      activity: getPortalActivity(workspaceId, 12),
      greetingFact: getGreetingFact(workspaceId),
      insights: getDashboardInsights(workspaceId),
      pendingApprovals: getPendingApprovalSummary(workspaceId).slice(0, 20),
      completedApprovals: getRecentlyCompletedApprovals(workspaceId).slice(0, 10),
      statusTally: getStatusTally(workspaceId),
    };
    res.json(data);
  });

  app.get("/api/tags", (req: AuthedRequest, res) => {
    res.json(getTags(workspaceOf(req)));
  });

  // --- Settings ---
  app.get("/api/settings", (req: AuthedRequest, res) => {
    res.json(getSettings(workspaceOf(req)));
  });

  app.patch("/api/settings", (req: AuthedRequest, res) => {
    try {
      res.json(updateSettings(req.body, workspaceOf(req)));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to save settings" });
    }
  });

  app.post("/api/settings/clear-demo-data", (req: AuthedRequest, res) => {
    try {
      clearDemoData(workspaceOf(req));
      res.status(204).end();
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to clear demo data" });
    }
  });

  // --- Tasks ---
  app.get("/api/tasks", (req: AuthedRequest, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(getTasks(workspaceOf(req), projectId));
  });

  app.post("/api/tasks", (req: AuthedRequest, res) => {
    const { projectId, title, dueDate, assignee } = req.body as {
      projectId?: string;
      title?: string;
      dueDate?: string | null;
      assignee?: string | null;
    };
    if (!projectId) return res.status(400).json({ error: "projectId is required" });
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
    try {
      const created = createTask(
        {
          id: "t" + Date.now() + Math.floor(Math.random() * 1000),
          projectId,
          title: title.trim().slice(0, 300),
          done: false,
          dueDate: dueDate || null,
          assignee: assignee || null,
          created: new Date().toISOString(),
        },
        workspaceOf(req)
      );
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    if (!getTaskById(req.params.id, workspaceId)) return res.status(404).json({ error: "Task not found" });
    const updated = updateTask(req.params.id, req.body, workspaceId);
    res.json(updated);
  });

  app.delete("/api/tasks/:id", (req: AuthedRequest, res) => {
    const ok = deleteTask(req.params.id, workspaceOf(req));
    if (!ok) return res.status(404).json({ error: "Task not found" });
    res.status(204).end();
  });

  // --- Calendar ---
  app.get("/api/events", (req: AuthedRequest, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(getEvents(workspaceOf(req), projectId));
  });

  app.post("/api/events", (req: AuthedRequest, res) => {
    const { projectId, title, date, startTime, endTime } = req.body as {
      projectId?: string | null;
      title?: string;
      date?: string;
      startTime?: string | null;
      endTime?: string | null;
    };
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
    if (!date || !date.trim()) return res.status(400).json({ error: "Date is required" });
    try {
      const created = createEvent(
        {
          id: "e" + Date.now() + Math.floor(Math.random() * 1000),
          projectId: projectId || null,
          title: title.trim().slice(0, 300),
          date: date.trim(),
          startTime: startTime || null,
          endTime: endTime || null,
          created: new Date().toISOString(),
        },
        workspaceOf(req)
      );
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create event" });
    }
  });

  app.patch("/api/events/:id", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    if (!getEventById(req.params.id, workspaceId)) return res.status(404).json({ error: "Event not found" });
    const updated = updateEvent(req.params.id, req.body, workspaceId);
    res.json(updated);
  });

  app.delete("/api/events/:id", (req: AuthedRequest, res) => {
    const ok = deleteEvent(req.params.id, workspaceOf(req));
    if (!ok) return res.status(404).json({ error: "Event not found" });
    res.status(204).end();
  });

  // --- Team ---
  app.get("/api/team", (req: AuthedRequest, res) => {
    res.json(getTeamMembers(workspaceOf(req)));
  });

  app.post("/api/team", (req: AuthedRequest, res) => {
    const { name, initials, role, email, color } = req.body as {
      name?: string;
      initials?: string;
      role?: string | null;
      email?: string | null;
      color?: string;
    };
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
    if (!initials || !initials.trim()) return res.status(400).json({ error: "Initials are required" });
    try {
      const created = createTeamMember(
        {
          id: "m" + Date.now() + Math.floor(Math.random() * 1000),
          name: name.trim(),
          initials: initials.trim().toUpperCase().slice(0, 3),
          role: role || null,
          email: email || null,
          color: color || "#8C897F",
        },
        workspaceOf(req)
      );
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create team member" });
    }
  });

  app.patch("/api/team/:id", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    if (!getTeamMemberById(req.params.id, workspaceId)) return res.status(404).json({ error: "Team member not found" });
    const updated = updateTeamMember(req.params.id, req.body, workspaceId);
    res.json(updated);
  });

  app.delete("/api/team/:id", (req: AuthedRequest, res) => {
    const ok = deleteTeamMember(req.params.id, workspaceOf(req));
    if (!ok) return res.status(404).json({ error: "Team member not found" });
    res.status(204).end();
  });

  // --- Messaging ---
  app.get("/api/conversations", (req: AuthedRequest, res) => {
    res.json(getConversations(workspaceOf(req)));
  });

  app.post("/api/conversations", (req: AuthedRequest, res) => {
    const { title, linkedProjectId, linkedClient, linkedMemberId } = req.body as {
      title?: string;
      linkedProjectId?: string | null;
      linkedClient?: string | null;
      linkedMemberId?: string | null;
    };
    if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
    try {
      const created = createConversation(
        {
          id: "cv" + Date.now() + Math.floor(Math.random() * 1000),
          title: title.trim().slice(0, 200),
          linkedProjectId: linkedProjectId || null,
          linkedClient: linkedClient || null,
          linkedMemberId: linkedMemberId || null,
          created: new Date().toISOString(),
        },
        workspaceOf(req)
      );
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create conversation" });
    }
  });

  app.patch("/api/conversations/:id", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    if (!getConversationById(req.params.id, workspaceId)) return res.status(404).json({ error: "Conversation not found" });
    const updated = updateConversation(req.params.id, req.body, workspaceId);
    res.json(updated);
  });

  app.delete("/api/conversations/:id", (req: AuthedRequest, res) => {
    const ok = deleteConversation(req.params.id, workspaceOf(req));
    if (!ok) return res.status(404).json({ error: "Conversation not found" });
    res.status(204).end();
  });

  app.get("/api/conversations/:id/messages", (req: AuthedRequest, res) => {
    if (!getConversationById(req.params.id, workspaceOf(req))) return res.status(404).json({ error: "Conversation not found" });
    res.json(getMessages(req.params.id));
  });

  app.post("/api/conversations/:id/messages", (req: AuthedRequest, res) => {
    const conversation = getConversationById(req.params.id, workspaceOf(req));
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });
    const { author, role, body } = req.body as { author?: string; role?: string; body?: string };
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const message = addMessage({
      id: "cm" + Date.now() + Math.floor(Math.random() * 1000),
      conversationId: req.params.id,
      author: (author || "").trim() || "Me",
      role: role === "them" ? "them" : "me",
      body: body.trim().slice(0, 4000),
      created: new Date().toISOString(),
    });
    res.status(201).json(message);
  });

  app.delete("/api/conversations/:id/messages/:messageId", (req: AuthedRequest, res) => {
    if (!getConversationById(req.params.id, workspaceOf(req))) return res.status(404).json({ error: "Conversation not found" });
    const ok = deleteMessage(req.params.messageId);
    if (!ok) return res.status(404).json({ error: "Message not found" });
    res.status(204).end();
  });

  // --- Handovers ---
  app.get("/api/handovers", (req: AuthedRequest, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(getHandovers(workspaceOf(req), projectId));
  });

  app.post("/api/handovers", (req: AuthedRequest, res) => {
    try {
      res.status(201).json(createHandover(req.body, workspaceOf(req)));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create handover" });
    }
  });

  app.patch("/api/handovers/:id", (req: AuthedRequest, res) => {
    // Normalize the patch: the portal token is server-owned (never client-set),
    // and passwords arrive in plaintext from the studio UI and are hashed here.
    const { token: _ignored, password, ...rest } = req.body as Partial<Handover> & { password?: string };
    const patch: Partial<Handover> = rest;
    if (typeof password === "string" && password.length > 0) {
      patch.passwordHash = hashPassword(password);
    }
    if (patch.accessMode && patch.accessMode !== "password") {
      patch.passwordHash = null;
    }
    const updated = updateHandover(req.params.id, patch, workspaceOf(req));
    if (!updated) return res.status(404).json({ error: "Handover not found" });
    res.json(updated);
  });

  app.delete("/api/handovers/:id", (req: AuthedRequest, res) => {
    const ok = deleteHandover(req.params.id, workspaceOf(req));
    if (!ok) return res.status(404).json({ error: "Handover not found" });
    res.status(204).end();
  });

  /** Manual "nudge the client" trigger — always available regardless of the automatic sweep's cooldown, since a human clicking the button is a deliberate choice. */
  app.post("/api/handovers/:id/remind", async (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    const handover = getHandoverById(req.params.id, workspaceId);
    if (!handover) return res.status(404).json({ error: "Handover not found" });
    if (!handover.clientEmail) return res.status(400).json({ error: "Add a client email to this handover first" });
    const settings = getSettings(workspaceId);
    const portalUrl = `${req.protocol}://${req.get("host")}/portal/${handover.token}`;
    const sent = await sendEmail({
      to: handover.clientEmail,
      subject: `Reminder: ${handover.title}`,
      html: reminderEmailHtml({ studioName: settings.studioName || "Your studio", handoverTitle: handover.title, portalUrl }),
    });
    if (sent) markReminderSent(handover.id, workspaceId);
    res.json({ sent, emailConfigured });
  });

  // --- Handover discussion (shared client/designer thread + file annotations) ---
  app.get("/api/handovers/comment-counts", (req: AuthedRequest, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    res.json(projectId ? getCommentCounts(projectId, workspaceOf(req)) : {});
  });

  app.get("/api/handovers/:id/comments", (req: AuthedRequest, res) => {
    if (!getHandoverById(req.params.id, workspaceOf(req))) return res.status(404).json({ error: "Handover not found" });
    res.json(getComments(req.params.id));
  });

  /** Per-file approval status within a handover, for the studio's own progress view. */
  app.get("/api/handovers/:id/approvals", (req: AuthedRequest, res) => {
    if (!getHandoverById(req.params.id, workspaceOf(req))) return res.status(404).json({ error: "Handover not found" });
    res.json(getApprovals(req.params.id));
  });

  app.post("/api/handovers/:id/comments", (req: AuthedRequest, res) => {
    const handover = getHandoverById(req.params.id, workspaceOf(req));
    if (!handover) return res.status(404).json({ error: "Handover not found" });
    const { author, role, body, fileId, internalOnly } = req.body as {
      author?: string;
      role?: string;
      body?: string;
      fileId?: string | null;
      internalOnly?: boolean;
    };
    if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
    const comment = addComment({
      id: "c" + Date.now() + Math.floor(Math.random() * 1000),
      handoverId: req.params.id,
      author: (author || "").trim() || "Anonymous",
      role: role === "designer" ? "designer" : "client",
      body: body.trim().slice(0, 4000),
      fileId: fileId && handover.fileIds.includes(fileId) ? fileId : null,
      created: new Date().toISOString(),
      internalOnly: internalOnly === true,
    });
    res.status(201).json(comment);
  });

  app.delete("/api/handovers/:id/comments/:commentId", (req: AuthedRequest, res) => {
    const handover = getHandoverById(req.params.id, workspaceOf(req));
    if (!handover) return res.status(404).json({ error: "Handover not found" });
    const ok = deleteComment(req.params.commentId);
    if (!ok) return res.status(404).json({ error: "Comment not found" });
    res.status(204).end();
  });

  // =========================================================================
  // AI API (proxied to Anthropic) — key stays server-side
  // =========================================================================

  // These calls cost real money per request. One shared limiter, keyed by
  // workspace (falling back to IP if that's ever missing) rather than just
  // IP, so it can't be starved by NAT/shared-office traffic and one workspace
  // can't drain another's budget.
  const aiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthedRequest).auth?.workspaceId || ipKeyGenerator(req.ip || "unknown"),
  });

  /**
   * Fast semantic search (claude-haiku-4-5).
   * Sends the query + a compact index (id, name, tags, status, type) and expects
   * back a ranked JSON array of matching file ids. Falls back to keyword matching
   * whenever the AI call is unavailable or fails.
   */
  app.post("/api/search", aiLimiter, async (req: AuthedRequest, res) => {
    const { query, files } = req.body as { query: string; files?: VaultFile[] };
    const allFiles: VaultFile[] = Array.isArray(files) && files.length ? files : getFiles(workspaceOf(req));

    if (!query || !query.trim()) return res.json([]);

    if (!anthropic) {
      return res.json(keywordSearch(query, allFiles));
    }

    // Compact index — only what the model needs to reason about relevance.
    const index = allFiles.map((f) => ({
      id: String(f.id),
      name: f.name,
      tags: f.tags,
      status: f.status,
      type: f.type,
    }));

    try {
      const message = await anthropic.messages.create({
        model: SEARCH_MODEL,
        max_tokens: 512,
        system:
          "You are a fast semantic file-search engine. Given a user query and a JSON index of files " +
          "(id, name, tags, status, type), decide which files best match the user's intent. Consider " +
          "filenames, tags, extensions, and meaning — not just literal substrings. " +
          'Respond with ONLY a JSON array of matching file id strings, most relevant first, e.g. ["f3","f1"]. ' +
          "Return [] if nothing matches. No prose, no explanation.",
        messages: [
          {
            role: "user",
            content: `Query: "${query}"\n\nFiles:\n${JSON.stringify(index)}`,
          },
        ],
      });

      const ids = extractJson<string[]>(extractText(message));
      if (Array.isArray(ids)) {
        return res.json(ids.map(String));
      }
      // Model returned something unparseable — degrade gracefully.
      return res.json(keywordSearch(query, allFiles));
    } catch (e: any) {
      console.error("[/api/search] AI error, falling back to keyword:", e.message);
      return res.json(keywordSearch(query, allFiles));
    }
  });

  /**
   * File & Project Copilot chat (claude-sonnet-4-6).
   * `fileContext` is the selected file or project object; it's given to the model
   * as reference context so answers are grounded in the user's actual data.
   */
  app.post("/api/chat", aiLimiter, async (req: AuthedRequest, res) => {
    const { prompt, fileContext } = req.body as { prompt: string; fileContext?: unknown };
    if (!anthropic) {
      return res.status(503).json({
        error: "AI is not configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.",
      });
    }
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: "Missing prompt" });

    try {
      const contextBlock = fileContext
        ? `Reference context (the item the user is currently working with), as JSON:\n${JSON.stringify(
            fileContext
          )}\n\n`
        : "";

      const message = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 2048,
        system:
          "You are Desboard Copilot, an assistant embedded in a design-studio workspace app. You help with " +
          "the user's files, projects, and clients: drafting client update emails, summarizing documents, " +
          "extracting action items, and analyzing deadlines and timeline risks. Be concise, practical, and " +
          "professional. Use the provided reference context when relevant, and say so if information is missing.",
        messages: [{ role: "user", content: `${contextBlock}${prompt}` }],
      });

      res.json({ text: extractText(message) });
    } catch (e: any) {
      console.error("[/api/chat] AI error:", e.message);
      res.status(500).json({ error: e.message || "Failed to generate answer" });
    }
  });

  /**
   * Upload analysis (claude-sonnet-4-6).
   * Suggests a short summary + tags for a freshly uploaded file. Images and PDFs
   * are passed to the model as real content; other file types are analyzed from
   * their name/type alone.
   */
  app.post("/api/analyze", aiLimiter, async (req: AuthedRequest, res) => {
    const { fileName, fileContent, mimeType } = req.body as {
      fileName: string;
      fileContent?: string;
      mimeType?: string;
    };
    if (!anthropic) {
      return res.status(503).json({
        error: "AI is not configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.",
      });
    }

    try {
      const mime = mimeType || "application/octet-stream";
      const isImage = /^image\/(png|jpe?g|gif|webp)$/i.test(mime);
      const isPdf = mime === "application/pdf";

      const content: Anthropic.ContentBlockParam[] = [];
      if (fileContent && isImage) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: fileContent,
          },
        });
      } else if (fileContent && isPdf) {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fileContent },
        });
      }
      content.push({
        type: "text",
        text:
          `Analyze the uploaded file named "${fileName}" (type: ${mime}). ` +
          (isImage || isPdf
            ? "Base your analysis on its actual contents shown above. "
            : "Only its name and type are available, so infer sensibly from those. ") +
          "Respond with ONLY a JSON object of the form " +
          '{"summary": "<a brief 1-2 sentence summary>", "tags": ["Tag1", "Tag2", "Tag3"]} ' +
          "with 3-5 short one-or-two-word tags. No prose outside the JSON.",
      });

      const message = await anthropic.messages.create({
        model: CHAT_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content }],
      });

      const parsed = extractJson<{ summary?: string; tags?: string[] }>(extractText(message));
      if (parsed && Array.isArray(parsed.tags)) {
        return res.json({ summary: parsed.summary ?? "", tags: parsed.tags.slice(0, 5) });
      }
      return res.status(502).json({ error: "Could not parse AI response" });
    } catch (e: any) {
      console.error("[/api/analyze] AI error:", e.message);
      res.status(500).json({ error: e.message || "Failed to analyze" });
    }
  });

  // =========================================================================
  // Home-screen assistant
  // =========================================================================

  /**
   * Suggested prompts for the assistant's empty state, generated from the
   * user's real data (recent project, pending approvals, recent handover
   * activity). No AI call — this must load instantly and never block.
   */
  app.get("/api/assistant/suggestions", (req: AuthedRequest, res) => {
    const workspaceId = workspaceOf(req);
    const projects = getProjects(workspaceId);
    const files = getFiles(workspaceId);
    const suggestions: string[] = [];

    if (projects.length === 0) {
      return res.json({
        suggestions: [
          "What can you help me with?",
          "How do I create my first project?",
          "How do handovers work?",
        ],
      });
    }

    const recent = projects[0];
    suggestions.push(`What's the latest on ${recent.name}?`);

    const pending = files.find((f) => f.status === "Review");
    if (pending) {
      const proj = pending.projectId ? projects.find((p) => p.id === `p${pending.projectId}`) : undefined;
      suggestions.push(`Which files are waiting on approval${proj ? ` in ${proj.name}` : ""}?`);
    }

    const activeHandover = getHandovers(workspaceId).find((h) => h.status === "Sent") ?? getHandovers(workspaceId)[0];
    if (activeHandover) {
      suggestions.push(`Summarize the "${activeHandover.title}" handover`);
    }

    const deadlineProj = projects.find((p) => p.status === "In Progress") ?? recent;
    if (suggestions.length < 4) {
      suggestions.push(`Is ${deadlineProj.name} on track for its deadline?`);
    }

    res.json({ suggestions: suggestions.slice(0, 4) });
  });

  /** Usage metrics: question volume + suggestion click-through. */
  app.post("/api/assistant/metrics", (req: AuthedRequest, res) => {
    const { event, detail } = req.body as { event?: string; detail?: string };
    const knownEvents = ["ask", "suggestion_click", "tab_change", "rail_action"];
    if (!event || !knownEvents.includes(event)) {
      return res.status(400).json({ error: "Unknown event" });
    }
    logAssistantMetric(workspaceOf(req), event, typeof detail === "string" ? detail.slice(0, 500) : undefined);
    res.status(204).end();
  });

  /**
   * Streaming workspace assistant (SSE). Read-only: it answers, finds and
   * summarizes over a compact index of the real workspace data; it performs no
   * writes and is told to redirect write requests to the right screen. Sources
   * are returned structurally (real file ids resolved server-side), never
   * parsed back out of the prose.
   */
  app.post("/api/assistant", aiLimiter, async (req: AuthedRequest, res) => {
    const { messages } = req.body as { messages?: { role: string; text: string }[] };
    if (!anthropic) {
      return res.status(503).json({
        error: "AI is not configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.",
      });
    }
    if (!Array.isArray(messages) || messages.length === 0 || !messages[messages.length - 1]?.text?.trim()) {
      return res.status(400).json({ error: "Missing messages" });
    }

    const workspaceId = workspaceOf(req);
    const files = getFiles(workspaceId);
    const projects = getProjects(workspaceId);
    const handovers = getHandovers(workspaceId);
    const index = {
      projects,
      files: files.map((f) => ({
        id: f.id, name: f.name, type: f.type, extension: f.extension, size: f.size,
        status: f.status, projectId: f.projectId, clientId: f.clientId, tags: f.tags,
        owner: f.owner, created: f.created,
        latestVersion: f.versions.find((v) => v.latest)?.version,
      })),
      handovers: handovers.map((h) => ({
        id: h.id, projectId: h.projectId, title: h.title, recipient: h.recipient,
        status: h.status, fileIds: h.fileIds, created: h.created,
      })),
    };

    const MARKER = "@@SOURCES:";
    const system =
      "You are the Desboard workspace assistant on the home screen. You answer questions about the user's " +
      "projects, files and handovers using ONLY the workspace index provided below. You are READ-ONLY: you " +
      "cannot create projects, link/unlink files, change statuses, or publish handovers. If asked to do any " +
      "of those, briefly say what would be done and point the user to the right screen (Projects, File Vault, " +
      "or the project's Handovers panel) instead. If the index doesn't contain the answer, say you don't have " +
      "that information — do not guess. Be concise; a few sentences unless asked for detail.\n\n" +
      `Workspace index:\n${JSON.stringify(index)}\n\n` +
      `After your answer, on a new line, output exactly ${MARKER} followed by a JSON array of the file ids ` +
      `from the index you actually used to answer (e.g. ${MARKER}["f1","f3"]). Use ${MARKER}[] if you used no ` +
      "specific files. Output nothing after that line.";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Forward text deltas, holding back anything that could be the start of the
    // sources marker so it never flashes into the visible answer.
    let acc = "";
    let sent = 0;
    let inSources = false;
    const safeLen = (s: string) => {
      for (let k = Math.min(MARKER.length - 1, s.length); k > 0; k--) {
        if (MARKER.startsWith(s.slice(s.length - k))) return s.length - k;
      }
      return s.length;
    };

    try {
      const stream = anthropic.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system,
        messages: messages.map((m) => ({
          role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
          content: m.text,
        })),
      });
      req.on("close", () => stream.abort());

      stream.on("text", (delta) => {
        if (inSources) { acc += delta; return; }
        acc += delta;
        const idx = acc.indexOf(MARKER, sent);
        if (idx !== -1) {
          if (idx > sent) send({ type: "delta", text: acc.slice(sent, idx) });
          sent = idx;
          inSources = true;
        } else {
          const upTo = safeLen(acc);
          if (upTo > sent) { send({ type: "delta", text: acc.slice(sent, upTo) }); sent = upTo; }
        }
      });

      await stream.finalMessage();

      let sourceIds: string[] = [];
      const markerAt = acc.indexOf(MARKER);
      if (markerAt !== -1) {
        const parsed = extractJson<string[]>(acc.slice(markerAt + MARKER.length));
        if (Array.isArray(parsed)) sourceIds = parsed.map(String);
      } else if (sent < acc.length) {
        // No marker ever arrived — flush the held-back tail.
        send({ type: "delta", text: acc.slice(sent) });
      }
      // Only real files, resolved server-side — never reconstructed from prose.
      const sources = sourceIds
        .map((id) => files.find((f) => f.id === id))
        .filter((f): f is VaultFile => !!f)
        .map((f) => ({ id: f.id, name: f.name }));
      send({ type: "sources", sources });
      send({ type: "done" });
    } catch (e: any) {
      if (!res.writableEnded) {
        const rateLimited = e?.status === 429;
        send({ type: "error", message: rateLimited ? "rate_limited" : e?.message || "Assistant failed" });
      }
      console.error("[/api/assistant] AI error:", e?.message);
    } finally {
      res.end();
    }
  });

  // =========================================================================
  // Frontend (Vite in dev, static build in prod)
  // =========================================================================

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Automatic client reminders — opt-in by nature of RESEND_API_KEY being
  // set at all, so an unconfigured install never emails anyone on its own.
  // getReminderCandidates() already enforces the unopened-days threshold and
  // a per-handover cooldown, so this is safe to run on a plain interval
  // rather than needing its own dedup bookkeeping here.
  async function runReminderSweep() {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
    for (const workspaceId of getAllWorkspaceIds()) {
      const settings = getSettings(workspaceId);
      for (const candidate of getReminderCandidates(workspaceId)) {
        const sent = await sendEmail({
          to: candidate.clientEmail,
          subject: `Reminder: ${candidate.handoverTitle}`,
          html: reminderEmailHtml({
            studioName: settings.studioName || "Your studio",
            handoverTitle: candidate.handoverTitle,
            portalUrl: `${baseUrl}/portal/${candidate.token}`,
          }),
        });
        if (sent) markReminderSent(candidate.handoverId, workspaceId);
      }
    }
  }

  if (emailConfigured) {
    const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
    setInterval(() => {
      runReminderSweep().catch((e) => console.error("[reminders] Sweep failed:", e));
    }, SWEEP_INTERVAL_MS);
    console.log("[Desboard] Automatic client reminders enabled (RESEND_API_KEY set).");
  } else {
    console.log(
      "\n[Desboard] Client reminders are logged, not sent — set RESEND_API_KEY (and optionally\n" +
        "           REMINDER_FROM_EMAIL) in .env to enable real delivery.\n"
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Desboard running at  http://localhost:${PORT}\n`);
  });
}

startServer();
