import { useState, useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Moon,
  Sun,
  ArrowLeft,
  Home,
  Briefcase,
  Folder,
  Users,
  Calendar as CalendarIcon,
  MessageSquare,
  Contact,
  Settings as SettingsIcon,
  Plus,
  Search,
  ChevronDown,
  LogOut,
  Cloud,
  Menu,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Toast } from "../components/Toast";
import { AssistantBox } from "../components/assistant/AssistantBox";
import { ActivityList } from "../components/home/ActivityList";
import { InsightRail } from "../components/home/InsightRail";
import { CelebrationBanner } from "../components/home/CelebrationBanner";
import { TrialBanner } from "../components/home/TrialBanner";
import { ProjectsApp } from "../components/apps/ProjectsApp";
import { FileVaultApp } from "../components/apps/FileVaultApp";
import { ClientPortalApp } from "../components/apps/ClientPortalApp";
import { ConnectionsApp } from "../components/apps/ConnectionsApp";
import { CalendarApp } from "../components/apps/CalendarApp";
import { SettingsApp } from "../components/apps/SettingsApp";
import { TeamApp } from "../components/apps/TeamApp";
import { MessagingApp } from "../components/apps/MessagingApp";
import type { WindowType } from "../components/windowTypes";
import { api } from "../lib/api";
import { logAssistantEvent } from "../lib/assistant";
import { useAuth } from "../components/auth/AuthContext";
import type { DashboardData, DashboardInsight, VaultFile, ProjectFull } from "../types";

/**
 * The Dashboard is the app shell. The left area shows either the "home" screen
 * (logo, menu, greeting + assistant) or an open app rendered inline, filling
 * that area. The right-hand column of widget cards launches / switches apps.
 * There is no floating-window or dock system — one app is visible at a time,
 * in place. Each app (Projects, File Vault, Client Portal, Calendar) lives in
 * its own component under src/components/apps/.
 */

