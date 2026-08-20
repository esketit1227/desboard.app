/**
 * Suggested prompts under the assistant input's empty state. Loaded
 * progressively from /api/assistant/suggestions (real workspace data);
 * rendering nothing while loading so the input is never blocked.
 */
export function SuggestionChips({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="text-left text-[12.5px] text-ink/70 bg-surface border border-line rounded-full px-3.5 py-2 hover:border-primary/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary transition-colors"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
