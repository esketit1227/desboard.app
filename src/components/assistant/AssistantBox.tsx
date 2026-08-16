import { useEffect, useRef, useState } from "react";
import { ArrowUp, History, Plus, Square } from "lucide-react";
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
    <div className="w-full max-w-[560px] mx-auto">
      <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-[20px] p-4 shadow-xl relative">
        <div className="flex items-center justify-end mb-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={openHistory} title="Recent threads" className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D85E25] transition-colors">
              <History className="w-3.5 h-3.5" />
            </button>
            {expanded && (
              <button type="button" onClick={newChat} title="New chat" className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D85E25] transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {historyOpen && (
          <div className="absolute right-4 top-12 z-30 w-64 bg-[#141416] border border-white/10 rounded-xl shadow-2xl p-2">
            {recents.length === 0 ? (
              <div className="text-[11px] text-white/40 px-2 py-3 text-center">No recent threads</div>
            ) : (
              recents.map((t) => (
                <button key={t.id} type="button" onClick={() => restore(t)} className="w-full text-left text-[12px] text-[#DBCBC2]/80 hover:text-white hover:bg-white/5 rounded-lg px-2.5 py-2 truncate transition-colors">
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
          className="flex items-end gap-2 bg-white/[0.04] border border-white/10 rounded-2xl px-3.5 py-2 focus-within:border-[#D85E25]/60 transition-colors"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
            }}
            placeholder="Ask about your projects — what's unapproved, what changed, where a file is"
            aria-label="Ask the workspace assistant"
            className="flex-1 bg-transparent text-[13px] text-[#EBE6DD] placeholder:text-white/30 outline-none resize-none max-h-28 py-1.5"
          />
          {busy ? (
            <button type="button" onClick={cancel} title="Stop generating" className="shrink-0 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D85E25] transition-colors">
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} title="Ask" className="shrink-0 w-8 h-8 rounded-full bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white transition-colors">
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
