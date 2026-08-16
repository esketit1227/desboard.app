import { useState, useEffect } from "react";
import { FileText, Download, CreditCard, CheckCircle, Link as LinkIcon, Package } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { ProjectFull } from "../../types";
import { api } from "../../lib/api";
import { HandoverPanel } from "./HandoverPanel";

/** Client Portal window: a brandable, client-facing tracking & handover space. */
export function ClientPortalApp({ showToast }: { showToast: (msg: string) => void }) {
  const [viewMode, setViewMode] = useState<"edit" | "preview">("preview");

  // Brand settings
  const [accentColor, setAccentColor] = useState("#D85E25");
  const [clientName, setClientName] = useState("Acme Corp");
  const [portalTitle, setPortalTitle] = useState("Project Hub");

  const [activeTab, setActiveTab] = useState<"timeline" | "files" | "invoices">("timeline");

  // Handovers (real feature) — pick a project, then manage its packages / branded
  // page / client discussion via the shared HandoverPanel.
  const [projects, setProjects] = useState<ProjectFull[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [showHandovers, setShowHandovers] = useState(false);

  useEffect(() => {
    api
      .getProjects()
      .then((list) => {
        setProjects(list);
        // Default to the project whose client matches the portal, else the first.
        const match = list.find((p) => p.client.toLowerCase() === clientName.toLowerCase());
        setSelectedProjectId((match ?? list[0])?.id ?? "");
      })
      .catch((e) => console.error("Failed to load projects", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const portalMilestones = [
    { id: 1, title: "Wireframes", status: "Approved", date: "Oct 12" },
    { id: 2, title: "Visual Design", status: "Pending Review", date: "Oct 15" },
    { id: 3, title: "Handoff Package", status: "Not Started", date: "Oct 20" },
  ];

  const portalFiles = [
    { id: 1, name: "Acme_Brand_Guidelines.pdf", size: "12MB", date: "Oct 10" },
    { id: 2, name: "Homepage_Design_v2.fig", size: "34MB", date: "Oct 14" },
  ];

  return (
    <div className="flex flex-col h-full text-[#EBE6DD] w-full relative">
      {/* Header */}
      <div className="flex justify-between items-end mb-6 shrink-0">
        <div>
          <h2 className="font-display text-[42px] uppercase leading-[0.8] mb-4">Client Portal</h2>
          <p className="text-[#DBCBC2]/80 text-[13px] tracking-wide">Brandable tracking & handover space.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Project picker + real handovers */}
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-full px-4 py-2 text-[11px] uppercase tracking-widest text-white outline-none focus:border-[#D85E25] transition-colors cursor-pointer *:bg-[#0a0a0a] max-w-[180px]"
            title="Choose a project"
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedProject && setShowHandovers(true)}
            disabled={!selectedProject}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium bg-[#D85E25] hover:bg-[#D85E25]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Package className="w-4 h-4" /> Handovers
          </button>
          <button
            onClick={() => setViewMode("edit")}
            className={`px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium transition-colors ${
              viewMode === "edit" ? "bg-[#D85E25] text-white" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setViewMode("preview")}
            className={`px-4 py-2 rounded-full text-[11px] uppercase tracking-widest font-medium transition-colors ${
              viewMode === "preview" ? "bg-[#D85E25] text-white" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {viewMode === "edit" ? (
        <div className="flex-1 overflow-y-auto pr-2 pb-6">
          <div className="bg-[#111]/60 backdrop-blur-md rounded-2xl border border-white/5 p-6 md:p-8 max-w-2xl">
            <h3 className="font-display text-[24px] uppercase tracking-widest mb-6 border-b border-white/10 pb-4">
              Brand Settings
            </h3>
            <div className="flex flex-col gap-6">
              <div>
                <label className="text-[10px] uppercase font-mono tracking-widest text-white/50 block mb-2">
                  Client Name
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono tracking-widest text-white/50 block mb-2">
                  Portal Title
                </label>
                <input
                  type="text"
                  value={portalTitle}
                  onChange={(e) => setPortalTitle(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-[13px] text-white focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono tracking-widest text-white/50 block mb-2">
                  Accent Color
                </label>
                <div className="flex gap-3 flex-wrap">
                  {["#D85E25", "#34A853", "#4285F4", "#9C27B0", "#E91E63", "#000000", "#FFFFFF"].map((color) => (
                    <button
                      key={color}
                      onClick={() => setAccentColor(color)}
                      className={`w-8 h-8 rounded-full border-[3px] transition-transform hover:scale-110 ${
                        accentColor === color ? "border-white/50 scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    ></button>
                  ))}
                </div>
              </div>
              <div className="pt-4 border-t border-white/10">
                <button
                  onClick={() => showToast("Changes saved")}
                  className="w-full bg-[#D85E25] hover:bg-[#D85E25]/80 text-white transition-colors px-5 py-3 rounded-xl text-[11px] uppercase tracking-widest font-bold"
                >
                  Save Configuration
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`https://desboard.app/portal/acme`);
                    showToast("Portal link copied!");
                  }}
                  className="mt-3 w-full bg-white/5 hover:bg-white/10 text-white transition-colors px-5 py-3 rounded-xl text-[11px] uppercase tracking-widest font-bold flex items-center justify-center gap-2 border border-white/10"
                >
                  <LinkIcon className="w-4 h-4" /> Copy Access Link
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-[#0A0A0A] rounded-2xl border border-white/5 p-4 md:p-8">
          <div className="absolute top-4 left-4 flex gap-2 items-center text-[10px] uppercase tracking-widest text-white/30 font-mono">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            Live Preview Mode
          </div>
          <div className="w-full max-w-[800px] h-full bg-[#111] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">
            <div className="h-[4px] w-full shrink-0 transition-colors" style={{ backgroundColor: accentColor }}></div>
            <div className="p-8 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
              <div>
                <h1
                  className="font-display text-[32px] uppercase leading-none mb-2 transition-colors"
                  style={{ color: accentColor === "#000000" ? "#FFF" : accentColor }}
                >
                  {clientName}
                </h1>
                <div className="text-white/40 text-[12px] uppercase tracking-widest">{portalTitle}</div>
              </div>
              <div className="flex gap-4 border border-white/10 rounded-full p-1 bg-black/20">
                {["timeline", "files", "invoices"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`text-[10px] uppercase tracking-widest font-bold transition-all px-4 py-2 rounded-full ${
                      activeTab === tab ? "text-[#111]" : "text-white/40 hover:text-white/80"
                    }`}
                    style={{
                      backgroundColor:
                        activeTab === tab ? (accentColor === "#000000" ? "#FFF" : accentColor) : "transparent",
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-black/20">
              {activeTab === "timeline" && (
                <div className="flex flex-col gap-8 relative pb-4 max-w-xl mx-auto">
                  <div className="absolute left-[13px] top-3 bottom-0 w-px bg-white/10 z-0"></div>
                  {portalMilestones.map((m) => (
                    <div key={m.id} className="flex items-start gap-4 md:gap-6 relative z-10 w-full">
                      <div
                        className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center border-[4px] border-[#0A0A0A] relative z-10 transition-colors"
                        style={{
                          backgroundColor:
                            m.status === "Approved"
                              ? accentColor === "#000000"
                                ? "#FFF"
                                : accentColor
                              : m.status === "Pending Review"
                              ? "#EAB308"
                              : "#333",
                        }}
                      >
                        {m.status === "Approved" && (
                          <CheckCircle className={`w-3.5 h-3.5 ${accentColor === "#FFFFFF" ? "text-black" : "text-white"}`} />
                        )}
                      </div>
                      <div className="flex-1 flex flex-col sm:flex-row justify-between sm:items-center -mt-1 bg-white/[0.02] border border-white/5 rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors gap-4">
                        <div>
                          <h4 className="font-display text-[16px] md:text-[18px] uppercase tracking-wider text-[#EBE6DD] mb-2">
                            {m.title}
                          </h4>
                          <span className="text-[#DBCBC2]/60 text-[10px] font-mono tracking-widest bg-white/5 px-2 py-1 rounded-md">
                            {m.date}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {m.status === "Pending Review" ? (
                            <button
                              onClick={() => showToast("Approval recorded!")}
                              className="px-5 py-2.5 rounded-full text-[10px] uppercase font-bold tracking-widest transition-transform hover:scale-105 shadow-xl"
                              style={{
                                backgroundColor: accentColor === "#000000" ? "#FFF" : accentColor,
                                color: accentColor === "#FFFFFF" || accentColor === "#34A853" ? "#000" : "#FFF",
                              }}
                            >
                              Approve Phase
                            </button>
                          ) : (
                            <span
                              className="text-[11px] uppercase tracking-widest font-bold"
                              style={{
                                color:
                                  m.status === "Approved" ? (accentColor === "#000000" ? "#FFF" : accentColor) : "#666",
                              }}
                            >
                              {m.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "files" && (
                <div className="flex flex-col gap-3 max-w-2xl mx-auto">
                  {portalFiles.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/5 rounded-lg text-white/50 group-hover:text-white transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="block text-[13px] font-medium text-[#EBE6DD] truncate pr-4">{f.name}</span>
                          <span className="block text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 font-mono mt-1">
                            {f.size} • {f.date}
                          </span>
                        </div>
                      </div>
                      <button className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/50 group-hover:text-white group-hover:bg-white/10 transition-colors shrink-0">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "invoices" && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12 md:py-20">
                  <CreditCard className="w-12 h-12 text-white/20 mb-6" />
                  <span className="text-[14px] uppercase tracking-widest text-white/80 mb-2 font-display">
                    No Invoices Due
                  </span>
                  <span className="text-[12px] text-white/40">All payments are up to date.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showHandovers && selectedProject && (
          <HandoverPanel project={selectedProject} onClose={() => setShowHandovers(false)} showToast={showToast} />
        )}
      </AnimatePresence>
    </div>
  );
}
