import { useEffect, useState } from "react";
import { PartyPopper, X } from "lucide-react";
import type { CompletedApproval } from "../../types";

const SEEN_KEY = "desboard_celebration_seen";
/** Sentinel meaning "never initialized" — distinct from 0, a real (if ancient) epoch ms. */
const UNINITIALIZED = -1;

/**
 * A quiet, dismissible strip that surfaces once when a handover package the
 * client was reviewing becomes fully approved — the one piece of genuinely
 * good news this app has to report. Mounted only once real dashboard data has
 * loaded (see Dashboard.tsx), so the very first mount already has real
 * `completedApprovals` to seed against: on that first-ever mount we adopt the
 * newest completion already present as the baseline rather than celebrating
 * a workspace's entire history, then only fire for completions newer than
 * whatever was last shown or dismissed.
 */
export function CelebrationBanner({
  completedApprovals,
  onOpenProject,
}: {
  completedApprovals: CompletedApproval[];
  onOpenProject: (projectId: string) => void;
}) {
  const [seenMark, setSeenMark] = useState<number>(() => {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? Number(raw) : UNINITIALIZED;
  });

  useEffect(() => {
    if (seenMark !== UNINITIALIZED) return;
    const maxTs = completedApprovals.reduce((m, c) => Math.max(m, Date.parse(c.completedAt)), 0);
    setSeenMark(maxTs);
    try {
      localStorage.setItem(SEEN_KEY, String(maxTs));
    } catch {
      /* best effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedApprovals]);

  const markSeen = (ts: number) => {
    setSeenMark(ts);
    try {
      localStorage.setItem(SEEN_KEY, String(ts));
    } catch {
      /* best effort */
    }
  };

  if (seenMark === UNINITIALIZED) return null;
  const newest = completedApprovals.find((c) => Date.parse(c.completedAt) > seenMark);
  if (!newest) return null;

  const clientDisplay = newest.clientName || newest.recipient || "Your client";

  return (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-panel pl-4 pr-2 py-3">
      <PartyPopper className="w-4 h-4 text-ink shrink-0" />
      <button
        type="button"
        onClick={() => {
          markSeen(Date.parse(newest.completedAt));
          onOpenProject(newest.projectId);
        }}
        className="flex-1 min-w-0 text-left text-[13px] text-ink/85 hover:text-ink transition-colors"
      >
        {clientDisplay} approved every file in <span className="font-medium text-ink">{newest.handoverTitle}</span>.
      </button>
      <button
        type="button"
        onClick={() => markSeen(Date.parse(newest.completedAt))}
        aria-label="Dismiss"
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-line transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
