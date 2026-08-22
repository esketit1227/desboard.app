import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X, FileText, Upload, Link as LinkIcon, Search } from "lucide-react";
import type { ProjectFull, VaultFile } from "../../types";
import { api } from "../../lib/api";
import { previewableKind, contentUrl } from "../../lib/filePreview";

/**
 * A project's own Files & Assets view, opened from its "Files & Assets" tile —
 * stays inside the Projects tab rather than switching to the separate File
 * Vault app. Uploads here are linked to this project automatically (no extra
 * step), and an already-uploaded file elsewhere in the vault can be attached
 * with "Link existing file" instead of re-uploading it.
 */
export function ProjectFilesPanel({
  project,
  onClose,
  onCountChange,
  showToast,
}: {
  project: ProjectFull;
  onClose: () => void;
  onCountChange?: (n: number) => void;
  showToast: (msg: string) => void;
}) {
  const numericProjectId = Number(project.id.replace(/^p/, ""));
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    api
      .getFiles()
      .then((list) => {
        setFiles(list);
        onCountChange?.(list.filter((f) => f.projectId === numericProjectId).length);
      })
      .catch((e) => console.error("Failed to load files", e));

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const linkedFiles = files.filter((f) => f.projectId === numericProjectId);
  const otherFiles = files
    .filter((f) => f.projectId !== numericProjectId)
    .filter((f) => f.name.toLowerCase().includes(pickerSearch.toLowerCase()));

  const handleUpload = async (picked: File) => {
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(picked);
      });
      const parts = picked.name.split(".");
      const extension = parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "file";
      const newFile: VaultFile = {
        id: Date.now().toString(),
        name: picked.name,
        type: "file",
        extension,
        size: (picked.size / 1024 / 1024).toFixed(1) + " MB",
        created: "Just now",
        owner: "You",
        source: "Desboard",
        status: "Draft",
        tags: [],
        access: ["Team"],
        versions: [{ version: "v1.0", date: "Just now", author: "You", latest: true }],
        projectId: numericProjectId,
        clientId: null,
      };
      const saved = await api.createFile(newFile, base64, picked.type || "application/octet-stream");
      setFiles((prev) => [saved, ...prev]);
      onCountChange?.(linkedFiles.length + 1);
      showToast(`${saved.name} added to ${project.name}`);
    } catch (e) {
      console.error("Failed to upload file", e);
      showToast("Could not upload that file — try again");
    } finally {
      setUploading(false);
    }
  };

  const linkExisting = async (file: VaultFile) => {
    try {
      const updated = await api.updateFile(file.id, { projectId: numericProjectId });
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      onCountChange?.(linkedFiles.length + 1);
      showToast(`${updated.name} linked to ${project.name}`);
      setShowPicker(false);
      setPickerSearch("");
    } catch (e) {
      console.error("Failed to link file", e);
      showToast("Could not link that file — try again");
    }
  };

  const unlink = async (file: VaultFile) => {
    try {
      const updated = await api.updateFile(file.id, { projectId: null });
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      onCountChange?.(Math.max(0, linkedFiles.length - 1));
      showToast(`Removed ${updated.name} from ${project.name}`);
    } catch (e) {
      console.error("Failed to unlink file", e);
      showToast("Could not remove that file — try again");
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[80] flex items-center justify-center p-4 md:p-6"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 16 }}
        className="bg-surface border border-line rounded-2xl w-full max-w-3xl max-h-[88%] shadow-xl flex flex-col overflow-hidden"
      >
        <div className="p-5 border-b border-line flex items-center justify-between bg-panel shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate/15 text-slate rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-semibold text-ink leading-none">Files & Assets</h3>
              <span className="text-[12.5px] text-muted">{project.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-16 text-[13px] text-muted">Loading…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] text-muted">
                  {linkedFiles.length} file{linkedFiles.length === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPicker((v) => !v)}
                    className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink bg-chip hover:bg-line rounded-full px-3.5 py-2 transition-colors"
                  >
                    <LinkIcon className="w-3.5 h-3.5" /> Link existing file
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-primary hover:bg-primary/85 disabled:opacity-50 rounded-full px-3.5 py-2 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : "Upload"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      e.target.value = "";
                      if (picked) handleUpload(picked);
                    }}
                  />
                </div>
              </div>

              {showPicker && (
                <div className="bg-panel border border-line rounded-xl p-3 mb-4">
                  <div className="relative mb-2.5">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      autoFocus
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Search files already in the vault…"
                      className="w-full bg-paper border border-line rounded-lg pl-8 pr-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                    {otherFiles.length === 0 ? (
                      <p className="text-[12px] text-muted text-center py-3">
                        {files.length === linkedFiles.length ? "Every file in the vault is already linked here." : "No matching files."}
                      </p>
                    ) : (
                      otherFiles.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => linkExisting(f)}
                          className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-chip text-left transition-colors"
                        >
                          <span className="text-[12.5px] text-ink truncate">{f.name}</span>
                          <span className="text-[11px] text-muted shrink-0">
                            {f.projectId ? "Linked elsewhere" : "Unlinked"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {linkedFiles.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-line rounded-2xl">
                  <p className="text-[13px] text-ink/70 mb-1">No files linked yet</p>
                  <p className="text-[12.5px] text-muted">Upload a file or link one already in the vault.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {linkedFiles.map((f) => {
                    const kind = previewableKind(f);
                    return (
                      <div key={f.id} className="bg-panel border border-line rounded-xl p-3 flex flex-col gap-2 group">
                        <div className="aspect-video rounded-lg overflow-hidden bg-chip flex items-center justify-center">
                          {kind === "image" ? (
                            <img src={contentUrl(f)} alt={f.name} className="w-full h-full object-cover" />
                          ) : kind === "pdf" ? (
                            <iframe src={contentUrl(f)} title={f.name} className="w-full h-full border-0 pointer-events-none bg-white" />
                          ) : kind === "video" ? (
                            <video src={contentUrl(f)} className="w-full h-full object-cover pointer-events-none" muted />
                          ) : (
                            <FileText className="w-5 h-5 text-muted" />
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0">
                            <p className="text-[12.5px] text-ink truncate" title={f.name}>
                              {f.name}
                            </p>
                            <p className="text-[11px] text-muted">{f.size || "--"} · {f.status}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => unlink(f)}
                            title="Remove from this project"
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-all text-[11px] underline underline-offset-2"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
