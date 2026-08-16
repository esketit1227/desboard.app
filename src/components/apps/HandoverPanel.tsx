import type React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Package,
  X,
  Plus,
  FileText,
  Link as LinkIcon,
  Trash2,
  Check,
  Send,
  Calendar,
  Palette,
  ExternalLink,
  Image as ImageIcon,
  Sun,
  Moon,
  MessageSquare,
  Send as SendIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { ProjectFull, Handover, HandoverStatus, HandoverBranding, HandoverComment, VaultFile } from "../../types";
import { api } from "../../lib/api";
import { renderHandoverPage, effectiveBranding } from "../../lib/handoverPage";

const ACCENT_SWATCHES = ["#D85E25", "#34A853", "#4285F4", "#9C27B0", "#E91E63", "#0EA5E9", "#EAB308", "#111111"];

const STATUS_ORDER: HandoverStatus[] = ["Draft", "Sent", "Accepted"];

function statusBadgeClass(status: HandoverStatus) {
  switch (status) {
    case "Sent":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "Accepted":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    default:
      return "bg-white/10 text-white/50 border-white/10";
  }
}

/**
 * Handover packages for a project. Lists existing packages and lets the user
 * assemble a new one (title, recipient, note, files), advance its status
 * (Draft -> Sent -> Accepted), copy a share link, or delete it. Everything is
 * persisted to SQLite via /api/handovers.
 */
