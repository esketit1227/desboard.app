/**
 * Client for the streaming home-screen assistant (/api/assistant, SSE).
 *
 * Exposes one function, streamAssistant, that POSTs the thread and invokes
 * callbacks as server-sent events arrive. Cancellation is an AbortSignal;
 * sources arrive structurally from the server (real file ids), never parsed
 * out of the answer text.
 */

export interface AssistantSource {
  id: string;
  name: string;
}

export interface AssistantMessage {
  role: "user" | "ai";
  text: string;
  /** Set on completed ai messages; empty array means the answer used no files. */
  sources?: AssistantSource[];
}

export interface AssistantThreadRecord {
  id: string;
  title: string;
  messages: AssistantMessage[];
  updated: string;
}

interface StreamHandlers {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onSources: (sources: AssistantSource[]) => void;
  onDone: () => void;
  onError: (message: string, kind: "error" | "rate_limited" | "unconfigured" | "offline") => void;
}

export async function streamAssistant(messages: AssistantMessage[], h: StreamHandlers): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    h.onError("You appear to be offline. Check your connection and try again.", "offline");
    return;
  }
  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: h.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    h.onError("Could not reach the assistant. Check your connection and try again.", "offline");
    return;
  }

  if (res.status === 503) {
    h.onError("AI features aren't available on this workspace right now.", "unconfigured");
    return;
  }
  if (res.status === 429) {
    h.onError("Too many requests right now — give it a moment and try again.", "rate_limited");
    return;
  }
  if (!res.ok || !res.body) {
    h.onError(`The assistant returned an error (${res.status}). Try again.`, "error");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const evt of events) {
        const line = evt.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let payload: { type: string; text?: string; sources?: AssistantSource[]; message?: string };
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (payload.type === "delta" && payload.text) h.onDelta(payload.text);
        else if (payload.type === "sources") h.onSources(payload.sources ?? []);
        else if (payload.type === "done") h.onDone();
        else if (payload.type === "error") {
          if (payload.message === "rate_limited") {
            h.onError("Too many requests right now — give it a moment and try again.", "rate_limited");
          } else {
            h.onError(payload.message || "The assistant hit an error. Try again.", "error");
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      h.onError("The connection dropped mid-answer. Try again.", "error");
    }
  }
}

/** Fire-and-forget usage metric (question volume / suggestion click-through / home-screen interactions). */
export function logAssistantEvent(event: "ask" | "suggestion_click" | "tab_change" | "rail_action", detail?: string): void {
  fetch("/api/assistant/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, detail }),
  }).catch(() => {});
}

// --- Recent threads (small, local, capped) -----------------------------------

const THREADS_KEY = "desboard_assistant_threads";
const MAX_THREADS = 5;

export function loadThreads(): AssistantThreadRecord[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AssistantThreadRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveThread(thread: AssistantThreadRecord): void {
  try {
    const rest = loadThreads().filter((t) => t.id !== thread.id);
    localStorage.setItem(THREADS_KEY, JSON.stringify([thread, ...rest].slice(0, MAX_THREADS)));
  } catch {
    /* storage full or unavailable — recents are best-effort */
  }
}
