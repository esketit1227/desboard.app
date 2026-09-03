import type React from "react";
import { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  CheckCircle,
  Archive,
  ArchiveRestore,
  Calendar,
  FileText,
  Target,
  MessageSquare,
  Package,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { ProjectFull, TeamMember } from "../../types";
import { api } from "../../lib/api";
import { HandoverPanel } from "./HandoverPanel";
import { TasksPanel } from "./TasksPanel";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

/** Projects window: list + detail view, create modal. */
export function ProjectsApp({
  showToast,
  onOpenProjectMessages,
  initialProjectId = null,
  initialShowTasks = false,
  initialShowHandovers = false,
  initialCreating = false,
}: {
  showToast: (msg: string) => void;
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
  const [listTab, setListTab] = useState<"active" | "archived">("active");
  const [isCreating, setIsCreating] = useState(false);
  const [showHandovers, setShowHandovers] = useState(false);
  const [handoverCount, setHandoverCount] = useState<number | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);

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

  // True once any create/update/archive has happened — guards against this
  // initial fetch resolving *after* that mutation and silently overwriting
  // the just-changed list with the pre-mutation server snapshot it fetched
  // (a real race: this GET fires on mount, and if it's slow enough to still
  // be in flight when a user creates a project, its late response would
  // otherwise wipe the new project right back out of view).
  const skipInitialLoad = useRef(false);
  useEffect(() => {
    api
      .getProjects()
      .then((list) => {
        if (!skipInitialLoad.current) setProjectsList(list);
      })
      .catch((e) => console.error("Failed to load projects", e));
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
    setFileCount(null);
    if (selectedProject) {
      const numericId = Number(selectedProject.id.replace(/^p/, ""));
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
      api
        .getFiles()
        .then((list) => setFileCount(list.filter((f) => f.projectId === numericId).length))
        .catch((e) => console.error("Failed to load file count", e));
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
      linked: { files: 0, tasks: 0, messages: 0, handovers: 0 },
    };
    try {
      const saved = await api.createProject(p);
      skipInitialLoad.current = true;
      setProjectsList((prev) => [saved, ...prev]);
      setIsCreating(false);
      setNewProject({ name: "", client: "", status: "Planning", deadline: "", progress: 0, tags: [] });
    } catch (e) {
      console.error("Failed to save project", e);
      showToast("Could not create the project — check your connection and try again");
      // Deliberately does NOT close the modal or add a local-only fake entry:
      // a project that only exists in this render and silently disappears on
      // the next refresh is worse than an honest, visible failure. The
      // user's typed input stays in the form so they can just retry.
    }
  };

  const toggleProjectStatus = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const current = projectsList.find((p) => p.id === id);
    if (!current) return;
    const statuses: ProjectFull["status"][] = ["Planning", "In Progress", "Review", "Archived"];
    const next = statuses[(statuses.indexOf(current.status) + 1) % statuses.length];
    const updated = { ...current, status: next };
    skipInitialLoad.current = true;
    setProjectsList((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (selectedProject?.id === id) setSelectedProject(updated);
    api.updateProject(id, { status: next }).catch((err) => {
      console.error("Failed to persist status", err);
      showToast("Could not save the status change");
    });
  };

  // Toggles between Archive and Unarchive depending on the project's current
  // status. There's no stored "status before archiving" to restore, so
  // Unarchive lands on Planning — the same default the status-cycle dot
  // already wraps back to today.
  const archiveProject = (id: string) => {
    const current = projectsList.find((p) => p.id === id);
    if (!current) return;
    const wasArchived = current.status === "Archived";
    const nextStatus = wasArchived ? ("Planning" as const) : ("Archived" as const);
    const updated = { ...current, status: nextStatus };
    skipInitialLoad.current = true;
    setProjectsList((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (selectedProject?.id === id) setSelectedProject(updated);
    api
      .updateProject(id, { status: nextStatus })
      .then(() => showToast(wasArchived ? "Project unarchived" : "Project archived"))
      .catch((err) => {
        console.error("Failed to update project status", err);
        showToast(wasArchived ? "Could not unarchive the project" : "Could not archive the project");
      });
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
      skipInitialLoad.current = true;
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
      (listTab === "archived" ? p.status === "Archived" : p.status !== "Archived") &&
      (p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.client.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const archivedCount = projectsList.filter((p) => p.status === "Archived").length;

  // --- Detail view ---
  if (selectedProject) {
    return (
      <div className="flex flex-col h-full text-ink w-full relative">
        <div className="flex flex-wrap items-center gap-4 mb-6 shrink-0">
          <button
            onClick={() => setSelectedProject(null)}
            className="p-2 bg-panel hover:bg-chip rounded-full transition-colors group shrink-0"
          >
            <ArrowRight className="w-4 h-4 text-ink/60 group-hover:text-ink rotate-180" />
          </button>
          <div className="min-w-0">
            <span className="text-[12.5px] text-muted">
              Projects / {selectedProject.client}
            </span>
            <h2 className="text-[24px] font-bold leading-none mt-1.5 truncate">{selectedProject.name}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 basis-full sm:basis-auto sm:ml-auto">
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
              {selectedProject.status === "Archived" ? (
                <>
                  <ArchiveRestore className="w-4 h-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4" /> Archive
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 shrink-0">
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
                count: `${fileCount ?? selectedProject.linked.files} items`,
                onClick: () => setShowFiles(true),
              },
              { icon: Target, iconClass: "p-3 bg-amber/10 text-amber rounded-lg group-hover:scale-110 transition-transform", label: "Tasks", count: `${taskCount ?? selectedProject.linked.tasks} items`, onClick: () => setShowTasks(true) },
              { icon: MessageSquare, iconClass: "p-3 bg-moss/10 text-moss rounded-lg group-hover:scale-110 transition-transform", label: "Messages", count: `${conversationCount ?? selectedProject.linked.messages} threads`, onClick: () => onOpenProjectMessages?.(selectedProject.id) },
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
                        type="date"
                        value={editDraft.deadline}
                        onChange={(e) => setEditDraft({ ...editDraft, deadline: e.target.value })}
                        className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
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
          {showFiles && (
            <ProjectFilesPanel
              project={selectedProject}
              onClose={() => setShowFiles(false)}
              onCountChange={setFileCount}
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-4 shrink-0 gap-4">
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

      <div className="flex items-center gap-1 mb-3 shrink-0">
        <button
          onClick={() => setListTab("active")}
          className={`text-[12.5px] px-2.5 py-1 rounded-full transition-colors ${
            listTab === "active" ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setListTab("archived")}
          className={`text-[12.5px] px-2.5 py-1 rounded-full transition-colors ${
            listTab === "archived" ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
        </button>
      </div>

      {filteredProjects.length === 0 && listTab === "archived" && (
        <div className="text-center py-16 border border-dashed border-line rounded-2xl mb-6">
          <p className="text-[13px] text-ink/70">No archived projects.</p>
        </div>
      )}

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
                      type="date"
                      value={newProject.deadline}
                      onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
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
