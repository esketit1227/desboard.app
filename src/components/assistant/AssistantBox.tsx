import { useEffect, useRef, useState } from "react";
import { ArrowUp, History, Plus, Sparkles, Square } from "lucide-react";
import {
  type AssistantMessage,
  type AssistantThreadRecord,
  loadThreads,
  logAssistantEvent,
  saveThread,
  streamAssistant,
} from "../../lib/assistant";
import { AssistantThread } from "./AssistantThread";
import { SuggestionChips } from "./SuggestionChips";

/**
 * Home-screen assistant: a command-surface chat box in the dashboard's middle
 * region. Empty state is a search-like input with data-driven suggestions; on
 * ask it expands in place into a streamed conversation. Read-only by design —
 * the server-side assistant answers/finds/summarizes and redirects writes.
 */
export function AssistantBox({ onOpenFile }: { onOpenFile: (fileId: string) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [thread, setThread] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recents, setRecents] = useState<AssistantThreadRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const accRef = useRef("");
  const threadIdRef = useRef(`t${Date.now()}`);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Progressive: input is usable immediately; chips appear when data arrives.
  useEffect(() => {
    fetch("/api/assistant/suggestions")
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((d: { suggestions?: string[] }) => setSuggestions(d.suggestions ?? []))
      .catch(() => {});
    return () => abortRef.current?.abort();
  }, []);

  // "/" focuses the command box from anywhere on the home screen, unless the
  // user is already typing into another field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const busy = isWaiting || streamingText !== null;

  const finalize = (msgs: AssistantMessage[]) => {
    setThread(msgs);
    setStreamingText(null);
    setIsWaiting(false);
    if (msgs.length > 0) {
      saveThread({
        id: threadIdRef.current,
        title: msgs[0].text.slice(0, 80),
        messages: msgs,
        updated: new Date().toISOString(),
      });
    }
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const next: AssistantMessage[] = [...thread, { role: "user", text }];
    setThread(next);
    setInput("");
    setError(null);
    setIsWaiting(true);
    accRef.current = "";
    logAssistantEvent("ask");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let sourcesSeen: AssistantMessage["sources"];
    void streamAssistant(next, {
      signal: ctrl.signal,
      onDelta: (t) => {
        accRef.current += t;
        setIsWaiting(false);
        setStreamingText(accRef.current);
      },
      onSources: (s) => (sourcesSeen = s),
      onDone: () => finalize([...next, { role: "ai", text: accRef.current.trim(), sources: sourcesSeen }]),
      onError: (msg) => {
        setIsWaiting(false);
        setStreamingText(null);
        setError(msg);
      },
    });
  };

  const cancel = () => {
    abortRef.current?.abort();
    const partial = accRef.current.trim();
    finalize(partial ? [...thread, { role: "ai", text: partial }] : thread);
  };

  const newChat = () => {
    abortRef.current?.abort();
    threadIdRef.current = `t${Date.now()}`;
    setThread([]);
    setStreamingText(null);
    setIsWaiting(false);
    setError(null);
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  const openHistory = () => {
    if (!historyOpen) setRecents(loadThreads());
    setHistoryOpen(!historyOpen);
  };

  const restore = (t: AssistantThreadRecord) => {
    abortRef.current?.abort();
    threadIdRef.current = t.id;
    setThread(t.messages);
    setStreamingText(null);
    setIsWaiting(false);
    setError(null);
    setHistoryOpen(false);
  };

  const expanded = thread.length > 0 || busy || error !== null;

  return (
    <div className="w-full max-w-[640px] mx-auto">
      <div className="bg-panel border border-line rounded-[28px] p-6 relative overflow-hidden">
        {/* Soft accent glow — the one "featured card" moment on the page */}
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[220px] rounded-full opacity-[0.10] pointer-events-none"
          style={{ background: "radial-gradient(closest-side, var(--color-primary), transparent)" }}
          aria-hidden
        />
        <div className="relative flex items-center justify-end mb-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={openHistory} title="Recent threads" className="w-7 h-7 rounded-full bg-paper hover:bg-line/60 flex items-center justify-center text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary transition-colors">
              <History className="w-3.5 h-3.5" />
            </button>
            {expanded && (
              <button type="button" onClick={newChat} title="New chat" className="w-7 h-7 rounded-full bg-paper hover:bg-line/60 flex items-center justify-center text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {historyOpen && (
          <div className="absolute right-4 top-12 z-30 w-64 bg-surface border border-line rounded-xl shadow-lg p-2">
            {recents.length === 0 ? (
              <div className="text-[12px] text-muted px-2 py-3 text-center">No recent threads</div>
            ) : (
              recents.map((t) => (
                <button key={t.id} type="button" onClick={() => restore(t)} className="w-full text-left text-[13px] text-ink/80 hover:text-ink hover:bg-paper rounded-lg px-2.5 py-2 truncate transition-colors">
                  {t.title}
                </button>
              ))
            )}
          </div>
        )}

        {expanded && (
          <AssistantThread messages={thread} streamingText={streamingText} isWaiting={isWaiting} error={error} onOpenFile={onOpenFile} />
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); submit(input); }}
          className="flex items-center gap-3 bg-paper border border-transparent rounded-full pl-5 pr-1.5 py-2.5 focus-within:border-primary/50 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-primary/70 shrink-0" strokeWidth={1.75} />
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
            }}
            placeholder="Ask about your projects — what's unapproved, what changed…"
            aria-label="Ask the workspace assistant"
            className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted outline-none resize-none max-h-28 py-1"
          />
          {busy ? (
            <button type="button" onClick={cancel} title="Stop generating" className="shrink-0 w-8 h-8 rounded-full bg-chip hover:bg-line flex items-center justify-center text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary transition-colors">
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} title="Ask" className="shrink-0 w-8 h-8 rounded-full bg-primary hover:bg-primary/85 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink transition-colors">
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </form>

        {!expanded && (
          <SuggestionChips
            suggestions={suggestions}
            onPick={(s) => { logAssistantEvent("suggestion_click", s); submit(s); }}
          />
        )}
      </div>
    </div>
  );
}
