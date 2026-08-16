import { useState, useEffect, useRef } from "react";
import { Moon, Sun, ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Toast } from "../components/Toast";
import { WidgetCard } from "../components/WidgetCard";
import { AssistantBox } from "../components/assistant/AssistantBox";
import { ProjectsApp } from "../components/apps/ProjectsApp";
import { FileVaultApp } from "../components/apps/FileVaultApp";
import { ClientPortalApp } from "../components/apps/ClientPortalApp";
import { CalendarApp } from "../components/apps/CalendarApp";
import type { WindowType } from "../components/windowTypes";

/**
 * The Dashboard is the app shell. The left area shows either the "home" screen
 * (logo, menu, greeting + assistant) or an open app rendered inline, filling
 * that area. The right-hand column of widget cards launches / switches apps.
 * There is no floating-window or dock system — one app is visible at a time,
 * in place. Each app (Projects, File Vault, Client Portal, Calendar) lives in
 * its own component under src/components/apps/.
 */

/** Workspace user shown in the home-screen greeting (no auth/profile system yet). */
const USER_NAME = "Elias";

/** Time-of-day greeting for the home screen. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Welcome back";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Dashboard() {
  const [time, setTime] = useState(new Date());
  const [activeView, setActiveView] = useState<WindowType | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isLightMode, setIsLightMode] = useState(true);
  const [activeMenu, setActiveMenu] = useState("home");
  // File the vault should open pre-selected (set by assistant citation chips).
  const [vaultFileId, setVaultFileId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string) => setToastMessage(message);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date, tzStr: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tzStr }).format(date);

  const menuItems = [
    { key: "home", label: "Home" },
    { key: "messaging", label: "Messaging" },
    { key: "team", label: "Team" },
    { key: "settings", label: "Settings" },
  ];

  const onMenuClick = (item: { key: string; label: string }) => {
    setActiveMenu(item.key);
    if (item.key === "home") setActiveView(null);
    else showToast(`${item.label} — coming soon`);
  };

  // Open (or switch to) an app in the inline view.
  const openWindow = (type: WindowType) => setActiveView(type);
  const goHome = () => {
    setActiveView(null);
    setActiveMenu("home");
  };

  const renderActiveApp = () => {
    switch (activeView) {
      case "projects":
        return <ProjectsApp showToast={showToast} onOpenWindow={openWindow} />;
      case "files":
        return <FileVaultApp showToast={showToast} initialFileId={vaultFileId} />;
      case "client":
        return <ClientPortalApp showToast={showToast} />;
      case "calendar":
        return <CalendarApp showToast={showToast} />;
      default:
        return null;
    }
  };

  const activeTitle =
    activeView === "files"
      ? "File Vault"
      : activeView === "client"
      ? "Client Portal"
      : activeView
      ? activeView.charAt(0).toUpperCase() + activeView.slice(1)
      : "";

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex relative overflow-hidden mesh-bg mx-auto transition-all duration-700"
      style={isLightMode ? { filter: "invert(1) hue-rotate(180deg)" } : {}}
    >
      <div className="glass-noise pointer-events-none"></div>

      <div className="absolute inset-0 p-8 md:p-10 lg:p-[52px] flex flex-col md:flex-row justify-between z-10 w-full h-full gap-8">
        {/* Left / main content column */}
        <div className="flex flex-col h-full flex-1 min-w-[300px] min-h-0">
          {/* Logo row (+ back button when an app is open) */}
          <div className="flex items-center gap-4 mb-8 shrink-0">
            <button onClick={goHome} className="flex items-center gap-2" title="Home">
              <span className="font-display font-light text-[26px] tracking-tight text-[#EBE6DD]">desboard</span>
              <span className="text-[10px] text-[#DBCBC2]/60 -mt-2">©</span>
            </button>
            {activeView && (
              <button
                onClick={goHome}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-light text-[#DBCBC2]/60 hover:text-[#EBE6DD] transition-colors ml-2 pt-0.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Home
              </button>
            )}
          </div>

          {/* Middle: home hero OR the active app, filling the area */}
          <div className="flex-1 min-h-0 flex flex-col">
            <AnimatePresence mode="wait">
              {activeView === null ? (
                <motion.div
                  key="home"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 min-h-0 flex flex-col"
                >
                  {/* Left menu */}
                  <nav className="flex flex-col items-start gap-3.5">
                    {menuItems.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => onMenuClick(item)}
                        className={`text-left text-[13px] uppercase tracking-[0.2em] font-light transition-colors ${
                          activeMenu === item.key ? "text-[#EBE6DD]" : "text-[#DBCBC2]/45 hover:text-[#DBCBC2]/85"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </nav>

                  {/* Centered assistant — the home screen's command surface */}
                  <div className="flex-1 min-h-0 flex flex-col justify-center py-6">
                    <h1 className="font-display font-light text-[26px] sm:text-[32px] tracking-tight text-[#EBE6DD] text-center mb-5">
                      {greeting()}, {USER_NAME}
                    </h1>
                    <AssistantBox
                      onOpenFile={(fileId) => {
                        setVaultFileId(fileId);
                        openWindow("files");
                      }}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={activeView}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 min-h-0 flex flex-col"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[#DBCBC2]/50 mb-4 shrink-0">{activeTitle}</span>
                  <div className="flex-1 min-h-0">{renderActiveApp()}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bottom-left: world clock + light mode toggle (persistent) */}
          <div className="flex items-end gap-8 shrink-0 pt-6">
            <div className="flex flex-col gap-1 font-mono text-[10px] leading-[1.5] text-[#DBCBC2]/70 tracking-tight">
              <span>{formatTime(time, "Europe/London")} &nbsp;LON</span>
              <span>{formatTime(time, "America/New_York")} &nbsp;NYC</span>
              <span>{formatTime(time, "America/Chicago")} &nbsp;CHI</span>
            </div>
            <button
              onClick={() => setIsLightMode(!isLightMode)}
              className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-light text-[#DBCBC2]/70 hover:text-[#EBE6DD] transition-colors pointer-events-auto"
              title="Toggle high-contrast theme"
            >
              {isLightMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              {isLightMode ? "Dark" : "Light"}
            </button>
          </div>
        </div>

        {/* Right widgets column — always visible; launches / switches apps */}
        <div className="w-full md:w-[320px] lg:w-[340px] flex flex-col gap-2 shrink-0 self-end mt-4 md:mt-0 h-full z-20 overflow-hidden">
          <WidgetCard title="Projects" active={activeView === "projects"} onClick={() => openWindow("projects")}>
            <div className="flex justify-between items-end">
              <div className="flex flex-col">
                <span className="text-white/40 text-[9px] uppercase tracking-widest mb-1">Current</span>
                <span className="font-display text-[11px] tracking-wider uppercase text-[#EBE6DD] line-clamp-1">Active Deliverables</span>
              </div>
              <span className="text-white/70 text-[9px] mb-[1px] whitespace-nowrap ml-2">3 Tracked</span>
            </div>
          </WidgetCard>

          <WidgetCard title="File Vault" active={activeView === "files"} onClick={() => openWindow("files")}>
            <div className="flex justify-between items-end mb-2">
              <div className="flex flex-col overflow-hidden pr-2">
                <span className="text-white/40 text-[9px] uppercase tracking-widest mb-1">Synced</span>
                <span className="font-display text-[11px] tracking-wider uppercase text-[#EBE6DD] truncate">Brand_Guidelines.pdf</span>
              </div>
              <span className="text-white/70 text-[8px] font-mono tracking-widest mb-[1px] whitespace-nowrap">JUST NOW</span>
            </div>
            <div className="w-full h-1 bg-[#D85E25] rounded-full"></div>
          </WidgetCard>

          <WidgetCard title="Client Portal" active={activeView === "client"} onClick={() => openWindow("client")}>
            <div className="flex justify-between items-end">
              <div className="flex flex-col w-[60%]">
                <span className="text-white/60 text-[9px] font-medium tracking-widest uppercase mb-1 truncate">Handover Room:</span>
                <span className="text-[#EBE6DD] text-[10px] font-medium tracking-wide truncate">Acme Desktop UI</span>
              </div>
              <div className="flex flex-col text-right items-end">
                <span className="text-[#D85E25] text-[9px] uppercase font-bold tracking-widest">Pending</span>
              </div>
            </div>
          </WidgetCard>

          <WidgetCard title="Calendar" active={activeView === "calendar"} onClick={() => openWindow("calendar")}>
            <div className="flex-1 grid grid-cols-7 gap-1 pt-1 opacity-80 select-none pointer-events-none">
              {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
                <div key={`${day}-${i}`} className="text-center text-[7px] text-white/40 mb-1">
                  {day}
                </div>
              ))}
              {Array.from({ length: 31 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex items-center text-[8px] justify-center text-white/80 ${
                    i === 14 ? "bg-[#D85E25] rounded text-white" : ""
                  } ${i === 20 ? "border border-white/20 rounded" : ""}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </WidgetCard>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