/** Time-of-day greeting for the home screen. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Welcome back";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const ACTIVITY_SEEN_KEY = "desboard_activity_seen";

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  kind: "home" | "app" | "stub";
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", icon: Home, kind: "home" },
  { key: "projects", label: "Projects", icon: Briefcase, kind: "app" },
  { key: "files", label: "File Vault", icon: Folder, kind: "app" },
  { key: "client", label: "Client Portal", icon: Users, kind: "app" },
  { key: "calendar", label: "Calendar", icon: CalendarIcon, kind: "app" },
  { key: "messaging", label: "Messaging", icon: MessageSquare, kind: "app" },
  { key: "team", label: "Roster", icon: Contact, kind: "app" },
  { key: "connections", label: "Connections", icon: Cloud, kind: "app" },
  { key: "settings", label: "Settings", icon: SettingsIcon, kind: "app" },
];

const THEME_KEY = "desboard_theme";
const HIGH_CONTRAST_KEY = "desboard_high_contrast";

// Content column width per app — sized to what each one's own layout actually
// needs, not one blanket number. A narrow default (880px) reads as "centered
// with dead space on both sides" the moment an app has real multi-panel
// content (a sidebar + detail pane, a month grid + agenda) to fill instead of
// prose. Home/Files/Client Portal already had their own tuned values; this
// extends the same treatment to the rest of the apps with real internal
// layout, rather than leaving them in the generic fallback.
const CONTENT_MAX_WIDTH: Partial<Record<WindowType, string>> = {
  files: "max-w-[1600px]",
  messaging: "max-w-[1400px]",
  client: "max-w-[1200px]",
  calendar: "max-w-[1200px]",
  team: "max-w-[1200px]",
  connections: "max-w-[1040px]",
  settings: "max-w-[1040px]",
};

export function Dashboard() {
  const { user, logout } = useAuth();
  const firstName = user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0] || "there";

  const [time, setTime] = useState(new Date());
  const [activeView, setActiveView] = useState<WindowType | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isLightMode, setIsLightModeState] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) !== "dark";
    } catch {
      return true;
    }
  });
  const setIsLightMode = (value: boolean) => {
    setIsLightModeState(value);
    try {
      localStorage.setItem(THEME_KEY, value ? "light" : "dark");
    } catch {
      /* best effort */
    }
  };
  const [highContrast, setHighContrastState] = useState(() => {
    try {
      return localStorage.getItem(HIGH_CONTRAST_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setHighContrast = (value: boolean) => {
    setHighContrastState(value);
    try {
      localStorage.setItem(HIGH_CONTRAST_KEY, value ? "1" : "0");
    } catch {
      /* best effort */
    }
  };
  const [activeMenu, setActiveMenu] = useState("home");
  // File the vault should open pre-selected (set by assistant citation chips).
  const [vaultFileId, setVaultFileId] = useState<string | null>(null);
  // Focus the vault's search field on open (sidebar Search shortcut).
  const [vaultFocusSearch, setVaultFocusSearch] = useState(false);
  // Project Projects should deep-open to, and whether to also open its Tasks
  // or Handovers panel (set by a Calendar entry, the greeting, or the rail).
  const [projectsInitialId, setProjectsInitialId] = useState<string | null>(null);
  const [projectsOpenTasks, setProjectsOpenTasks] = useState(false);
  const [projectsOpenHandovers, setProjectsOpenHandovers] = useState(false);
  const [projectsStartCreating, setProjectsStartCreating] = useState(false);
  // Project Messaging should prefer selecting a conversation for (a project's Messages tile).
  const [messagingProjectFilter, setMessagingProjectFilter] = useState<string | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [activitySeen, setActivitySeen] = useState<number>(() => {
    const raw = localStorage.getItem(ACTIVITY_SEEN_KEY);
    return raw ? Number(raw) : 0;
  });
  // Home-screen-only data for the Activity List and the sidebar's Recent group.
  const [homeProjects, setHomeProjects] = useState<ProjectFull[]>([]);
  const [homeFiles, setHomeFiles] = useState<VaultFile[]>([]);
  const [homeDataLoading, setHomeDataLoading] = useState(true);
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string) => setToastMessage(message);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Land back on Connections after an OAuth connect/callback round-trip
  // (a full-page redirect, so this is the only way back into the SPA's state).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("oauth");
    const error = params.get("oauth_error");
    if (!connected && !error) return;
    if (connected) showToast(`${connected.startsWith("google") ? "Google Drive" : "Dropbox"} connected`);
    if (error) showToast("Connection was cancelled");
    setActiveView("connections");
    setActiveMenu("connections");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Live home-screen data: greeting, insights, activity feed. Refreshed when
  // returning home and on a slow poll so client actions show up while working.
  useEffect(() => {
    const load = () => api.getDashboard().then(setDash).catch(() => {});
    load();
    const poll = setInterval(load, 60_000);
    return () => clearInterval(poll);
  }, [activeView]);

  // Projects + files for the Activity List and the sidebar's Recent group.
  useEffect(() => {
    setHomeDataLoading(true);
    Promise.all([api.getProjects(), api.getFiles()])
      .then(([p, f]) => {
        setHomeProjects(p);
        setHomeFiles(f);
      })
      .catch(() => {})
      .finally(() => setHomeDataLoading(false));
  }, [activeView]);

  const unseenActivity = dash
    ? dash.activity.filter((a) => Date.parse(a.created) > activitySeen).length
    : 0;

  const markActivitySeen = () => {
    const now = Date.now();
    setActivitySeen(now);
    try {
      localStorage.setItem(ACTIVITY_SEEN_KEY, String(now));
    } catch {
      /* best effort */
    }
  };

  const formatTime = (date: Date, tzStr: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tzStr }).format(date);

  // Open (or switch to) an app in the inline view.
  const openWindow = (type: WindowType) => setActiveView(type);
  const goHome = () => {
    setActiveView(null);
    setActiveMenu("home");
  };

  const openFile = (fileId: string) => {
    setVaultFileId(fileId);
    openWindow("files");
  };

  // Open a project, optionally landing directly on its Handovers list — the
  // greeting fact and the Activity List's "Needs you" rows both use this.
  const openProject = (projectId: string, showHandovers: boolean) => {
    setProjectsInitialId(projectId);
    setProjectsOpenTasks(false);
    setProjectsOpenHandovers(showHandovers);
    setProjectsStartCreating(false);
    setMobileNavOpen(false);
    openWindow("projects");
  };

  const handleInsightAction = (insight: DashboardInsight) => {
    logAssistantEvent("rail_action", insight.category);
    switch (insight.action.kind) {
      case "open":
        if (insight.action.fileId) openFile(insight.action.fileId);
        else openProject(insight.action.projectId, false);
        break;
      case "copy_link":
        navigator.clipboard.writeText(window.location.origin + insight.action.href).then(
          () => showToast("Portal link copied"),
          () => showToast("Couldn't copy the link")
        );
        break;
      case "extend_expiry":
        api
          .updateHandover(insight.action.handoverId, { expiresAt: insight.action.newExpiresAt })
          .then(() => {
            showToast("Expiry extended by 7 days");
            api.getDashboard().then(setDash).catch(() => {});
          })
          .catch(() => showToast("Couldn't extend the link"));
        break;
      case "reconnect":
        // Wired to the Connections screen once real OAuth lands.
        showToast("Reconnect from Settings once Connections is set up");
        break;
    }
  };

  const renderActiveApp = () => {
    switch (activeView) {
      case "projects":
        return (
          <ProjectsApp
            showToast={showToast}
            onOpenProjectMessages={(projectId) => {
              setMessagingProjectFilter(projectId);
              openWindow("messaging");
            }}
            initialProjectId={projectsInitialId}
            initialShowTasks={projectsOpenTasks}
            initialShowHandovers={projectsOpenHandovers}
            initialCreating={projectsStartCreating}
          />
        );
      case "files":
        return (
          <FileVaultApp
            showToast={showToast}
            initialFileId={vaultFileId}
            initialFocusSearch={vaultFocusSearch}
            highContrast={highContrast}
            onHighContrastChange={setHighContrast}
            onOpenConnections={() => openWindow("connections")}
          />
        );
      case "client":
        return <ClientPortalApp showToast={showToast} />;
      case "calendar":
        return (
          <CalendarApp
            showToast={showToast}
            onOpenProject={(projectId, openTasks) => {
              setProjectsInitialId(projectId);
              setProjectsOpenTasks(!!openTasks);
              setProjectsOpenHandovers(false);
              setProjectsStartCreating(false);
              openWindow("projects");
            }}
          />
        );
      case "team":
        return <TeamApp showToast={showToast} />;
      case "connections":
        return <ConnectionsApp showToast={showToast} />;
      case "messaging":
        return (
          <MessagingApp
            showToast={showToast}
            initialProjectFilter={messagingProjectFilter}
            onOpenProject={(projectId) => openProject(projectId, true)}
          />
        );
      case "settings":
        return (
          <SettingsApp
            showToast={showToast}
            highContrast={highContrast}
            onHighContrastChange={setHighContrast}
            isLightMode={isLightMode}
            onLightModeChange={setIsLightMode}
          />
        );
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

  const isNavActive = (item: NavItem) =>
    item.kind === "home" ? activeView === null && activeMenu === "home" : item.kind === "app" ? activeView === item.key : activeMenu === item.key;

  const onNavClick = (item: NavItem) => {
    setActiveMenu(item.key);
    setMobileNavOpen(false);
    if (item.kind === "home") setActiveView(null);
    else if (item.kind === "app") {
      if (item.key === "client") markActivitySeen();
      setVaultFocusSearch(false);
      setActiveView(item.key as WindowType);
    } else showToast(`${item.label} — coming soon`);
  };

  const recentProjects = homeProjects.filter((p) => p.status !== "Archived").slice(0, 5);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex relative overflow-hidden mesh-bg mx-auto transition-all duration-700"
      style={isLightMode ? {} : { filter: "invert(1) hue-rotate(180deg)" }}
    >
      <div className="absolute inset-0 flex flex-row z-10 w-full h-full">
        {/* Mobile-only backdrop, dismisses the drawer */}
        {mobileNavOpen && (
          <div className="sm:hidden fixed inset-0 bg-ink/30 z-40" onClick={() => setMobileNavOpen(false)} aria-hidden />
        )}

        {/* Persistent left sidebar: quick actions, workspace nav, recents, account.
            Below sm: a fixed overlay drawer toggled by the Menu button; sm+: always visible. */}
        <div
          className={`${mobileNavOpen ? "flex fixed inset-y-0 left-0 z-50 shadow-xl" : "hidden"} sm:flex sm:static sm:shadow-none flex-col w-[228px] shrink-0 h-full bg-paper border-r border-line px-3 py-5 overflow-y-auto`}
        >
          <div className="flex items-center justify-between gap-2 px-2.5 mb-5">
            <span style={{ fontFamily: "var(--font-wordmark)" }} className="text-[17px] tracking-tight text-ink">
              desboard
            </span>
            <button
              onClick={() => setMobileNavOpen(false)}
              className="sm:hidden text-muted hover:text-ink transition-colors"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-0.5 mb-4">
            <button
              onClick={() => {
                setProjectsInitialId(null);
                setProjectsStartCreating(true);
                setMobileNavOpen(false);
                openWindow("projects");
              }}
              className="flex items-center gap-2 text-left text-[13.5px] px-2.5 py-[7px] rounded-lg text-ink/70 hover:bg-surface/60 hover:text-ink transition-colors"
            >
              <Plus className="w-[15px] h-[15px] opacity-60" strokeWidth={1.75} />
              New project
            </button>
            <button
              onClick={() => {
                setVaultFocusSearch(true);
                setMobileNavOpen(false);
                openWindow("files");
              }}
              className="flex items-center gap-2 text-left text-[13.5px] px-2.5 py-[7px] rounded-lg text-ink/70 hover:bg-surface/60 hover:text-ink transition-colors"
            >
              <Search className="w-[15px] h-[15px] opacity-60" strokeWidth={1.75} />
              Search
            </button>
          </div>

          <div className="px-2.5 mb-1.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase">Workspace</div>
          <nav className="flex flex-col gap-0.5 mb-4">
            {NAV_ITEMS.map((item) => {
              const active = isNavActive(item);
              return (
                <button
                  key={item.key}
                  onClick={() => onNavClick(item)}
                  className={`flex items-center justify-between gap-2 text-left text-[13.5px] px-2.5 py-[7px] rounded-lg transition-colors relative ${
                    active ? "bg-surface text-ink font-medium shadow-sm" : "text-ink/70 hover:bg-surface/60 hover:text-ink"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="relative shrink-0">
                    <item.icon className="w-[15px] h-[15px] opacity-60" strokeWidth={1.75} />
                    {item.key === "client" && unseenActivity > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                </button>
              );
            })}
          </nav>

          {recentProjects.length > 0 && (
            <div className="mb-4">
              <button
                onClick={() => setRecentExpanded(!recentExpanded)}
                className="w-full flex items-center justify-between px-2.5 mb-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase hover:text-ink transition-colors"
              >
                Recent
                <ChevronDown className={`w-3 h-3 transition-transform ${recentExpanded ? "" : "-rotate-90"}`} />
              </button>
              {recentExpanded && (
                <div className="flex flex-col gap-0.5">
                  {recentProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openProject(p.id, false)}
                      className="text-left text-[13px] px-2.5 py-[6px] rounded-lg text-ink/60 hover:bg-surface/60 hover:text-ink truncate transition-colors"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bottom of sidebar: world clock, theme toggle, account */}
          <div className="mt-auto flex flex-col gap-3 px-2.5">
            <button
              onClick={() => setIsLightMode(!isLightMode)}
              className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink transition-colors self-start"
              title="Toggle high-contrast theme"
            >
              {isLightMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {isLightMode ? "Light" : "Dark"}
            </button>
            <div className="flex flex-col gap-0.5 text-[11px] leading-[1.5] text-muted">
              <span>{formatTime(time, "Europe/London")} &nbsp;LON</span>
              <span>{formatTime(time, "America/New_York")} &nbsp;NYC</span>
              <span>{formatTime(time, "America/Chicago")} &nbsp;CHI</span>
            </div>
            <div className="pt-3 -mx-2.5 px-2.5 border-t border-line flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] text-ink font-medium truncate">{user.workspaceName}</div>
                <div className="text-[11px] text-muted truncate">{user.email}</div>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="shrink-0 w-7 h-7 rounded-full bg-paper hover:bg-line/60 flex items-center justify-center text-muted hover:text-ink transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main content pane */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto">
          <div
            className={`mx-auto px-8 md:px-12 py-8 md:py-10 ${
              activeView === null ? "max-w-[1180px]" : CONTENT_MAX_WIDTH[activeView] ?? "max-w-[880px]"
            }`}
          >
            <button
              onClick={() => setMobileNavOpen(true)}
              className="sm:hidden flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition-colors mb-5"
              aria-label="Open navigation"
            >
              <Menu className="w-3.5 h-3.5" /> Menu
            </button>

            {activeView && (
              <button
                onClick={goHome}
                className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition-colors mb-5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Home
              </button>
            )}

            <AnimatePresence mode="wait">
              {activeView === null ? (
                <motion.div
                  key="home"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col min-[1200px]:flex-row gap-8 items-start justify-center"
                >
                  <div className="flex-1 w-full min-w-0 max-w-[720px]">
                    <div className="mb-8" style={{ fontFamily: "var(--font-serif)" }}>
                      <p className="italic text-[19px] text-muted mb-1.5">
                        {greeting()}, {firstName}.
                      </p>
                      {dash ? (
                        <p className="text-[27px] leading-[1.3] text-ink">
                          {dash.greetingFact.lead && `${dash.greetingFact.lead} `}
                          {dash.greetingFact.entityLabel &&
                            (dash.greetingFact.projectId ? (
                              <button
                                type="button"
                                onClick={() => openProject(dash.greetingFact.projectId!, !!dash.greetingFact.openHandovers)}
                                className="underline decoration-1 underline-offset-4 decoration-muted/40 hover:decoration-primary hover:text-primary transition-colors"
                              >
                                {dash.greetingFact.entityLabel}
                              </button>
                            ) : (
                              <span>{dash.greetingFact.entityLabel}</span>
                            ))}
                          {dash.greetingFact.trail}
                        </p>
                      ) : (
                        <div className="h-[35px] w-2/3 bg-chip rounded animate-pulse" />
                      )}
                    </div>

                    <TrialBanner onOpenBilling={() => openWindow("settings")} />

                    {dash && (
                      // Always mounted once dash data exists (even with zero completions) —
                      // it needs to see the empty state at least once to seed its "already
                      // seen" baseline, or the first real completion would be mistaken for
                      // unseen history and silently swallowed instead of celebrated.
                      <CelebrationBanner completedApprovals={dash.completedApprovals} onOpenProject={(projectId) => openProject(projectId, true)} />
                    )}

                    {/* Featured card — the assistant, the page's one glow moment */}
                    <AssistantBox onOpenFile={openFile} />

                    <ActivityList
                      dash={dash}
                      files={homeFiles}
                      projects={homeProjects}
                      loading={homeDataLoading}
                      onOpenFile={openFile}
                      onOpenApproval={(projectId) => openProject(projectId, true)}
                    />
                  </div>

                  {dash && dash.insights.length > 0 && (
                    <div className="w-full min-[1200px]:w-[320px] shrink-0">
                      <InsightRail insights={dash.insights} onAction={handleInsightAction} />
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key={activeView} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <h1 className="text-[22px] font-semibold text-ink mb-5">{activeTitle}</h1>
                  <div className="h-[calc(100vh-220px)] min-h-[400px]">{renderActiveApp()}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
