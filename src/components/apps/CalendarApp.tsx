import { useState, useMemo, useEffect } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock, Plus, Briefcase, Calendar as CalendarIcon, X } from "lucide-react";
import type { CalendarEvent, VaultTask, ProjectFull } from "../../types";
import { PLAUSIBLE_DEADLINE_WINDOW_MS } from "../../types";
import { api } from "../../lib/api";

type EntryColor = "primary" | "amber" | "slate";

interface DayEntry {
  key: string;
  kind: "event" | "task" | "deadline";
  id: string;
  title: string;
  color: EntryColor;
  projectId?: string | null;
  time?: string | null;
}

const DOT_CLASS: Record<EntryColor, string> = {
  primary: "bg-primary",
  amber: "bg-amber",
  slate: "bg-slate",
};

const BORDER_CLASS: Record<EntryColor, string> = {
  primary: "border-primary",
  amber: "border-amber",
  slate: "border-slate",
};

/**
 * Project deadlines are free text, not guaranteed ISO — parse defensively.
 * A year-less string like "Nov 20" still produces a "valid" Date (JS
 * defaults the missing year to 2001), which isNaN alone won't catch — it
 * would silently place the marker decades away instead of failing safe.
 */
function parseDeadline(deadline: string): Date | null {
  const d = new Date(deadline);
  if (isNaN(d.getTime()) || Math.abs(d.getTime() - Date.now()) >= PLAUSIBLE_DEADLINE_WINDOW_MS) return null;
  return d;
}

/**
 * Calendar window: a real month grid backed by events, plus task due-dates and
 * project deadlines merged in as read-only entries (client-side aggregation,
 * no server-side join needed for three small, already-loaded lists).
 */
