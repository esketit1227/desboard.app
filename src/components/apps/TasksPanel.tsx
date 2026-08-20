import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X, Plus, Trash2, Target, Check } from "lucide-react";
import type { ProjectFull, VaultTask } from "../../types";
import { api } from "../../lib/api";

/** Per-project task checklist, opened from a project's "Tasks" tile. */
export function TasksPanel({
  project,
  onClose,
  onCountChange,
  showToast,
}: {
  project: ProjectFull;
  onClose: () => void;
  onCountChange?: (n: number) => void;
  showToast: (msg: string) => void;
}) {
  const [tasks, setTasks] = useState<VaultTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = () =>
    api
      .getTasks(project.id)
      .then((list) => {
        setTasks(list);
        onCountChange?.(list.length);
      })
      .catch((e) => console.error("Failed to load tasks", e));

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      await api.createTask({
        projectId: project.id,
        title: newTitle.trim(),
        dueDate: newDueDate || null,
        assignee: newAssignee.trim() || null,
      });
      setNewTitle("");
      setNewDueDate("");
      setNewAssignee("");
      await refresh();
    } catch (e) {
      console.error("Failed to add task", e);
      showToast("Could not add task");
    } finally {
      setAdding(false);
    }
  };

  const toggleDone = async (t: VaultTask) => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try {
      await api.updateTask(t.id, { done: !t.done });
    } catch (e) {
      console.error("Failed to update task", e);
      refresh();
    }
  };

  const removeTask = async (t: VaultTask) => {
    const next = tasks.filter((x) => x.id !== t.id);
    setTasks(next);
    try {
      const ok = await api.deleteTask(t.id);
      if (!ok) throw new Error("delete failed");
      onCountChange?.(next.length);
    } catch (e) {
      console.error("Failed to delete task", e);
      refresh();
    }
  };

  const doneCount = tasks.filter((t) => t.done).length;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[80] flex items-center justify-center p-4 md:p-6"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 16 }}
        className="bg-surface border border-line rounded-2xl w-full max-w-2xl max-h-[88%] shadow-xl flex flex-col overflow-hidden"
      >
        <div className="p-5 border-b border-line flex items-center justify-between bg-panel shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber/15 text-amber rounded-lg">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[16px] font-semibold text-ink leading-none">Tasks</h3>
              <span className="text-[12.5px] text-muted">{project.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-16 text-[13px] text-muted">Loading…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] text-muted">
                  {doneCount}/{tasks.length} done
                </span>
              </div>

              <div className="bg-panel border border-line rounded-xl p-3 mb-4 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !adding) addTask();
                  }}
                  placeholder="Add a task…"
                  className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-primary/50 transition-colors"
                />
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors sm:w-[150px]"
                />
                <input
                  type="text"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  placeholder="Assignee"
                  className="bg-paper border border-line rounded-lg px-3 py-2 text-[12.5px] text-ink outline-none focus:border-primary/50 transition-colors sm:w-[130px]"
                />
                <button
                  onClick={addTask}
                  disabled={adding || !newTitle.trim()}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-medium transition-colors shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-line rounded-2xl">
                  <Target className="w-10 h-10 text-muted mx-auto mb-4" />
                  <p className="text-[13px] text-ink/70 mb-1">No tasks yet</p>
                  <p className="text-[12.5px] text-muted">Add one above to start tracking work on this project.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className="bg-panel border border-line rounded-xl p-3.5 flex items-center gap-3 hover:bg-chip transition-colors group"
                    >
                      <button
                        onClick={() => toggleDone(t)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          t.done ? "bg-moss border-moss" : "border-line hover:border-primary"
                        }`}
                      >
                        {t.done && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13.5px] ${t.done ? "text-muted line-through" : "text-ink"}`}>{t.title}</p>
                        {(t.dueDate || t.assignee) && (
                          <div className="flex items-center gap-2 mt-1">
                            {t.dueDate && <span className="text-[11px] text-muted">{t.dueDate}</span>}
                            {t.assignee && <span className="text-[11px] text-muted">· {t.assignee}</span>}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeTask(t)}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-ink transition-all shrink-0"
                        aria-label="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
