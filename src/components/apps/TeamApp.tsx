import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, X, Mail, Trash2 } from "lucide-react";
import type { TeamMember } from "../../types";
import { api } from "../../lib/api";

const AVATAR_COLORS = ["#D85E25", "#2F9463", "#4C6B93", "#B8791E", "#9C27B0", "#E91E63"];

/** Team window: a simple studio directory — no login/permissions, just a roster. */
export function TeamApp({ showToast }: { showToast: (msg: string) => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TeamMember | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", initials: "", role: "", email: "", color: AVATAR_COLORS[0] });
  const [saving, setSaving] = useState(false);

  const refresh = () => api.getTeamMembers().then(setMembers).catch((e) => console.error("Failed to load team", e));

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setDraft({ name: "", initials: "", role: "", email: "", color: AVATAR_COLORS[members.length % AVATAR_COLORS.length] });
    setEditing("new");
  };

  const openEdit = (m: TeamMember) => {
    setDraft({ name: m.name, initials: m.initials, role: m.role || "", email: m.email || "", color: m.color });
    setEditing(m);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.initials.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        initials: draft.initials.trim(),
        role: draft.role.trim() || null,
        email: draft.email.trim() || null,
        color: draft.color,
      };
      if (editing === "new") {
        await api.createTeamMember(payload);
        showToast("Added to the roster");
      } else if (editing) {
        await api.updateTeamMember(editing.id, payload);
        showToast("Roster entry updated");
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      console.error("Failed to save team member", e);
      showToast("Could not save team member");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: TeamMember) => {
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
    try {
      const ok = await api.deleteTeamMember(m.id);
      if (!ok) throw new Error("delete failed");
      showToast(`Removed ${m.name}`);
    } catch (e) {
      console.error("Failed to delete team member", e);
      refresh();
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-[13px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full text-ink w-full relative">
      <div className="flex items-center justify-between mb-6">
        <p className="text-muted text-[14px]">Your studio's roster.</p>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/85 text-white transition-colors rounded-full text-[13px] font-medium"
        >
          <Plus className="w-4 h-4" /> Add member
        </button>
      </div>

      {members.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-line rounded-2xl">
          <p className="text-[13px] text-ink/70 mb-1">No one on the roster yet</p>
          <p className="text-[12.5px] text-muted">Add one to start building your roster.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {members.map((m) => (
            <div
              key={m.id}
              onClick={() => openEdit(m)}
              className="bg-panel hover:bg-chip transition-colors rounded-2xl p-5 cursor-pointer group relative"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(m);
                }}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-all"
                aria-label={`Remove ${m.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[13px] font-semibold mb-3"
                style={{ backgroundColor: m.color }}
              >
                {m.initials}
              </div>
              <h4 className="text-[14px] font-medium text-ink mb-0.5">{m.name}</h4>
              {m.role && <p className="text-[12.5px] text-muted mb-1.5">{m.role}</p>}
              {m.email && (
                <p className="flex items-center gap-1.5 text-[11.5px] text-muted truncate">
                  <Mail className="w-3 h-3 shrink-0" /> {m.email}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {editing && (
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
              <button onClick={() => setEditing(null)} className="absolute top-6 right-6 text-muted hover:text-ink">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-[20px] font-bold text-ink mb-6">{editing === "new" ? "Add team member" : "Edit team member"}</h3>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-[13px] text-muted block mb-2">Name</label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    placeholder="e.g. Jordan Lee"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Initials</label>
                    <input
                      type="text"
                      value={draft.initials}
                      onChange={(e) => setDraft((d) => ({ ...d, initials: e.target.value.toUpperCase().slice(0, 3) }))}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      placeholder="JL"
                    />
                  </div>
                  <div>
                    <label className="text-[13px] text-muted block mb-2">Role</label>
                    <input
                      type="text"
                      value={draft.role}
                      onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                      className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                      placeholder="e.g. Designer"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[13px] text-muted block mb-2">Email</label>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                    className="w-full bg-paper border border-line rounded-lg px-4 py-3 text-[13.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    placeholder="jordan@studio.com"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-muted block mb-2">Avatar color</label>
                  <div className="flex gap-2.5 flex-wrap">
                    {AVATAR_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setDraft((d) => ({ ...d, color }))}
                        className={`w-7 h-7 rounded-full border-[3px] transition-transform hover:scale-110 ${
                          draft.color === color ? "border-ink/30 scale-110" : "border-transparent"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  onClick={save}
                  disabled={saving || !draft.name.trim() || !draft.initials.trim()}
                  className="mt-2 w-full bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-colors py-3 rounded-lg text-[13px] font-semibold text-white"
                >
                  {saving ? "Saving…" : editing === "new" ? "Add member" : "Save changes"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
