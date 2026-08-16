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
import type { ProjectFull, ChatMessage } from "../../types";
import type { WindowType } from "../windowTypes";
import { api } from "../../lib/api";
import { HandoverPanel } from "./HandoverPanel";

/** Projects window: list + detail view, create modal, and the Project Copilot. */
export function ProjectsApp({
  showToast,
  onOpenWindow,
}: {
  showToast: (msg: string) => void;
  onOpenWindow: (type: WindowType) => void;
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

  const [newProject, setNewProject] = useState<Partial<ProjectFull>>({
    name: "",
    client: "",
    status: "Planning",
    deadline: "",
    progress: 0,
    tags: [],
  });

  // Load projects from the SQLite-backed API so they survive a refresh.
  useEffect(() => {
    api.getProjects().then(setProjectsList).catch((e) => console.error("Failed to load projects", e));
  }, []);

  // Load the live handover count whenever a project's detail view opens, so the
  // "Handovers" card shows the real number of packages.
  useEffect(() => {
    setShowHandovers(false);
    setHandoverCount(null);
    if (selectedProject) {
      api
        .getHandovers(selectedProject.id)
        .then((list) => setHandoverCount(list.length))
        .catch((e) => console.error("Failed to load handover count", e));
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
    setProjectsList((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const statuses: ProjectFull["status"][] = ["Planning", "In Progress", "Review", "Archived"];
        const nextIndex = (statuses.indexOf(p.status) + 1) % statuses.length;
        const updated = { ...p, status: statuses[nextIndex] };
        if (selectedProject?.id === p.id) setSelectedProject(updated);
        return updated;
      })
    );
  };

  const getStatusColor = (status: ProjectFull["status"]) => {
    switch (status) {
      case "Planning":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "In Progress":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "Review":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "Archived":
        return "bg-white/5 text-white/40 border-white/10";
      default:
        return "bg-white/5 text-[#DBCBC2]/80 border-white/10";
    }
  };

  const getStatusDotColor = (status: ProjectFull["status"]) => {
    switch (status) {
      case "Planning":
        return "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]";
      case "In Progress":
        return "bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]";
      case "Review":
        return "bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.5)]";
      case "Archived":
        return "bg-white/40 shadow-[0_0_12px_rgba(255,255,255,0.2)]";
      default:
        return "bg-[#D85E25] shadow-[0_0_12px_rgba(216,94,37,0.5)]";
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
      <div className="flex flex-col h-full text-[#EBE6DD] w-full relative">
        <div className="flex items-center gap-4 mb-6 shrink-0">
          <button
            onClick={() => setSelectedProject(null)}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors group"
          >
            <ArrowRight className="w-4 h-4 text-white/60 group-hover:text-white rotate-180" />
          </button>
          <div>
            <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/60 font-mono">
              Projects / {selectedProject.client}
            </span>
            <h2 className="font-display text-[28px] uppercase leading-none mt-1">{selectedProject.name}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[#34A853]/10 hover:bg-[#34A853]/20 rounded-lg text-[10px] uppercase tracking-widest transition-colors font-medium border border-[#34A853]/30 text-[#34A853]"
            >
              <Sparkles className="w-4 h-4" /> Copilot
            </button>
            <button
              onClick={() => showToast("Edit Project functionality coming soon")}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] uppercase tracking-widest transition-colors font-medium border border-white/5"
            >
              <CheckCircle className="w-4 h-4" /> Edit
            </button>
            <button
              onClick={() => showToast("Project archived")}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] uppercase tracking-widest transition-colors font-medium border border-[#D85E25]/30 text-[#D85E25]"
            >
              <Archive className="w-4 h-4" /> Archive
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6 shrink-0">
          <div className="bg-[#111]/60 p-4 rounded-2xl border border-white/5">
            <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 block mb-3 font-mono">Status</span>
            <div
              className="flex items-center gap-3 cursor-pointer group"
              onClick={(e) => toggleProjectStatus(selectedProject.id, e)}
            >
              <div className={`w-3 h-3 rounded-full transition-all duration-500 ${getStatusDotColor(selectedProject.status)}`}></div>
              <span className="text-[14px] uppercase tracking-wider group-hover:text-white transition-colors">
                {selectedProject.status}
              </span>
            </div>
          </div>
          <div className="bg-[#111]/60 p-4 rounded-2xl border border-white/5">
            <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 block mb-3 font-mono">Progress</span>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#D85E25] rounded-full" style={{ width: selectedProject.progress + "%" }}></div>
              </div>
              <span className="text-[16px] font-mono">{selectedProject.progress}%</span>
            </div>
          </div>
          <div className="bg-[#111]/60 p-4 rounded-2xl border border-white/5">
            <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 block mb-3 font-mono">Deadline</span>
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-white/40" />
              <span className="text-[14px] uppercase tracking-wider truncate">{selectedProject.deadline}</span>
            </div>
          </div>
          <div className="bg-[#111]/60 p-4 rounded-2xl border border-white/5 overflow-hidden">
            <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 block mb-3 font-mono">Team</span>
            <div className="flex -space-x-2">
              {selectedProject.team.map((m, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full bg-[#1a1a1a] border-2 border-[#111] flex items-center justify-center text-[9px] uppercase font-bold text-white/80"
                >
                  {m}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-6">
          <h3 className="font-display text-[16px] uppercase tracking-widest mb-4">Linked Resources</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max">
            {/* Full class strings (not interpolated) so Tailwind keeps them in the build. */}
            {[
              {
                icon: FileText,
                iconClass: "p-3 bg-blue-500/10 text-blue-400 rounded-lg group-hover:scale-110 transition-transform",
                label: "Files & Assets",
                count: `${selectedProject.linked.files} ITEMS`,
                // Opens the File Vault window, where files/assets can be uploaded and managed.
                onClick: () => {
                  onOpenWindow("files");
                  showToast("Opening File Vault…");
                },
              },
              { icon: Target, iconClass: "p-3 bg-purple-500/10 text-purple-400 rounded-lg group-hover:scale-110 transition-transform", label: "Tasks & Milestones", count: `${selectedProject.linked.tasks} ITEMS`, onClick: () => showToast("Tasks & Milestones — coming soon") },
              { icon: MessageSquare, iconClass: "p-3 bg-yellow-500/10 text-yellow-400 rounded-lg group-hover:scale-110 transition-transform", label: "Messages", count: `${selectedProject.linked.messages} THREADS`, onClick: () => showToast("Messages — coming soon") },
              { icon: CreditCard, iconClass: "p-3 bg-green-500/10 text-green-400 rounded-lg group-hover:scale-110 transition-transform", label: "Invoices & Finance", count: `${selectedProject.linked.invoices} RECORDS`, onClick: () => showToast("Invoices & Finance — coming soon") },
              { icon: Package, iconClass: "p-3 bg-[#D85E25]/10 text-[#D85E25] rounded-lg group-hover:scale-110 transition-transform", label: "Handovers", count: `${handoverCount ?? selectedProject.linked.handovers} PACKAGES`, onClick: () => setShowHandovers(true) },
            ].map((item) => (
              <div
                key={item.label}
                onClick={item.onClick}
                className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 transition-colors p-5 rounded-xl cursor-pointer group flex flex-col items-start gap-4"
              >
                <div className={item.iconClass}>
                  <item.icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[14px] uppercase tracking-wider mb-1">{item.label}</h4>
                  <span className="text-[11px] font-mono text-white/40">{item.count}</span>
                </div>
              </div>
            ))}

            <div
              onClick={() => showToast("Linked Resource feature coming soon")}
              className="bg-transparent border border-dashed border-white/10 hover:border-white/30 transition-colors p-5 rounded-xl cursor-pointer flex flex-col items-center justify-center gap-3 min-h-[140px]"
            >
              <div className="p-2 bg-white/5 text-white/40 rounded-full">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-[#DBCBC2]/60 font-mono">Link Resource</span>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isAiModalOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-6 right-6 w-[360px] bg-[#0A0A0A] border border-white/10 shadow-2xl rounded-2xl overflow-hidden z-[100] flex flex-col max-h-[500px]"
            >
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-1.5 bg-[#34A853]/20 text-[#34A853] rounded-md">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <h3 className="text-[13px] uppercase tracking-widest font-bold">Project Copilot</h3>
                </div>
                <button onClick={() => setIsAiModalOpen(false)} className="text-white/40 hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-[250px]">
                {aiChatResponses.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-[12px] text-white/50 mb-2">
                      I'm your AI assistant for <strong>{selectedProject.name}</strong>.
                    </p>
                    <div className="flex flex-col gap-2 mt-4">
                      <button
                        onClick={() =>
                          sendCopilotMessage(
                            "Draft an update email to the client highlighting recent progress.",
                            selectedProject
                          )
                        }
                        className="text-left p-3 text-[11px] bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 transition-colors text-white/80"
                      >
                        Draft a project update email
                      </button>
                      <button
                        onClick={() =>
                          sendCopilotMessage("Analyze the deadlines and predict potential risks.", selectedProject)
                        }
                        className="text-left p-3 text-[11px] bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 transition-colors text-white/80"
                      >
                        Analyze pacing & risks
                      </button>
                    </div>
                  </div>
                ) : (
                  aiChatResponses.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                      <div
                        className={`px-4 py-3 rounded-2xl text-[12px] max-w-[90%] whitespace-pre-wrap leading-relaxed ${
                          msg.role === "user"
                            ? "bg-[#34A853] text-[#0A0A0A] font-medium rounded-br-sm"
                            : "bg-white/5 text-[#EBE6DD] rounded-bl-sm border border-white/5"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                {isAiLoading && (
                  <div className="flex items-start">
                    <div className="px-4 py-3 rounded-2xl text-[12px] bg-white/5 text-white/50 rounded-bl-sm border border-white/5">
                      <Sparkles className="w-4 h-4 animate-pulse text-[#34A853]" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-3 bg-white/[0.02] border-t border-white/5">
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
                    className="w-full bg-black/40 border border-[#34A853]/20 focus:border-[#34A853] rounded-xl pl-4 pr-10 py-3 text-[12px] text-white outline-none transition-colors"
                  />
                  <button
                    onClick={() => {
                      if (aiChatInput.trim() && !isAiLoading) sendCopilotMessage(aiChatInput.trim(), selectedProject);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-[#34A853] text-[#0A0A0A] rounded-lg hover:bg-[#34A853]/80 transition-colors"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
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
        </AnimatePresence>
      </div>
    );
  }

  // --- List view ---
  return (
    <div className="flex flex-col h-full text-[#EBE6DD] w-full relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 shrink-0 gap-4">
        <div>
          <h2 className="font-display text-[42px] uppercase leading-[0.8] mb-4">Projects</h2>
          <p className="text-[#DBCBC2]/80 text-[13px] tracking-wide">Active deliverables & engagements.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative w-full md:w-64 focus-within:border-[#D85E25] rounded-full transition-colors bg-[#111]/60 border border-white/10 px-4 py-2.5 flex items-center gap-3">
            <Search className="w-4 h-4 text-white/40 shrink-0" />
            <input
              type="text"
              placeholder="Search projects by name, client..."
              className="bg-transparent border-none outline-none text-[12px] w-full text-white placeholder:text-white/40 font-mono"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="shrink-0 flex items-center gap-2 bg-[#D85E25] hover:bg-[#D85E25]/80 transition-colors px-5 py-2.5 rounded-full text-[11px] uppercase tracking-widest font-medium"
          >
            <Plus className="w-4 h-4" /> New Project
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
        {filteredProjects.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedProject(p)}
            className="bg-[#111]/60 hover:bg-[#1a1a1a]/80 backdrop-blur-md rounded-2xl p-6 border border-white/5 hover:border-white/20 transition-all cursor-pointer group flex flex-col h-[200px]"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-[85%] pr-2">
                <h3 className="font-display text-[20px] uppercase tracking-wider mb-1 leading-none truncate">{p.name}</h3>
                <span className="text-[#DBCBC2]/60 text-[11px] uppercase tracking-widest truncate block">{p.client}</span>
              </div>
              <div
                onClick={(e) => toggleProjectStatus(p.id, e)}
                className={`px-3 py-1.5 rounded-full border text-[9px] uppercase tracking-widest font-medium whitespace-nowrap transition-all duration-500 hover:brightness-125 cursor-pointer ${getStatusColor(
                  p.status
                )}`}
              >
                <span className="transition-opacity duration-300 drop-shadow-sm">{p.status}</span>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap mb-4 overflow-hidden h-[24px]">
              {p.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded bg-white/5 text-[9px] uppercase tracking-widest text-[#DBCBC2]/60 border border-white/5 truncate max-w-[80px]"
                >
                  #{t}
                </span>
              ))}
              {p.tags.length > 3 && (
                <span className="px-2 py-0.5 rounded bg-white/5 text-[9px] uppercase tracking-widest text-[#DBCBC2]/60 border border-white/5">
                  +{p.tags.length - 3}
                </span>
              )}
            </div>

            <div className="mt-auto">
              <div className="flex items-center justify-between mb-3 text-[10px] font-mono text-white/40 uppercase tracking-widest">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {p.team.length} Members
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> Due {p.deadline}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#D85E25] rounded-full transition-all duration-1000" style={{ width: p.progress + "%" }}></div>
                </div>
                <span className="text-[12px] font-mono text-[#DBCBC2]/80">{p.progress}%</span>
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
            className="absolute inset-[-40px] bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6 mb-[48px]"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#111] border border-white/10 rounded-2xl p-6 md:p-8 w-full max-w-md shadow-2xl relative"
            >
              <button onClick={() => setIsCreating(false)} className="absolute top-6 right-6 text-white/40 hover:text-white">
                <X className="w-5 h-5" />
              </button>
              <h3 className="font-display text-[24px] uppercase mb-6">New Project</h3>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                    placeholder="e.g. Q4 Website Redesign"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">
                    Client Name
                  </label>
                  <input
                    type="text"
                    value={newProject.client}
                    onChange={(e) => setNewProject({ ...newProject, client: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                    placeholder="e.g. Acme Corp"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">Status</label>
                    <select
                      value={newProject.status}
                      onChange={(e) => setNewProject({ ...newProject, status: e.target.value as ProjectFull["status"] })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors cursor-pointer *:bg-[#0a0a0a]"
                    >
                      <option value="Planning">Planning</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Review">Review</option>
                      <option value="Archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-mono tracking-widest text-white/40 block mb-2">
                      Deadline
                    </label>
                    <input
                      type="text"
                      value={newProject.deadline}
                      onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white outline-none focus:border-[#D85E25] transition-colors"
                      placeholder="e.g. Dec 15"
                    />
                  </div>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={!newProject.name}
                  className="mt-4 w-full bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg text-[11px] uppercase tracking-widest font-medium"
                >
                  Create Project
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
