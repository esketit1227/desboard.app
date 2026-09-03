import type React from "react";
import { useState, useEffect, useRef } from "react";
import {
  Folder,
  FileText,
  Search,
  Upload,
  Download,
  History,
  Eye,
  Link as LinkIcon,
  MoreVertical,
  Video,
  X,
  Filter,
  Users,
  LayoutGrid,
  List,
  Plus,
  ChevronRight,
  Archive,
  Check,
  Moon,
  Cloud,
  Database,
  Figma,
  PenTool,
  CheckCircle,
  Sparkles,
  Image as ImageIcon,
  Maximize,
  ArrowRight,
  Menu,
  FolderPlus,
  Trash2,
  Tag as TagIcon,
  FolderInput,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { VaultFile, ProjectFull, Tag, FileStatus, PlanLimits } from "../../types";
import { api } from "../../lib/api";
import { previewableKind, contentUrl } from "../../lib/filePreview";
import { useAuth } from "../auth/AuthContext";

/**
 * A drag-anywhere before/after reveal for two image versions of the same file —
 * the top version is clipped to the handle position, showing the version below
 * wherever it's dragged past. Only meaningful for images: it needs both
 * versions rendered into the exact same frame to align, which a PDF or a
 * binary format like .ai can't offer without a renderer this app doesn't have.
 */
function SliderCompare({
  file,
  versions,
  sliderPos,
  setSliderPos,
  restoreVersion,
}: {
  file: VaultFile;
  versions: string[];
  sliderPos: number;
  setSliderPos: (n: number) => void;
  restoreVersion: (version: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updateFromClientX = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSliderPos(Math.round(ratio * 100));
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current) updateFromClientX(e.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const versionMeta = (v: string) => file.versions.find((x) => x.version === v);
  const urlFor = (v: string) => `/api/files/${file.id}/version/${encodeURIComponent(v)}/download`;

  return (
    <div className="flex-1 flex flex-col pb-6 overflow-hidden">
      <div
        ref={frameRef}
        className="relative flex-1 bg-[#050505] border border-white/10 rounded-xl overflow-hidden select-none cursor-ew-resize"
        onPointerDown={(e) => {
          dragging.current = true;
          updateFromClientX(e.clientX);
        }}
      >
        {/* Base layer: version[1], fully visible */}
        <img src={urlFor(versions[1])} alt={`${file.name} — ${versions[1]}`} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        {/* Top layer: version[0], clipped to the handle so only its left side shows */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
          <img src={urlFor(versions[0])} alt={`${file.name} — ${versions[0]}`} className="absolute inset-0 w-full h-full object-contain" />
        </div>

        {/* Handle */}
        <div className="absolute inset-y-0 w-px bg-white/80 pointer-events-none" style={{ left: `${sliderPos}%` }}>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center text-ink text-[13px]">
            ↔
          </div>
        </div>

        {/* Corner labels */}
        <div className="absolute top-3 left-3 bg-black/60 text-white text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full">
          {versions[0]}
        </div>
        <div className="absolute top-3 right-3 bg-black/60 text-white text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full">
          {versions[1]}
        </div>
      </div>

      <div className="flex items-center justify-center gap-6 pt-4 text-[11px] font-mono uppercase tracking-widest">
        {[0, 1].map((side) => (
          <button
            key={side}
            onClick={() => restoreVersion(versions[side])}
            className="text-primary hover:text-primary/80 flex items-center gap-1.5"
          >
            Restore {versions[side]}
            <span className="text-white/30 font-sans normal-case tracking-normal">
              ({versionMeta(versions[side])?.date})
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * File Vault window — grid/list browser, search, drag-and-drop into projects,
 * a file inspector (details / history / links), version comparison, and file
 * preview. Data is loaded from and persisted to the SQLite-backed API so it
 * survives a refresh.
 */
export function FileVaultApp({
  showToast,
  initialFileId = null,
  initialFocusSearch = false,
  highContrast,
  onHighContrastChange,
  onOpenConnections,
}: {
  showToast: (msg: string) => void;
  /** Open with this file pre-selected in the inspector (e.g. from an assistant citation). */
  initialFileId?: string | null;
  /** Focus the search field on mount (e.g. from the sidebar's Search shortcut). */
  initialFocusSearch?: boolean;
  /** App-wide preference (also editable from Settings) — lifted so it survives switching screens. */
  highContrast: boolean;
  onHighContrastChange: (value: boolean) => void;
  /** Deep-link to the Connections screen to actually connect/disconnect a provider. */
  onOpenConnections?: () => void;
}) {
  const { user } = useAuth();
  const displayName = user.name?.trim() || user.email.split("@")[0];
  const [filesList, setFilesList] = useState<VaultFile[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  /** Below sm: the Vault nav is a toggled drawer, same pattern as the app shell's own sidebar. */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "versions" | "links">("details");
  const [searchQuery, setSearchQuery] = useState("");

  const [aiSearchResults, setAiSearchResults] = useState<string[] | null>(null);
  // null while unknown, so the message below the search box doesn't flash
  // on then off before the check comes back.
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagVal, setNewTagVal] = useState("");
  const [linkedDrive, setLinkedDrive] = useState(false);
  const [linkedDropbox, setLinkedDropbox] = useState(false);
  const [linkedOneDrive, setLinkedOneDrive] = useState(false);
  const [uploadDestination, setUploadDestination] = useState<"drive" | "dropbox" | "onedrive" | "desboard">("desboard");

  // Real connection status (Google Drive / Dropbox / OneDrive), for the
  // upload-destination picker and the sidebar's Cloud Storage panel — see
  // ConnectionsApp for the actual connect/disconnect flow, which lives on its
  // own screen.
  useEffect(() => {
    api.getOAuthStatus("google").then((s) => setLinkedDrive(s.connected)).catch(() => {});
    api.getOAuthStatus("dropbox").then((s) => setLinkedDropbox(s.connected)).catch(() => {});
    api.getOAuthStatus("onedrive").then((s) => setLinkedOneDrive(s.connected)).catch(() => {});
  }, []);
  const [previewingFile, setPreviewingFile] = useState<VaultFile | null>(null);
  const [selectedFilterProject, setSelectedFilterProject] = useState<number | null>(null);
  const [dragHoverProject, setDragHoverProject] = useState<number | null>(null);

  // Real sidebar data (projects/tags) + the filters they drive.
  const [projects, setProjects] = useState<ProjectFull[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<"all" | "recent" | "shared">("all");
  const [statusFilter, setStatusFilter] = useState<FileStatus | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [isAddingAccess, setIsAddingAccess] = useState(false);
  const [newAccessVal, setNewAccessVal] = useState("");
  const [editingLink, setEditingLink] = useState<"project" | "client" | null>(null);

  // Upload state. `content` holds the base64 bytes until confirm, so the
  // upload stores a real file (previews + downloads), not just metadata.
  const [uploadingFile, setUploadingFile] = useState<{
    name: string;
    size: string;
    extension: string;
    content: string;
    mime: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialFocusSearch) searchInputRef.current?.focus();
  }, [initialFocusSearch]);

  // Folder navigation — real nesting, not just an icon. `folderPath` is the
  // breadcrumb trail from the current view's root down to where we are now;
  // `currentFolderId` (the last entry's id, or null at the root) is what
  // actually filters the file list.
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;

  // Bulk selection + multi-file upload queue.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<{ id: string; name: string; status: "pending" | "uploading" | "done" | "error" }[]>([]);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  // Version comparison state
  const [selectedVersionsToCompare, setSelectedVersionsToCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [compareMode, setCompareMode] = useState<"side-by-side" | "slider">("side-by-side");
  const [sliderPos, setSliderPos] = useState(50);
  const [compareLoadFailed, setCompareLoadFailed] = useState<Record<number, boolean>>({});

  // Load files from the SQLite-backed API so they survive a refresh.
  useEffect(() => {
    api.getFiles().then(setFilesList).catch((e) => console.error("Failed to load files", e));
  }, []);

  useEffect(() => {
    api.getAiStatus().then((s) => setAiConfigured(s.configured)).catch(() => setAiConfigured(false));
  }, []);

  // Plan limits — until these load, bulk-select/multi-upload stay hidden
  // rather than briefly flashing on then off (planLimits starts null; the
  // gate checks below treat "not loaded yet" the same as "not entitled").
  const [planLimits, setPlanLimits] = useState<PlanLimits | null>(null);
  useEffect(() => {
    api.getBillingStatus().then((s) => setPlanLimits(s.limits)).catch(() => setPlanLimits(null));
  }, []);

  useEffect(() => {
    api.getProjects().then(setProjects).catch((e) => console.error("Failed to load projects", e));
    api.getTags().then(setTags).catch((e) => console.error("Failed to load tags", e));
  }, []);

  // Switching which project/tag/status/sidebar view we're looking at leaves
  // an old folder path pointing nowhere relevant, and a stale multi-selection
  // pointing at files that just scrolled out of view — both reset together.
  useEffect(() => {
    setFolderPath([]);
    setSelectedIds(new Set());
  }, [selectedFilterProject, selectedTagFilter, statusFilter, sidebarView]);

  // Deep-open a specific file (assistant citation chips) once files are loaded.
  useEffect(() => {
    if (!initialFileId) return;
    const f = filesList.find((x) => x.id === initialFileId);
    if (f) {
      setSelectedFile(f);
      setActiveTab("details");
    }
  }, [initialFileId, filesList]);

  // Debounced search — server-side keyword matching over name/tags/status/type.
  useEffect(() => {
    if (!searchQuery.trim()) {
      setAiSearchResults(null);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const matchedIds = await api.search(searchQuery, filesList);
        if (Array.isArray(matchedIds)) setAiSearchResults(matchedIds);
      } catch (e) {
        console.error("Failed search", e);
      }
    }, 600);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, filesList]);

  // Persist a file move to another vault project and update local state. A
  // folder only makes sense inside the project it was created in, so hopping
  // to a different project always drops back out to that project's root.
  //
  // If what's moving is itself a folder, its contents move with it — every
  // descendant's projectId is cascaded too. Without this, a moved folder's
  // files stay tagged with the old project, and since the project filter is
  // the outermost filter (checked before parentId), they'd become invisible
  // everywhere: not in the old project's view (the folder that led to them is
  // gone) and not in the new one either (wrong projectId). Real, silent data
  // loss from the user's point of view, even though the rows still exist.
  const moveFileToProject = (sourceId: string, projectId: number, toastMsg: string) => {
    const moved = filesList.find((f) => f.id === sourceId);
    const ids = moved?.type === "folder" ? [sourceId, ...collectDescendantIds(sourceId)] : [sourceId];
    setFilesList((prev) =>
      prev.map((f) => (f.id === sourceId ? { ...f, projectId, parentId: null } : ids.includes(f.id) ? { ...f, projectId } : f))
    );
    api.updateFile(sourceId, { projectId, parentId: null }).catch((e) => console.error("Failed to move file", e));
    ids
      .filter((id) => id !== sourceId)
      .forEach((id) => api.updateFile(id, { projectId }).catch((e) => console.error("Failed to move descendant", id, e)));
    showToast(toastMsg);
  };

  // Every file/folder nested anywhere under `folderId`, however deep —
  // used to cascade a project move down a folder's whole subtree.
  const collectDescendantIds = (folderId: string): string[] => {
    const direct = filesList.filter((f) => f.parentId === folderId);
    return direct.flatMap((f) => [f.id, ...(f.type === "folder" ? collectDescendantIds(f.id) : [])]);
  };

  // True when `candidateId` is `targetId` itself or sits somewhere in its
  // parent chain — the check that stops a folder from being dropped into its
  // own subfolder, which would otherwise wall off that whole branch (its
  // parent chain would loop and never reach the root again).
  const isSameOrDescendant = (candidateId: string, targetId: string): boolean => {
    let current: string | null = targetId;
    const seen = new Set<string>();
    while (current) {
      if (current === candidateId) return true;
      if (seen.has(current)) break; // pre-existing cycle safety net, shouldn't happen
      seen.add(current);
      current = filesList.find((f) => f.id === current)?.parentId ?? null;
    }
    return false;
  };

  // Moves one or more files into a folder (or back out to root with folderId
  // null) — real nesting via parentId, not the projectId trick the old
  // drop-on-a-folder behavior used.
  const moveFilesToFolder = (sourceIds: string[], folderId: string | null, toastMsg: string) => {
    if (folderId) {
      const blocked = sourceIds.filter((id) => isSameOrDescendant(id, folderId));
      if (blocked.length > 0) {
        showToast("Can't move a folder into itself or one of its own subfolders");
        sourceIds = sourceIds.filter((id) => !blocked.includes(id));
        if (sourceIds.length === 0) return;
      }
    }
    const ids = new Set(sourceIds);
    setFilesList((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, parentId: folderId } : f)));
    sourceIds.forEach((id) => api.updateFile(id, { parentId: folderId }).catch((e) => console.error("Failed to move file", e)));
    showToast(toastMsg);
  };

  const openFolder = (folder: VaultFile) => {
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedIds(new Set());
    setSearchQuery("");
  };

  const goToBreadcrumb = (index: number) => {
    // index -1 means the root ("All Files") itself.
    setFolderPath((prev) => (index < 0 ? [] : prev.slice(0, index + 1)));
    setSelectedIds(new Set());
  };

  const createFolder = async () => {
    const name = window.prompt("Folder name")?.trim();
    if (!name) return;
    const folder: VaultFile = {
      id: "fold" + Date.now(),
      name,
      type: "folder",
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      owner: "You",
      source: "Desboard",
      tags: [],
      status: "Draft",
      projectId: selectedFilterProject,
      clientId: null,
      versions: [],
      access: ["Team"],
      parentId: currentFolderId,
    };
    setFilesList((prev) => [folder, ...prev]);
    try {
      const saved = await api.createFile(folder);
      setFilesList((prev) => prev.map((f) => (f.id === folder.id ? saved : f)));
    } catch (e) {
      console.error("Failed to create folder", e);
      showToast(e instanceof Error ? e.message : "Could not create the folder");
      setFilesList((prev) => prev.filter((f) => f.id !== folder.id));
    }
  };

  // --- Bulk selection + actions -------------------------------------------
  const toggleSelect = (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      // Bulk selection (acting on more than one file at once) is a Studio+
      // feature — a plan without it can still select and act on ONE file
      // (the same action bar works fine for a set of size 1), it just can't
      // grow past that.
      if (!planLimits?.bulkActions) {
        return prev.has(fileId) ? new Set() : new Set([fileId]);
      }
      const next = new Set(prev);
      if (e.shiftKey && lastClickedId) {
        // Range-select between the last clicked row and this one, in whatever
        // order they currently appear in the grid/list — the same feel as a
        // Finder or Drive shift-click.
        const ids = filteredFiles.map((f) => f.id);
        const a = ids.indexOf(lastClickedId);
        const b = ids.indexOf(fileId);
        if (a !== -1 && b !== -1) {
          const [start, end] = a < b ? [a, b] : [b, a];
          for (let i = start; i <= end; i++) next.add(ids[i]);
          setLastClickedId(fileId);
          return next;
        }
      }
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      setLastClickedId(fileId);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkAddTag = () => {
    const tag = window.prompt(`Add a tag to ${selectedIds.size} file${selectedIds.size === 1 ? "" : "s"}`)?.trim();
    if (!tag) return;
    const ids = Array.from(selectedIds);
    setFilesList((prev) => prev.map((f) => (ids.includes(f.id) && !f.tags.includes(tag) ? { ...f, tags: [...f.tags, tag] } : f)));
    ids.forEach((id: string) => {
      const f = filesList.find((x) => x.id === id);
      if (f && !f.tags.includes(tag)) api.updateFile(id, { tags: [...f.tags, tag] }).catch((e) => console.error("Bulk tag failed", id, e));
    });
    showToast(`Tagged ${ids.length} file${ids.length === 1 ? "" : "s"} "${tag}"`);
    // Deliberately doesn't clear the selection — tagging doesn't remove files
    // from view the way delete/move do, so chaining another bulk action
    // (download them too, say) right after shouldn't require re-selecting.
  };

  const bulkMoveToProject = (projectId: string) => {
    const numericId = Number(projectId.replace(/^p/, ""));
    const sourceIds = Array.from(selectedIds);
    const descendantIds = sourceIds.flatMap((id: string) => {
      const f = filesList.find((file) => file.id === id);
      return f?.type === "folder" ? collectDescendantIds(id) : [];
    });
    const allIds = Array.from(new Set([...sourceIds, ...descendantIds]));
    setFilesList((prev) =>
      prev.map((f) =>
        sourceIds.includes(f.id)
          ? { ...f, projectId: numericId, parentId: null }
          : allIds.includes(f.id)
          ? { ...f, projectId: numericId }
          : f
      )
    );
    sourceIds.forEach((id: string) =>
      api.updateFile(id, { projectId: numericId, parentId: null }).catch((e) => console.error("Bulk move failed", id, e))
    );
    descendantIds.forEach((id: string) =>
      api.updateFile(id, { projectId: numericId }).catch((e) => console.error("Bulk move descendant failed", id, e))
    );
    showToast(`Moved ${sourceIds.length} file${sourceIds.length === 1 ? "" : "s"}`);
    setShowMoveMenu(false);
    clearSelection();
  };

  const bulkDownload = () => {
    // No zip step in this build — each file downloads as its own request.
    // Staggered slightly since browsers throttle/block a burst of simultaneous
    // downloads triggered from one click.
    Array.from(selectedIds).forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/files/${id}/download`;
        a.click();
      }, i * 400);
    });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!window.confirm(`Delete ${ids.length} file${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    // Deleting a folder re-parents its direct children server-side rather than
    // cascading the delete — mirror that here so children don't just vanish
    // from view until the next refetch.
    setFilesList((prev) => {
      const deletedIds = new Set(ids);
      const byId = new Map<string, VaultFile>(prev.map((f) => [f.id, f]));
      // Walk up the original parent chain past any other folder that's also
      // being deleted in this same batch, landing on the nearest surviving ancestor.
      const resolveParent = (parentId: string | null | undefined): string | null => {
        let current = parentId ?? null;
        const seen = new Set<string>();
        while (current && deletedIds.has(current) && !seen.has(current)) {
          seen.add(current);
          current = byId.get(current)?.parentId ?? null;
        }
        return current;
      };
      const reparented = prev.map((f) =>
        deletedIds.has(f.id) || !deletedIds.has(f.parentId ?? "") ? f : { ...f, parentId: resolveParent(f.parentId) }
      );
      return reparented.filter((f) => !deletedIds.has(f.id));
    });
    clearSelection();
    const results = await Promise.allSettled(ids.map((id: string) => api.deleteFile(id)));
    const failed = results.filter((r) => r.status === "rejected" || r.value !== true).length;
    if (failed > 0) {
      showToast(`${failed} file${failed === 1 ? "" : "s"} couldn't be deleted — refresh to check`);
      api.getFiles().then(setFilesList).catch(() => {});
    } else {
      showToast(`Deleted ${ids.length} file${ids.length === 1 ? "" : "s"}`);
    }
  };

  // Dragging a file that's already part of the current selection drags the
  // whole selection along with it; dragging one that isn't starts a fresh
  // single-file drag, same as before.
  const handleFileDragStart = (e: React.DragEvent, file: VaultFile) => {
    const ids = selectedIds.has(file.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [file.id];
    e.dataTransfer.setData("sourceIds", JSON.stringify(ids));
    // Also set the single-id key the sidebar's project drop targets read —
    // keeps that older drop zone working without its own multi-id handling.
    e.dataTransfer.setData("sourceId", file.id);
  };

  const handleFileDropOnFolder = (e: React.DragEvent, folder: VaultFile) => {
    e.preventDefault();
    e.stopPropagation();
    // stopPropagation means the outer vault container's own onDrop — the one
    // that clears the "Drop files to upload" overlay — never fires. Without
    // this, the overlay is stuck on screen after every drop onto a folder.
    setDragActive(false);
    const raw = e.dataTransfer.getData("sourceIds");
    if (!raw) return;
    try {
      const ids: string[] = JSON.parse(raw).filter((id: string) => id !== folder.id);
      if (ids.length > 0) moveFilesToFolder(ids, folder.id, `Moved to ${folder.name}`);
    } catch {
      /* malformed drag payload — ignore */
    }
  };

  const handleFileCardClick = (file: VaultFile) => {
    if (file.type === "folder") {
      openFolder(file);
      return;
    }
    setSelectedFile(file);
    setSelectedVersionsToCompare([]);
    setIsComparing(false);
  };

  const handlePreviewNewWindow = (file: VaultFile, e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`/api/files/${file.id}/content`, "_blank");
  };

  const handleShareLink = (file: VaultFile, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`https://desboard.app/preview/${file.id}`);
    showToast("Preview link copied to clipboard!");
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleFileUploadEvent = async (file: File) => {
    const parts = file.name.split(".");
    const extension = parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "file";

    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    let fileContent = "";
    try {
      fileContent = await base64Promise;
    } catch {
      showToast("Could not read that file");
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    setUploadingFile({
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(1) + " MB",
      extension,
      content: fileContent,
      mime: mimeType,
    });
  };

  /**
   * Dropping or picking more than one file skips the single-file confirm
   * step (reviewing ten files one at a time defeats the point of a batch)
   * and just uploads them straight into the current folder, tracked in a
   * lightweight progress queue instead.
   */
  const handleMultiFileUpload = async (rawFiles: File[]) => {
    // Multi-file upload is a Studio+ feature. Rather than silently dropping
    // the extra files with no explanation, upload just the first and say why
    // the rest didn't come along — matches how bulk-select degrades to a
    // single selection instead of just refusing to select anything.
    const files = !planLimits?.multiUpload && rawFiles.length > 1 ? rawFiles.slice(0, 1) : rawFiles;
    if (files.length < rawFiles.length) {
      showToast(`Uploaded 1 of ${rawFiles.length} files — multiple at once is a Studio-plan feature.`);
    }
    const queueIds = files.map((f, i) => `${Date.now()}-${i}-${f.name}`);
    setUploadQueue(files.map((f, i) => ({ id: queueIds[i], name: f.name, status: "pending" as const })));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const queueId = queueIds[i];
      setUploadQueue((prev) => prev.map((q) => (q.id === queueId ? { ...q, status: "uploading" } : q)));
      try {
        const parts = file.name.split(".");
        const extension = parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "file";
        const content: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] || result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const newFile: VaultFile = {
          id: Date.now().toString() + i,
          name: file.name,
          type: "file",
          extension,
          size: (file.size / 1024 / 1024).toFixed(1) + " MB",
          created: "Just now",
          source: "Desboard",
          status: "Draft",
          owner: displayName,
          tags: [],
          access: ["Team"],
          versions: [{ version: "v1.0", date: "Just now", author: displayName, latest: true }],
          projectId: selectedFilterProject,
          clientId: null,
          parentId: currentFolderId,
        };
        const saved = await api.createFile(newFile, content, file.type || "application/octet-stream");
        setFilesList((prev) => [saved, ...prev]);
        setUploadQueue((prev) => prev.map((q) => (q.id === queueId ? { ...q, status: "done" } : q)));
      } catch (e) {
        console.error("Failed to upload", file.name, e);
        setUploadQueue((prev) => prev.map((q) => (q.id === queueId ? { ...q, status: "error" } : q)));
        showToast(e instanceof Error ? e.message : `Could not upload ${file.name}`);
      }
    }

    setTimeout(() => setUploadQueue([]), 2500);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (files.length === 1) handleFileUploadEvent(files[0]);
    else handleMultiFileUpload(Array.from(files));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length === 1) handleFileUploadEvent(files[0]);
    else if (files && files.length > 1) handleMultiFileUpload(Array.from(files));
    // Reset so selecting the same file again (e.g. after Cancel) still fires a
    // change event — native file inputs don't fire onChange if the value (the
    // selected path) doesn't change from the previous selection.
    e.target.value = "";
  };

  const handleConfirmUpload = async () => {
    if (!uploadingFile) return;

    const newFile: VaultFile = {
      id: Date.now().toString(),
      name: uploadingFile.name,
      type: "file",
      extension: uploadingFile.extension,
      size: uploadingFile.size,
      created: "Just now",
      source:
        uploadDestination === "drive"
          ? "Drive"
          : uploadDestination === "dropbox"
            ? "Dropbox"
            : uploadDestination === "onedrive"
              ? "OneDrive"
              : "Desboard",
      status: "Draft",
      owner: displayName,
      tags: [],
      access: ["Team"],
      versions: [{ version: "v1.0", date: "Just now", author: displayName, latest: true }],
      projectId: selectedFilterProject,
      clientId: null,
      parentId: currentFolderId,
    };

    setFilesList([newFile, ...filesList]);
    setUploadingFile(null);
    try {
      // Bytes go with the metadata so the file gets a real preview + download.
      const saved = await api.createFile(newFile, uploadingFile.content, uploadingFile.mime);
      setFilesList((prev) => prev.map((f) => (f.id === saved.id ? saved : f)));
    } catch (e) {
      console.error("Failed to persist uploaded file", e);
      showToast(e instanceof Error ? e.message : "Upload failed to save — try again");
      setFilesList((prev) => prev.filter((f) => f.id !== newFile.id));
    }
  };

  /** Upload a replacement binary as a new version of the selected file. */
  const handleVersionUpload = async (file: File) => {
    if (!selectedFile) return;
    const reader = new FileReader();
    const base64: string = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] || result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const updated = await api.uploadFileVersion(
        selectedFile.id,
        base64,
        file.type || "application/octet-stream",
        displayName
      );
      setFilesList((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedFile(updated);
      showToast(`New version of ${updated.name} uploaded`);
    } catch (e) {
      console.error("Failed to upload version", e);
      showToast(e instanceof Error ? e.message : "Could not upload the new version");
    }
  };

  const restoreVersion = async (version: string) => {
    if (!selectedFile) return;
    try {
      const updated = await api.restoreFileVersion(selectedFile.id, version);
      setFilesList((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedFile(updated);
      showToast(`Restored ${version}`);
    } catch (e) {
      console.error("Failed to restore version", e);
      showToast("Could not restore that version");
    }
  };

  const handleAddTag = () => {
    if (newTagVal.trim() && selectedFile) {
      const newTag = newTagVal.trim();
      if (!selectedFile.tags.includes(newTag)) {
        const updatedFile = { ...selectedFile, tags: [...selectedFile.tags, newTag] };
        setFilesList(filesList.map((f) => (f.id === updatedFile.id ? updatedFile : f)));
        setSelectedFile(updatedFile);
        api.updateFile(updatedFile.id, { tags: updatedFile.tags }).catch((e) => console.error("Failed to save tag", e));
      }
      setIsAddingTag(false);
      setNewTagVal("");
    }
  };

  const handleAddAccess = () => {
    if (newAccessVal.trim() && selectedFile) {
      const entry = newAccessVal.trim();
      if (!selectedFile.access.includes(entry)) {
        const updatedFile = { ...selectedFile, access: [...selectedFile.access, entry] };
        setFilesList(filesList.map((f) => (f.id === updatedFile.id ? updatedFile : f)));
        setSelectedFile(updatedFile);
        api.updateFile(updatedFile.id, { access: updatedFile.access }).catch((e) => console.error("Failed to update access", e));
      }
      setIsAddingAccess(false);
      setNewAccessVal("");
    }
  };

  const removeAccess = (entry: string) => {
    if (!selectedFile) return;
    const updatedFile = { ...selectedFile, access: selectedFile.access.filter((x) => x !== entry) };
    setFilesList(filesList.map((f) => (f.id === updatedFile.id ? updatedFile : f)));
    setSelectedFile(updatedFile);
    api.updateFile(updatedFile.id, { access: updatedFile.access }).catch((e) => console.error("Failed to update access", e));
  };

  const setFileLink = (patch: { projectId?: number | null; clientId?: string | null }) => {
    if (!selectedFile) return;
    const updatedFile = { ...selectedFile, ...patch };
    setFilesList(filesList.map((f) => (f.id === updatedFile.id ? updatedFile : f)));
    setSelectedFile(updatedFile);
    api.updateFile(updatedFile.id, patch).catch((e) => console.error("Failed to update link", e));
  };

  const isSearching = searchQuery.trim().length > 0;
  let currentFilteredFiles = filesList;
  if (selectedFilterProject !== null) {
    currentFilteredFiles = currentFilteredFiles.filter((f) => f.projectId === selectedFilterProject);
  }
  if (selectedTagFilter !== null) {
    currentFilteredFiles = currentFilteredFiles.filter((f) => f.tags.includes(selectedTagFilter));
  }
  if (statusFilter !== null) {
    currentFilteredFiles = currentFilteredFiles.filter((f) => f.status === statusFilter);
  }
  if (sidebarView === "recent") {
    // filesList is already newest-first (server sorts by ord DESC).
    currentFilteredFiles = currentFilteredFiles.slice(0, 12);
  } else if (sidebarView === "shared") {
    currentFilteredFiles = currentFilteredFiles.filter((f) => f.access.length > 0);
  } else if (!isSearching) {
    // Folders are real containers now — normal browsing only shows what's at
    // the current level. Recent/Shared stay flat by design; a search looks
    // everywhere within the active filters, not just the folder you're in.
    currentFilteredFiles = currentFilteredFiles.filter((f) => (f.parentId ?? null) === currentFolderId);
  }

  const filteredFiles = searchQuery.trim()
    ? aiSearchResults
      ? currentFilteredFiles.filter(
          (f) =>
            aiSearchResults.includes(f.id.toString()) ||
            aiSearchResults.includes(f.name) ||
            f.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : currentFilteredFiles.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : currentFilteredFiles;

  const getFileIcon = (file: VaultFile) => {
    if (file.type === "folder") return <Folder className="w-8 h-8 text-muted" />;
    // Checked by mime first, not just the .mp4 extension case below — a
    // .mov/.webm/etc. upload has the same real mime and deserves the same
    // icon, not the generic fallback.
    if (file.mime?.startsWith("video/")) return <Video className="w-8 h-8 text-muted" />;
    switch (file.extension) {
      case "pdf":
        return <FileText className="w-8 h-8 text-muted" />;
      case "ai":
        return <PenTool className="w-8 h-8 text-muted" />;
      case "fig":
        return <Figma className="w-8 h-8 text-muted" />;
      case "png":
      case "jpg":
        return <ImageIcon className="w-8 h-8 text-muted" />;
      default:
        return <FileText className="w-8 h-8 text-muted" />;
    }
  };

  const PROJECT_DOTS = ["bg-primary", "bg-slate", "bg-amber", "bg-moss"];
  const projectSidebar: { id: number; label: string; dot: string; toast: string }[] = projects.map((p, i) => ({
    id: Number(p.id.replace(/^p/, "")),
    label: p.name,
    dot: PROJECT_DOTS[i % PROJECT_DOTS.length],
    toast: `Moved to ${p.name}`,
  }));

  return (
    <div
      className="flex h-full text-ink bg-panel rounded-2xl overflow-hidden transition-colors relative"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Mobile-only backdrop, dismisses the Vault nav drawer */}
      {mobileNavOpen && (
        <div className="sm:hidden fixed inset-0 bg-ink/30 z-40" onClick={() => setMobileNavOpen(false)} aria-hidden />
      )}

      {/* Sidebar — below sm: a fixed overlay drawer toggled from the top bar; sm+: always visible. */}
      <div
        className={`${
          mobileNavOpen ? "flex fixed inset-y-0 left-0 z-50 shadow-xl" : "hidden"
        } sm:flex sm:static sm:shadow-none w-[200px] flex-col p-4 shrink-0 border-r border-line bg-panel transition-colors overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[13px] font-semibold text-ink">Vault</h3>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="sm:hidden text-muted hover:text-ink transition-colors"
            aria-label="Close Vault navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1 mb-8">
          <button
            onClick={() => {
              setSelectedFilterProject(null);
              setSidebarView("all");
              setMobileNavOpen(false);
            }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
              selectedFilterProject === null && sidebarView === "all" ? "bg-surface text-ink shadow-sm" : "text-ink/60 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Folder className="w-4 h-4" /> All Files
          </button>
          <button
            onClick={() => {
              setSidebarView("recent");
              setMobileNavOpen(false);
            }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[13px] font-medium ${
              sidebarView === "recent" ? "bg-surface text-ink shadow-sm" : "text-ink/60 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <History className="w-4 h-4" /> Recent
          </button>
          <button
            onClick={() => {
              setSidebarView("shared");
              setMobileNavOpen(false);
            }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[13px] font-medium ${
              sidebarView === "shared" ? "bg-surface text-ink shadow-sm" : "text-ink/60 hover:bg-surface/60 hover:text-ink"
            }`}
          >
            <Users className="w-4 h-4" /> Shared
          </button>
        </div>

        <h4 className="text-[12px] text-muted mb-2.5">Projects</h4>
        <div className="flex flex-col gap-1 mb-8">
          {projectSidebar.map((proj) => (
            <button
              key={proj.id}
              onClick={() => {
                setSelectedFilterProject(proj.id);
                setMobileNavOpen(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragHoverProject(proj.id);
              }}
              onDragLeave={() => setDragHoverProject(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragHoverProject(null);
                const raw = e.dataTransfer.getData("sourceIds");
                const ids = raw ? JSON.parse(raw) : [e.dataTransfer.getData("sourceId")].filter(Boolean);
                ids.forEach((id: string) => moveFileToProject(id, proj.id, proj.toast));
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-[13px] ${
                selectedFilterProject === proj.id
                  ? "bg-surface text-ink shadow-sm"
                  : dragHoverProject === proj.id
                  ? "bg-surface/60 text-ink"
                  : "text-ink/60 hover:text-ink"
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${proj.dot}`}></div> <span className="truncate">{proj.label}</span>
            </button>
          ))}
          {projectSidebar.length === 0 && <span className="text-[12px] text-muted px-3">No projects yet</span>}
        </div>

        <h4 className="text-[12px] text-muted mb-2.5">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              onClick={() => setSelectedTagFilter((prev) => (prev === tag.name ? null : tag.name))}
              key={tag.id}
              className={`px-2 py-1 rounded-full text-[11px] cursor-pointer transition-colors ${
                selectedTagFilter === tag.name ? "bg-primary text-white" : "bg-chip text-ink/60 hover:bg-line"
              }`}
            >
              #{tag.name}
            </span>
          ))}
          {tags.length === 0 && <span className="text-[12px] text-muted">No tags yet</span>}
        </div>

        <div className="flex items-center justify-between mb-2.5 mt-8">
          <h4 className="text-[12px] text-muted">Cloud Storage</h4>
          {onOpenConnections && (
            <button onClick={onOpenConnections} className="text-[11px] text-primary hover:underline">
              Manage
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-ink/60">
            <Cloud className="w-4 h-4" /> Google Drive {linkedDrive && <Check className="w-3 h-3 ml-auto text-moss" />}
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-ink/60">
            <Archive className="w-4 h-4" /> Dropbox {linkedDropbox && <Check className="w-3 h-3 ml-auto text-moss" />}
          </div>
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-ink/60">
            <Database className="w-4 h-4" /> OneDrive {linkedOneDrive && <Check className="w-3 h-3 ml-auto text-moss" />}
          </div>
        </div>

        <div className="mt-auto pt-8">
          <h4 className="text-[12px] text-muted mb-2.5">Preferences</h4>
          <button
            onClick={() => onHighContrastChange(!highContrast)}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-ink/60 hover:bg-surface/60 hover:text-ink transition-colors text-[13px] font-medium"
          >
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4" /> High Contrast
            </div>
            <div className={`w-6 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${highContrast ? "bg-primary" : "bg-line"}`}>
              <div className={`w-2 h-2 rounded-full bg-white transition-transform ${highContrast ? "translate-x-3" : "translate-x-0"}`} />
            </div>
          </button>
        </div>
      </div>

      {/* Main File Area */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-paper">
        {/* Top Bar */}
        <div className="min-h-[60px] sm:h-[60px] border-b border-line flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-0 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-[180px]">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="sm:hidden shrink-0 p-2 text-muted hover:text-ink rounded-lg hover:bg-panel transition-colors"
              aria-label="Open Vault navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex flex-col gap-1 flex-1 min-w-0 sm:max-w-sm">
              <div className="relative w-full border border-transparent focus-within:border-primary/50 rounded-full transition-colors bg-panel px-4 py-2 flex items-center gap-2">
                <Search className="w-4 h-4 text-muted" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search files or tags…"
                  className="bg-transparent border-none outline-none text-[13px] w-full text-ink placeholder:text-muted"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {aiConfigured === false && searchQuery.trim() && (
                <span className="px-4 text-[10.5px] text-muted">
                  Keyword matches only — this instance has no Anthropic API key configured for AI-ranked results.
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-panel rounded-lg p-1">
              <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded ${viewMode === "grid" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode("list")} className={`p-1.5 rounded ${viewMode === "list" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                <List className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={createFolder}
              title="New folder"
              className="flex items-center gap-2 bg-panel hover:bg-chip text-ink/70 hover:text-ink transition-colors px-3.5 py-2 rounded-full text-[13px] font-medium"
            >
              <FolderPlus className="w-4 h-4" />
              <span className="hidden md:inline">New Folder</span>
            </button>
            <input type="file" multiple={planLimits?.multiUpload ?? false} ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-primary hover:bg-primary/85 text-white transition-colors px-4 py-2 rounded-full text-[13px] font-medium"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
        </div>

        {uploadQueue.length > 0 && (
          <div className="border-b border-line bg-panel/60 px-4 sm:px-6 py-2.5 flex flex-col gap-1.5 max-h-32 overflow-y-auto shrink-0">
            <div className="flex items-center justify-between text-[11.5px] text-muted">
              <span>
                Uploading {uploadQueue.filter((q) => q.status === "done").length} of {uploadQueue.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {uploadQueue.map((q) => (
                <span
                  key={q.id}
                  className={`text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                    q.status === "done"
                      ? "bg-moss/10 text-moss"
                      : q.status === "error"
                        ? "bg-red-500/10 text-red-500"
                        : q.status === "uploading"
                          ? "bg-primary/10 text-primary"
                          : "bg-chip text-muted"
                  }`}
                >
                  {q.status === "uploading" && <Sparkles className="w-3 h-3 animate-pulse" />}
                  {q.status === "done" && <Check className="w-3 h-3" />}
                  {q.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence>
          {uploadingFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 top-[60px] bg-ink/30 backdrop-blur-sm z-50 flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-surface border border-line rounded-2xl w-full max-w-md p-6 shadow-xl flex flex-col"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-chip flex items-center justify-center">
                      <FileText className="w-5 h-5 text-ink/60" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-ink truncate max-w-[200px]">
                        {uploadingFile.name}
                      </h3>
                      <span className="text-[12px] text-muted">
                        {uploadingFile.size} • {uploadingFile.extension.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setUploadingFile(null)} className="text-muted hover:text-ink transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mb-6 flex flex-col gap-2">
                  <span className="text-[13px] text-muted block">Upload destination</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setUploadDestination("desboard")}
                      className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-[13px] font-medium ${
                        uploadDestination === "desboard" ? "bg-primary/10 text-primary" : "bg-chip text-ink/60 hover:bg-line"
                      }`}
                    >
                      <Upload className="w-4 h-4" /> Desboard
                    </button>
                    {linkedDrive && (
                      <button
                        onClick={() => setUploadDestination("drive")}
                        className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-[13px] font-medium ${
                          uploadDestination === "drive" ? "bg-moss/10 text-moss" : "bg-chip text-ink/60 hover:bg-line"
                        }`}
                      >
                        <Cloud className="w-4 h-4" /> Drive
                      </button>
                    )}
                    {linkedDropbox && (
                      <button
                        onClick={() => setUploadDestination("dropbox")}
                        className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-[13px] font-medium ${
                          uploadDestination === "dropbox" ? "bg-slate/10 text-slate" : "bg-chip text-ink/60 hover:bg-line"
                        }`}
                      >
                        <Archive className="w-4 h-4" /> Dropbox
                      </button>
                    )}
                    {linkedOneDrive && (
                      <button
                        onClick={() => setUploadDestination("onedrive")}
                        className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-[13px] font-medium ${
                          uploadDestination === "onedrive" ? "bg-amber/10 text-amber" : "bg-chip text-ink/60 hover:bg-line"
                        }`}
                      >
                        <Database className="w-4 h-4" /> OneDrive
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] text-muted">
                    Desboard stores the file locally. Drive/Dropbox/OneDrive sync is a future integration.
                  </span>
                </div>

                <div className="flex gap-3 mt-auto">
                  <button
                    onClick={() => setUploadingFile(null)}
                    className="flex-1 py-2.5 rounded-lg bg-chip hover:bg-line text-ink transition-colors text-[13px] font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!uploadDestination}
                    onClick={handleConfirmUpload}
                    className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2 ${
                      !uploadDestination ? "bg-chip text-muted" : "bg-primary text-white hover:bg-primary/85"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" /> Confirm &amp; Upload
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {isComparing && selectedVersionsToCompare.length === 2 && selectedFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 top-[60px] bg-ink z-[60] flex flex-col pt-6 px-6"
            >
              <div className="flex justify-between items-center mb-6 px-4">
                <div>
                  <h3 className="text-[18px] font-semibold text-paper">Compare versions</h3>
                  <p className="text-[12.5px] text-paper/50">{selectedFile.name}</p>
                </div>
                <div className="flex items-center gap-3">
                  {selectedFile.mime?.startsWith("image/") && (
                    <div className="flex bg-paper/10 rounded-full p-1">
                      {(["side-by-side", "slider"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setCompareMode(m)}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-medium capitalize transition-colors ${
                            compareMode === m ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
                          }`}
                        >
                          {m === "side-by-side" ? "Side by side" : "Slider"}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setIsComparing(false)}
                    className="w-10 h-10 rounded-full bg-paper/10 flex items-center justify-center hover:bg-paper/20 transition-colors text-paper/70 hover:text-paper"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {selectedFile.mime?.startsWith("image/") && compareMode === "slider" ? (
                <SliderCompare
                  file={selectedFile}
                  versions={selectedVersionsToCompare}
                  sliderPos={sliderPos}
                  setSliderPos={setSliderPos}
                  restoreVersion={(v) => {
                    restoreVersion(v);
                    setIsComparing(false);
                  }}
                />
              ) : (
                <div className="flex-1 flex gap-6 pb-6 overflow-hidden">
                  {[0, 1].map((side) => {
                    const version = selectedVersionsToCompare[side];
                    const isImage = selectedFile.mime?.startsWith("image/");
                    const failed = compareLoadFailed[side];
                    return (
                      <div key={side} className="flex-1 bg-[#111] border border-white/10 rounded-xl flex flex-col overflow-hidden relative">
                        <div className={`p-4 border-b border-white/10 flex justify-between items-center ${highContrast ? "bg-black" : "bg-black/40"}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-[12px] ${side === 0 ? "bg-[#D85E25]" : "bg-white/20"}`}>
                              {version.slice(0, 2)}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-mono text-[12px] uppercase tracking-widest text-[#EBE6DD]">{version}</span>
                              <span className="text-[10px] text-white/40">
                                {selectedFile.versions.find((v) => v.version === version)?.date} · {selectedFile.versions.find((v) => v.version === version)?.author}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              restoreVersion(version);
                              setIsComparing(false);
                            }}
                            className="text-primary hover:text-primary/80 text-[10px] uppercase tracking-widest font-mono"
                          >
                            Restore This
                          </button>
                        </div>
                        <div className={`flex-1 p-8 flex items-center justify-center relative ${highContrast ? "bg-black" : "bg-[#050505]"} overflow-y-auto`}>
                          {isImage && !failed ? (
                            <img
                              src={`/api/files/${selectedFile.id}/version/${encodeURIComponent(version)}/download`}
                              alt={`${selectedFile.name} — ${version}`}
                              className="max-w-full max-h-full object-contain rounded shadow-2xl bg-white"
                              onError={() => setCompareLoadFailed((prev) => ({ ...prev, [side]: true }))}
                            />
                          ) : (
                            <div className="text-center max-w-xs">
                              <p className="text-[13px] text-paper/60 mb-3">
                                {isImage
                                  ? "No stored content for this version — it predates real uploads."
                                  : "No inline preview for this file type. Download each version to compare its contents directly."}
                              </p>
                              {/* An image that already failed to load is confirmed to have no stored
                                  bytes — offering a download for it would just 404. */}
                              {!(isImage && failed) && (
                                <a
                                  href={`/api/files/${selectedFile.id}/version/${encodeURIComponent(version)}/download`}
                                  className="inline-block text-[11px] font-medium text-primary hover:text-primary/80 bg-primary/10 px-3 py-1.5 rounded-full"
                                >
                                  Download {version}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Files */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {dragActive && (
            <div className="absolute inset-0 bg-primary/[0.06] border-2 border-dashed border-primary z-10 rounded-lg flex items-center justify-center backdrop-blur-sm m-4">
              <div className="flex flex-col items-center gap-4">
                <Upload className="w-12 h-12 text-primary" />
                <span className="text-[20px] font-semibold text-primary">Drop files to upload</span>
              </div>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between relative">
            {selectedIds.size > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-medium text-ink pr-1">
                  {selectedIds.size} selected
                </span>
                <button onClick={bulkAddTag} className="flex items-center gap-1.5 text-[12px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-3 py-1.5 rounded-full transition-colors">
                  <TagIcon className="w-3.5 h-3.5" /> Add tag
                </button>
                <div className="relative">
                  <button onClick={() => setShowMoveMenu((v) => !v)} className="flex items-center gap-1.5 text-[12px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-3 py-1.5 rounded-full transition-colors">
                    <FolderInput className="w-3.5 h-3.5" /> Move to project
                  </button>
                  {showMoveMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowMoveMenu(false)} />
                      <div className="absolute left-0 top-9 z-20 bg-surface border border-line rounded-xl shadow-lg p-2 flex flex-col gap-0.5 min-w-[200px] max-h-64 overflow-y-auto">
                        {projects.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => bulkMoveToProject(p.id)}
                            className="text-left px-3 py-1.5 rounded-lg text-[12.5px] text-ink/70 hover:bg-chip hover:text-ink transition-colors truncate"
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={bulkDownload} className="flex items-center gap-1.5 text-[12px] text-ink/70 hover:text-ink bg-chip hover:bg-line px-3 py-1.5 rounded-full transition-colors">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button onClick={bulkDelete} className="flex items-center gap-1.5 text-[12px] text-red-500 hover:text-white hover:bg-red-500 bg-red-500/10 px-3 py-1.5 rounded-full transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
                <button onClick={clearSelection} className="text-[12px] text-muted hover:text-ink px-2 py-1.5">
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-muted flex-wrap">
                <button
                  onClick={() => goToBreadcrumb(-1)}
                  className={`hover:text-ink transition-colors ${folderPath.length === 0 ? "text-ink/70" : "cursor-pointer"}`}
                >
                  All Files
                </button>
                {folderPath.map((seg, i) => (
                  <span key={seg.id} className="flex items-center gap-2">
                    <ChevronRight className="w-3 h-3" />
                    <button
                      onClick={() => goToBreadcrumb(i)}
                      className={`hover:text-ink transition-colors truncate max-w-[160px] ${i === folderPath.length - 1 ? "text-ink/70" : "cursor-pointer"}`}
                    >
                      {seg.name}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowFilterMenu((v) => !v)}
              className={`flex items-center gap-2 text-[12.5px] transition-colors shrink-0 ${statusFilter ? "text-primary font-medium" : "text-muted hover:text-ink"}`}
            >
              <Filter className="w-3.5 h-3.5" /> {statusFilter ? `Status: ${statusFilter}` : "Filter"}
            </button>
            {showFilterMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
                <div className="absolute right-0 top-7 z-20 bg-surface border border-line rounded-xl shadow-lg p-2 flex flex-col gap-0.5 min-w-[150px]">
                  {(["Draft", "Review", "Approved", "Delivered"] as FileStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setStatusFilter((prev) => (prev === s ? null : s));
                        setShowFilterMenu(false);
                      }}
                      className={`text-left px-3 py-1.5 rounded-lg text-[12.5px] transition-colors ${
                        statusFilter === s ? "bg-primary/10 text-primary font-medium" : "text-ink/70 hover:bg-chip"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {statusFilter && (
                    <button
                      onClick={() => {
                        setStatusFilter(null);
                        setShowFilterMenu(false);
                      }}
                      className="text-left px-3 py-1.5 rounded-lg text-[12.5px] text-muted hover:text-ink border-t border-line mt-1 pt-2"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {filteredFiles.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-line rounded-2xl">
              {filesList.length === 0 ? (
                <>
                  <p className="text-[13px] text-ink/70 mb-1">No files yet</p>
                  <p className="text-[12.5px] text-muted">Upload one to get started.</p>
                </>
              ) : isSearching ? (
                <p className="text-[13px] text-ink/70">No files match "{searchQuery.trim()}".</p>
              ) : (
                <p className="text-[13px] text-ink/70">No files here.</p>
              )}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={(e) => handleFileDragStart(e, file)}
                  onDragOver={(e) => {
                    if (file.type === "folder") e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (file.type === "folder") handleFileDropOnFolder(e, file);
                  }}
                  onClick={() => handleFileCardClick(file)}
                  className={`relative rounded-xl p-4 cursor-pointer transition-all flex flex-col group ${
                    selectedIds.has(file.id)
                      ? "bg-primary/[0.06] shadow-sm ring-1 ring-primary/50"
                      : selectedFile?.id === file.id
                        ? "bg-surface shadow-sm ring-1 ring-primary/40"
                        : "bg-surface hover:bg-chip"
                  }`}
                >
                  <button
                    onClick={(e) => toggleSelect(file.id, e)}
                    className={`absolute top-2.5 left-2.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all z-10 ${
                      selectedIds.has(file.id)
                        ? "bg-primary border-primary opacity-100"
                        : "bg-surface/90 border-line opacity-0 group-hover:opacity-100"
                    }`}
                    aria-label={selectedIds.has(file.id) ? "Deselect" : "Select"}
                  >
                    {selectedIds.has(file.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                  <div className="flex justify-between items-start mb-4">
                    {previewableKind(file) === "image" ? (
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-chip">
                        <img src={contentUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="p-3 bg-chip rounded-lg">{getFileIcon(file)}</div>
                    )}
                    <button className="p-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-ink">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <h5 className="font-medium text-[13.5px] text-ink truncate mb-1" title={file.name}>
                    {file.name}
                  </h5>
                  <div className="flex items-center justify-between mt-auto pt-4 relative">
                    <span className="text-[11.5px] text-muted truncate">{file.size || "Folder"}</span>
                    <span
                      className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${
                        file.status === "Approved"
                          ? "bg-moss/10 text-moss"
                          : file.status === "Review"
                          ? "bg-amber/10 text-amber"
                          : "bg-chip text-muted"
                      }`}
                    >
                      {file.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[auto,1fr,auto] sm:grid-cols-[auto,repeat(12,minmax(0,1fr))] gap-4 px-4 py-2 border-b border-line text-[11.5px] text-muted mb-2">
                <div className="w-5" />
                <div className="sm:col-span-5">Name</div>
                <div className="hidden sm:block sm:col-span-2">Date Modified</div>
                <div className="hidden sm:block sm:col-span-1">Size</div>
                <div className="sm:col-span-2">Status</div>
                <div className="hidden sm:block sm:col-span-2">Owner</div>
              </div>
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={(e) => handleFileDragStart(e, file)}
                  onDragOver={(e) => {
                    if (file.type === "folder") e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (file.type === "folder") handleFileDropOnFolder(e, file);
                  }}
                  onClick={() => handleFileCardClick(file)}
                  className={`group grid grid-cols-[auto,1fr,auto] sm:grid-cols-[auto,repeat(12,minmax(0,1fr))] gap-4 px-4 py-3 items-center rounded-lg cursor-pointer transition-colors ${
                    selectedIds.has(file.id)
                      ? "bg-primary/[0.06] ring-1 ring-primary/50"
                      : selectedFile?.id === file.id
                        ? "bg-surface shadow-sm ring-1 ring-primary/40"
                        : "hover:bg-surface/70"
                  }`}
                >
                  <button
                    onClick={(e) => toggleSelect(file.id, e)}
                    className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                      selectedIds.has(file.id)
                        ? "bg-primary border-primary opacity-100"
                        : "bg-surface/90 border-line opacity-0 group-hover:opacity-100"
                    }`}
                    aria-label={selectedIds.has(file.id) ? "Deselect" : "Select"}
                  >
                    {selectedIds.has(file.id) && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                  <div className="sm:col-span-5 flex items-center gap-3 min-w-0 truncate">
                    {getFileIcon(file)}
                    <span className="text-[13.5px] text-ink truncate">{file.name}</span>
                  </div>
                  <div className="hidden sm:block sm:col-span-2 text-[12px] text-muted">{file.created}</div>
                  <div className="hidden sm:block sm:col-span-1 text-[12px] text-muted">{file.size || "--"}</div>
                  <div className="sm:col-span-2">
                    <span
                      className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${
                        file.status === "Approved"
                          ? "bg-moss/10 text-moss"
                          : file.status === "Review"
                          ? "bg-amber/10 text-amber"
                          : "bg-chip text-muted"
                      }`}
                    >
                      {file.status}
                    </span>
                  </div>
                  <div className="hidden sm:flex sm:col-span-2 items-center gap-2 text-[12px] text-ink/70">
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[10px] text-white uppercase">{file.owner.charAt(0)}</div>
                    <span className="truncate">{file.owner}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar (Inspector) — full-screen overlay below sm (there's no room for a
          third column on a phone), a static 280px panel from sm up. Its own X button
          above already clears selectedFile, so no separate mobile close path is needed. */}
      {selectedFile && (
        <div
          className={`fixed inset-0 z-40 sm:static sm:inset-auto sm:z-auto w-full sm:w-[280px] flex flex-col shrink-0 bg-paper ${highContrast ? "border-l-2 border-ink" : ""}`}
        >
          <div className="h-[60px] border-b border-line flex items-center justify-between px-4">
            <h4 className="text-[14px] font-semibold text-ink">Inspector</h4>
            <div className="flex gap-2">
              <a
                href={`/api/files/${selectedFile.id}/download`}
                download={selectedFile.name}
                title={selectedFile.hasContent ? `Download ${selectedFile.name}` : "No stored content — downloads a delivery note"}
                className="p-1.5 text-muted hover:text-ink rounded bg-panel"
              >
                <Download className="w-4 h-4" />
              </a>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setSelectedVersionsToCompare([]);
                  setIsComparing(false);
                }}
                className="p-1.5 text-muted hover:text-primary rounded bg-panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div
              className={`aspect-video bg-panel flex items-center justify-center relative group overflow-hidden ${
                selectedFile.type === "file" ? "cursor-pointer" : ""
              }`}
              onClick={() => selectedFile.type === "file" && setPreviewingFile(selectedFile)}
              title={selectedFile.type === "file" ? "Click to open full preview" : undefined}
            >
              {previewableKind(selectedFile) === "image" ? (
                <img src={contentUrl(selectedFile)} alt={selectedFile.name} className="w-full h-full object-cover" />
              ) : previewableKind(selectedFile) === "pdf" ? (
                <iframe src={contentUrl(selectedFile)} title={selectedFile.name} className="w-full h-full border-0 pointer-events-none bg-white" />
              ) : previewableKind(selectedFile) === "video" ? (
                <video src={contentUrl(selectedFile)} className="w-full h-full object-cover pointer-events-none" muted />
              ) : (
                getFileIcon(selectedFile)
              )}
              {selectedFile.type === "file" && (
                <>
                  <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/60 transition-colors flex items-center justify-center pointer-events-none">
                    <span className="flex items-center gap-2 bg-primary px-4 py-2 rounded-full text-[12.5px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <Eye className="w-4 h-4" /> Open full preview
                    </span>
                  </div>
                  <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreviewNewWindow(selectedFile, e);
                      }}
                      title="Open in new window"
                      className="p-1.5 bg-ink/60 hover:bg-ink/80 rounded-full text-white transition-colors"
                    >
                      <Maximize className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShareLink(selectedFile, e);
                      }}
                      title="Copy share link"
                      className="p-1.5 bg-ink/60 hover:bg-ink/80 rounded-full text-white transition-colors"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="p-5">
              <h3 className="text-[16px] font-semibold text-ink leading-tight mb-2 break-all">{selectedFile.name}</h3>
              <div className="flex gap-2 flex-wrap mb-6 items-center">
                {selectedFile.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-full bg-panel text-[11px] text-ink/60">
                    #{t}
                  </span>
                ))}
                {isAddingTag ? (
                  <div className="flex items-center gap-1 bg-panel px-2 py-0.5 rounded-full">
                    <span className="text-[11px] text-muted">#</span>
                    <input
                      autoFocus
                      value={newTagVal}
                      onChange={(e) => setNewTagVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTag();
                        if (e.key === "Escape") {
                          setIsAddingTag(false);
                          setNewTagVal("");
                        }
                      }}
                      className="bg-transparent border-none outline-none text-[11px] text-ink w-16"
                    />
                    <button onClick={handleAddTag} className="text-primary hover:text-ink ml-1">
                      <CheckCircle className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsAddingTag(true)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-panel text-[11px] text-primary transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add tag
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b border-line mb-6 text-[12.5px] overflow-x-auto">
                <button
                  onClick={() => setActiveTab("details")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "details" ? "border-primary text-primary font-medium" : "border-transparent text-muted hover:text-ink"}`}
                >
                  Details
                </button>
                <button
                  onClick={() => setActiveTab("versions")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "versions" ? "border-primary text-primary font-medium" : "border-transparent text-muted hover:text-ink"}`}
                >
                  History
                </button>
                <button
                  onClick={() => setActiveTab("links")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "links" ? "border-primary text-primary font-medium" : "border-transparent text-muted hover:text-ink"}`}
                >
                  Links
                </button>
              </div>

              {activeTab === "details" && (
                <div className="flex flex-col gap-4 text-[13px]">
                  <div>
                    <span className="text-muted text-[12px] block mb-1">Status</span>
                    <div className="p-2 bg-panel rounded-lg flex justify-between items-center cursor-pointer text-ink">
                      {selectedFile.status} <ArrowRight className="w-3 h-3 text-muted rotate-90" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-muted text-[12px] block mb-1">Size</span>
                      <span className="text-ink/80">{selectedFile.size || "--"}</span>
                    </div>
                    <div>
                      <span className="text-muted text-[12px] block mb-1">Type</span>
                      <span className="text-ink/80 uppercase">{selectedFile.extension || "Folder"}</span>
                    </div>
                    <div>
                      <span className="text-muted text-[12px] block mb-1">Created</span>
                      <span className="text-ink/80">{selectedFile.created}</span>
                    </div>
                    <div>
                      <span className="text-muted text-[12px] block mb-1">Owner</span>
                      <span className="text-ink/80">{selectedFile.owner}</span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted text-[12px] block mb-1">Access Control</span>
                    <p className="text-muted text-[11px] leading-snug mb-2">
                      {selectedFile.access.some((a) => a.startsWith("Client"))
                        ? "Visible on this file's delivery links. Remove the Client tag to pull it from every portal it's in, immediately."
                        : "Team-only — invisible on any delivery link. Added to a handover automatically tags it Client (Read-only)."}
                    </p>
                    <div className="flex flex-col gap-2">
                      {selectedFile.access.map((a) => (
                        <div key={a} className="flex items-center justify-between text-[12.5px] text-ink/80 bg-panel px-2 py-1.5 rounded-lg">
                          <span className="flex items-center gap-1.5">
                            {a.startsWith("Client") && <span className="w-1.5 h-1.5 rounded-full bg-moss shrink-0" title="Client-visible" />}
                            {a}
                          </span>
                          <button onClick={() => removeAccess(a)} className="text-muted hover:text-ink">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {isAddingAccess ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={newAccessVal}
                            onChange={(e) => setNewAccessVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddAccess();
                              if (e.key === "Escape") {
                                setIsAddingAccess(false);
                                setNewAccessVal("");
                              }
                            }}
                            placeholder="Name or email"
                            className="flex-1 bg-paper border border-line rounded-lg px-2 py-1 text-[12px] text-ink outline-none focus:border-primary/50"
                          />
                          <button onClick={handleAddAccess} className="text-primary text-[12px] hover:underline shrink-0">
                            Add
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setIsAddingAccess(true)} className="text-left text-primary text-[12px] hover:underline">
                          + Invite
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "versions" && (
                <div className="flex flex-col gap-4">
                  {selectedFile.versions.length === 0 ? (
                    <p className="text-[12.5px] text-muted">No version history available.</p>
                  ) : (
                    <div className="flex flex-col relative before:absolute before:left-[11px] before:top-2 before:bottom-0 before:w-px before:bg-line">
                      <div className="flex justify-between items-center mb-4 relative z-10">
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-panel text-ink/70 hover:bg-chip hover:text-ink cursor-pointer transition-all">
                          <Upload className="w-3 h-3" /> New Version
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleVersionUpload(f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <button
                          onClick={() => {
                            setCompareMode("side-by-side");
                            setSliderPos(50);
                            setCompareLoadFailed({});
                            setIsComparing(true);
                          }}
                          disabled={selectedVersionsToCompare.length !== 2}
                          className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                            selectedVersionsToCompare.length === 2 ? "bg-primary text-white hover:bg-primary/85" : "bg-panel text-muted cursor-not-allowed"
                          }`}
                        >
                          Compare Selected
                        </button>
                      </div>
                      {selectedFile.versions.map((ver, idx) => (
                        <div key={idx} className="flex gap-4 relative mb-6 last:mb-0">
                          <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border-4 border-paper relative z-10 ${ver.latest ? "bg-primary" : "bg-line"}`}>
                            {ver.latest && <CheckCircle className="w-3 h-3 text-white" />}
                          </div>
                          <div className="pt-1 w-full">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13.5px] font-medium text-ink leading-none">{ver.version}</span>
                                {ver.latest && <span className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Latest</span>}
                              </div>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="w-3 h-3 accent-primary rounded cursor-pointer"
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      if (selectedVersionsToCompare.length < 2) setSelectedVersionsToCompare([...selectedVersionsToCompare, ver.version]);
                                    } else {
                                      setSelectedVersionsToCompare(selectedVersionsToCompare.filter((v) => v !== ver.version));
                                    }
                                  }}
                                  checked={selectedVersionsToCompare.includes(ver.version)}
                                  disabled={!selectedVersionsToCompare.includes(ver.version) && selectedVersionsToCompare.length >= 2}
                                />
                                <span className="text-[11px] text-muted select-none">Compare</span>
                              </label>
                            </div>
                            <p className="text-[12px] text-muted mb-2">
                              {ver.date} • {ver.author}
                            </p>
                            {!ver.latest && (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => restoreVersion(ver.version)}
                                  className="text-[11px] font-medium text-ink/70 hover:text-ink bg-panel px-2 py-1 rounded-full"
                                >
                                  Restore
                                </button>
                                <a
                                  href={`/api/files/${selectedFile.id}/version/${encodeURIComponent(ver.version)}/download`}
                                  className="text-[11px] font-medium text-ink/70 hover:text-ink bg-panel px-2 py-1 rounded-full"
                                >
                                  Download
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "links" && (
                <div className="flex flex-col gap-5 text-[13px]">
                  <div>
                    <span className="flex items-center gap-1.5 text-muted text-[12px] mb-2">
                      <Folder className="w-3 h-3" /> Linked Project
                    </span>
                    {editingLink === "project" ? (
                      <select
                        autoFocus
                        defaultValue={selectedFile.projectId ?? ""}
                        onChange={(e) => {
                          setFileLink({ projectId: e.target.value ? Number(e.target.value) : null });
                          setEditingLink(null);
                        }}
                        onBlur={() => setEditingLink(null)}
                        className="w-full p-2.5 bg-panel rounded-lg text-ink outline-none border border-primary/40"
                      >
                        <option value="">-- None --</option>
                        {projects.map((p) => (
                          <option key={p.id} value={Number(p.id.replace(/^p/, ""))}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-2.5 bg-panel rounded-lg flex items-center justify-between text-ink">
                        <span>
                          {selectedFile.projectId
                            ? projects.find((p) => Number(p.id.replace(/^p/, "")) === selectedFile.projectId)?.name ??
                              `Project #${selectedFile.projectId}`
                            : "--"}
                        </span>
                        <button onClick={() => setEditingLink("project")} className="text-muted hover:text-ink">
                          <LinkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 text-muted text-[12px] mb-2">
                      <Users className="w-3 h-3" /> Linked Client
                    </span>
                    {editingLink === "client" ? (
                      <input
                        autoFocus
                        type="text"
                        defaultValue={selectedFile.clientId ?? ""}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingLink(null);
                        }}
                        onBlur={(e) => {
                          setFileLink({ clientId: e.target.value.trim() || null });
                          setEditingLink(null);
                        }}
                        placeholder="Client name"
                        className="w-full p-2.5 bg-panel rounded-lg text-ink outline-none border border-primary/40"
                      />
                    ) : (
                      <div className="p-2.5 bg-panel rounded-lg flex items-center justify-between text-ink">
                        <span>{selectedFile.clientId || "--"}</span>
                        <button onClick={() => setEditingLink("client")} className="text-muted hover:text-ink">
                          <LinkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {previewingFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink z-[60] flex flex-col p-8 rounded-xl overflow-hidden"
          >
            <div className="flex justify-between items-center mb-8 shrink-0">
              <div className="flex items-center gap-4 text-paper">
                {getFileIcon(previewingFile)}
                <div>
                  <h2 className="text-paper text-[22px] font-semibold leading-none mb-1">{previewingFile.name}</h2>
                  <span className="text-paper/50 text-[12px]">
                    {previewingFile.size || "--"} • {previewingFile.extension?.toUpperCase() || "FILE"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => handlePreviewNewWindow(previewingFile, e)}
                  className="px-4 py-2 bg-paper/10 hover:bg-paper/20 text-paper rounded-full text-[12.5px] font-medium transition-colors flex items-center gap-2"
                >
                  <Maximize className="w-3.5 h-3.5" /> Open Native Window
                </button>
                <button
                  onClick={(e) => handleShareLink(previewingFile, e)}
                  className="px-4 py-2 bg-paper/10 hover:bg-paper/20 text-paper rounded-full text-[12.5px] font-medium transition-colors flex items-center gap-2"
                >
                  <LinkIcon className="w-3.5 h-3.5" /> Copy Link
                </button>
                <button
                  onClick={() => setPreviewingFile(null)}
                  className="w-10 h-10 bg-paper/10 hover:bg-paper/20 text-paper/70 hover:text-paper rounded-full flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/25 rounded-2xl flex items-center justify-center overflow-hidden relative">
              {previewableKind(previewingFile) === "image" ? (
                <img src={contentUrl(previewingFile)} alt={previewingFile.name} className="max-w-full max-h-full object-contain" />
              ) : previewableKind(previewingFile) === "pdf" ? (
                <iframe src={contentUrl(previewingFile)} title={previewingFile.name} className="w-full h-full border-0 bg-white" />
              ) : previewableKind(previewingFile) === "video" ? (
                <video src={contentUrl(previewingFile)} controls className="max-w-full max-h-full">
                  <track kind="captions" />
                </video>
              ) : previewingFile.extension === "fig" ? (
                <div className="text-center">
                  <Figma className="w-16 h-16 text-paper/40 mx-auto mb-4" />
                  <p className="text-paper/40 text-[13px]">Figma Preview Embedded Here</p>
                </div>
              ) : previewingFile.extension === "pdf" ? (
                <div className="text-center">
                  <FileText className="w-16 h-16 text-paper/40 mx-auto mb-4" />
                  <p className="text-paper/40 text-[13px]">No stored content — upload a version to preview</p>
                </div>
              ) : (
                <div className="text-center">
                  <Eye className="w-16 h-16 text-paper/25 mx-auto mb-4" />
                  <p className="text-paper/40 text-[13px]">
                    {previewingFile.hasContent ? `${(previewingFile.extension || "FILE").toUpperCase()} has no in-browser preview` : "No stored content to preview"}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
