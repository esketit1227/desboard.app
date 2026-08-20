import { useEffect, useState } from "react";
import { CheckCircle2, Link2, ExternalLink, Package } from "lucide-react";
import { api } from "../../lib/api";
import { isApprovalCurrent } from "../../lib/filePreview";
import type { Handover, ProjectFull, VaultFile } from "../../types";

interface HandoverRow {
  handoverId: string;
  handoverTitle: string;
  token: string;
  projectId: string;
  projectName: string;
  recipient: string;
  clientName?: string;
  totalFiles: number;
  approvedFiles: number;
  sentDaysAgo: number;
}

/**
 * Every sent handover package — approved and still-unapproved alike — one
 * scrollable list. Lives inside Messaging as a section rather than its own
 * app: reviewing what's been sent to a client is close kin to the rest of
 * client communication that lives here. Composed entirely from existing
 * endpoints (handovers, per-handover approvals, files); no new backend surface.
 */
export function MessagingHandoversSection({
  showToast,
  onOpenProject,
}: {
  showToast: (msg: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [rows, setRows] = useState<HandoverRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getHandovers(), api.getProjects(), api.getFiles()]).then(async ([handovers, projects, files]) => {
      const relevant = handovers.filter((h: Handover) => h.status !== "Draft" && !h.revoked && h.fileIds.length > 0);
      const approvalsByHandover = await Promise.all(relevant.map((h) => api.getHandoverApprovals(h.id)));
      if (cancelled) return;

      const filesById = new Map(files.map((f) => [f.id, f]));
      const projectsById = new Map(projects.map((p) => [p.id, p]));

      const built: HandoverRow[] = relevant.map((h, i) => {
        const approvals = approvalsByHandover[i];
        const approvedFiles = h.fileIds.filter((id) => {
          const a = approvals[id];
          return a?.status === "approved" && isApprovalCurrent(a, filesById.get(id));
        }).length;
        const sentDaysAgo = Math.max(0, Math.floor((Date.now() - Date.parse(h.created)) / 86_400_000));
        return {
          handoverId: h.id,
          handoverTitle: h.title,
          token: h.token,
          projectId: h.projectId,
          projectName: projectsById.get(h.projectId)?.name ?? "Unknown project",
          recipient: h.recipient,
          clientName: h.clientName,
          totalFiles: h.fileIds.length,
          approvedFiles,
          sentDaysAgo,
        };
      });

      built.sort((a, b) => {
        const aPending = a.approvedFiles < a.totalFiles;
        const bPending = b.approvedFiles < b.totalFiles;
        if (aPending !== bPending) return aPending ? -1 : 1;
        return b.sentDaysAgo - a.sentDaysAgo;
      });

      setRows(built);
    }).catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const copyLink = (row: HandoverRow) => {
    navigator.clipboard.writeText(`${window.location.origin}/portal/${row.token}`).then(
      () => showToast("Portal link copied"),
      () => showToast("Couldn't copy the link")
    );
  };

  if (rows === null) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-panel animate-pulse" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center py-16 px-10 border border-dashed border-line rounded-2xl">
          <Package className="w-8 h-8 text-muted mx-auto mb-3" />
          <p className="text-[13px] text-ink/70 mb-1">No handovers sent yet</p>
          <p className="text-[12.5px] text-muted">Send a handover from a project and it'll show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2">
      {rows.map((row) => {
        const complete = row.approvedFiles === row.totalFiles;
        const clientDisplay = row.clientName || row.recipient;
        return (
          <div key={row.handoverId} className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-panel border border-line">
            <span className={`shrink-0 ${complete ? "text-moss" : "text-amber"}`}>
              <CheckCircle2 className="w-5 h-5" strokeWidth={complete ? 2 : 1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-ink truncate">{row.handoverTitle}</span>
                <span className="text-[12px] text-muted shrink-0">· {row.projectName}</span>
              </div>
              <div className="text-[12.5px] text-muted truncate">
                {complete ? "Fully approved" : `${row.approvedFiles} of ${row.totalFiles} approved`} · {clientDisplay} · sent{" "}
                {row.sentDaysAgo === 0 ? "today" : `${row.sentDaysAgo}d ago`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => copyLink(row)}
                title="Copy portal link"
                className="w-8 h-8 rounded-full bg-paper hover:bg-line/60 flex items-center justify-center text-muted hover:text-ink transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onOpenProject(row.projectId)}
                className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink bg-paper hover:bg-line/60 rounded-full px-3 py-1.5 transition-colors"
              >
                Open <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
