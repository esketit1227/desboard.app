/**
 * Desboard backend — Node.js + Express.
 *
 * Responsibilities:
 *  1. Serve the React frontend (via Vite middleware in dev, static files in prod).
 *  2. Expose a small REST API over the SQLite database (files / projects / tags).
 *  3. Proxy every AI call to the Anthropic Claude API using the official SDK, so
 *     the ANTHROPIC_API_KEY lives only on the server and never reaches the browser.
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
import {
  getFiles,
  getFileById,
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
  logAssistantMetric,
} from "./db.ts";
import type { VaultFile } from "./src/types.ts";
import { renderHandoverPage } from "./src/lib/handoverPage.ts";

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

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: "50mb" }));

  // =========================================================================
  // Data API (SQLite-backed) — survives refresh
  // =========================================================================

  app.get("/api/files", (_req, res) => {
    res.json(getFiles());
  });

  app.post("/api/files", (req, res) => {
    try {
      const created = createFile(req.body as VaultFile);
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create file" });
    }
  });

  app.patch("/api/files/:id", (req, res) => {
    const updated = updateFile(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "File not found" });
    res.json(updated);
  });

  app.get("/api/projects", (_req, res) => {
    res.json(getProjects());
  });

  app.post("/api/projects", (req, res) => {
    try {
      const created = createProject(req.body);
      res.status(201).json(created);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create project" });
    }
  });

  app.get("/api/tags", (_req, res) => {
    res.json(getTags());
  });

  // --- Handovers ---
  app.get("/api/handovers", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    res.json(getHandovers(projectId));
  });

  app.post("/api/handovers", (req, res) => {
    try {
      res.status(201).json(createHandover(req.body));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Failed to create handover" });
    }
  });

  app.patch("/api/handovers/:id", (req, res) => {
    const updated = updateHandover(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Handover not found" });
    res.json(updated);
  });

  app.delete("/api/handovers/:id", (req, res) => {
    const ok = deleteHandover(req.params.id);
    if (!ok) return res.status(404).json({ error: "Handover not found" });
    res.status(204).end();
  });

  // --- Handover discussion (shared client/designer thread + file annotations) ---
  app.get("/api/handovers/comment-counts", (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    res.json(projectId ? getCommentCounts(projectId) : {});
  });

  app.get("/api/handovers/:id/comments", (req, res) => {
    if (!getHandoverById(req.params.id)) return res.status(404).json({ error: "Handover not found" });
    res.json(getComments(req.params.id));
  });

  app.post("/api/handovers/:id/comments", (req, res) => {
    const handover = getHandoverById(req.params.id);
    if (!handover) return res.status(404).json({ error: "Handover not found" });
    const { author, role, body, fileId } = req.body as {
      author?: string;
      role?: string;
      body?: string;
      fileId?: string | null;
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
    });
    res.status(201).json(comment);
  });

  app.delete("/api/handovers/:id/comments/:commentId", (req, res) => {
    const ok = deleteComment(req.params.commentId);
    if (!ok) return res.status(404).json({ error: "Comment not found" });
    res.status(204).end();
  });

  // Standalone, client-facing branded handover landing page. Registered before the
  // frontend middleware so it wins over the SPA catch-all. Shareable as-is.
  app.get("/handover/:id", (req, res) => {
    const handover = getHandoverById(req.params.id);
    if (!handover) {
      return res
        .status(404)
        .type("html")
        .send(
          `<!doctype html><meta charset="utf-8"><title>Not found</title>` +
            `<body style="background:#0b0b0d;color:#EBE6DD;font-family:system-ui;display:flex;height:100vh;margin:0;align-items:center;justify-content:center">` +
            `<div style="text-align:center"><h1 style="font-weight:600">Handover not found</h1>` +
            `<p style="opacity:.6">This handover link is invalid or has been removed.</p></div></body>`
        );
    }
    const files = getFiles().filter((f) => handover.fileIds.includes(String(f.id)));
    const comments = getComments(handover.id);
    res.type("html").send(renderHandoverPage({ handover, files, comments }));
  });

  // Download a file from a handover. This demo stores file metadata rather than
  // the original binary, so we return a delivery note describing the asset —
  // enough to make the client-facing "Download" button actually produce a file.
  app.get("/handover/:id/file/:fileId/download", (req, res) => {
    const handover = getHandoverById(req.params.id);
    if (!handover || !handover.fileIds.includes(req.params.fileId)) {
      return res.status(404).type("text").send("File not found in this handover.");
    }
    const file = getFileById(req.params.fileId);
    if (!file) return res.status(404).type("text").send("File not found.");

    const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._ -]/g, "_");
    const body =
      `${file.name}\n${"=".repeat(Math.max(file.name.length, 3))}\n\n` +
      `Delivered via Desboard handover: ${handover.title}\n` +
      `Recipient: ${handover.recipient || "-"}\n` +
      `Type: ${file.type === "folder" ? "Folder" : (file.extension || "file").toUpperCase()}\n` +
      `Size: ${file.size || "-"}\n` +
      `Status: ${file.status || "-"}\n` +
      `Tags: ${(file.tags || []).join(", ") || "-"}\n\n` +
      `Note: This is a delivery note. In this build Desboard stores file metadata\n` +
      `rather than the original binary, so the asset is represented by this summary.\n`;

    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.txt"`);
    res.type("text/plain; charset=utf-8").send(body);
  });

  // =========================================================================
  // AI API (proxied to Anthropic) — key stays server-side
  // =========================================================================

  /**
   * Fast semantic search (claude-haiku-4-5).
   * Sends the query + a compact index (id, name, tags, status, type) and expects
   * back a ranked JSON array of matching file ids. Falls back to keyword matching
   * whenever the AI call is unavailable or fails.
   */
  app.post("/api/search", async (req, res) => {
    const { query, files } = req.body as { query: string; files?: VaultFile[] };
    const allFiles: VaultFile[] = Array.isArray(files) && files.length ? files : getFiles();

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
  app.post("/api/chat", async (req, res) => {
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
  app.post("/api/analyze", async (req, res) => {
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
  app.get("/api/assistant/suggestions", (_req, res) => {
    const projects = getProjects();
    const files = getFiles();
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

    const activeHandover = getHandovers().find((h) => h.status === "Sent") ?? getHandovers()[0];
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
  app.post("/api/assistant/metrics", (req, res) => {
    const { event, detail } = req.body as { event?: string; detail?: string };
    if (event !== "ask" && event !== "suggestion_click") {
      return res.status(400).json({ error: "Unknown event" });
    }
    logAssistantMetric(event, typeof detail === "string" ? detail.slice(0, 500) : undefined);
    res.status(204).end();
  });

  /**
   * Streaming workspace assistant (SSE). Read-only: it answers, finds and
   * summarizes over a compact index of the real workspace data; it performs no
   * writes and is told to redirect write requests to the right screen. Sources
   * are returned structurally (real file ids resolved server-side), never
   * parsed back out of the prose.
   */
  app.post("/api/assistant", async (req, res) => {
    const { messages } = req.body as { messages?: { role: string; text: string }[] };
    if (!anthropic) {
      return res.status(503).json({
        error: "AI is not configured. Add ANTHROPIC_API_KEY to your .env file and restart the server.",
      });
    }
    if (!Array.isArray(messages) || messages.length === 0 || !messages[messages.length - 1]?.text?.trim()) {
      return res.status(400).json({ error: "Missing messages" });
    }

    const files = getFiles();
    const projects = getProjects();
    const handovers = getHandovers();
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  Desboard running at  http://localhost:${PORT}\n`);
  });
}

startServer();