export function CalendarApp({
  showToast,
  onOpenProject,
}: {
  showToast: (msg: string) => void;
  /** Jump to a project's detail view (optionally opening its Tasks panel). */
  onOpenProject?: (projectId: string, openTasks?: boolean) => void;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [projects, setProjects] = useState<ProjectFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = () =>
    Promise.all([api.getEvents(), api.getTasks(), api.getProjects()]).then(([e, t, p]) => {
      setEvents(e);
      setTasks(t);
      setProjects(p);
    });

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((e) => console.error("Failed to load calendar data", e))
      .finally(() => setLoading(false));
  }, []);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const add = (dateKey: string, entry: DayEntry) => {
      const list = map.get(dateKey) ?? [];
      list.push(entry);
      map.set(dateKey, list);
    };
    events.forEach((e) => {
      add(e.date, {
        key: `event-${e.id}`,
        kind: "event",
        id: e.id,
        title: e.title,
        color: "primary",
        projectId: e.projectId,
        time: e.startTime,
      });
    });
    tasks.forEach((t) => {
      if (!t.dueDate || t.done) return;
      add(t.dueDate, { key: `task-${t.id}`, kind: "task", id: t.id, title: t.title, color: "amber", projectId: t.projectId });
    });
    projects.forEach((p) => {
      const d = parseDeadline(p.deadline);
      if (!d) return;
      add(format(d, "yyyy-MM-dd"), {
        key: `deadline-${p.id}`,
        kind: "deadline",
        id: p.id,
        title: `${p.name} due`,
        color: "slate",
        projectId: p.id,
      });
    });
    return map;
  }, [events, tasks, projects]);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const selectedEntries = entriesByDate.get(selectedKey) ?? [];

  const addEvent = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await api.createEvent({
        title: newTitle.trim(),
        date: selectedKey,
        startTime: newTime || null,
        projectId: newProjectId || null,
      });
      setNewTitle("");
      setNewTime("");
      setNewProjectId("");
      setShowAddForm(false);
      await refresh();
      showToast("Event added");
    } catch (e) {
      console.error("Failed to add event", e);
      showToast("Could not add event");
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (id: string) => {
    try {
      const ok = await api.deleteEvent(id);
      if (!ok) throw new Error("delete failed");
      await refresh();
    } catch (e) {
      console.error("Failed to delete event", e);
      showToast("Could not remove event");
    }
  };

  const projectName = (id?: string | null) => (id ? projects.find((p) => p.id === id)?.name : undefined);

  if (loading) {
    return <div className="text-center py-16 text-[13px] text-muted">Loading…</div>;
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full text-ink w-full">
      <div className="flex-[1.4] bg-panel rounded-2xl p-5 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-[15px] font-semibold text-ink">{format(viewMonth, "MMMM yyyy")}</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-chip transition-colors text-ink/60 hover:text-ink"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setViewMonth(new Date());
                setSelectedDate(new Date());
              }}
              className="px-2.5 py-1 rounded-lg hover:bg-chip transition-colors text-[12px] text-ink/60 hover:text-ink"
            >
              Today
            </button>
            <button
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-chip transition-colors text-ink/60 hover:text-ink"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1 shrink-0">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-center text-[11px] text-muted font-medium py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 flex-1 min-h-0">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEntries = entriesByDate.get(key) ?? [];
            const inMonth = isSameMonth(day, viewMonth);
            const selected = isSameDay(day, selectedDate);
            const today = isToday(day);
            return (
              <button
                key={key}
                onClick={() => setSelectedDate(day)}
                className={`flex flex-col items-center rounded-xl py-1.5 gap-1 transition-colors ${
                  selected ? "bg-surface shadow-sm" : "hover:bg-surface/60"
                } ${!inMonth ? "opacity-35" : ""}`}
              >
                <span
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-[12.5px] ${
                    today ? "bg-primary text-white font-semibold" : "text-ink"
                  }`}
                >
                  {format(day, "d")}
                </span>
                <div className="flex items-center gap-0.5 h-1.5">
                  {dayEntries.slice(0, 3).map((e) => (
                    <span key={e.key} className={`w-1.5 h-1.5 rounded-full ${DOT_CLASS[e.color]}`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 bg-panel rounded-2xl p-5 flex flex-col min-w-[260px] overflow-hidden">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-[14px] font-semibold text-ink">{format(selectedDate, "EEEE, MMM d")}</h3>
          <button onClick={() => setShowAddForm((v) => !v)} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAddForm && (
          <div className="bg-surface border border-line rounded-xl p-3 mb-4 flex flex-col gap-2 shrink-0">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) addEvent();
              }}
              placeholder="Event title…"
              className="w-full bg-paper border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors"
            />
            <div className="flex gap-2">
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
              />
              <select
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={addEvent}
              disabled={saving || !newTitle.trim()}
              className="self-end px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12.5px] font-medium transition-colors"
            >
              {saving ? "Adding…" : "Add event"}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {selectedEntries.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-line rounded-xl">
              <CalendarIcon className="w-7 h-7 text-muted mx-auto mb-2" />
              <p className="text-[12.5px] text-muted">Nothing scheduled</p>
            </div>
          ) : (
            selectedEntries.map((e) => (
              <div key={e.key} className={`border-l-2 pl-3 py-2 rounded-r-lg hover:bg-chip transition-colors ${BORDER_CLASS[e.color]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink truncate">{e.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {e.time && (
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <Clock className="w-3 h-3" /> {e.time}
                        </span>
                      )}
                      {e.kind !== "event" && (
                        <span className="text-[11px] text-muted uppercase tracking-wide">
                          {e.kind === "task" ? "Task due" : "Deadline"}
                        </span>
                      )}
                      {projectName(e.projectId) && (
                        <button
                          onClick={() => onOpenProject?.(e.projectId!, e.kind === "task")}
                          className="flex items-center gap-1 text-[11px] text-ink/60 hover:text-primary transition-colors truncate"
                        >
                          <Briefcase className="w-3 h-3" /> {projectName(e.projectId)}
                        </button>
                      )}
                    </div>
                  </div>
                  {e.kind === "event" && (
                    <button
                      onClick={() => removeEvent(e.id)}
                      className="text-muted hover:text-ink transition-colors shrink-0"
                      aria-label="Delete event"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