export function HandoverPanel({
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
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [mode, setMode] = useState<"list" | "create" | "brand" | "discuss">("list");
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Discussion state
  const [discussTarget, setDiscussTarget] = useState<Handover | null>(null);
  const [comments, setComments] = useState<HandoverComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentFileId, setCommentFileId] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // Create-form state
  const [title, setTitle] = useState("");
  const [recipient, setRecipient] = useState(project.client);
  const [note, setNote] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Branding / landing-page editor state
  const [brandingTarget, setBrandingTarget] = useState<Handover | null>(null);
  const [brand, setBrand] = useState<HandoverBranding | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Live preview HTML — the exact same renderer the server uses for the shared page.
  const includedFiles = useMemo(
    () => (brandingTarget ? files.filter((f) => brandingTarget.fileIds.includes(f.id)) : []),
    [brandingTarget, files]
  );
  const previewHtml = useMemo(
    () => (brandingTarget && brand ? renderHandoverPage({ handover: { ...brandingTarget, branding: brand }, files: includedFiles }) : ""),
    [brandingTarget, brand, includedFiles]
  );

  const refresh = () =>
    api
      .getHandovers(project.id)
      .then((list) => {
        setHandovers(list);
        onCountChange?.(list.length);
      })
      .catch((e) => console.error("Failed to load handovers", e));

  const refreshCounts = () =>
    api
      .getCommentCounts(project.id)
      .then(setCounts)
      .catch((e) => console.error("Failed to load comment counts", e));

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getHandovers(project.id), api.getFiles(), api.getCommentCounts(project.id)])
      .then(([list, allFiles, countMap]) => {
        setHandovers(list);
        setFiles(allFiles);
        setCounts(countMap);
        onCountChange?.(list.length);
      })
      .catch((e) => console.error("Failed to load handover data", e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const fileName = (id: string) => files.find((f) => f.id === id)?.name ?? id;

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  // --- Discussion ---
  const loadComments = (handoverId: string) => {
    setLoadingComments(true);
    return api
      .getComments(handoverId)
      .then(setComments)
      .catch((e) => console.error("Failed to load comments", e))
      .finally(() => setLoadingComments(false));
  };

  const openDiscussion = (h: Handover) => {
    setDiscussTarget(h);
    setComments([]);
    setCommentAuthor(effectiveBranding(h).studioName);
    setCommentBody("");
    setCommentFileId("");
    setMode("discuss");
    loadComments(h.id);
  };

  const postComment = async () => {
    if (!discussTarget || !commentBody.trim()) return;
    setPostingComment(true);
    try {
      await api.addComment(discussTarget.id, {
        author: commentAuthor.trim() || "Designer",
        role: "designer",
        body: commentBody.trim(),
        fileId: commentFileId || null,
      });
      setCommentBody("");
      setCommentFileId("");
      await loadComments(discussTarget.id);
      refreshCounts();
    } catch (e) {
      console.error("Failed to post reply", e);
      showToast("Could not send reply");
    } finally {
      setPostingComment(false);
    }
  };

  const removeComment = async (c: HandoverComment) => {
    if (!discussTarget) return;
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await api.deleteComment(discussTarget.id, c.id);
      refreshCounts();
    } catch (e) {
      console.error("Failed to delete comment", e);
      loadComments(discussTarget.id);
    }
  };

  const openCreate = () => {
    setTitle(`${project.name} — Handoff`);
    setRecipient(project.client);
    setNote("");
    // Pre-select the files that already belong to this client.
    setSelectedFileIds(files.filter((f) => f.clientId && f.clientId === project.client).map((f) => f.id));
    setMode("create");
  };

  const toggleFile = (id: string) =>
    setSelectedFileIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const handover: Handover = {
      id: "h" + Date.now(),
      projectId: project.id,
      title: title.trim(),
      recipient: recipient.trim() || project.client,
      note: note.trim(),
      status: "Draft",
      fileIds: selectedFileIds,
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    };
    try {
      await api.createHandover(handover);
      await refresh();
      showToast("Handover package created");
      setMode("list");
    } catch (e) {
      console.error("Failed to create handover", e);
      showToast("Could not save handover");
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (h: Handover) => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(h.status) + 1) % STATUS_ORDER.length];
    setHandovers((prev) => prev.map((x) => (x.id === h.id ? { ...x, status: next } : x)));
    try {
      await api.updateHandover(h.id, { status: next });
      showToast(`Marked "${h.title}" as ${next}`);
    } catch (e) {
      console.error("Failed to update status", e);
      refresh(); // revert to server truth on failure
    }
  };

  const removeHandover = async (h: Handover) => {
    setHandovers((prev) => prev.filter((x) => x.id !== h.id));
    try {
      await api.deleteHandover(h.id);
      onCountChange?.(handovers.length - 1);
      showToast("Handover deleted");
    } catch (e) {
      console.error("Failed to delete handover", e);
      refresh();
    }
  };

  const shareUrl = (id: string) => `${window.location.origin}/handover/${id}`;

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(shareUrl(id));
    showToast("Share link copied!");
  };

  const openLandingPage = (id: string) => window.open(shareUrl(id), "_blank", "noopener");

  // --- Branding editor ---
  const openBranding = (h: Handover) => {
    setBrandingTarget(h);
    setBrand(effectiveBranding(h)); // resolved defaults, fully populated for editing
    setMode("brand");
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !brand) return;
    const reader = new FileReader();
    reader.onload = () => setBrand({ ...brand, logoUrl: String(reader.result) });
    reader.readAsDataURL(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  const saveBranding = async (): Promise<Handover | undefined> => {
    if (!brandingTarget || !brand) return;
    setSavingBrand(true);
    try {
      const updated = await api.updateHandover(brandingTarget.id, { branding: brand });
      setHandovers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setBrandingTarget(updated);
      showToast("Landing page saved");
      return updated;
    } catch (e) {
      console.error("Failed to save branding", e);
      showToast("Could not save landing page");
    } finally {
      setSavingBrand(false);
    }
  };

  const saveAndOpen = async () => {
    const updated = await saveBranding();
    const id = (updated ?? brandingTarget)?.id;
    if (id) openLandingPage(id);
  };

  // Rendered through a portal to <body> so it's a true full-screen modal,
  // independent of whichever app (Projects / Client Portal) launched it and any
  // transformed / narrow ancestor.
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4 md:p-6"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 16 }}
        className={`bg-[#0A0A0A] border border-white/10 rounded-2xl w-full ${
          mode === "brand" ? "max-w-5xl" : "max-w-2xl"
        } max-h-[88%] shadow-2xl flex flex-col overflow-hidden transition-[max-width] duration-300`}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#D85E25]/15 text-[#D85E25] rounded-lg">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-[18px] uppercase tracking-widest leading-none">Handovers</h3>
              <span className="text-[11px] font-mono text-white/40 uppercase tracking-widest">{project.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-16 text-[12px] font-mono uppercase tracking-widest text-white/40">Loading…</div>
          ) : (
            <AnimatePresence mode="wait">
              {mode === "list" && (
                <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] uppercase tracking-widest font-mono text-white/40">
                      {handovers.length} Package{handovers.length === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={openCreate}
                      className="flex items-center gap-2 bg-[#D85E25] hover:bg-[#D85E25]/80 transition-colors px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium"
                    >
                      <Plus className="w-4 h-4" /> New Package
                    </button>
                  </div>

                  {handovers.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                      <Package className="w-10 h-10 text-white/20 mx-auto mb-4" />
                      <p className="text-[13px] text-white/60 mb-1">No handover packages yet</p>
                      <p className="text-[11px] text-white/30">Create one to bundle files and deliver them to the client.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {handovers.map((h) => (
                        <div key={h.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <h4 className="text-[14px] font-medium text-[#EBE6DD] truncate">{h.title}</h4>
                              <span className="text-[11px] text-white/40 font-mono">To: {h.recipient || "—"}</span>
                            </div>
                            <button
                              onClick={() => cycleStatus(h)}
                              title="Click to advance status"
                              className={`shrink-0 px-3 py-1 rounded-full border text-[9px] uppercase tracking-widest font-bold transition-all hover:brightness-125 ${statusBadgeClass(
                                h.status
                              )}`}
                            >
                              {h.status}
                            </button>
                          </div>

                          {h.note && <p className="text-[12px] text-white/60 leading-relaxed mb-3 line-clamp-2">{h.note}</p>}

                          {h.fileIds.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {h.fileIds.map((fid) => (
                                <span
                                  key={fid}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-[9px] uppercase tracking-widest text-[#DBCBC2]/70 border border-white/5"
                                >
                                  <FileText className="w-3 h-3" /> {fileName(fid)}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-3 border-t border-white/5">
                            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/30">
                              <Calendar className="w-3 h-3" /> {h.created} • {h.fileIds.length} file{h.fileIds.length === 1 ? "" : "s"}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openDiscussion(h)}
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-mono text-white/70 hover:text-white border border-white/10 hover:bg-white/10 px-2.5 py-1.5 rounded transition-colors"
                              >
                                <MessageSquare className="w-3 h-3" /> Discussion
                                {counts[h.id] ? (
                                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#D85E25] text-white text-[8px] font-bold">
                                    {counts[h.id]}
                                  </span>
                                ) : null}
                              </button>
                              <button
                                onClick={() => openBranding(h)}
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-mono text-[#D85E25] hover:text-white border border-[#D85E25]/40 hover:bg-[#D85E25] px-2.5 py-1.5 rounded transition-colors"
                              >
                                <Palette className="w-3 h-3" /> Customize Page
                              </button>
                              <button
                                onClick={() => openLandingPage(h.id)}
                                title="Open landing page"
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => copyLink(h.id)}
                                title="Copy share link"
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-mono text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded transition-colors"
                              >
                                <LinkIcon className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => removeHandover(h)}
                                className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest font-mono text-red-400/70 hover:text-red-400 bg-white/5 hover:bg-red-500/10 px-2.5 py-1.5 rounded transition-colors"
                                aria-label="Delete handover"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {mode === "create" && (
                <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5">
                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Package Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                      placeholder="e.g. Final Handoff Package"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Recipient</label>
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                      placeholder="Client name or email"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Note to Client</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors resize-none"
                      placeholder="A short message accompanying the delivery…"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">
                      Include Files ({selectedFileIds.length} selected)
                    </label>
                    {files.length === 0 ? (
                      <p className="text-[11px] text-white/40 font-mono">No files available in the vault.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                        {files.map((f) => {
                          const checked = selectedFileIds.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              onClick={() => toggleFile(f.id)}
                              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                                checked ? "bg-[#D85E25]/10 border-[#D85E25]/40" : "bg-white/[0.02] border-white/5 hover:bg-white/5"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${checked ? "bg-[#D85E25] border-[#D85E25]" : "border-white/30"}`}>
                                  {checked && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <FileText className="w-4 h-4 text-white/40 shrink-0" />
                                <span className="text-[12px] text-[#EBE6DD] truncate">{f.name}</span>
                              </div>
                              {f.clientId && (
                                <span className="text-[9px] uppercase tracking-widest font-mono text-white/30 shrink-0">{f.clientId}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setMode("list")}
                      className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors text-[11px] uppercase tracking-widest font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!title.trim() || saving}
                      className="flex-1 py-2.5 rounded-lg bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[11px] uppercase tracking-widest font-bold flex items-center justify-center gap-2"
                    >
                      {saving ? "Saving…" : (<><Send className="w-3.5 h-3.5" /> Create Package</>)}
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "brand" && brand && brandingTarget && (
                <motion.div key="brand" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("list")}
                      className="text-[10px] uppercase tracking-widest font-mono text-white/50 hover:text-white transition-colors"
                    >
                      ← Back to packages
                    </button>
                    <span className="text-[11px] font-mono uppercase tracking-widest text-white/40 truncate">{brandingTarget.title}</span>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Controls */}
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Studio / Sender Name</label>
                        <input
                          type="text"
                          value={brand.studioName}
                          onChange={(e) => setBrand({ ...brand, studioName: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Logo</label>
                        <div className="flex items-center gap-3">
                          {brand.logoUrl ? (
                            <img src={brand.logoUrl} alt="Logo" className="h-10 max-w-[120px] object-contain bg-white/10 rounded p-1 border border-white/10" />
                          ) : (
                            <div className="h-10 w-10 rounded bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                          <input type="file" accept="image/*" ref={logoInputRef} onChange={handleLogoFile} className="hidden" />
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            className="text-[10px] uppercase tracking-widest font-mono text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded transition-colors"
                          >
                            Upload
                          </button>
                          {brand.logoUrl && (
                            <button
                              onClick={() => setBrand({ ...brand, logoUrl: "" })}
                              className="text-[10px] uppercase tracking-widest font-mono text-red-400/70 hover:text-red-400 px-2 py-2 rounded transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Headline</label>
                        <input
                          type="text"
                          value={brand.headline}
                          onChange={(e) => setBrand({ ...brand, headline: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Subheading</label>
                        <input
                          type="text"
                          value={brand.subhead}
                          onChange={(e) => setBrand({ ...brand, subhead: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Welcome Message</label>
                        <textarea
                          value={brand.welcome}
                          onChange={(e) => setBrand({ ...brand, welcome: e.target.value })}
                          rows={3}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Accent Color</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {ACCENT_SWATCHES.map((sw) => (
                            <button
                              key={sw}
                              onClick={() => setBrand({ ...brand, accent: sw })}
                              style={{ backgroundColor: sw }}
                              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                                brand.accent.toLowerCase() === sw.toLowerCase() ? "border-white/70 scale-110" : "border-transparent"
                              }`}
                              aria-label={`Accent ${sw}`}
                            />
                          ))}
                          <label className="relative w-7 h-7 rounded-full overflow-hidden border border-white/20 cursor-pointer" title="Custom color">
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(brand.accent) ? brand.accent : "#D85E25"}
                              onChange={(e) => setBrand({ ...brand, accent: e.target.value })}
                              className="absolute -inset-1 w-[150%] h-[150%] cursor-pointer"
                            />
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Theme</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setBrand({ ...brand, theme: "dark" })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-[11px] uppercase tracking-widest font-bold transition-colors ${
                              brand.theme === "dark" ? "border-[#D85E25] bg-[#D85E25]/10 text-[#D85E25]" : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                            }`}
                          >
                            <Moon className="w-3.5 h-3.5" /> Dark
                          </button>
                          <button
                            onClick={() => setBrand({ ...brand, theme: "light" })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-[11px] uppercase tracking-widest font-bold transition-colors ${
                              brand.theme === "light" ? "border-[#D85E25] bg-[#D85E25]/10 text-[#D85E25]" : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                            }`}
                          >
                            <Sun className="w-3.5 h-3.5" /> Light
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Live preview */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-white/40">Live Preview</span>
                        <button
                          onClick={saveAndOpen}
                          className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-mono text-white/60 hover:text-white transition-colors"
                        >
                          Open in new tab <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <iframe
                        title="Handover landing page preview"
                        srcDoc={previewHtml}
                        className="w-full h-[460px] rounded-lg border border-white/10 bg-white"
                      />
                      <p className="text-[10px] text-white/30 font-mono leading-relaxed">
                        This is exactly what your client sees at the share link. Save to publish your changes.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-4 border-t border-white/5">
                    <button
                      onClick={() => setMode("list")}
                      className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors text-[11px] uppercase tracking-widest font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => copyLink(brandingTarget.id)}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-white/10 text-white/70 hover:text-white hover:bg-white/5 transition-colors text-[11px] uppercase tracking-widest font-bold"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> Copy Link
                    </button>
                    <button
                      onClick={saveBranding}
                      disabled={savingBrand}
                      className="flex-1 py-2.5 rounded-lg bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[11px] uppercase tracking-widest font-bold flex items-center justify-center gap-2"
                    >
                      {savingBrand ? "Saving…" : (<><Check className="w-3.5 h-3.5" /> Save Landing Page</>)}
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "discuss" && discussTarget && (
                <motion.div key="discuss" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("list")}
                      className="text-[10px] uppercase tracking-widest font-mono text-white/50 hover:text-white transition-colors"
                    >
                      ← Back to packages
                    </button>
                    <button
                      onClick={() => openLandingPage(discussTarget.id)}
                      className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-mono text-white/60 hover:text-white transition-colors"
                    >
                      Client view <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div>
                    <h4 className="text-[15px] font-medium text-[#EBE6DD]">{discussTarget.title}</h4>
                    <p className="text-[11px] font-mono text-white/40 uppercase tracking-widest">
                      Shared thread with {discussTarget.recipient || "the client"}
                    </p>
                  </div>

                  {/* Thread */}
                  <div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-1">
                    {loadingComments ? (
                      <div className="text-center py-10 text-[12px] font-mono uppercase tracking-widest text-white/40">Loading…</div>
                    ) : comments.length === 0 ? (
                      <div className="text-center py-10 border border-dashed border-white/10 rounded-xl">
                        <MessageSquare className="w-8 h-8 text-white/20 mx-auto mb-3" />
                        <p className="text-[12px] text-white/50">No notes yet</p>
                        <p className="text-[11px] text-white/30">Start the conversation, or share the link so your client can chime in.</p>
                      </div>
                    ) : (
                      comments.map((cm) => {
                        const isDesigner = cm.role === "designer";
                        return (
                          <div
                            key={cm.id}
                            className={`rounded-xl p-3.5 border group ${
                              isDesigner ? "bg-[#D85E25]/[0.07] border-[#D85E25]/20" : "bg-white/[0.02] border-white/5"
                            }`}
                          >
                            <div className="flex items-center flex-wrap gap-2 mb-1.5">
                              <span className="text-[13px] font-medium text-[#EBE6DD]">{cm.author}</span>
                              <span
                                className={`text-[8px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full border ${
                                  isDesigner ? "text-[#D85E25] border-[#D85E25]/40 bg-[#D85E25]/10" : "text-white/50 border-white/10 bg-white/5"
                                }`}
                              >
                                {isDesigner ? "Studio" : "Client"}
                              </span>
                              {cm.fileId && (
                                <span className="text-[9px] uppercase tracking-widest text-[#D85E25] font-mono flex items-center gap-1">
                                  <FileText className="w-3 h-3" /> {fileName(cm.fileId)}
                                </span>
                              )}
                              <span className="ml-auto text-[10px] font-mono text-white/30">{fmtTime(cm.created)}</span>
                              <button
                                onClick={() => removeComment(cm)}
                                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all"
                                title="Delete note"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <p className="text-[13px] text-[#DBCBC2] whitespace-pre-wrap leading-relaxed">{cm.body}</p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Designer composer */}
                  <div className="border-t border-white/5 pt-4 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder="Your name"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-[#D85E25] transition-colors"
                      />
                      <select
                        value={commentFileId}
                        onChange={(e) => setCommentFileId(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-[#D85E25] transition-colors cursor-pointer *:bg-[#0a0a0a] max-w-[45%]"
                      >
                        <option value="">General note</option>
                        {discussTarget.fileIds.map((fid) => (
                          <option key={fid} value={fid}>
                            On: {fileName(fid)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2 items-end">
                      <textarea
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        rows={2}
                        placeholder="Reply to your client…"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors resize-none"
                      />
                      <button
                        onClick={postComment}
                        disabled={!commentBody.trim() || postingComment}
                        className="shrink-0 h-[42px] px-4 rounded-lg bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[11px] uppercase tracking-widest font-bold flex items-center gap-2"
                      >
                        <SendIcon className="w-3.5 h-3.5" /> {postingComment ? "…" : "Send"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
