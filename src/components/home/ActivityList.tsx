import { useState } from "react";
import type { DashboardData, VaultFile, ProjectFull } from "../../types";
import { timeAgo } from "../../lib/utils";
import { logAssistantEvent } from "../../lib/assistant";

type Tab = "all" | "needs_you" | "review" | "delivered";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_you", label: "Needs you" },
  { key: "review", label: "In review" },
  { key: "delivered", label: "Delivered" },
];

const TAB_KEY = "desboard_activity_tab";

type Row =
  | { kind: "file"; id: string; ts: number; file: VaultFile; projectName: string | null }
  | {
      kind: "approval";
      id: string;
      ts: number;
      title: string;
      projectId: string;
      description: string;
    };

/**
 * Real-data activity feed for the home screen: files sitting in Review or
 * marked Delivered, plus handovers still awaiting a client's approval. No
 * portal-visit telemetry here — that's covered by the greeting fact and the
 * insight rail; this list is about asset/handover state.
 */
export function ActivityList({
  dash,
  files,
  projects,
  loading,
  onOpenFile,
  onOpenApproval,
}: {
  dash: DashboardData | null;
  files: VaultFile[];
  projects: ProjectFull[];
  loading: boolean;
  onOpenFile: (fileId: string) => void;
  onOpenApproval: (projectId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved === "all" || saved === "needs_you" || saved === "review" || saved === "delivered" ? saved : "all";
    } catch {
      return "all";
    }
  });

  const changeTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* best effort */
    }
    logAssistantEvent("tab_change", next);
  };

  const projectName = (numericId: number | null | undefined) => {
    if (numericId == null) return null;
    return projects.find((p) => Number(p.id.replace(/^p/, "")) === numericId)?.name ?? null;
  };

  const fileRows: Row[] = files
    .filter((f) => f.status === "Review" || f.status === "Delivered")
    .map((f) => ({
      kind: "file",
      id: f.id,
      ts: Date.parse(f.statusChangedAt || f.created) || 0,
      file: f,
      projectName: projectName(f.projectId),
    }));

  const approvalRows: Row[] = (dash?.pendingApprovals ?? []).map((a) => ({
    kind: "approval",
    id: a.handoverId,
    ts: Date.parse(a.created) || 0,
    title: a.handoverTitle,
    projectId: a.projectId,
    description: `${a.approvedFiles} of ${a.totalFiles} approved · ${a.clientName || a.recipient}`,
  }));

  const filtered: Row[] =
    tab === "needs_you"
      ? approvalRows
      : tab === "review"
        ? fileRows.filter((r) => r.kind === "file" && r.file.status === "Review")
        : tab === "delivered"
          ? fileRows.filter((r) => r.kind === "file" && r.file.status === "Delivered")
          : [...fileRows, ...approvalRows];

  const rows = [...filtered].sort((a, b) => b.ts - a.ts);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => changeTab(t.key)}
            className={`text-[12.5px] px-2.5 py-1 rounded-full transition-colors ${
              tab === t.key ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-panel overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3 border-b border-line last:border-b-0 animate-pulse">
              <div className="h-3.5 w-2/3 bg-chip rounded mb-2" />
              <div className="h-3 w-1/3 bg-chip rounded" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-line rounded-2xl">
          <p className="text-[13px] text-ink/70 mb-1">Nothing here yet</p>
          <p className="text-[12.5px] text-muted">
            {tab === "needs_you" ? "No handovers are waiting on a client approval." : "Files will show up here as their status changes."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-panel overflow-hidden">
          {rows.map((r) =>
            r.kind === "file" ? (
              <button
                key={r.id}
                onClick={() => onOpenFile(r.file.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-line last:border-b-0 hover:bg-surface/60 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    r.file.status === "Approved" ? "bg-moss" : r.file.status === "Review" ? "bg-amber" : "bg-muted"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-ink font-medium truncate">{r.file.name}</span>
                  <span className="block text-[12px] text-muted truncate">
                    {r.file.status}
                    {r.projectName ? ` · ${r.projectName}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-muted">{timeAgo(r.file.statusChangedAt || r.file.created)}</span>
              </button>
            ) : (
              <button
                key={r.id}
                onClick={() => onOpenApproval(r.projectId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-line last:border-b-0 hover:bg-surface/60 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-ink font-medium truncate">{r.title}</span>
                  <span className="block text-[12px] text-muted truncate">{r.description}</span>
                </span>
                <span className="shrink-0 text-[12px] text-muted">{timeAgo(new Date(r.ts).toISOString())}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
