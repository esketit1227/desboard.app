import { useState, useEffect } from "react";
import { FileText, Download, CheckCircle, Link as LinkIcon, Package } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { ProjectFull, Handover, VaultFile, StudioSettings } from "../../types";
import { api } from "../../lib/api";
import { HandoverPanel } from "./HandoverPanel";

/** Client Portal window: a brandable, client-facing tracking & handover space. */
export function ClientPortalApp({ showToast }: { showToast: (msg: string) => void }) {
  const [viewMode, setViewMode] = useState<"edit" | "preview">("preview");

  // Brand settings — accent is studio-wide (Settings); client name/portal title
  // are shown from the selected project's own real data, not free text.
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [accentColor, setAccentColor] = useState("#D85E25");
  const [savingBrand, setSavingBrand] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setAccentColor(s.brandAccent);
      })
      .catch((e) => console.error("Failed to load settings", e));
  }, []);

  const saveBrand = async () => {
    setSavingBrand(true);
    try {
      const updated = await api.updateSettings({ brandAccent: accentColor });
      setSettings(updated);
      showToast("Brand settings saved");
    } catch (e) {
      console.error("Failed to save brand settings", e);
      showToast("Could not save brand settings");
    } finally {
      setSavingBrand(false);
    }
  };

  const [activeTab, setActiveTab] = useState<"timeline" | "files">("timeline");

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
        setSelectedProjectId(list[0]?.id ?? "");
      })
      .catch((e) => console.error("Failed to load projects", e));
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const clientName = selectedProject?.client || "Your client";
  const portalTitle = selectedProject?.name || "Project Hub";

  // Timeline + files reflect the selected project's real handovers/files, not
  // fixture data — this preview shows what a client visiting the real portal
  // link would actually see.
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [allFiles, setAllFiles] = useState<VaultFile[]>([]);

  const refreshHandovers = () => {
    if (!selectedProjectId) {
      setHandovers([]);
      return;
    }
    api
      .getHandovers(selectedProjectId)
      .then(setHandovers)
      .catch((e) => console.error("Failed to load handovers", e));
  };

  useEffect(refreshHandovers, [selectedProjectId]);

  useEffect(() => {
    api.getFiles().then(setAllFiles).catch((e) => console.error("Failed to load files", e));
  }, []);

  const numericProjectId = selectedProject ? Number(selectedProject.id.replace(/^p/, "")) : null;
  const projectFiles = numericProjectId != null ? allFiles.filter((f) => f.projectId === numericProjectId) : [];

  const milestoneStatus = (status: Handover["status"]) =>
    status === "Accepted" ? "Approved" : status === "Sent" ? "Pending Review" : "Not Started";

  const approveHandover = async (h: Handover) => {
    try {
      const updated = await api.updateHandover(h.id, { status: "Accepted" });
      setHandovers((prev) => prev.map((x) => (x.id === h.id ? updated : x)));
      showToast("Approved");
    } catch (e) {
      console.error("Failed to approve handover", e);
      showToast("Could not record approval");
    }
  };

  return (
    <div className="flex flex-col h-full text-ink w-full relative">
      {/* Header */}
      <div className="flex justify-between items-end mb-6 shrink-0">
        <p className="text-muted text-[14px]">Brandable tracking &amp; handover space.</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Project picker + real handovers */}
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-panel border border-line rounded-full px-4 py-2 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors cursor-pointer max-w-[180px]"
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
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-white hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Package className="w-4 h-4" /> Handovers
          </button>
          <button
            onClick={() => setViewMode("edit")}
            className={`px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
              viewMode === "edit" ? "bg-ink text-paper" : "bg-panel hover:bg-chip text-ink"
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setViewMode("preview")}
            className={`px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
              viewMode === "preview" ? "bg-ink text-paper" : "bg-panel hover:bg-chip text-ink"
            }`}
          >
            Preview
          </button>
        </div>
      </div>

      {viewMode === "edit" ? (
        <div className="flex-1 overflow-y-auto pr-2 pb-6">
          <div className="bg-panel rounded-2xl p-6 md:p-8 max-w-2xl">
            <h3 className="text-[16px] font-semibold text-ink mb-6 border-b border-line pb-4">Brand settings</h3>
            <div className="flex flex-col gap-6">
              <div>
                <label className="text-[13px] text-muted block mb-2">Client name</label>
                <div className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink/70">
                  {clientName}
                </div>
                <p className="text-[11.5px] text-muted mt-1.5">From the selected project's client field.</p>
              </div>
              <div>
                <label className="text-[13px] text-muted block mb-2">Portal title</label>
                <div className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink/70">
                  {portalTitle}
                </div>
                <p className="text-[11.5px] text-muted mt-1.5">The selected project's name.</p>
              </div>
              <div>
                <label className="text-[13px] text-muted block mb-2">Accent color</label>
                <div className="flex gap-3 flex-wrap">
                  {["#D85E25", "#34A853", "#4285F4", "#9C27B0", "#E91E63", "#000000", "#FFFFFF"].map((color) => (
                    <button
                      key={color}
                      onClick={() => setAccentColor(color)}
                      className={`w-8 h-8 rounded-full border-[3px] transition-transform hover:scale-110 ${
                        accentColor === color ? "border-ink/30 scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    ></button>
                  ))}
                </div>
                <p className="text-[11.5px] text-muted mt-2">Studio-wide default — pre-fills new handovers' branding too.</p>
              </div>
              <div className="pt-4 border-t border-line">
                <button
                  onClick={saveBrand}
                  disabled={savingBrand || !settings}
                  className="w-full bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors px-5 py-3 rounded-xl text-[13px] font-semibold"
                >
                  {savingBrand ? "Saving…" : "Save configuration"}
                </button>
                <button
                  onClick={() => {
                    const latest = handovers[0];
                    if (!latest) {
                      showToast("Create a handover first");
                      return;
                    }
                    navigator.clipboard.writeText(`${window.location.origin}/portal/${latest.token}`);
                    showToast("Portal link copied!");
                  }}
                  className="mt-3 w-full bg-panel hover:bg-chip text-ink transition-colors px-5 py-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2"
                >
                  <LinkIcon className="w-4 h-4" /> Copy access link
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-panel rounded-2xl p-4 md:p-8">
          <div className="absolute top-4 left-4 flex gap-2 items-center text-[12px] text-muted">
            <div className="w-2 h-2 rounded-full bg-moss animate-pulse"></div>
            Live preview mode
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
                {["timeline", "files"].map((tab) => (
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
                  {handovers.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                      <p className="text-[13px] text-white/60 mb-1">No handover packages yet</p>
                      <p className="text-[12px] text-white/30">Create one to show a timeline here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="absolute left-[13px] top-3 bottom-0 w-px bg-white/10 z-0"></div>
                      {handovers.map((h) => {
                        const status = milestoneStatus(h.status);
                        return (
                          <div key={h.id} className="flex items-start gap-4 md:gap-6 relative z-10 w-full">
                            <div
                              className="w-7 h-7 rounded-full flex shrink-0 items-center justify-center border-[4px] border-[#0A0A0A] relative z-10 transition-colors"
                              style={{
                                backgroundColor:
                                  status === "Approved"
                                    ? accentColor === "#000000"
                                      ? "#FFF"
                                      : accentColor
                                    : status === "Pending Review"
                                    ? "#EAB308"
                                    : "#333",
                              }}
                            >
                              {status === "Approved" && (
                                <CheckCircle className={`w-3.5 h-3.5 ${accentColor === "#FFFFFF" ? "text-black" : "text-white"}`} />
                              )}
                            </div>
                            <div className="flex-1 flex flex-col sm:flex-row justify-between sm:items-center -mt-1 bg-white/[0.02] border border-white/5 rounded-xl p-4 md:p-5 hover:bg-white/[0.04] transition-colors gap-4">
                              <div>
                                <h4 className="font-display text-[16px] md:text-[18px] uppercase tracking-wider text-[#EBE6DD] mb-2">
                                  {h.title}
                                </h4>
                                <span className="text-[#DBCBC2]/60 text-[10px] font-mono tracking-widest bg-white/5 px-2 py-1 rounded-md">
                                  {h.created}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                {status === "Pending Review" ? (
                                  <button
                                    onClick={() => approveHandover(h)}
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
                                        status === "Approved" ? (accentColor === "#000000" ? "#FFF" : accentColor) : "#666",
                                    }}
                                  >
                                    {status}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {activeTab === "files" && (
                <div className="flex flex-col gap-3 max-w-2xl mx-auto">
                  {projectFiles.length === 0 ? (
                    <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
                      <p className="text-[13px] text-white/60 mb-1">No files linked to this project yet</p>
                    </div>
                  ) : (
                    projectFiles.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-colors group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-white/5 rounded-lg text-white/50 group-hover:text-white transition-colors">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="block text-[13px] font-medium text-[#EBE6DD] truncate pr-4">{f.name}</span>
                            <span className="block text-[10px] uppercase tracking-widest text-[#DBCBC2]/40 font-mono mt-1">
                              {f.size} • {f.created}
                            </span>
                          </div>
                        </div>
                        <a
                          href={`/api/files/${f.id}/download`}
                          download={f.name}
                          className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showHandovers && selectedProject && (
          <HandoverPanel
            project={selectedProject}
            onClose={() => {
              setShowHandovers(false);
              refreshHandovers();
            }}
            showToast={showToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
