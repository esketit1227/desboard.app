import { useEffect, useRef } from "react";
import { FileText, Sparkles } from "lucide-react";
import type { AssistantMessage } from "../../lib/assistant";

/**
 * The conversation portion of the home-screen assistant: user/ai messages,
 * the in-progress streamed answer, citation chips wired to real file ids,
 * and error text. A polite live region so screen readers hear answers.
 */
export function AssistantThread({
  messages,
  streamingText,
  isWaiting,
  error,
  onOpenFile,
}: {
  messages: AssistantMessage[];
  /** Partial answer while streaming, or null when not streaming. */
  streamingText: string | null;
  /** Submitted, no first token yet. */
  isWaiting: boolean;
  error: string | null;
  onOpenFile: (fileId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, streamingText, isWaiting]);

  return (
    <div aria-live="polite" className="flex flex-col gap-3 overflow-y-auto max-h-[300px] pr-1 mb-3">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="self-end max-w-[85%] bg-white/10 text-[#EBE6DD] text-[12.5px] rounded-xl rounded-br-sm px-3.5 py-2 whitespace-pre-wrap">
            {m.text}
          </div>
        ) : (
          <div key={i} className="self-start max-w-[92%]">
            <div className="text-[#DBCBC2] text-[12.5px] leading-relaxed whitespace-pre-wrap">{m.text}</div>
            {m.sources && m.sources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {m.sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onOpenFile(s.id)}
                    title={`Open ${s.name} in the File Vault`}
                    className="flex items-center gap-1.5 text-[10px] font-mono text-[#D85E25] bg-[#D85E25]/10 border border-[#D85E25]/30 rounded-full px-2.5 py-1 hover:bg-[#D85E25]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D85E25] transition-colors"
                  >
                    <FileText className="w-3 h-3" /> {s.name}
                  </button>
                ))}
              </div>
            )}
            {m.sources && m.sources.length === 0 && (
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mt-2">
                No workspace sources — general guidance only
              </div>
            )}
          </div>
        )
      )}

      {streamingText !== null && (
        <div className="self-start max-w-[92%] text-[#DBCBC2] text-[12.5px] leading-relaxed whitespace-pre-wrap">
          {streamingText}
          <span className="inline-block w-1.5 h-3.5 bg-[#D85E25] ml-0.5 align-middle animate-pulse" aria-hidden />
        </div>
      )}
      {isWaiting && (
        <div className="self-start flex items-center gap-2 text-white/40 text-[11px]">
          <Sparkles className="w-3.5 h-3.5 animate-pulse text-[#D85E25]" /> Thinking…
        </div>
      )}
      {error && <div className="self-start text-[12px] text-red-400/90">{error}</div>}
      <div ref={endRef} />
    </div>
  );
}
