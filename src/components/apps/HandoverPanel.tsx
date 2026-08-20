import type React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Package,
  X,
  Plus,
  Pencil,
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
  Shield,
  Mail,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type {
  ProjectFull,
  Handover,
  HandoverStatus,
  HandoverBranding,
  HandoverComment,
  HandoverApprovals,
  HandoverFileApproval,
  VaultFile,
  PortalAccessMode,
} from "../../types";
import { api } from "../../lib/api";
import { renderHandoverPage, effectiveBranding } from "../../lib/handoverPage";
import { isApprovalCurrent } from "../../lib/filePreview";
import { HandoverFileRow } from "./HandoverFileRow";

const ACCENT_SWATCHES = ["#D85E25", "#34A853", "#4285F4", "#9C27B0", "#E91E63", "#0EA5E9", "#EAB308", "#111111"];

const STATUS_ORDER: HandoverStatus[] = ["Draft", "Sent", "Accepted"];

function statusBadgeClass(status: HandoverStatus) {
  switch (status) {
    case "Sent":
      return "bg-slate/10 text-slate";
    case "Accepted":
      return "bg-moss/10 text-moss";
    default:
      return "bg-chip text-muted";
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
  // Only files linked directly to this project are eligible for a handover —
  // matches the numeric-id convention used elsewhere (ProjectsApp, FileVaultApp).
  const numericProjectId = Number(project.id.replace(/^p/, ""));
  const projectFiles = files.filter((f) => f.projectId === numericProjectId);
  const [mode, setMode] = useState<"list" | "create" | "edit" | "brand" | "discuss" | "access">("list");
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [approvalsByHandover, setApprovalsByHandover] = useState<Record<string, HandoverApprovals>>({});

  // Discussion state
  const [discussTarget, setDiscussTarget] = useState<Handover | null>(null);
  const [comments, setComments] = useState<HandoverComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentFileId, setCommentFileId] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // Create/edit-form state — shared between both modes, since the fields are identical.
  const [title, setTitle] = useState("");
  const [recipient, setRecipient] = useState(project.client);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [note, setNote] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<Handover | null>(null);

  // Access & sharing editor state
  const [accessTarget, setAccessTarget] = useState<Handover | null>(null);
  const [accessMode, setAccessMode] = useState<PortalAccessMode>("invite");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessExpiry, setAccessExpiry] = useState(""); // yyyy-mm-dd or ""
  const [savingAccess, setSavingAccess] = useState(false);

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
      .then(async ([list, allFiles, countMap]) => {
        setHandovers(list);
        setFiles(allFiles);
        setCounts(countMap);
        onCountChange?.(list.length);
        // Per-handover approval status, for the "N of M approved" chips below —
        // one small request per package, fine at the scale a studio has open here.
        const entries = await Promise.all(
          list.map((h) =>
            api
              .getHandoverApprovals(h.id)
              .then((a) => [h.id, a] as const)
              .catch(() => [h.id, {} as HandoverApprovals] as const)
          )
        );
        setApprovalsByHandover(Object.fromEntries(entries));
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
    setClientName("");
    setClientEmail("");
    setNote("");
    // Every file linked to this project is included by default.
    setSelectedFileIds(projectFiles.map((f) => f.id));
    setMode("create");
  };

  const openEdit = (h: Handover) => {
    setEditTarget(h);
    setTitle(h.title);
    setRecipient(h.recipient);
    setClientName(h.clientName || "");
    setClientEmail(h.clientEmail || "");
    setNote(h.note);
    setSelectedFileIds(h.fileIds);
    setMode("edit");
  };

  const toggleFile = (id: string) =>
    setSelectedFileIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    // Studio-wide defaults (Settings) pre-fill the new page's identity; headline/
    // subhead/welcome are deliberately left unset so effectiveBranding()'s own
    // per-handover fallback logic (title/recipient/note) still applies to those.
    const settings = await api.getSettings().catch(() => null);
    const handover: Handover = {
      id: "h" + Date.now(),
      projectId: project.id,
      title: title.trim(),
      recipient: recipient.trim() || project.client,
      clientName: clientName.trim() || undefined,
      clientEmail: clientEmail.trim() || undefined,
      note: note.trim(),
      status: "Draft",
      fileIds: selectedFileIds,
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      token: "", // server generates the unguessable portal token
      accessMode: "invite",
      revoked: false,
      branding: settings
        ? { accent: settings.brandAccent, theme: settings.brandTheme, studioName: settings.studioName, logoUrl: settings.logoUrl }
        : undefined,
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

  const handleUpdate = async () => {
    if (!editTarget || !title.trim()) return;
    setSaving(true);
    try {
      await api.updateHandover(editTarget.id, {
        title: title.trim(),
        recipient: recipient.trim() || project.client,
        clientName: clientName.trim() || undefined,
        clientEmail: clientEmail.trim() || undefined,
        note: note.trim(),
        fileIds: selectedFileIds,
      });
      await refresh();
      showToast("Handover package updated");
      setEditTarget(null);
      setMode("list");
    } catch (e) {
      console.error("Failed to update handover", e);
      showToast("Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Uploads a new version of an existing vault file in place (same file id).
   * Any prior client approval on this file is automatically stale afterward —
   * HandoverFileRow's status chip re-derives from `files` + `approvalsByHandover`
   * on every render, so it flips back to "pending" the moment `files` updates
   * here, with no separate invalidation step needed.
   */
  const handleReplaceFile = async (file: VaultFile, picked: File) => {
    const reader = new FileReader();
    const base64: string = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(picked);
    });
    try {
      const updated = await api.uploadFileVersion(file.id, base64, picked.type || "application/octet-stream", "You");
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      showToast(`New version of ${updated.name} uploaded`);
    } catch (e) {
      console.error("Failed to upload version", e);
      showToast("Could not upload the new version");
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

  const shareUrl = (h: Handover) => `${window.location.origin}/portal/${h.token}`;

  const copyLink = (h: Handover) => {
    navigator.clipboard.writeText(shareUrl(h));
    showToast("Share link copied!");
  };

  const openLandingPage = (h: Handover) => window.open(shareUrl(h), "_blank", "noopener");

  const [reminding, setReminding] = useState<string | null>(null);
  const remindClient = async (h: Handover) => {
    if (!h.clientEmail) {
      showToast("Add a client email to this handover first");
      return;
    }
    setReminding(h.id);
    try {
      const { sent, emailConfigured } = await api.remindHandover(h.id);
      showToast(sent ? "Reminder sent" : emailConfigured ? "Could not send the reminder" : "No email provider configured — reminder logged only");
    } catch (e) {
      console.error("Failed to send reminder", e);
      showToast("Could not send the reminder");
    } finally {
      setReminding(null);
    }
  };

  // --- Access & sharing ---
  const openAccess = (h: Handover) => {
    setAccessTarget(h);
    setAccessMode(h.accessMode);
    setAccessPassword("");
    setAccessExpiry(h.expiresAt ? h.expiresAt.slice(0, 10) : "");
    setMode("access");
  };

  const saveAccess = async () => {
    if (!accessTarget) return;
    if (accessMode === "password" && !accessTarget.passwordHash && !accessPassword.trim()) {
      showToast("Set a password first");
      return;
    }
    setSavingAccess(true);
    try {
      const patch: Partial<Handover> & { password?: string } = {
        accessMode,
        expiresAt: accessExpiry ? new Date(`${accessExpiry}T23:59:59`).toISOString() : null,
      };
      if (accessMode === "password" && accessPassword.trim()) patch.password = accessPassword;
      const updated = await api.updateHandover(accessTarget.id, patch);
      setHandovers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setAccessTarget(updated);
      setAccessPassword("");
      showToast("Access settings saved");
    } catch (e) {
      console.error("Failed to save access settings", e);
      showToast("Could not save access settings");
    } finally {
      setSavingAccess(false);
    }
  };

  const toggleRevoked = async (h: Handover) => {
    try {
      const updated = await api.updateHandover(h.id, {
        revoked: !h.revoked,
        revokedAt: h.revoked ? null : new Date().toISOString(),
      });
      setHandovers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      if (accessTarget?.id === updated.id) setAccessTarget(updated);
      showToast(updated.revoked ? "Link revoked — the portal is now inaccessible" : "Link restored");
    } catch (e) {
      console.error("Failed to toggle revocation", e);
      showToast("Could not update the link");
    }
  };

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
    const target = updated ?? brandingTarget;
    if (target) openLandingPage(target);
  };

  // Rendered through a portal to <body> so it's a true full-screen modal,
  // independent of whichever app (Projects / Client Portal) launched it and any
  // transformed / narrow ancestor.
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
        className={`bg-surface border border-line rounded-2xl w-full ${
          mode === "brand" ? "max-w-5xl" : "max-w-2xl"
        } max-h-[88%] shadow-xl flex flex-col overflow-hidden transition-[max-width] duration-300`}
      >
        {/* Header */}
        <div className="p-5 border-b border-line flex items-center justify-between bg-panel shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/15 text-primary rounded-lg">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-semibold text-ink leading-none">Handovers</h3>
              <span className="text-[12.5px] text-muted">{project.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-16 text-[13px] text-muted">Loading…</div>
          ) : (
            <AnimatePresence mode="wait">
              {mode === "list" && (
                <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-muted">
                      {handovers.length} Package{handovers.length === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={openCreate}
                      className="flex items-center gap-2 bg-primary hover:bg-primary/85 text-white transition-colors px-4 py-2 rounded-full text-[13px] font-medium"
                    >
                      <Plus className="w-4 h-4" /> New Package
                    </button>
                  </div>

                  {handovers.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-line rounded-2xl">
                      <Package className="w-10 h-10 text-muted mx-auto mb-4" />
                      <p className="text-[13px] text-ink/70 mb-1">No handover packages yet</p>
                      <p className="text-[12.5px] text-muted">Create one to bundle files and deliver them to the client.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {handovers.map((h) => (
                        <div key={h.id} className="bg-panel border border-line rounded-xl p-4 hover:bg-chip transition-colors">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <h4 className="text-[14.5px] font-medium text-ink truncate">{h.title}</h4>
                              <span className="text-[12.5px] text-muted">
                                To: {h.clientName ? `${h.clientName} — ` : ""}{h.recipient || "—"}
                              </span>
                            </div>
                            <button
                              onClick={() => cycleStatus(h)}
                              title="Click to advance status"
                              className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-medium transition-colors hover:brightness-95 ${statusBadgeClass(
                                h.status
                              )}`}
                            >
                              {h.status}
                            </button>
                          </div>

                          {h.note && <p className="text-[13px] text-ink/60 leading-relaxed mb-3 line-clamp-2">{h.note}</p>}

                          {h.fileIds.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {h.fileIds.map((fid) => {
                                const approval = approvalsByHandover[h.id]?.[fid];
                                const file = files.find((f) => f.id === fid);
                                const changesRequested = approval?.status === "changes_requested";
                                const approved = approval?.status === "approved" && isApprovalCurrent(approval, file);
                                return (
                                  <span
                                    key={fid}
                                    title={
                                      changesRequested
                                        ? "Client requested changes"
                                        : approved
                                          ? "Approved by the client"
                                          : "Not yet approved by the client"
                                    }
                                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${
                                      changesRequested
                                        ? "border border-ink text-ink"
                                        : approved
                                          ? "bg-moss/10 text-moss"
                                          : "bg-chip text-ink/60"
                                    }`}
                                  >
                                    {changesRequested ? (
                                      <AlertTriangle className="w-3 h-3" />
                                    ) : approved ? (
                                      <Check className="w-3 h-3" />
                                    ) : (
                                      <FileText className="w-3 h-3" />
                                    )}{" "}
                                    {fileName(fid)}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-3 border-t border-line">
                            <span className="flex items-center gap-1.5 text-[12px] text-muted">
                              <Calendar className="w-3 h-3" /> {h.created} • {h.fileIds.length} file{h.fileIds.length === 1 ? "" : "s"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {h.status === "Sent" && h.clientEmail && (
                                <button
                                  onClick={() => remindClient(h)}
                                  disabled={reminding === h.id}
                                  title={h.lastReminderAt ? `Last reminded ${fmtTime(h.lastReminderAt)}` : "Send a reminder email"}
                                  className="flex items-center gap-1.5 text-[11.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors disabled:opacity-50"
                                >
                                  <Mail className="w-3 h-3" /> {reminding === h.id ? "Sending…" : "Remind"}
                                </button>
                              )}
                              <button
                                onClick={() => openDiscussion(h)}
                                className="flex items-center gap-1.5 text-[11.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors"
                              >
                                <MessageSquare className="w-3 h-3" /> Discussion
                                {counts[h.id] ? (
                                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold">
                                    {counts[h.id]}
                                  </span>
                                ) : null}
                              </button>
                              <button
                                onClick={() => openEdit(h)}
                                title="Edit package"
                                className="flex items-center gap-1.5 text-[11.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors"
                              >
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                              <button
                                onClick={() => openBranding(h)}
                                className="flex items-center gap-1.5 text-[11.5px] text-primary hover:text-white bg-primary/10 hover:bg-primary px-2.5 py-1.5 rounded-full transition-colors"
                              >
                                <Palette className="w-3 h-3" /> Customize Page
                              </button>
                              <button
                                onClick={() => openAccess(h)}
                                title="Access & sharing"
                                className={`flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-full transition-colors ${
                                  h.revoked
                                    ? "text-white bg-ink hover:bg-ink/85"
                                    : "text-ink/70 hover:text-ink bg-chip hover:bg-line"
                                }`}
                              >
                                <Shield className="w-3 h-3" />
                                {h.revoked ? "Revoked" : h.accessMode === "password" ? "Password" : h.accessMode === "public" ? "Public" : "Invite"}
                              </button>
                              <button
                                onClick={() => openLandingPage(h)}
                                title="Open landing page"
                                className="flex items-center gap-1.5 text-[11.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => copyLink(h)}
                                title="Copy share link"
                                className="flex items-center gap-1.5 text-[11.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors"
                              >
                                <LinkIcon className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => removeHandover(h)}
                                className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink bg-chip hover:bg-line px-2.5 py-1.5 rounded-full transition-colors"
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

              {(mode === "create" || mode === "edit") && (
                <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5">
                  <div className="flex items-center justify-between -mb-1">
                    <h4 className="text-[15px] font-medium text-ink">{mode === "edit" ? "Edit package" : "New package"}</h4>
                    {mode === "edit" && editTarget && (
                      <button
                        type="button"
                        onClick={() => openLandingPage(editTarget)}
                        className="flex items-center gap-1.5 text-[12.5px] text-ink/70 hover:text-ink transition-colors"
                      >
                        View full package <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Package title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      placeholder="e.g. Final Handoff Package"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="text-[13px] text-muted block mb-2">Recipient (company)</label>
                      <input
                        type="text"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        placeholder="e.g. Acme Corp"
                      />
                    </div>
                    <div>
                      <label className="text-[13px] text-muted block mb-2">Client name (contact)</label>
                      <input
                        type="text"
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        placeholder="e.g. Dana — shown on the delivery page"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[13px] text-muted block mb-2">Client email (optional)</label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      placeholder="e.g. dana@acmecorp.com — required to send reminders"
                    />
                  </div>

                  <div>
                    <label className="text-[13px] text-muted block mb-2">Note to client</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors resize-none"
                      placeholder="A short message accompanying the delivery…"
                    />
                  </div>

                  <div>
                    <label className="text-[13px] text-muted block mb-2">
                      Include files ({selectedFileIds.length} selected)
                    </label>
                    {projectFiles.length === 0 ? (
                      <p className="text-[12.5px] text-muted">No files linked to this project yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                        {projectFiles.map((f: VaultFile) => {
                          const rowApproval: HandoverFileApproval | undefined = editTarget
                            ? approvalsByHandover[editTarget.id]?.[f.id]
                            : undefined;
                          const rowSelected: boolean = selectedFileIds.includes(f.id);
                          return (
                            <div key={f.id}>
                              <HandoverFileRow
                                file={f}
                                approval={rowApproval}
                                selected={rowSelected}
                                onToggle={() => toggleFile(f.id)}
                                onReplaced={handleReplaceFile}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => {
                        setEditTarget(null);
                        setMode("list");
                      }}
                      className="flex-1 py-2.5 rounded-lg bg-chip hover:bg-line text-ink transition-colors text-[13px] font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={mode === "edit" ? handleUpdate : handleCreate}
                      disabled={!title.trim() || saving}
                      className="flex-1 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-[13px] font-semibold flex items-center justify-center gap-2"
                    >
                      {saving ? (
                        "Saving…"
                      ) : mode === "edit" ? (
                        <>
                          <Send className="w-3.5 h-3.5" /> Save Changes
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" /> Create Package
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "access" && accessTarget && (
                <motion.div key="access" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5 max-w-lg">
                  <button
                    onClick={() => setMode("list")}
                    className="self-start text-[13px] text-muted hover:text-ink transition-colors"
                  >
                    ← Back to packages
                  </button>
                  <div>
                    <h4 className="text-[16px] font-semibold text-ink flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" /> Access &amp; sharing
                    </h4>
                    <p className="text-[12.5px] text-muted mt-1">{accessTarget.title}</p>
                  </div>

                  <div>
                    <label className="text-[13px] text-muted block mb-2">Share link</label>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-paper border border-line rounded-lg px-3 py-2.5 text-[12px] text-ink/70 truncate">
                        {shareUrl(accessTarget)}
                      </code>
                      <button
                        onClick={() => copyLink(accessTarget)}
                        className="shrink-0 bg-chip hover:bg-line px-3 rounded-lg text-ink/60 hover:text-ink transition-colors"
                        title="Copy share link"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[12px] text-muted mt-1.5">
                      The link contains an unguessable token — nobody can reach this delivery without it.
                    </p>
                  </div>

                  <div>
                    <label className="text-[13px] text-muted block mb-2">Access mode</label>
                    <div className="flex flex-col gap-2">
                      {(
                        [
                          { key: "invite", label: "Invite only", hint: "Only people you send the link to. Default." },
                          { key: "password", label: "Password", hint: "The link plus a password you share separately." },
                          { key: "public", label: "Public link", hint: "Anyone who has the URL. Use with care." },
                        ] as { key: PortalAccessMode; label: string; hint: string }[]
                      ).map((opt) => (
                        <label
                          key={opt.key}
                          className={`flex items-start gap-3 rounded-lg px-4 py-3 cursor-pointer transition-colors ${
                            accessMode === opt.key ? "bg-primary/[0.07]" : "bg-chip hover:bg-line"
                          }`}
                        >
                          <input
                            type="radio"
                            name="access-mode"
                            checked={accessMode === opt.key}
                            onChange={() => setAccessMode(opt.key)}
                            className="mt-0.5 accent-primary"
                          />
                          <span>
                            <span className="block text-[13px] text-ink">{opt.label}</span>
                            <span className="block text-[12px] text-muted">{opt.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {accessMode === "password" && (
                    <div>
                      <label className="text-[13px] text-muted block mb-2">
                        {accessTarget.passwordHash ? "Change password" : "Set password"}
                      </label>
                      <input
                        type="password"
                        value={accessPassword}
                        onChange={(e) => setAccessPassword(e.target.value)}
                        placeholder={accessTarget.passwordHash ? "Leave blank to keep the current password" : "Choose a password to share with the client"}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[13px] text-muted block mb-2">Link expiry</label>
                    <input
                      type="date"
                      value={accessExpiry}
                      onChange={(e) => setAccessExpiry(e.target.value)}
                      className="bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    />
                    <p className="text-[12px] text-muted mt-1.5">The link stops working at the end of this day. Leave empty for no expiry.</p>
                  </div>

                  <button
                    onClick={saveAccess}
                    disabled={savingAccess}
                    className="self-start bg-primary hover:bg-primary/85 disabled:opacity-50 text-white transition-colors px-6 py-2.5 rounded-full text-[13px] font-medium"
                  >
                    {savingAccess ? "Saving…" : "Save access settings"}
                  </button>

                  <div className="bg-chip rounded-xl p-4 mt-2">
                    <h5 className="text-[13px] font-medium text-ink mb-1.5">
                      {accessTarget.revoked ? "Link revoked" : "Revoke link"}
                    </h5>
                    <p className="text-[12.5px] text-muted mb-3">
                      {accessTarget.revoked
                        ? "The portal is inaccessible and all outstanding download links are dead. You can restore access at any time."
                        : "Immediately cuts off the portal page and every outstanding download link. Your files in their cloud location are untouched."}
                    </p>
                    <button
                      onClick={() => toggleRevoked(accessTarget)}
                      className={`text-[12.5px] font-medium px-4 py-2 rounded-full transition-colors ${
                        accessTarget.revoked
                          ? "text-ink/70 bg-surface hover:bg-chip"
                          : "text-ink bg-white border-2 border-ink hover:bg-ink hover:text-white"
                      }`}
                    >
                      {accessTarget.revoked ? "Restore access" : "Revoke link now"}
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "brand" && brand && brandingTarget && (
                <motion.div key="brand" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("list")}
                      className="text-[13px] text-muted hover:text-ink transition-colors"
                    >
                      ← Back to packages
                    </button>
                    <span className="text-[12.5px] text-muted truncate">{brandingTarget.title}</span>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Controls */}
                    <div className="flex flex-col gap-4">
                      <div>
                        <label className="text-[13px] text-muted block mb-2">Studio / sender name</label>
                        <input
                          type="text"
                          value={brand.studioName}
                          onChange={(e) => setBrand({ ...brand, studioName: e.target.value })}
                          className="w-full bg-paper border border-line rounded-lg px-4 py-2.5 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Logo</label>
                        <div className="flex items-center gap-3">
                          {brand.logoUrl ? (
                            <img src={brand.logoUrl} alt="Logo" className="h-10 max-w-[120px] object-contain bg-chip rounded p-1" />
                          ) : (
                            <div className="h-10 w-10 rounded bg-chip flex items-center justify-center text-muted">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                          <input type="file" accept="image/*" ref={logoInputRef} onChange={handleLogoFile} className="hidden" />
                          <button
                            onClick={() => logoInputRef.current?.click()}
                            className="text-[12.5px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-3 py-2 rounded-lg transition-colors"
                          >
                            Upload
                          </button>
                          {brand.logoUrl && (
                            <button
                              onClick={() => setBrand({ ...brand, logoUrl: "" })}
                              className="text-[12.5px] text-muted hover:text-ink px-2 py-2 rounded transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Headline</label>
                        <input
                          type="text"
                          value={brand.headline}
                          onChange={(e) => setBrand({ ...brand, headline: e.target.value })}
                          className="w-full bg-paper border border-line rounded-lg px-4 py-2.5 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Subheading</label>
                        <input
                          type="text"
                          value={brand.subhead}
                          onChange={(e) => setBrand({ ...brand, subhead: e.target.value })}
                          className="w-full bg-paper border border-line rounded-lg px-4 py-2.5 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Welcome message</label>
                        <textarea
                          value={brand.welcome}
                          onChange={(e) => setBrand({ ...brand, welcome: e.target.value })}
                          rows={3}
                          className="w-full bg-paper border border-line rounded-lg px-4 py-2.5 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors resize-none"
                        />
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Accent color</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {ACCENT_SWATCHES.map((sw) => (
                            <button
                              key={sw}
                              onClick={() => setBrand({ ...brand, accent: sw })}
                              style={{ backgroundColor: sw }}
                              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                                brand.accent.toLowerCase() === sw.toLowerCase() ? "border-ink/40 scale-110" : "border-transparent"
                              }`}
                              aria-label={`Accent ${sw}`}
                            />
                          ))}
                          <label className="relative w-7 h-7 rounded-full overflow-hidden border border-line cursor-pointer" title="Custom color">
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(brand.accent) ? brand.accent : "#2c2c2e"}
                              onChange={(e) => setBrand({ ...brand, accent: e.target.value })}
                              className="absolute -inset-1 w-[150%] h-[150%] cursor-pointer"
                            />
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="text-[13px] text-muted block mb-2">Theme</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setBrand({ ...brand, theme: "dark" })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                              brand.theme === "dark" ? "bg-primary/10 text-primary" : "bg-chip text-muted hover:bg-line"
                            }`}
                          >
                            <Moon className="w-3.5 h-3.5" /> Dark
                          </button>
                          <button
                            onClick={() => setBrand({ ...brand, theme: "light" })}
                            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                              brand.theme === "light" ? "bg-primary/10 text-primary" : "bg-chip text-muted hover:bg-line"
                            }`}
                          >
                            <Sun className="w-3.5 h-3.5" /> Light
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Live preview — genuine client-facing output, left as its own visual system */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-ink">Live preview</span>
                        <button
                          onClick={saveAndOpen}
                          className="flex items-center gap-1.5 text-[12.5px] text-ink/70 hover:text-ink transition-colors"
                        >
                          Open in new tab <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <iframe
                        title="Handover landing page preview"
                        srcDoc={previewHtml}
                        className="w-full h-[460px] rounded-lg border border-line bg-white"
                      />
                      <p className="text-[12px] text-muted leading-relaxed">
                        This is exactly what your client sees at the share link. Save to publish your changes.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-4 border-t border-line">
                    <button
                      onClick={() => setMode("list")}
                      className="flex-1 py-2.5 rounded-lg bg-chip hover:bg-line text-ink transition-colors text-[13px] font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => copyLink(brandingTarget)}
                      className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-chip hover:bg-line text-ink transition-colors text-[13px] font-semibold"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> Copy link
                    </button>
                    <button
                      onClick={saveBranding}
                      disabled={savingBrand}
                      className="flex-1 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-[13px] font-semibold flex items-center justify-center gap-2"
                    >
                      {savingBrand ? "Saving…" : (<><Check className="w-3.5 h-3.5" /> Save landing page</>)}
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "discuss" && discussTarget && (
                <motion.div key="discuss" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => setMode("list")}
                      className="text-[13px] text-muted hover:text-ink transition-colors"
                    >
                      ← Back to packages
                    </button>
                    <button
                      onClick={() => openLandingPage(discussTarget)}
                      className="flex items-center gap-1.5 text-[12.5px] text-ink/70 hover:text-ink transition-colors"
                    >
                      Client view <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div>
                    <h4 className="text-[15px] font-medium text-ink">{discussTarget.title}</h4>
                    <p className="text-[12.5px] text-muted">
                      Shared thread with {discussTarget.recipient || "the client"}
                    </p>
                  </div>

                  {/* Thread */}
                  <div className="flex flex-col gap-3 max-h-[320px] overflow-y-auto pr-1">
                    {loadingComments ? (
                      <div className="text-center py-10 text-[13px] text-muted">Loading…</div>
                    ) : comments.length === 0 ? (
                      <div className="text-center py-10 border border-dashed border-line rounded-xl">
                        <MessageSquare className="w-8 h-8 text-muted mx-auto mb-3" />
                        <p className="text-[13px] text-ink/70">No notes yet</p>
                        <p className="text-[12.5px] text-muted">Start the conversation, or share the link so your client can chime in.</p>
                      </div>
                    ) : (
                      comments.map((cm) => {
                        const isDesigner = cm.role === "designer";
                        return (
                          <div
                            key={cm.id}
                            className={`rounded-xl p-3.5 group ${isDesigner ? "bg-primary/[0.06]" : "bg-chip"}`}
                          >
                            <div className="flex items-center flex-wrap gap-2 mb-1.5">
                              <span className="text-[13px] font-medium text-ink">{cm.author}</span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  isDesigner ? "text-primary bg-primary/10" : "text-muted bg-line"
                                }`}
                              >
                                {isDesigner ? "Studio" : "Client"}
                              </span>
                              {cm.fileId && (
                                <span className="text-[11px] text-primary flex items-center gap-1">
                                  <FileText className="w-3 h-3" /> {fileName(cm.fileId)}
                                </span>
                              )}
                              <span className="ml-auto text-[11.5px] text-muted">{fmtTime(cm.created)}</span>
                              <button
                                onClick={() => removeComment(cm)}
                                className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-all"
                                title="Delete note"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <p className="text-[13.5px] text-ink/80 whitespace-pre-wrap leading-relaxed">{cm.body}</p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Designer composer */}
                  <div className="border-t border-line pt-4 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder="Your name"
                        className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      />
                      <select
                        value={commentFileId}
                        onChange={(e) => setCommentFileId(e.target.value)}
                        className="bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors cursor-pointer max-w-[45%]"
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
                        className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors resize-none"
                      />
                      <button
                        onClick={postComment}
                        disabled={!commentBody.trim() || postingComment}
                        className="shrink-0 h-[42px] px-4 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-[13px] font-semibold flex items-center gap-2"
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
