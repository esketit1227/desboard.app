import { useState, useEffect } from "react";
import { Sun, Moon, AlertTriangle, Users } from "lucide-react";
import type { StudioSettings, AuthUser, WorkspaceMember, PendingInvite, WorkspaceRole, BillingStatus, HandoverTemplate } from "../../types";
import { api } from "../../lib/api";
import { PricingCards } from "../PricingCards";
import { TemplateThumbnail } from "../TemplateThumbnail";

const ACCENT_SWATCHES = ["#D85E25", "#2F9463", "#4C6B93", "#B8791E", "#9C27B0", "#000000"];

const TEMPLATE_OPTIONS: { value: HandoverTemplate; label: string; blurb: string }[] = [
  { value: "editorial", label: "Editorial", blurb: "Quiet, magazine-like" },
  { value: "minimal", label: "Minimal", blurb: "Flat, understated" },
  { value: "bold", label: "Bold", blurb: "Big type, confident" },
  { value: "ledger", label: "Ledger", blurb: "Tractor-feed paper, mono" },
  { value: "terminal", label: "Terminal", blurb: "Dark HUD, mission control" },
  { value: "broadsheet", label: "Broadsheet", blurb: "Newsprint masthead" },
  { value: "boarding-pass", label: "Boarding Pass", blurb: "Ticket stub, barcode" },
  { value: "zine", label: "Zine", blurb: "Punk flyer, loud color" },
  { value: "friendly", label: "Friendly", blurb: "Soft, rounded, approachable" },
  { value: "gallery", label: "Gallery", blurb: "Museum wall label" },
  { value: "blueprint", label: "Blueprint", blurb: "Technical spec sheet" },
  { value: "swiss", label: "Swiss", blurb: "Grid, numerals, one accent" },
  { value: "app", label: "App", blurb: "Bold color, rounded type" },
  { value: "letterhead", label: "Letterhead", blurb: "Elegant serif, thin rules" },
  { value: "manifest", label: "Manifest", blurb: "Business record, tabular" },
];

/** Workspace-level usage can reach GB/TB (unlike a single file's size), so this scales further than server/storage.ts's own formatBytes. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

function UsageBar({
  label,
  used,
  cap,
  format = (n) => String(n),
}: {
  label: string;
  used: number;
  cap: number | null;
  format?: (n: number) => string;
}) {
  const pct = cap === null || cap === 0 ? 0 : Math.min(100, (used / cap) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12.5px] text-muted">{label}</span>
        <span className="text-[12px] text-muted tabular-nums">
          {format(used)} {cap !== null ? `/ ${format(cap)}` : "· unlimited"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-chip overflow-hidden">
        {cap !== null && <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

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
  const [brandDraft, setBrandDraft] = useState<{ brandAccent: string; brandTheme: "dark" | "light"; brandTemplate: HandoverTemplate }>({
    brandAccent: "#2c2c2e",
    brandTheme: "light",
    brandTemplate: "editorial",
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

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setProfileDraft({ studioName: s.studioName, defaultOwner: s.defaultOwner });
        setBrandDraft({ brandAccent: s.brandAccent, brandTheme: s.brandTheme, brandTemplate: s.brandTemplate });
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

    api.getBillingStatus().then(setBilling).catch((e) => console.error("Failed to load billing status", e));
  }, []);

  const openBillingPortal = async () => {
    setOpeningPortal(true);
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not open billing portal");
      setOpeningPortal(false);
    }
  };

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
        <h3 className="text-[15px] font-semibold text-ink mb-1">Billing &amp; plan</h3>
        {!billing ? (
          <p className="text-[13px] text-muted py-2">Loading…</p>
        ) : (
          <>
            <p className="text-[12.5px] text-muted mb-5">
              {billing.tier === "trial"
                ? "You're on the 14-day trial — the full Studio feature set, no card required."
                : "Usage against your current plan's limits."}
            </p>

            {billing.subscriptionStatus === "past_due" && (
              <div className="flex items-start gap-2.5 bg-amber/10 border border-amber/30 rounded-lg px-4 py-3 mb-5">
                <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-ink">
                  Your last payment didn't go through. Stripe will retry automatically — update your card under
                  "Manage billing" to avoid any interruption.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
              <div>
                <p className="text-[13px] text-muted mb-1">Current plan</p>
                <p className="text-lg font-semibold text-ink capitalize">
                  {billing.tier}
                  {billing.tier !== "trial" && billing.planInterval && (
                    <span className="text-[13px] text-muted font-normal"> · billed {billing.planInterval}ly</span>
                  )}
                </p>
                {billing.tier === "trial" && billing.trialEndsAt && (
                  <p className="text-[12.5px] text-muted mt-1">
                    {Math.max(0, Math.ceil((Date.parse(billing.trialEndsAt) - Date.now()) / 86400000))} day
                    {Math.ceil((Date.parse(billing.trialEndsAt) - Date.now()) / 86400000) === 1 ? "" : "s"} left
                  </p>
                )}
                {billing.cancelAtPeriodEnd && billing.currentPeriodEnd && (
                  <p className="text-[12.5px] text-ink mt-1">
                    Cancels on {new Date(billing.currentPeriodEnd).toLocaleDateString()}
                  </p>
                )}
              </div>
              {me?.role === "owner" && billing.hasStripeCustomer && (
                <button
                  onClick={openBillingPortal}
                  disabled={openingPortal}
                  className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 text-white transition-colors text-[13px] font-semibold"
                >
                  {openingPortal ? "Redirecting…" : "Manage billing"}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4 max-w-md mb-2">
              <UsageBar label="Seats" used={billing.usage.members} cap={billing.limits.seatCap} />
              <UsageBar label="Storage" used={billing.usage.storageBytes} cap={billing.limits.storageCapBytes} format={formatBytes} />
              <UsageBar label="Active handovers" used={billing.usage.activeHandovers} cap={billing.limits.activeHandoverCap} />
            </div>

            {me?.role === "owner" && billing.tier === "trial" && (
              <div className="mt-6 pt-6 border-t border-line">
                <p className="text-[13px] text-ink font-medium mb-4">
                  Choose a plan whenever you're ready — your trial keeps running until then.
                </p>
                <PricingCards variant="checkout" currentTier={billing.tier} />
              </div>
            )}
          </>
        )}
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
        <div className="mb-5">
          <label className="text-[13px] text-muted block mb-2">Template</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-w-3xl">
            {TEMPLATE_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setBrandDraft((d) => ({ ...d, brandTemplate: t.value }))}
                className={`text-left p-1.5 rounded-lg border transition-colors ${
                  brandDraft.brandTemplate === t.value ? "border-primary/50 bg-primary/10" : "border-line bg-surface hover:bg-chip"
                }`}
              >
                <TemplateThumbnail
                  template={t.value}
                  accent={brandDraft.brandAccent}
                  theme={brandDraft.brandTheme}
                  width={140}
                  height={98}
                />
                <div className={`text-[13px] font-medium mt-1.5 ${brandDraft.brandTemplate === t.value ? "text-primary" : "text-ink"}`}>
                  {t.label}
                </div>
                <div className="text-[11.5px] text-muted">{t.blurb}</div>
              </button>
            ))}
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
