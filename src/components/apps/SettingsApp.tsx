import { useState, useEffect } from "react";
import { Sun, Moon, AlertTriangle, Users } from "lucide-react";
import type { StudioSettings, AuthUser, WorkspaceMember, PendingInvite, WorkspaceRole } from "../../types";
import { api } from "../../lib/api";

const ACCENT_SWATCHES = ["#D85E25", "#2F9463", "#4C6B93", "#B8791E", "#9C27B0", "#000000"];

/**
 * Settings window: studio-wide preferences, plus who's on the team and
 * pending invites to join this workspace.
 */
export function SettingsApp({
  showToast,
  highContrast,
  onHighContrastChange,
  isLightMode,
  onLightModeChange,
}: {
  showToast: (msg: string) => void;
  highContrast: boolean;
  onHighContrastChange: (value: boolean) => void;
  isLightMode: boolean;
  onLightModeChange: (value: boolean) => void;
}) {
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [profileDraft, setProfileDraft] = useState({ studioName: "", defaultOwner: "" });
  const [brandDraft, setBrandDraft] = useState<{ brandAccent: string; brandTheme: "dark" | "light" }>({
    brandAccent: "#2c2c2e",
    brandTheme: "light",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [me, setMe] = useState<AuthUser | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [creatingInvite, setCreatingInvite] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setProfileDraft({ studioName: s.studioName, defaultOwner: s.defaultOwner });
        setBrandDraft({ brandAccent: s.brandAccent, brandTheme: s.brandTheme });
      })
      .catch((e) => console.error("Failed to load settings", e));

    Promise.all([api.me(), api.getWorkspaceMembers(), api.getPendingInvites()])
      .then(([user, memberList, inviteList]) => {
        setMe(user);
        setMembers(memberList);
        setInvites(inviteList);
      })
      .catch((e) => console.error("Failed to load team", e))
      .finally(() => setLoadingTeam(false));
  }, []);

  const createInvite = async () => {
    setCreatingInvite(true);
    try {
      const invite = await api.createInvite({ email: inviteEmail.trim() || undefined, role: inviteRole });
      setInvites((prev) => [invite, ...prev]);
      setInviteEmail("");
      const link = `${window.location.origin}/join/${invite.token}`;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Invite link copied to clipboard");
      } catch {
        showToast("Invite created");
      }
    } catch (e) {
      console.error("Failed to create invite", e);
      showToast(e instanceof Error ? e.message : "Could not create invite");
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInviteLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${token}`);
    showToast("Invite link copied");
  };

  const removeInvite = async (token: string) => {
    setInvites((prev) => prev.filter((i) => i.token !== token));
    try {
      await api.revokeInvite(token);
    } catch (e) {
      console.error("Failed to revoke invite", e);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api.updateSettings({
        studioName: profileDraft.studioName.trim(),
        defaultOwner: profileDraft.defaultOwner.trim(),
      });
      setSettings(updated);
      showToast("Studio profile saved");
    } catch (e) {
      console.error("Failed to save studio profile", e);
      showToast("Could not save studio profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveBrand = async () => {
    setSavingBrand(true);
    try {
      const updated = await api.updateSettings(brandDraft);
      setSettings(updated);
      showToast("Brand defaults saved");
    } catch (e) {
      console.error("Failed to save brand defaults", e);
      showToast("Could not save brand defaults");
    } finally {
      setSavingBrand(false);
    }
  };

  const handleClearDemoData = async () => {
    setClearing(true);
    try {
      await api.clearDemoData();
      showToast("Demo data cleared");
      setConfirmClear(false);
    } catch (e) {
      console.error("Failed to clear demo data", e);
      showToast("Could not clear demo data");
    } finally {
      setClearing(false);
    }
  };

  if (!settings) {
    return <div className="text-center py-16 text-[13px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pr-1 pb-4">
      <div className="bg-panel rounded-2xl p-6">
        <h3 className="text-[15px] font-semibold text-ink mb-1">Studio profile</h3>
        <p className="text-[12.5px] text-muted mb-5">Used as the default across new projects and handovers.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="text-[13px] text-muted block mb-2">Studio name</label>
            <input
              type="text"
              value={profileDraft.studioName}
              onChange={(e) => setProfileDraft((d) => ({ ...d, studioName: e.target.value }))}
              className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-[13px] text-muted block mb-2">Default owner</label>
            <input
              type="text"
              value={profileDraft.defaultOwner}
              onChange={(e) => setProfileDraft((d) => ({ ...d, defaultOwner: e.target.value }))}
              placeholder="Filled in as owner on new projects"
              className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>
        <button
          onClick={saveProfile}
          disabled={savingProfile || !profileDraft.studioName.trim()}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-[13px] font-semibold"
        >
          {savingProfile ? "Saving…" : "Save profile"}
        </button>
      </div>

      <div className="bg-panel rounded-2xl p-6">
        <h3 className="text-[15px] font-semibold text-ink mb-1 flex items-center gap-2">
          <Users className="w-4 h-4" /> Team
        </h3>
        <p className="text-[12.5px] text-muted mb-5 max-w-lg">
          Everyone below shares this studio's projects, files, and handovers.
        </p>
        {loadingTeam ? (
          <div className="text-[13px] text-muted">Loading…</div>
        ) : (
          <>
            <div className="flex flex-col gap-2 mb-5">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-chip">
                  <div className="min-w-0">
                    <span className="text-[13px] text-ink font-medium">{m.name || m.email}</span>
                    {m.name && <span className="text-[12px] text-muted ml-2">{m.email}</span>}
                  </div>
                  <span className="text-[11px] uppercase tracking-wide text-muted shrink-0">{m.role}</span>
                </div>
              ))}
            </div>

            {invites.length > 0 && (
              <div className="flex flex-col gap-2 mb-5">
                <span className="text-[11px] text-muted uppercase tracking-wide">Pending invites</span>
                {invites.map((inv) => (
                  <div key={inv.token} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-chip">
                    <div className="min-w-0">
                      <span className="text-[13px] text-ink truncate">{inv.email || "Anyone with the link"}</span>
                      <span className="text-[11px] text-muted ml-2 uppercase">{inv.role}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => copyInviteLink(inv.token)}
                        className="text-[12px] text-ink/70 hover:text-ink transition-colors"
                      >
                        Copy link
                      </button>
                      {me?.role === "owner" && (
                        <button
                          onClick={() => removeInvite(inv.token)}
                          className="text-[12px] text-red-500 hover:text-red-600 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {me?.role === "owner" && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-[13px] text-muted block mb-2">Invite by email (optional)</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@studio.com — blank for a shareable link"
                    className="bg-paper border border-line rounded-lg px-4 py-2.5 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors w-72"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-muted block mb-2">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                    className="bg-paper border border-line rounded-lg px-3 py-2.5 text-[13px] text-ink outline-none cursor-pointer"
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <button
                  onClick={createInvite}
                  disabled={creatingInvite}
                  className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 text-white transition-colors text-[13px] font-semibold"
                >
                  {creatingInvite ? "Creating…" : "Create invite link"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-panel rounded-2xl p-6">
        <h3 className="text-[15px] font-semibold text-ink mb-1">Portal &amp; brand defaults</h3>
        <p className="text-[12.5px] text-muted mb-5 max-w-lg">
          Pre-fills a new handover's client-facing page. Each handover can still override these from its own
          "Customize page" screen.
        </p>
        <div className="flex flex-wrap items-end gap-8 mb-5">
          <div>
            <label className="text-[13px] text-muted block mb-2">Accent color</label>
            <div className="flex gap-2.5 flex-wrap max-w-[220px]">
              {ACCENT_SWATCHES.map((color) => (
                <button
                  key={color}
                  onClick={() => setBrandDraft((d) => ({ ...d, brandAccent: color }))}
                  className={`w-7 h-7 rounded-full border-[3px] transition-transform hover:scale-110 ${
                    brandDraft.brandAccent === color ? "border-ink/30 scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-[13px] text-muted block mb-2">Page theme</label>
            <div className="flex bg-surface border border-line rounded-full p-1 w-fit">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setBrandDraft((d) => ({ ...d, brandTheme: t }))}
                  className={`px-4 py-1.5 rounded-full text-[12.5px] font-medium capitalize transition-colors ${
                    brandDraft.brandTheme === t ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={saveBrand}
          disabled={savingBrand}
          className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 text-white transition-colors text-[13px] font-semibold"
        >
          {savingBrand ? "Saving…" : "Save defaults"}
        </button>
      </div>

      <div className="bg-panel rounded-2xl p-6">
        <h3 className="text-[15px] font-semibold text-ink mb-1">Appearance</h3>
        <p className="text-[12.5px] text-muted mb-5">Applies immediately across Desboard.</p>
        <div className="flex flex-col gap-1 max-w-sm">
          <button
            onClick={() => onLightModeChange(!isLightMode)}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg hover:bg-chip transition-colors text-[13px] font-medium text-ink"
          >
            <div className="flex items-center gap-2">
              {isLightMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              Light mode
            </div>
            <div
              className={`w-6 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${
                isLightMode ? "bg-primary" : "bg-line"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full bg-white transition-transform ${
                  isLightMode ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </div>
          </button>
          <button
            onClick={() => onHighContrastChange(!highContrast)}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg hover:bg-chip transition-colors text-[13px] font-medium text-ink"
          >
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4" /> High contrast (File Vault)
            </div>
            <div
              className={`w-6 h-3.5 rounded-full flex items-center px-0.5 transition-colors ${
                highContrast ? "bg-primary" : "bg-line"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full bg-white transition-transform ${
                  highContrast ? "translate-x-3" : "translate-x-0"
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      <div className="bg-chip border border-line rounded-2xl p-6">
        <h3 className="text-[15px] font-semibold text-ink mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Data management
        </h3>
        <p className="text-[12.5px] text-muted mb-5 max-w-lg">
          Desboard ships with sample projects (Nebula, Acme Corp, GlobalNet) so the app isn't empty on first run.
          Clearing removes just that sample data — anything you've created yourself is untouched.
        </p>
        {confirmClear ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12.5px] text-ink font-medium">Remove all sample data? This can't be undone.</span>
            <button
              onClick={handleClearDemoData}
              disabled={clearing}
              className="px-4 py-2 rounded-lg bg-ink hover:bg-ink/85 disabled:opacity-50 text-white text-[12.5px] font-semibold transition-colors"
            >
              {clearing ? "Clearing…" : "Yes, clear it"}
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="px-4 py-2 rounded-lg bg-white hover:bg-line text-ink text-[12.5px] font-semibold transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="px-5 py-2.5 rounded-lg bg-white hover:bg-chip text-ink border-2 border-ink transition-colors text-[13px] font-semibold"
          >
            Clear demo data
          </button>
        )}
      </div>
    </div>
  );
}
