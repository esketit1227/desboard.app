import type React from "react";
import { useState, useEffect } from "react";
import { Plus, Send, Trash2, Briefcase, MessageSquare, ArrowLeft } from "lucide-react";
import type { Conversation, ConversationMessage, ProjectFull, TeamMember } from "../../types";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/utils";
import { MessagingHandoversSection } from "./MessagingHandoversSection";

type Section = "conversations" | "handovers";

/**
 * Messaging window: a global inbox — independent conversations, not tied to
 * any one project. Since there's a single local operator and no second real
 * user, the composer's "Me"/"Them" toggle lets one person log both sides of a
 * conversation (mirrors HandoverPanel's designer/client discuss mode). A
 * second section, switched via the tabs at the top, lists every sent
 * handover package alongside its client-approval status.
 */
export function MessagingApp({
  showToast,
  initialProjectFilter = null,
  onOpenProject,
}: {
  showToast: (msg: string) => void;
  /** Prefer selecting a conversation linked to this project on open (e.g. a project's Messages tile). */
  initialProjectFilter?: string | null;
  onOpenProject: (projectId: string) => void;
}) {
  const [section, setSection] = useState<Section>("conversations");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<ProjectFull[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [creating, setCreating] = useState(false);

  const [composerAuthor, setComposerAuthor] = useState("Elias M.");
  const [composerRole, setComposerRole] = useState<"me" | "them">("me");
  const [composerBody, setComposerBody] = useState("");
  const [sending, setSending] = useState(false);

  const refreshConversations = () =>
    api.getConversations().then(setConversations).catch((e) => console.error("Failed to load conversations", e));

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getConversations(), api.getProjects(), api.getTeamMembers()])
      .then(([c, p, m]) => {
        setConversations(c);
        setProjects(p);
        setMembers(m);
        // List is already sorted most-recently-active first; prefer a match
        // for the requesting project, else just the top of that list.
        const preferred = initialProjectFilter ? c.find((x) => x.linkedProjectId === initialProjectFilter) : undefined;
        setSelectedId((preferred ?? c[0])?.id ?? null);
      })
      .catch((e) => console.error("Failed to load messaging data", e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    api
      .getMessages(selectedId)
      .then(setMessages)
      .catch((e) => console.error("Failed to load messages", e))
      .finally(() => setLoadingMessages(false));
  }, [selectedId]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const projectName = (id?: string | null) => (id ? projects.find((p) => p.id === id)?.name : undefined);
  const memberName = (id?: string | null) => (id ? members.find((m) => m.id === id)?.name : undefined);

  const createConversation = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await api.createConversation({ title: newTitle.trim(), linkedProjectId: newProjectId || null });
      setNewTitle("");
      setNewProjectId("");
      setShowNewForm(false);
      await refreshConversations();
      setSelectedId(created.id);
    } catch (e) {
      console.error("Failed to create conversation", e);
      showToast("Could not create conversation");
    } finally {
      setCreating(false);
    }
  };

  const removeConversation = async (c: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const ok = await api.deleteConversation(c.id);
      if (!ok) throw new Error("delete failed");
      if (selectedId === c.id) setSelectedId(null);
      await refreshConversations();
    } catch (err) {
      console.error("Failed to delete conversation", err);
      showToast("Could not delete conversation");
    }
  };

  const sendMessage = async () => {
    if (!selectedId || !composerBody.trim()) return;
    setSending(true);
    try {
      const msg = await api.addMessage(selectedId, {
        author: composerAuthor.trim() || (composerRole === "me" ? "Me" : "Them"),
        role: composerRole,
        body: composerBody.trim(),
      });
      setMessages((prev) => [...prev, msg]);
      setComposerBody("");
      await refreshConversations();
    } catch (e) {
      console.error("Failed to send message", e);
      showToast("Could not send message");
    } finally {
      setSending(false);
    }
  };

  const SECTION_TABS: { key: Section; label: string }[] = [
    { key: "conversations", label: "Conversations" },
    { key: "handovers", label: "Handovers" },
  ];

  return (
    <div className="flex flex-col h-full text-ink bg-panel rounded-2xl overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-line shrink-0">
        {SECTION_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className={`text-[12.5px] px-3 py-1.5 rounded-full transition-colors font-medium ${
              section === t.key ? "bg-chip text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "handovers" ? (
        <MessagingHandoversSection showToast={showToast} onOpenProject={onOpenProject} />
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted">Loading…</div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Below sm: master-detail — the list and the open thread are each full-width
              and mutually exclusive (picking a conversation swaps to the thread; the
              in-thread back arrow swaps back), since there's no room to show both.
              sm+: unchanged side-by-side panels. */}
          <div
            className={`${
              selectedId ? "hidden sm:flex" : "flex"
            } w-full sm:w-[280px] shrink-0 flex-col border-r border-line`}
          >
            <div className="p-4 border-b border-line">
              <button
                onClick={() => setShowNewForm((v) => !v)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/85 text-white rounded-full text-[13px] font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> New conversation
              </button>
              {showNewForm && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !creating) createConversation();
                    }}
                    placeholder="Conversation title…"
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                  />
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                  >
                    <option value="">No linked project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={createConversation}
                    disabled={creating || !newTitle.trim()}
                    className="w-full py-2 rounded-lg bg-ink text-paper disabled:opacity-50 disabled:cursor-not-allowed text-[12.5px] font-medium transition-colors"
                  >
                    {creating ? "Creating…" : "Create"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <MessageSquare className="w-8 h-8 text-muted mx-auto mb-3" />
                  <p className="text-[12.5px] text-muted">No conversations yet</p>
                </div>
              ) : (
                conversations.map((c) => {
                  const active = c.id === selectedId;
                  const linkedLabel = projectName(c.linkedProjectId) || memberName(c.linkedMemberId) || c.linkedClient;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left px-4 py-3 border-b border-line/60 transition-colors group relative ${
                        active ? "bg-chip" : "hover:bg-chip/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1 pr-4">
                        <span className="text-[13px] font-medium text-ink truncate">{c.title}</span>
                        <span className="text-[10.5px] text-muted shrink-0">{timeAgo(c.created)}</span>
                      </div>
                      {linkedLabel && (
                        <span className="text-[11px] text-muted flex items-center gap-1 truncate">
                          {projectName(c.linkedProjectId) && <Briefcase className="w-3 h-3 shrink-0" />}
                          {linkedLabel}
                        </span>
                      )}
                      <button
                        onClick={(e) => removeConversation(c, e)}
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-all"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className={`${selectedId ? "flex" : "hidden sm:flex"} flex-1 flex-col min-w-0 bg-paper`}>
            {!selected ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="w-10 h-10 text-muted mx-auto mb-3" />
                  <p className="text-[13px] text-muted">Select a conversation, or start a new one.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="h-[60px] border-b border-line flex items-center gap-3 px-4 sm:px-6 shrink-0">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="sm:hidden shrink-0 p-1.5 -ml-1.5 text-muted hover:text-ink rounded-lg hover:bg-panel transition-colors"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold text-ink leading-tight truncate">{selected.title}</h3>
                    {projectName(selected.linkedProjectId) && (
                      <span className="text-[11.5px] text-muted flex items-center gap-1">
                        <Briefcase className="w-3 h-3" /> {projectName(selected.linkedProjectId)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
                  {loadingMessages ? (
                    <div className="text-center py-10 text-[13px] text-muted">Loading…</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-line rounded-xl">
                      <p className="text-[13px] text-ink/70">No messages yet</p>
                      <p className="text-[12.5px] text-muted">Send the first one below.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMe = m.role === "me";
                      return (
                        <div
                          key={m.id}
                          className={`rounded-xl p-3.5 max-w-[80%] ${isMe ? "bg-primary/[0.06] self-end" : "bg-panel self-start"}`}
                        >
                          <div className="flex items-center flex-wrap gap-2 mb-1.5">
                            <span className="text-[13px] font-medium text-ink">{m.author}</span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                isMe ? "text-primary bg-primary/10" : "text-muted bg-line"
                              }`}
                            >
                              {isMe ? "Me" : "Them"}
                            </span>
                            <span className="ml-auto text-[11.5px] text-muted">{timeAgo(m.created)}</span>
                          </div>
                          <p className="text-[13.5px] text-ink/80 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-line p-4 flex flex-col gap-2 shrink-0">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={composerAuthor}
                      onChange={(e) => setComposerAuthor(e.target.value)}
                      placeholder="Your name"
                      className="flex-1 bg-panel border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
                    />
                    <div className="flex bg-panel border border-line rounded-lg p-0.5 shrink-0">
                      {(["me", "them"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setComposerRole(r)}
                          className={`px-3 py-1.5 rounded-md text-[12px] font-medium capitalize transition-colors ${
                            composerRole === r ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={composerBody}
                      onChange={(e) => setComposerBody(e.target.value)}
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Write a message…"
                      className="flex-1 bg-panel border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors resize-none"
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!composerBody.trim() || sending}
                      className="shrink-0 h-[42px] px-4 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-[13px] font-semibold flex items-center gap-2"
                    >
                      <Send className="w-3.5 h-3.5" /> {sending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
