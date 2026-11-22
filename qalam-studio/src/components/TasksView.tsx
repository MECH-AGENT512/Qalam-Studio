import React, { useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';
import { deleteTaskById, saveTasks } from '../lib/db';
import type { ExtractedTask } from '../types';

interface TasksViewProps {
  tasks: ExtractedTask[];
  onRefresh: () => void;
  onOpenLecture: (lectureId: string) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ tasks, onRefresh, onOpenLecture }) => {
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const task: ExtractedTask = {
      id: `task-manual-${Date.now()}`,
      title: newTitle.trim(),
      priority: newPriority,
      dueHint: 'Personal task',
      category: 'study',
      completed: false,
      createdAt: Date.now(),
    };
    await saveTasks([task]);
    setNewTitle('');
    onRefresh();
  };

  const toggleTask = async (t: ExtractedTask) => {
    await saveTasks([{ ...t, completed: !t.completed }]);
    onRefresh();
  };

  const removeTask = async (id: string) => {
    await deleteTaskById(id);
    onRefresh();
  };

  const visible = tasks.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  const pendingCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Action Tasks & Deadlines
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {pendingCount} pending · Automatically extracted from lectures and personal study items
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start">
          {(['all', 'pending', 'completed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer capitalize whitespace-nowrap ${
                filter === tab
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Add Task Bar */}
      <form
        onSubmit={(e) => void handleAdd(e)}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-2.5 shadow-sm"
      >
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a study task, reading, or project milestone..."
          className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
        />
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}
          aria-label="Task priority"
          className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm text-slate-800 dark:text-slate-200"
        >
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>
        <button
          type="submit"
          className="flex items-center justify-center gap-1.5 px-5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Task</span>
        </button>
      </form>

      {/* Task List */}
      {visible.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          No tasks in this view. Record a lecture or add a personal task above.
        </div>
      ) : (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-sm">
          {visible.map((t) => (
            <div key={t.id} className="p-4 sm:px-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void toggleTask(t)}
                className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
              >
                {t.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div
                    className={`text-sm font-medium ${
                      t.completed
                        ? 'line-through text-slate-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {t.title}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span
                      className={
                        t.priority === 'high'
                          ? 'text-red-600 dark:text-red-400 font-medium capitalize'
                          : 'capitalize'
                      }
                    >
                      {t.priority} priority
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t.dueHint}</span>
                    {t.lectureTitle && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            if (t.lectureId) onOpenLecture(t.lectureId);
                          }}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {t.lectureTitle}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => void removeTask(t.id)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer shrink-0"
                aria-label={`Delete task ${t.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
