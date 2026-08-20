import { useRef, useState } from "react";
import { FileText, Check, AlertTriangle, Upload } from "lucide-react";
import type { VaultFile, HandoverFileApproval } from "../../types";
import { previewableKind, contentUrl, isApprovalCurrent } from "../../lib/filePreview";

/**
 * One row in a handover package's "Include files" checklist: a real preview
 * (image/PDF/video, matching FileVaultApp's own inline-preview rendering),
 * the client's review status for this file (staleness-aware — an approval
 * recorded against an older version doesn't count as current), and a
 * Replace action that uploads a new version in place.
 */
interface HandoverFileRowProps {
  file: VaultFile;
  approval: HandoverFileApproval | undefined;
  selected: boolean;
  onToggle: () => void;
  onReplaced: (file: VaultFile, picked: File) => Promise<void>;
}

export function HandoverFileRow({ file, approval, selected, onToggle, onReplaced }: HandoverFileRowProps) {
  const [replacing, setReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const kind = previewableKind(file);
  const changesRequested = approval?.status === "changes_requested";
  const approved = approval?.status === "approved" && isApprovalCurrent(approval, file);

  const handlePicked = async (picked: File) => {
    setReplacing(true);
    try {
      await onReplaced(file, picked);
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg transition-colors ${
        selected ? "bg-primary/10" : "bg-chip hover:bg-line"
      }`}
    >
      <button type="button" onClick={onToggle} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
        <div
          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
            selected ? "bg-primary border-primary" : "border-line"
          }`}
        >
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>

        <div className="w-9 h-9 rounded-md overflow-hidden bg-panel shrink-0 flex items-center justify-center">
          {kind === "image" ? (
            <img src={contentUrl(file)} alt={file.name} className="w-full h-full object-cover" />
          ) : kind === "pdf" ? (
            <iframe src={contentUrl(file)} title={file.name} className="w-full h-full border-0 pointer-events-none bg-white" />
          ) : kind === "video" ? (
            <video src={contentUrl(file)} className="w-full h-full object-cover pointer-events-none" muted />
          ) : (
            <FileText className="w-4 h-4 text-muted" />
          )}
        </div>

        <span className="text-[12.5px] text-ink truncate">{file.name}</span>
        {file.clientId && <span className="text-[11px] text-muted shrink-0">{file.clientId}</span>}
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        {(changesRequested || approved) && (
          <span
            title={changesRequested ? "Client requested changes" : "Approved by the client"}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] ${
              changesRequested ? "border border-ink text-ink" : "bg-moss/10 text-moss"
            }`}
          >
            {changesRequested ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          </span>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={replacing}
          title="Upload a new version of this file"
          className="flex items-center gap-1 text-[10.5px] text-ink/60 hover:text-ink disabled:opacity-50 px-2 py-1 rounded-full hover:bg-line transition-colors"
        >
          <Upload className="w-3 h-3" /> {replacing ? "…" : "Replace"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) handlePicked(picked);
          }}
        />
      </div>
    </div>
  );
}
