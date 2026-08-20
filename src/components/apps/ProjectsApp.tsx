import type React from "react";
import { useState, useEffect } from "react";
import {
  ArrowRight,
  Sparkles,
  CheckCircle,
  Archive,
  Calendar,
  FileText,
  Target,
  MessageSquare,
  CreditCard,
  Package,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { ProjectFull, ChatMessage, TeamMember } from "../../types";
import type { WindowType } from "../windowTypes";
import { api } from "../../lib/api";
import { HandoverPanel } from "./HandoverPanel";
import { TasksPanel } from "./TasksPanel";

/** Projects window: list + detail view, create modal, and the Project Copilot. */
export function ProjectsApp({
  showToast,
  onOpenWindow,
  onOpenProjectFiles,
  onOpenProjectMessages,
  initialProjectId = null,
  initialShowTasks = false,
  initialShowHandovers = false,
  initialCreating = false,
}: {
  showToast: (msg: string) => void;
  onOpenWindow: (type: WindowType) => void;
  /** Open the File Vault pre-filtered to this project (numeric vault project id). */
  onOpenProjectFiles?: (numericProjectId: number | null) => void;
  /** Open Messaging, preferring a conversation linked to this project. */
  onOpenProjectMessages?: (projectId: string) => void;
  /** Open directly into this project's detail view (e.g. from a Calendar entry). */
  initialProjectId?: string | null;
  /** Once opened via initialProjectId, also open its Tasks panel. */
  initialShowTasks?: boolean;
  /** Once opened via initialProjectId, also open its Handovers panel (e.g. from the home greeting/rail). */
  initialShowHandovers?: boolean;
  /** Open straight into the "New project" modal (e.g. from the sidebar's New project shortcut). */
  initialCreating?: boolean;
}) {
  const [projectsList, setProjectsList] = useState<ProjectFull[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectFull | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatResponses, setAiChatResponses] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showHandovers, setShowHandovers] = useState(false);
  const [handoverCount, setHandoverCount] = useState<number | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);

  const [newProject, setNewProject] = useState<Partial<ProjectFull>>({
    name: "",
    client: "",
    status: "Planning",
    deadline: "",
    progress: 0,
    tags: [],
  });

  // Edit-project modal state; null when closed.
  const [editDraft, setEditDraft] = useState<ProjectFull | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load projects from the SQLite-backed API so they survive a refresh.
  useEffect(() => {
    api.getProjects().then(setProjectsList).catch((e) => console.error("Failed to load projects", e));
  }, []);

  // Resolve team chips (bare initials on the project) to real roster members
  // for color + a name tooltip, once, up front.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  useEffect(() => {
    api.getTeamMembers().then(setTeamMembers).catch((e) => console.error("Failed to load team", e));
  }, []);
  const memberByInitials = (initials: string) => teamMembers.find((m) => m.initials === initials);

  // Deep-open a specific project (e.g. a Calendar entry's project) once loaded.
  useEffect(() => {
    if (!initialProjectId) return;
    const p = projectsList.find((x) => x.id === initialProjectId);
    if (p) setSelectedProject(p);
  }, [initialProjectId, projectsList]);

  // Open straight into the "New project" modal (e.g. from the sidebar shortcut).
  useEffect(() => {
    if (initialCreating) setIsCreating(true);
  }, [initialCreating]);

  // Load the live handover count whenever a project's detail view opens, so the
  // "Handovers" card shows the real number of packages. Also auto-opens Tasks
  // when this selection is the one a deep-link asked for.
  useEffect(() => {
    setShowHandovers(selectedProject !== null && selectedProject.id === initialProjectId && initialShowHandovers);
    setHandoverCount(null);
    setShowTasks(selectedProject !== null && selectedProject.id === initialProjectId && initialShowTasks);
    setTaskCount(null);
    setConversationCount(null);
    if (selectedProject) {
      api
        .getHandovers(selectedProject.id)
        .then((list) => setHandoverCount(list.length))
        .catch((e) => console.error("Failed to load handover count", e));
      api
        .getTasks(selectedProject.id)
        .then((list) => setTaskCount(list.length))
        .catch((e) => console.error("Failed to load task count", e));
      api
        .getConversations()
        .then((list) => setConversationCount(list.filter((c) => c.linkedProjectId === selectedProject.id).length))
        .catch((e) => console.error("Failed to load conversation count", e));
    }
  }, [selectedProject?.id]);

  const handleCreate = async () => {
    if (!newProject.name) return;
    const p: ProjectFull = {
      id: "p" + Date.now(),
      name: newProject.name || "Untitled Project",
      client: newProject.client || "Internal",
      status: (newProject.status as ProjectFull["status"]) || "Planning",
      deadline: newProject.deadline || "TBD",
      owner: "You",
      team: ["You"],
      tags: newProject.tags || [],
      progress: 0,
      linked: { files: 0, tasks: 0, messages: 0, invoices: 0, handovers: 0 },
    };
    try {
      const saved = await api.createProject(p);
      setProjectsList((prev) => [saved, ...prev]);
    } catch (e) {
      console.error("Failed to save project", e);
      setProjectsList((prev) => [p, ...prev]); // still show it locally
    }
    setIsCreating(false);
    setNewProject({ name: "", client: "", status: "Planning", deadline: "", progress: 0, tags: [] });
  };

  const sendCopilotMessage = async (prompt: string, project: ProjectFull) => {
    setAiChatInput("");
    setAiChatResponses((prev) => [...prev, { role: "user", text: prompt }]);
    setIsAiLoading(true);
    try {
      const text = await api.chat(prompt, project);
      setAiChatResponses((prev) => [...prev, { role: "ai", text }]);
    } catch {
      setAiChatResponses((prev) => [...prev, { role: "ai", text: "Error connecting to Copilot." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const toggleProjectStatus = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const current = projectsList.find((p) => p.id === id);
    if (!current) return;
    const statuses: ProjectFull["status"][] = ["Planning", "In Progress", "Review", "Archived"];
    const next = statuses[(statuses.indexOf(current.status) + 1) % statuses.length];
    const updated = { ...current, status: next };
    setProjectsList((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (selectedProject?.id === id) setSelectedProject(updated);
    api.updateProject(id, { status: next }).catch((err) => console.error("Failed to persist status", err));
  };

  const archiveProject = (id: string) => {
    const current = projectsList.find((p) => p.id === id);
    if (!current) return;
    const updated = { ...current, status: "Archived" as const };
    setProjectsList((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (selectedProject?.id === id) setSelectedProject(updated);
    api.updateProject(id, { status: "Archived" }).catch((err) => console.error("Failed to archive project", err));
    showToast("Project archived");
  };

  const saveEdit = async () => {
    if (!editDraft || !editDraft.name.trim()) return;
    setSavingEdit(true);
    try {
      const saved = await api.updateProject(editDraft.id, {
        name: editDraft.name.trim(),
        client: editDraft.client.trim(),
        status: editDraft.status,
        deadline: editDraft.deadline.trim(),
        progress: Math.max(0, Math.min(100, editDraft.progress)),
      });
      setProjectsList((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      if (selectedProject?.id === saved.id) setSelectedProject(saved);
      setEditDraft(null);
      showToast("Project updated");
    } catch (e) {
      console.error("Failed to save project", e);
      showToast("Could not save project changes");
    } finally {
      setSavingEdit(false);
    }
  };

  const getStatusColor = (status: ProjectFull["status"]) => {
    switch (status) {
      case "Planning":
        return "bg-slate/10 text-slate";
      case "In Progress":
        return "bg-moss/10 text-moss";
      case "Review":
        return "bg-amber/10 text-amber";
      case "Archived":
        return "bg-chip text-muted";
      default:
        return "bg-chip text-ink/70";
    }
  };

  const getStatusDotColor = (status: ProjectFull["status"]) => {
    switch (status) {
      case "Planning":
        return "bg-slate";
      case "In Progress":
        return "bg-moss";
      case "Review":
        return "bg-amber";
      case "Archived":
        return "bg-muted";
      default:
        return "bg-primary";
    }
  };

  const filteredProjects = projectsList.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.client.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // --- Detail view ---
  if (selectedProject) {
    return (
      <div className="flex flex-col h-full text-ink w-full relative">
        <div className="flex items-center gap-4 mb-6 shrink-0">
          <button
            onClick={() => setSelectedProject(null)}
            className="p-2 bg-panel hover:bg-chip rounded-full transition-colors group"
          >
            <ArrowRight className="w-4 h-4 text-ink/60 group-hover:text-ink rotate-180" />
          </button>
          <div>
            <span className="text-[12.5px] text-muted">
              Projects / {selectedProject.client}
            </span>
            <h2 className="text-[24px] font-bold leading-none mt-1.5">{selectedProject.name}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-moss/10 hover:bg-moss/[0.16] rounded-full text-[13px] transition-colors font-medium text-moss"
            >
              <Sparkles className="w-4 h-4" /> Copilot
            </button>
            <button
              onClick={() => setEditDraft(selectedProject)}
              className="flex items-center gap-2 px-4 py-2 bg-panel hover:bg-chip rounded-full text-[13px] transition-colors font-medium text-ink"
            >
              <CheckCircle className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={() => archiveProject(selectedProject.id)}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/[0.16] rounded-full text-[13px] transition-colors font-medium text-primary"
            >
              <Archive className="w-4 h-4" /> Archive
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-6 shrink-0">
          <div className="bg-panel p-4 rounded-2xl">
            <span className="text-[13px] text-muted block mb-2.5">Status</span>
            <div
              className="flex items-center gap-2.5 cursor-pointer group"
              onClick={(e) => toggleProjectStatus(selectedProject.id, e)}
            >
              <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${getStatusDotColor(selectedProject.status)}`}></div>
              <span className="text-[15px] font-medium group-hover:text-primary transition-colors">
                {selectedProject.status}
              </span>
            </div>
          </div>
          <div className="bg-panel p-4 rounded-2xl">
            <span className="text-[13px] text-muted block mb-2.5">Progress</span>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: selectedProject.progress + "%" }}></div>
              </div>
              <span className="text-[15px] font-medium">{selectedProject.progress}%</span>
            </div>
          </div>
          <div className="bg-panel p-4 rounded-2xl">
            <span className="text-[13px] text-muted block mb-2.5">Deadline</span>
            <div className="flex items-center gap-2.5">
              <Calendar className="w-4 h-4 text-muted" />
              <span className="text-[15px] font-medium truncate">{selectedProject.deadline}</span>
            </div>
          </div>
          <div className="bg-panel p-4 rounded-2xl overflow-hidden">
            <span className="text-[13px] text-muted block mb-2.5">Team</span>
            <div className="flex -space-x-2">
              {selectedProject.team.map((m, i) => {
                const member = memberByInitials(m);
                return (
                  <div
                    key={i}
                    title={member?.name ?? m}
                    className="w-7 h-7 rounded-full border-2 border-panel flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: member?.color ?? "var(--color-surface)" }}
                  >
                    <span style={!member ? { color: "var(--color-ink)", opacity: 0.8 } : undefined}>{m}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-6">
          <h3 className="text-[15px] font-semibold text-ink mb-4">Linked resources</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-max">
            {/* Full class strings (not interpolated) so Tailwind keeps them in the build. */}
            {[
              {
                icon: FileText,
                iconClass: "p-3 bg-slate/10 text-slate rounded-lg group-hover:scale-110 transition-transform",
                label: "Files & Assets",
                count: `${selectedProject.linked.files} items`,
                // Opens the File Vault pre-filtered to this project's files.
                onClick: () => {
                  const numericId = Number(selectedProject.id.replace(/^p/, ""));
                  if (onOpenProjectFiles && Number.isFinite(numericId)) {
                    onOpenProjectFiles(numericId);
                    showToast(`Opening ${selectedProject.name}'s files…`);
                  } else {
                    onOpenWindow("files");
                    showToast("Opening File Vault…");
                  }
                },
              },
              { icon: Target, iconClass: "p-3 bg-amber/10 text-amber rounded-lg group-hover:scale-110 transition-transform", label: "Tasks", count: `${taskCount ?? selectedProject.linked.tasks} items`, onClick: () => setShowTasks(true) },
              { icon: MessageSquare, iconClass: "p-3 bg-moss/10 text-moss rounded-lg group-hover:scale-110 transition-transform", label: "Messages", count: `${conversationCount ?? selectedProject.linked.messages} threads`, onClick: () => onOpenProjectMessages?.(selectedProject.id) },
              { icon: CreditCard, iconClass: "p-3 bg-slate/10 text-slate rounded-lg group-hover:scale-110 transition-transform", label: "Invoices & Finance", count: `${selectedProject.linked.invoices} records`, onClick: () => showToast("Invoices & Finance — coming soon") },
              { icon: Package, iconClass: "p-3 bg-primary/10 text-primary rounded-lg group-hover:scale-110 transition-transform", label: "Handovers", count: `${handoverCount ?? selectedProject.linked.handovers} packages`, onClick: () => setShowHandovers(true) },
            ].map((item) => (
              <div
                key={item.label}
                onClick={item.onClick}
                className="bg-panel hover:bg-chip transition-colors p-5 rounded-xl cursor-pointer group flex flex-col items-start gap-4"
              >
                <div className={item.iconClass}>
                  <item.icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[14px] font-medium text-ink mb-1">{item.label}</h4>
                  <span className="text-[12.5px] text-muted">{item.count}</span>
                </div>
              </div>
            ))}

            <div
              onClick={() => showToast("Linked Resource feature coming soon")}
              className="bg-transparent border border-dashed border-line hover:border-ink/25 transition-colors p-5 rounded-xl cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[140px]"
            >
              <div className="p-2 bg-panel text-muted rounded-full">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-[12.5px] text-muted">Link resource</span>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isAiModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-6 right-6 w-[360px] bg-surface border border-line shadow-xl rounded-2xl overflow-hidden z-[100] flex flex-col max-h-[500px]"
            >
              <div className="p-4 border-b border-line flex items-center justify-between bg-panel">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-moss/15 text-moss rounded-md">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="text-[14px] font-semibold text-ink">Project Copilot</h3>
                </div>
                <button onClick={() => setIsAiModalOpen(false)} className="text-muted hover:text-ink transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-[250px]">
                {aiChatResponses.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-[13px] text-muted mb-2">
                      I'm your AI assistant for <strong className="text-ink">{selectedProject.name}</strong>.
                    </p>
                    <div className="flex flex-col gap-2 mt-4">
                      <button
                        onClick={() =>
                          sendCopilotMessage(
                            "Draft an update email to the client highlighting recent progress.",
                            selectedProject
                          )
                        }
                        className="text-left p-3 text-[12.5px] bg-chip hover:bg-line rounded-lg transition-colors text-ink/80"
                      >
                        Draft a project update email
                      </button>
                      <button
                        onClick={() =>
                          sendCopilotMessage("Analyze the deadlines and predict potential risks.", selectedProject)
                        }
                        className="text-left p-3 text-[12.5px] bg-chip hover:bg-line rounded-lg transition-colors text-ink/80"
                      >
                        Analyze pacing & risks
                      </button>
                    </div>
                  </div>
                ) : (
                  aiChatResponses.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                      <div
                        className={`px-4 py-3 rounded-2xl text-[13px] max-w-[90%] whitespace-pre-wrap leading-relaxed ${
                          msg.role === "user"
                            ? "bg-moss text-white font-medium rounded-br-sm"
                            : "bg-chip text-ink rounded-bl-sm"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                {isAiLoading && (
                  <div className="flex items-start">
                    <div className="px-4 py-3 rounded-2xl text-[13px] bg-chip text-muted rounded-bl-sm">
                      <Sparkles className="w-4 h-4 animate-pulse text-moss" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-3 bg-panel border-t border-line">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Ask your assistant..."
                    value={aiChatInput}
                    onChange={(e) => setAiChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && aiChatInput.trim() && !isAiLoading) {
                        sendCopilotMessage(aiChatInput.trim(), selectedProject);
                      }
                    }}
                    className="w-full bg-surface border border-line focus:border-moss/50 rounded-xl pl-4 pr-10 py-3 text-[13px] text-ink outline-none transition-colors"
                  />
                  <button
                    onClick={() => {
                      if (aiChatInput.trim() && !isAiLoading) sendCopilotMessage(aiChatInput.trim(), selectedProject);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-moss text-white rounded-lg hover:bg-moss/85 transition-colors"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {editDraft && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-[-40px] bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
            >
              <motion.div
                initial={{ scale: 0.95, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 20 }}
                className="bg-surface border border-line rounded-2xl p-6 md:p-8 w-full max-w-md shadow-xl relative"
              >
                <button onClick={() => setEditDraft(null)} className="absolute top-6 right-6 text-muted hover:text-ink">
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-[20px] font-bold text-ink mb-6">Edit project</h3>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Project name</label>
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Client name</label>
                    <input
                      type="text"
                      value={editDraft.client}
                      onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[13px] text-muted block mb-2">Status</label>
                      <select
                        value={editDraft.status}
                        onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value as ProjectFull["status"] })}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors cursor-pointer"
                      >
                        <option value="Planning">Planning</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Review">Review</option>
                        <option value="Archived">Archived</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[13px] text-muted block mb-2">Deadline</label>
                      <input
                        type="text"
                        value={editDraft.deadline}
                        onChange={(e) => setEditDraft({ ...editDraft, deadline: e.target.value })}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                        placeholder="e.g. Dec 15, 2026"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[13px] text-muted block mb-2">
                      Progress — {editDraft.progress}%
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={editDraft.progress}
                      onChange={(e) => setEditDraft({ ...editDraft, progress: Number(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit || !editDraft.name.trim()}
                    className="mt-4 w-full bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg text-[13px] font-semibold text-white"
                  >
                    {savingEdit ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showHandovers && (
            <HandoverPanel
              project={selectedProject}
              onClose={() => setShowHandovers(false)}
              onCountChange={setHandoverCount}
              showToast={showToast}
            />
          )}
          {showTasks && (
            <TasksPanel
              project={selectedProject}
              onClose={() => setShowTasks(false)}
              onCountChange={setTaskCount}
              showToast={showToast}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // --- List view ---
  return (
    <div className="flex flex-col h-full text-ink w-full relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 shrink-0 gap-4">
        <p className="text-muted text-[14px]">Active deliverables &amp; engagements.</p>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative w-full md:w-64 focus-within:border-primary/50 rounded-full transition-colors bg-panel border border-transparent px-4 py-2.5 flex items-center gap-3">
            <Search className="w-4 h-4 text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search projects by name, client..."
              className="bg-transparent border-none outline-none text-[13px] w-full text-ink placeholder:text-muted"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="shrink-0 flex items-center gap-2 bg-primary hover:bg-primary/85 text-white transition-colors px-5 py-2.5 rounded-full text-[13px] font-medium"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 auto-rows-max">
        {filteredProjects.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedProject(p)}
            className="bg-panel hover:bg-chip rounded-2xl p-6 transition-colors cursor-pointer group flex flex-col h-[200px]"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-[85%] pr-2">
                <h3 className="text-[17px] font-semibold text-ink mb-1 leading-none truncate">{p.name}</h3>
                <span className="text-muted text-[12.5px] truncate block">{p.client}</span>
              </div>
              <div
                onClick={(e) => toggleProjectStatus(p.id, e)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer hover:brightness-95 ${getStatusColor(
                  p.status
                )}`}
              >
                {p.status}
              </div>
            </div>

            <div className="flex gap-1.5 flex-wrap mb-4 overflow-hidden h-[24px]">
              {p.tags.slice(0, 3).map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-chip text-[11px] text-muted truncate max-w-[80px]">
                  #{t}
                </span>
              ))}
              {p.tags.length > 3 && (
                <span className="px-2 py-0.5 rounded-full bg-chip text-[11px] text-muted">+{p.tags.length - 3}</span>
              )}
            </div>

            <div className="mt-auto">
              <div className="flex items-center justify-between mb-3 text-[12px] text-muted">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {p.team.length} members
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> Due {p.deadline}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: p.progress + "%" }}></div>
                </div>
                <span className="text-[12.5px] text-ink/70">{p.progress}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {isCreating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-[-40px] bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6 mb-[48px]"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-surface border border-line rounded-2xl p-6 md:p-8 w-full max-w-md shadow-xl relative"
            >
              <button onClick={() => setIsCreating(false)} className="absolute top-6 right-6 text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-[20px] font-bold text-ink mb-6">New project</h3>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-[13px] text-muted block mb-2">Project name</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    placeholder="e.g. Q4 Website Redesign"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-muted block mb-2">Client name</label>
                  <input
                    type="text"
                    value={newProject.client}
                    onChange={(e) => setNewProject({ ...newProject, client: e.target.value })}
                    className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    placeholder="e.g. Acme Corp"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Status</label>
                    <select
                      value={newProject.status}
                      onChange={(e) => setNewProject({ ...newProject, status: e.target.value as ProjectFull["status"] })}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    >
                      <option value="Planning">Planning</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Review">Review</option>
                      <option value="Archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Deadline</label>
                    <input
                      type="text"
                      value={newProject.deadline}
                      onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      placeholder="e.g. Dec 15"
                    />
                  </div>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={!newProject.name}
                  className="mt-4 w-full bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg text-[13px] font-semibold text-white"
                >
                  Create project
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
