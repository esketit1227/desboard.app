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
  Figma,
  PenTool,
  CheckCircle,
  Sparkles,
  Image as ImageIcon,
  Maximize,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { VaultFile, ChatMessage } from "../../types";
import { api } from "../../lib/api";

/**
 * File Vault window — grid/list browser, AI upload tagging, AI semantic search,
 * drag-and-drop into projects, a file inspector (details / history / links / AI),
 * version comparison, and file preview. Data is loaded from and persisted to the
 * SQLite-backed API so it survives a refresh.
 */
export function FileVaultApp({
  showToast,
  initialFileId = null,
}: {
  showToast: (msg: string) => void;
  /** Open with this file pre-selected in the inspector (e.g. from an assistant citation). */
  initialFileId?: string | null;
}) {
  const [filesList, setFilesList] = useState<VaultFile[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "versions" | "links" | "ai">("details");
  const [searchQuery, setSearchQuery] = useState("");

  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatResponses, setAiChatResponses] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSearchingAI, setIsSearchingAI] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<string[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagVal, setNewTagVal] = useState("");
  const [highContrast, setHighContrast] = useState(false);
  const [linkedDrive, setLinkedDrive] = useState(false);
  const [linkedDropbox, setLinkedDropbox] = useState(false);
  const [uploadDestination, setUploadDestination] = useState<"drive" | "dropbox" | "desboard">("desboard");
  const [previewingFile, setPreviewingFile] = useState<VaultFile | null>(null);
  const [selectedFilterProject, setSelectedFilterProject] = useState<number | null>(null);
  const [dragHoverProject, setDragHoverProject] = useState<number | null>(null);

  // Upload & AI tagging state
  const [uploadingFile, setUploadingFile] = useState<{ name: string; size: string; extension: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Version comparison state
  const [selectedVersionsToCompare, setSelectedVersionsToCompare] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);

  // Load files from the SQLite-backed API so they survive a refresh.
  useEffect(() => {
    api.getFiles().then(setFilesList).catch((e) => console.error("Failed to load files", e));
  }, []);

  // Deep-open a specific file (assistant citation chips) once files are loaded.
  useEffect(() => {
    if (!initialFileId) return;
    const f = filesList.find((x) => x.id === initialFileId);
    if (f) {
      setSelectedFile(f);
      setActiveTab("details");
    }
  }, [initialFileId, filesList]);

  // Debounced AI semantic search (falls back to keyword matching server-side).
  useEffect(() => {
    if (!searchQuery.trim()) {
      setAiSearchResults(null);
      setIsSearchingAI(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setIsSearchingAI(true);
      try {
        const matchedIds = await api.search(searchQuery, filesList);
        if (Array.isArray(matchedIds)) setAiSearchResults(matchedIds);
      } catch (e) {
        console.error("Failed semantic search", e);
      } finally {
        setIsSearchingAI(false);
      }
    }, 600);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, filesList]);

  // Persist a file move to another vault project and update local state.
  const moveFileToProject = (sourceId: string, projectId: number, toastMsg: string) => {
    setFilesList((prev) => prev.map((f) => (f.id === sourceId ? { ...f, projectId } : f)));
    api.updateFile(sourceId, { projectId }).catch((e) => console.error("Failed to move file", e));
    showToast(toastMsg);
  };

  const handlePreviewNewWindow = (file: VaultFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const dummyHtml = `
      <html>
        <head>
           <title>Preview - ${file.name}</title>
           <style>
             body { background: #050505; color: #EBE6DD; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; }
             .box { border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 12px; background: rgba(255,255,255,0.02); text-align: center; }
           </style>
        </head>
        <body>
           <div class="box">
              <h2 style="margin-bottom: 8px;">${file.name}</h2>
              <p style="opacity: 0.5; font-size: 12px;">Desboard File Viewer</p>
           </div>
        </body>
      </html>
    `;
    const blob = new Blob([dummyHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
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

    setUploadingFile({
      name: file.name,
      size: (file.size / 1024 / 1024).toFixed(1) + " MB",
      extension,
    });
    setIsAnalyzing(true);
    setSuggestedTags([]);
    setUploadSummary(null);
    setSelectedSuggestions([]);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const b64 = result.split(",")[1] || result;
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const fileContent = await base64Promise;
      const mimeType = file.type || "text/plain";
      const data = await api.analyze(file.name, fileContent, mimeType);

      if (data.tags && Array.isArray(data.tags)) {
        setSuggestedTags(data.tags.slice(0, 5));
        setSelectedSuggestions(data.tags.slice(0, 1));
        if (data.summary) setUploadSummary(data.summary);
      } else {
        throw new Error("Invalid format");
      }
    } catch (err) {
      // Graceful fallback if AI is unavailable — suggest a couple of basic tags.
      console.error(err);
      const baseTags = ["Q3 Review", "Draft", "V1", "Asset", "Document", "Design", "Raw"];
      const extTag = extension.toUpperCase();
      const random1 = baseTags[Math.floor(Math.random() * baseTags.length)];
      setSuggestedTags([extTag, random1]);
      setSelectedSuggestions([extTag]);
    }

    setIsAnalyzing(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUploadEvent(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFileUploadEvent(e.target.files[0]);
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
      source: "Direct Upload",
      status: "Draft",
      owner: "Current User",
      tags: selectedSuggestions,
      access: ["Team"],
      versions: [],
      projectId: selectedFilterProject,
      clientId: null,
    };

    setFilesList([newFile, ...filesList]);
    setUploadingFile(null);
    try {
      await api.createFile(newFile);
    } catch (e) {
      console.error("Failed to persist uploaded file", e);
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

  const sendFileChat = async (prompt: string) => {
    if (!selectedFile) return;
    setAiChatInput("");
    setAiChatResponses((prev) => [...prev, { role: "user", text: prompt }]);
    setIsAiLoading(true);
    try {
      const text = await api.chat(prompt, selectedFile);
      setAiChatResponses((prev) => [...prev, { role: "ai", text }]);
    } catch {
      setAiChatResponses((prev) => [...prev, { role: "ai", text: "Error connecting to AI." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  let currentFilteredFiles = filesList;
  if (selectedFilterProject !== null) {
    currentFilteredFiles = currentFilteredFiles.filter((f) => f.projectId === selectedFilterProject);
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
    if (file.type === "folder") return <Folder className="w-8 h-8 text-yellow-500" />;
    switch (file.extension) {
      case "pdf":
        return <FileText className="w-8 h-8 text-red-500" />;
      case "ai":
        return <PenTool className="w-8 h-8 text-orange-500" />;
      case "fig":
        return <Figma className="w-8 h-8 text-purple-500" />;
      case "mp4":
        return <Video className="w-8 h-8 text-blue-500" />;
      case "png":
      case "jpg":
        return <ImageIcon className="w-8 h-8 text-green-500" />;
      default:
        return <FileText className="w-8 h-8 text-gray-400" />;
    }
  };

  const projectSidebar: { id: number; label: string; dot: string; toast: string }[] = [
    { id: 1, label: "Nebula", dot: "bg-[#D85E25]", toast: "Moved to Nebula project" },
    { id: 2, label: "Acme Corp", dot: "bg-blue-500", toast: "Moved to Acme Corp project" },
    { id: 3, label: "GlobalNet", dot: "bg-purple-500", toast: "Moved to GlobalNet project" },
  ];

  return (
    <div
      className={`flex h-full text-[#EBE6DD] ${highContrast ? "bg-black" : "bg-[#050505]/40"} rounded-xl overflow-hidden transition-colors`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      <div
        className={`w-[200px] border-r ${highContrast ? "border-white/20 bg-black" : "border-white/10 bg-black/20"} flex flex-col p-4 shrink-0 transition-colors`}
      >
        <h3 className="font-display text-[16px] uppercase tracking-wider mb-6">Vault</h3>

        <div className="flex flex-col gap-1 mb-8">
          <button
            onClick={() => setSelectedFilterProject(null)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] uppercase tracking-widest font-medium ${
              selectedFilterProject === null ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white transition-colors"
            }`}
          >
            <Folder className="w-4 h-4" /> All Files
          </button>
          <button
            onClick={() => showToast("Recent files view coming soon")}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/50 hover:bg-white/5 hover:text-white transition-colors text-[11px] uppercase tracking-widest font-medium"
          >
            <History className="w-4 h-4" /> Recent
          </button>
          <button
            onClick={() => showToast("Shared files view coming soon")}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/50 hover:bg-white/5 hover:text-white transition-colors text-[11px] uppercase tracking-widest font-medium"
          >
            <Users className="w-4 h-4" /> Shared
          </button>
        </div>

        <h4 className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 mb-3">Projects</h4>
        <div className="flex flex-col gap-1 mb-8">
          {projectSidebar.map((proj) => (
            <button
              key={proj.id}
              onClick={() => setSelectedFilterProject(proj.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragHoverProject(proj.id);
              }}
              onDragLeave={() => setDragHoverProject(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragHoverProject(null);
                const sourceId = e.dataTransfer.getData("sourceId");
                if (sourceId) moveFileToProject(sourceId, proj.id, proj.toast);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-[11px] tracking-wide ${
                selectedFilterProject === proj.id
                  ? "bg-white/10 text-white"
                  : dragHoverProject === proj.id
                  ? "bg-white/5 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${proj.dot}`}></div> {proj.label}
            </button>
          ))}
        </div>

        <h4 className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 mb-3">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {["UI", "Brand", "Concept", "Final"].map((tag) => (
            <span
              onClick={() => showToast("Filtered by tag: " + tag)}
              key={tag}
              className="px-2 py-1 rounded bg-white/5 text-[9px] uppercase tracking-widest text-white/60 cursor-pointer hover:bg-white/10"
            >
              #{tag}
            </span>
          ))}
        </div>

        <h4 className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 mb-3 mt-8">Cloud Storage</h4>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              setLinkedDrive(!linkedDrive);
              showToast(linkedDrive ? "Google Drive unlinked" : "Google Drive linked");
            }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[11px] uppercase tracking-widest font-medium ${
              linkedDrive ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Cloud className="w-4 h-4" /> Google Drive {linkedDrive && <Check className="w-3 h-3 ml-auto text-green-400" />}
          </button>
          <button
            onClick={() => {
              setLinkedDropbox(!linkedDropbox);
              showToast(linkedDropbox ? "Dropbox unlinked" : "Dropbox linked");
            }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-[11px] uppercase tracking-widest font-medium ${
              linkedDropbox ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Archive className="w-4 h-4" /> Dropbox {linkedDropbox && <Check className="w-3 h-3 ml-auto text-green-400" />}
          </button>
        </div>

        <div className="mt-auto pt-8">
          <h4 className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 mb-3">Preferences</h4>
          <button
            onClick={() => setHighContrast(!highContrast)}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-white/50 hover:bg-white/5 hover:text-white transition-colors text-[11px] uppercase tracking-widest font-medium"
          >
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4" /> High Contrast
            </div>
            <div className={`w-6 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${highContrast ? "bg-[#D85E25]" : "bg-white/20"}`}>
              <div className={`w-2 h-2 rounded-full bg-white transition-transform ${highContrast ? "translate-x-3" : "translate-x-0"}`} />
            </div>
          </button>
        </div>
      </div>

      {/* Main File Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top Bar */}
        <div className="h-[60px] border-b border-white/10 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-sm border border-transparent focus-within:border-[#D85E25] rounded-full transition-colors bg-white/5 px-4 py-2 flex items-center gap-2">
              {isSearchingAI ? (
                <Sparkles className="w-4 h-4 text-[#D85E25] animate-pulse" />
              ) : (
                <Search className="w-4 h-4 text-white/40" />
              )}
              <input
                type="text"
                placeholder="Search files, tags, or use phrases like 'show branding'..."
                className="bg-transparent border-none outline-none text-[12px] w-full text-white placeholder:text-white/40 font-mono"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/5">
              <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded ${viewMode === "grid" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode("list")} className={`p-1.5 rounded ${viewMode === "list" ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>
                <List className="w-4 h-4" />
              </button>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-[#D85E25] hover:bg-[#D85E25]/80 transition-colors px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium"
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
          </div>
        </div>

        <AnimatePresence>
          {uploadingFile && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 top-[60px] bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white/60" />
                    </div>
                    <div>
                      <h3 className="font-display text-[16px] uppercase tracking-wider text-white truncate max-w-[200px]">
                        {uploadingFile.name}
                      </h3>
                      <span className="text-[10px] font-mono text-white/40">
                        {uploadingFile.size} • {uploadingFile.extension.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setUploadingFile(null)} className="text-white/40 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6 relative overflow-hidden">
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center justify-center py-6">
                      <Sparkles className="w-6 h-6 text-purple-400 animate-pulse mb-3" />
                      <span className="text-[11px] uppercase tracking-widest font-mono text-purple-300">AI Analyzing Content...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {uploadSummary && (
                        <div className="text-[12px] text-white/70 leading-relaxed border-b border-white/10 pb-4">{uploadSummary}</div>
                      )}
                      <div>
                        <div className="flex justify-between items-end mb-3">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-purple-400" />
                            <span className="text-[10px] uppercase tracking-widest font-mono text-purple-300">Suggested Tags</span>
                          </div>
                          <span className="text-[9px] uppercase tracking-widest text-white/40">{selectedSuggestions.length} Selected</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {suggestedTags.map((tag) => (
                            <button
                              key={tag}
                              title={tag}
                              onClick={() =>
                                setSelectedSuggestions((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
                              }
                              className={`px-3 py-1.5 rounded-lg text-[10px] uppercase font-mono tracking-widest transition-all border ${
                                selectedSuggestions.includes(tag)
                                  ? "bg-purple-500/20 border-purple-500/50 text-purple-200"
                                  : "bg-transparent border-white/20 text-white/60 hover:text-white hover:border-white/40"
                              }`}
                            >
                              {selectedSuggestions.includes(tag) && <Check className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {!linkedDrive && !linkedDropbox ? (
                  <div className="mb-4 text-center p-4 border border-red-500/20 bg-red-500/10 rounded-xl">
                    <span className="text-[11px] text-red-400 block mb-2 uppercase tracking-widest font-mono">No Hosting Linked</span>
                    <span className="text-[10px] text-white/50 block">
                      Desboard does not host files directly. Please link Google Drive or Dropbox from the sidebar to upload.
                    </span>
                  </div>
                ) : (
                  <div className="mb-6 flex flex-col gap-2">
                    <span className="text-[10px] uppercase font-mono text-white/50 tracking-widest block">Upload Destination</span>
                    <div className="flex gap-2">
                      {linkedDrive && (
                        <button
                          onClick={() => setUploadDestination("drive")}
                          className={`flex-1 py-3 px-4 rounded-xl border flex items-center justify-center gap-2 transition-all text-[11px] uppercase tracking-widest font-bold ${
                            uploadDestination === "drive" ? "border-[#34A853] bg-[#34A853]/10 text-[#34A853]" : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                          }`}
                        >
                          <Cloud className="w-4 h-4" /> Drive
                        </button>
                      )}
                      {linkedDropbox && (
                        <button
                          onClick={() => setUploadDestination("dropbox")}
                          className={`flex-1 py-3 px-4 rounded-xl border flex items-center justify-center gap-2 transition-all text-[11px] uppercase tracking-widest font-bold ${
                            uploadDestination === "dropbox" ? "border-[#0061FF] bg-[#0061FF]/20 text-[#0061FF]" : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                          }`}
                        >
                          <Archive className="w-4 h-4" /> Dropbox
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 mt-auto">
                  <button
                    onClick={() => setUploadingFile(null)}
                    className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 transition-colors text-[11px] uppercase tracking-widest font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={isAnalyzing || (!linkedDrive && !linkedDropbox) || !uploadDestination || uploadDestination === "desboard"}
                    onClick={handleConfirmUpload}
                    className={`flex-1 py-2.5 rounded-lg text-[11px] uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-2 ${
                      isAnalyzing || (!linkedDrive && !linkedDropbox) || !uploadDestination || uploadDestination === "desboard"
                        ? "bg-white/10 text-white/40"
                        : "bg-[#D85E25] text-white hover:bg-[#D85E25]/80"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" /> Confirm & Upload
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
              className="absolute inset-x-0 bottom-0 top-[60px] bg-black/95 backdrop-blur-2xl z-[60] flex flex-col pt-6 px-6"
            >
              <div className="flex justify-between items-center mb-6 px-4">
                <div>
                  <h3 className="font-display text-[20px] uppercase tracking-wider text-white">Compare Versions</h3>
                  <p className="text-[11px] font-mono text-white/40">{selectedFile.name}</p>
                </div>
                <button
                  onClick={() => setIsComparing(false)}
                  className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors text-white/60 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 flex gap-6 pb-6 overflow-hidden">
                {[0, 1].map((side) => (
                  <div key={side} className="flex-1 bg-[#111] border border-white/10 rounded-xl flex flex-col overflow-hidden relative">
                    <div className={`p-4 border-b border-white/10 flex justify-between items-center ${highContrast ? "bg-black" : "bg-black/40"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-[12px] ${side === 0 ? "bg-[#D85E25]" : "bg-white/20"}`}>
                          {selectedVersionsToCompare[side].slice(0, 2)}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-mono text-[12px] uppercase tracking-widest text-[#EBE6DD]">{selectedVersionsToCompare[side]}</span>
                          <span className="text-[10px] text-white/40">
                            {selectedFile.versions.find((v) => v.version === selectedVersionsToCompare[side])?.date}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => showToast("Restored previous version")} className="text-[#D85E25] hover:text-[#D85E25]/80 text-[10px] uppercase tracking-widest font-mono">
                        Restore This
                      </button>
                    </div>
                    <div className={`flex-1 p-8 flex items-center justify-center relative ${highContrast ? "bg-black" : "bg-[#050505]"} overflow-y-auto`}>
                      <div className="w-full max-w-[500px] aspect-[1/1.4] bg-white text-black p-8 shadow-2xl relative overflow-hidden text-[10px]">
                        <div className="h-4 w-3/4 bg-gray-200 mb-6 rounded-sm"></div>
                        <div className="h-3 w-full bg-gray-200 mb-3 rounded-sm"></div>
                        <div className="h-3 w-full bg-gray-200 mb-3 rounded-sm"></div>
                        <div className="h-3 w-4/5 bg-gray-200 mb-3 rounded-sm"></div>
                        <div
                          className={`h-48 w-full my-6 rounded-sm border-2 border-dashed flex items-center justify-center font-bold uppercase tracking-widest text-center whitespace-pre-wrap ${
                            side === 0 ? "bg-blue-100 border-blue-300 text-blue-500" : "bg-red-50 border-red-200 text-red-400"
                          }`}
                        >
                          {side === 0 ? "Updated Banner Draft" : "Original Empty State"}
                        </div>
                        <div className="h-3 w-full bg-gray-200 mb-3 rounded-sm"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Files */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {dragActive && (
            <div className="absolute inset-0 bg-[#D85E25]/10 border-2 border-dashed border-[#D85E25] z-10 rounded-lg flex items-center justify-center backdrop-blur-sm m-4">
              <div className="flex flex-col items-center gap-4">
                <Upload className="w-12 h-12 text-[#D85E25]" />
                <span className="font-display text-[24px] uppercase tracking-widest text-[#D85E25]">Drop files to upload</span>
              </div>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12px] text-white/50 tracking-wide font-mono">
              <span className="hover:text-white cursor-pointer">Root</span> <ChevronRight className="w-3 h-3" /> <span>All Files</span>
            </div>
            <button
              onClick={() => showToast("Filter options coming soon")}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-white/50 hover:text-white transition-colors"
            >
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
          </div>

          {viewMode === "grid" ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("sourceId", file.id)}
                  onDragOver={(e) => {
                    if (file.type === "folder") e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (file.type === "folder") {
                      e.preventDefault();
                      e.stopPropagation();
                      const sourceId = e.dataTransfer.getData("sourceId");
                      if (sourceId && sourceId !== file.id && file.projectId) {
                        moveFileToProject(sourceId, file.projectId, `Moved to ${file.name}`);
                      }
                    }
                  }}
                  onClick={() => {
                    setSelectedFile(file);
                    setSelectedVersionsToCompare([]);
                    setIsComparing(false);
                  }}
                  className={`bg-[#111]/40 border ${
                    selectedFile?.id === file.id ? "border-[#D85E25] bg-[#111]/80" : "border-white/5"
                  } hover:bg-white/5 rounded-xl p-4 cursor-pointer hover:border-white/20 transition-all flex flex-col group`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 bg-white/5 rounded-lg">{getFileIcon(file)}</div>
                    <button className="p-1 opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-white">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <h5 className="font-medium text-[13px] truncate mb-1" title={file.name}>
                    {file.name}
                  </h5>
                  <div className="flex items-center justify-between mt-auto pt-4 relative">
                    <span className="text-[10px] text-[#DBCBC2]/40 font-mono uppercase truncate">{file.size || "Folder"}</span>
                    <span
                      className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded ${
                        file.status === "Approved"
                          ? "bg-green-500/20 text-green-400"
                          : file.status === "Review"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-white/10 text-white/40"
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
              <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-white/5 text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 font-mono mb-2">
                <div className="col-span-5">Name</div>
                <div className="col-span-2">Date Modified</div>
                <div className="col-span-1">Size</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Owner</div>
              </div>
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("sourceId", file.id)}
                  onDragOver={(e) => {
                    if (file.type === "folder") e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (file.type === "folder") {
                      e.preventDefault();
                      e.stopPropagation();
                      const sourceId = e.dataTransfer.getData("sourceId");
                      if (sourceId && sourceId !== file.id && file.projectId) {
                        moveFileToProject(sourceId, file.projectId, `Moved to ${file.name}`);
                      }
                    }
                  }}
                  onClick={() => {
                    setSelectedFile(file);
                    setSelectedVersionsToCompare([]);
                    setIsComparing(false);
                  }}
                  className={`grid grid-cols-12 gap-4 px-4 py-3 items-center rounded-lg cursor-pointer border ${
                    selectedFile?.id === file.id ? "bg-[#111]/80 border-[#D85E25]" : "bg-white/[0.02] border-transparent hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="col-span-5 flex items-center gap-3 truncate">
                    {getFileIcon(file)}
                    <span className="text-[13px] truncate">{file.name}</span>
                  </div>
                  <div className="col-span-2 text-[11px] text-[#DBCBC2]/60 font-mono">{file.created}</div>
                  <div className="col-span-1 text-[11px] text-[#DBCBC2]/60 font-mono">{file.size || "--"}</div>
                  <div className="col-span-2">
                    <span
                      className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded ${
                        file.status === "Approved"
                          ? "bg-green-500/20 text-green-400"
                          : file.status === "Review"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-white/10 text-white/40"
                      }`}
                    >
                      {file.status}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 text-[11px]">
                    <div className="w-5 h-5 rounded-full bg-[#D85E25] flex items-center justify-center text-[9px] uppercase">{file.owner.charAt(0)}</div>
                    <span className="truncate">{file.owner}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar (Inspector) */}
      {selectedFile && (
        <div className={`w-[280px] border-l ${highContrast ? "border-white/20 bg-black" : "border-white/10 bg-[#050505]"} flex flex-col shrink-0`}>
          <div className={`h-[60px] border-b ${highContrast ? "border-white/20" : "border-white/10"} flex items-center justify-between px-4`}>
            <h4 className="font-display uppercase tracking-widest text-[14px]">Inspector</h4>
            <div className="flex gap-2">
              <button onClick={() => showToast("Downloading " + selectedFile.name)} className="p-1.5 text-white/40 hover:text-white rounded bg-white/5">
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setSelectedVersionsToCompare([]);
                  setIsComparing(false);
                }}
                className="p-1.5 text-white/40 hover:text-[#D85E25] rounded bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="aspect-video bg-black/40 border-b border-white/5 flex items-center justify-center relative group">
              {getFileIcon(selectedFile)}
              {selectedFile.type === "file" && (
                <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                  <button
                    onClick={() => setPreviewingFile(selectedFile)}
                    className="flex items-center gap-2 bg-[#D85E25] px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium hover:bg-[#D85E25]/80 transition-colors"
                  >
                    <Eye className="w-4 h-4" /> Preview
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => handlePreviewNewWindow(selectedFile, e)}
                      className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full text-[9px] uppercase tracking-widest font-medium hover:bg-white/20 transition-colors"
                    >
                      <Maximize className="w-3 h-3" /> New Window
                    </button>
                    <button
                      onClick={(e) => handleShareLink(selectedFile, e)}
                      className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full text-[9px] uppercase tracking-widest font-medium hover:bg-white/20 transition-colors"
                    >
                      <LinkIcon className="w-3 h-3" /> Share
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5">
              <h3 className="text-[16px] font-medium leading-tight mb-2 break-all">{selectedFile.name}</h3>
              <div className="flex gap-2 flex-wrap mb-6 items-center">
                {selectedFile.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded bg-white/5 text-[9px] uppercase tracking-widest text-[#DBCBC2]/60 border border-white/5">
                    #{t}
                  </span>
                ))}
                {isAddingTag ? (
                  <div className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded border border-[#D85E25]/50">
                    <span className="text-[9px] text-[#DBCBC2]/60">#</span>
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
                      className="bg-transparent border-none outline-none text-[9px] uppercase tracking-widest text-white w-16"
                    />
                    <button onClick={handleAddTag} className="text-[#D85E25] hover:text-white ml-1">
                      <CheckCircle className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsAddingTag(true)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white/5 text-[9px] uppercase tracking-widest text-[#D85E25] border border-transparent hover:border-[#D85E25]/30 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add Tag
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex border-b border-white/10 mb-6 font-mono text-[10px] uppercase tracking-widest overflow-x-auto">
                <button
                  onClick={() => setActiveTab("details")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "details" ? "border-[#D85E25] text-[#D85E25]" : "border-transparent text-white/40 hover:text-white"}`}
                >
                  Details
                </button>
                <button
                  onClick={() => setActiveTab("versions")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "versions" ? "border-[#D85E25] text-[#D85E25]" : "border-transparent text-white/40 hover:text-white"}`}
                >
                  History
                </button>
                <button
                  onClick={() => setActiveTab("links")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors ${activeTab === "links" ? "border-[#D85E25] text-[#D85E25]" : "border-transparent text-white/40 hover:text-white"}`}
                >
                  Links
                </button>
                <button
                  onClick={() => setActiveTab("ai")}
                  className={`flex-1 min-w-[60px] pb-2 border-b-2 transition-colors flex items-center justify-center gap-1 ${
                    activeTab === "ai" ? "border-[#D85E25] text-[#D85E25]" : "border-transparent text-[#34A853] hover:text-[#34A853]/80"
                  }`}
                >
                  <Sparkles className="w-3 h-3" /> AI
                </button>
              </div>

              {activeTab === "details" && (
                <div className="flex flex-col gap-4 text-[12px]">
                  <div>
                    <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-1">Status</span>
                    <div className="p-2 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center cursor-pointer">
                      {selectedFile.status} <ArrowRight className="w-3 h-3 text-white/40 rotate-90" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-1">Size</span>
                      <span className="font-mono text-[#DBCBC2]/80">{selectedFile.size || "--"}</span>
                    </div>
                    <div>
                      <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-1">Type</span>
                      <span className="font-mono text-[#DBCBC2]/80 uppercase">{selectedFile.extension || "Folder"}</span>
                    </div>
                    <div>
                      <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-1">Created</span>
                      <span className="font-mono text-[#DBCBC2]/80">{selectedFile.created}</span>
                    </div>
                    <div>
                      <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-1">Owner</span>
                      <span className="text-[#DBCBC2]/80">{selectedFile.owner}</span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="text-white/40 uppercase text-[9px] tracking-widest block mb-2">Access Control</span>
                    <div className="flex flex-col gap-2">
                      {selectedFile.access.map((a) => (
                        <div key={a} className="flex items-center justify-between text-[11px] bg-white/5 px-2 py-1.5 rounded">
                          {a}{" "}
                          <button className="text-red-400/50 hover:text-red-400">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button className="text-left text-[#D85E25] text-[10px] uppercase font-mono tracking-widest hover:underline">+ Invite</button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "versions" && (
                <div className="flex flex-col gap-4">
                  {selectedFile.versions.length === 0 ? (
                    <p className="text-[11px] text-white/40 font-mono">No version history available.</p>
                  ) : (
                    <div className="flex flex-col relative before:absolute before:left-[11px] before:top-2 before:bottom-0 before:w-px before:bg-white/10">
                      <div className="flex justify-end mb-4">
                        <button
                          onClick={() => setIsComparing(true)}
                          disabled={selectedVersionsToCompare.length !== 2}
                          className={`px-3 py-1.5 rounded-lg text-[10px] uppercase font-mono tracking-widest transition-all ${
                            selectedVersionsToCompare.length === 2 ? "bg-[#D85E25] text-white hover:bg-[#D85E25]/80" : "bg-white/5 text-white/40 cursor-not-allowed"
                          }`}
                        >
                          Compare Selected
                        </button>
                      </div>
                      {selectedFile.versions.map((ver, idx) => (
                        <div key={idx} className="flex gap-4 relative mb-6 last:mb-0">
                          <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border-4 border-[#050505] relative z-10 ${ver.latest ? "bg-[#D85E25]" : "bg-white/20"}`}>
                            {ver.latest && <CheckCircle className="w-3 h-3 text-white" />}
                          </div>
                          <div className="pt-1 w-full">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium leading-none">{ver.version}</span>
                                {ver.latest && <span className="text-[8px] uppercase tracking-widest bg-[#D85E25]/20 text-[#D85E25] px-1.5 py-0.5 rounded">Latest</span>}
                              </div>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="w-3 h-3 accent-[#D85E25] bg-black border border-white/20 rounded cursor-pointer"
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
                                <span className="text-[9px] uppercase tracking-widest font-mono text-white/60 select-none">Compare</span>
                              </label>
                            </div>
                            <p className="text-[10px] font-mono text-white/40 mb-2">
                              {ver.date} • {ver.author}
                            </p>
                            {!ver.latest && (
                              <div className="flex gap-2">
                                <button onClick={() => showToast("Restored version " + ver.version)} className="text-[9px] uppercase tracking-widest font-mono text-white/60 hover:text-white bg-white/10 px-2 py-1 rounded">
                                  Restore
                                </button>
                                <button onClick={() => showToast("Downloading version " + ver.version)} className="text-[9px] uppercase tracking-widest font-mono text-white/60 hover:text-white bg-white/10 px-2 py-1 rounded">
                                  Download
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => showToast("Upload feature coming soon")}
                    className="w-full mt-4 bg-white/5 hover:bg-white/10 border border-white/10 py-2 rounded-lg text-[10px] uppercase font-mono tracking-widest transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload className="w-3 h-3" /> Upload New Version
                  </button>
                </div>
              )}

              {activeTab === "links" && (
                <div className="flex flex-col gap-5 text-[12px]">
                  <div>
                    <span className="flex items-center gap-1.5 text-white/40 uppercase text-[9px] tracking-widest mb-2">
                      <Folder className="w-3 h-3" /> Linked Project
                    </span>
                    <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                      <span>{selectedFile.projectId ? `Project #${selectedFile.projectId}` : "--"}</span>
                      <button className="text-white/40 hover:text-white">
                        <LinkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 text-white/40 uppercase text-[9px] tracking-widest mb-2">
                      <Users className="w-3 h-3" /> Linked Client
                    </span>
                    <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 flex items-center justify-between">
                      <span>{selectedFile.clientId || "--"}</span>
                      <button className="text-white/40 hover:text-white">
                        <LinkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="flex items-center gap-1.5 text-white/40 uppercase text-[9px] tracking-widest mb-2">
                      <CheckCircle className="w-3 h-3" /> Deliverable
                    </span>
                    <button className="w-full text-left p-2.5 bg-white/5 border border-dashed border-white/20 text-white/40 hover:text-white hover:border-white/50 rounded-lg text-[11px] transition-colors">
                      + Connect to Task/Deliverable
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "ai" && (
                <div className="flex flex-col h-full gap-4 relative">
                  <div className="flex-1 overflow-y-auto pr-2 pb-20 max-h-[300px] flex flex-col gap-4">
                    {aiChatResponses.length === 0 && (
                      <div className="text-center p-4">
                        <Sparkles className="w-8 h-8 text-[#34A853]/50 mx-auto mb-3" />
                        <p className="text-[12px] text-white/50 mb-1">Ask AI about this file</p>
                        <p className="text-[10px] text-white/30">Generate summaries, extract action items, or ask questions.</p>
                      </div>
                    )}
                    {aiChatResponses.map((msg, idx) => (
                      <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                        <div
                          className={`px-3 py-2 rounded-xl text-[12px] max-w-[90%] whitespace-pre-wrap ${
                            msg.role === "user"
                              ? "bg-white/10 text-white rounded-br-none"
                              : "bg-[#34A853]/20 text-[#DBCBC2] rounded-bl-none border border-[#34A853]/20"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {isAiLoading && (
                      <div className="flex items-start">
                        <div className="px-3 py-2 rounded-xl text-[12px] bg-[#34A853]/10 text-white/50 rounded-bl-none border border-[#34A853]/10">
                          <Sparkles className="w-3 h-3 animate-pulse" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-[#0A0A0A] pt-2 border-t border-white/5">
                    <input
                      type="text"
                      placeholder="Ask anything..."
                      value={aiChatInput}
                      onChange={(e) => setAiChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && aiChatInput.trim() && !isAiLoading) sendFileChat(aiChatInput.trim());
                      }}
                      className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-white focus:outline-none focus:border-[#34A853]/50 focus:bg-white/[0.05] transition-all"
                    />
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
            className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[60] flex flex-col p-8 rounded-xl overflow-hidden"
          >
            <div className="flex justify-between items-center mb-8 shrink-0">
              <div className="flex items-center gap-4">
                {getFileIcon(previewingFile)}
                <div>
                  <h2 className="text-[#EBE6DD] font-display text-[24px] uppercase tracking-wide leading-none mb-1">{previewingFile.name}</h2>
                  <span className="text-white/40 text-[11px] font-mono uppercase tracking-widest">
                    {previewingFile.size || "--"} • {previewingFile.extension?.toUpperCase() || "FILE"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => handlePreviewNewWindow(previewingFile, e)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-[11px] font-medium tracking-widest uppercase transition-colors flex items-center gap-2"
                >
                  <Maximize className="w-3.5 h-3.5" /> Open Native Window
                </button>
                <button
                  onClick={(e) => handleShareLink(previewingFile, e)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-[11px] font-medium tracking-widest uppercase transition-colors flex items-center gap-2"
                >
                  <LinkIcon className="w-3.5 h-3.5" /> Copy Link
                </button>
                <button
                  onClick={() => setPreviewingFile(null)}
                  className="w-10 h-10 bg-white/10 hover:bg-red-500/20 text-white/50 hover:text-red-400 rounded-full flex items-center justify-center transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/40 border border-white/10 rounded-2xl flex items-center justify-center overflow-hidden relative">
              {previewingFile.extension === "fig" ? (
                <div className="text-center">
                  <Figma className="w-16 h-16 text-white/50 mx-auto mb-4" />
                  <p className="text-white/40 font-mono text-[12px] uppercase tracking-widest">Figma Preview Embedded Here</p>
                </div>
              ) : previewingFile.extension === "pdf" ? (
                <div className="text-center">
                  <FileText className="w-16 h-16 text-white/50 mx-auto mb-4" />
                  <p className="text-white/40 font-mono text-[12px] uppercase tracking-widest">PDF Viewer Embedded Here</p>
                </div>
              ) : (
                <div className="text-center">
                  <Eye className="w-16 h-16 text-white/20 mx-auto mb-4" />
                  <p className="text-white/40 font-mono text-[12px] uppercase tracking-widest">Generic File Viewer Embedded Here</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
