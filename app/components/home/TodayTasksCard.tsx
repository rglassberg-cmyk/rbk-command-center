'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useWorkspace } from '../AuthProvider';

interface ActionNote {
  id: string;
  email_id?: string | null;
  agenda_item_id?: string | null;
  text: string;
  type: 'note' | 'decision' | 'action';
  // Capitalized in the DB ('RBK', 'Emily', etc.); compared
  // case-insensitively against currentMember.assigneeKey.
  assignee: string | null;
  created_at: string;
  completed?: boolean;
}

interface TodayTasksCardProps {
  // Kept for backward compatibility — the card now reads currentMember
  // directly from the workspace context which already accounts for
  // impersonation.
  effectiveEmail?: string;
}

export default function TodayTasksCard({}: TodayTasksCardProps) {
  const { currentMember } = useWorkspace();
  const myAssigneeKey = currentMember?.assigneeKey ? currentMember.assigneeKey.toLowerCase() : null;
  const [expanded, setExpanded] = useState(true);
  const [tasks, setTasks] = useState<ActionNote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch('/api/agenda-notes?type=action');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.notes || []);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const toggleComplete = async (noteId: string) => {
    const note = tasks.find(n => n.id === noteId);
    if (!note) return;
    const newCompleted = !note.completed;
    // Optimistic update
    setTasks(prev => prev.map(n => n.id === noteId ? { ...n, completed: newCompleted } : n));
    try {
      const res = await apiFetch(`/api/agenda-notes?id=${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: newCompleted }),
      });
      if (!res.ok) {
        // Revert on failure
        setTasks(prev => prev.map(n => n.id === noteId ? { ...n, completed: !newCompleted } : n));
      }
    } catch {
      setTasks(prev => prev.map(n => n.id === noteId ? { ...n, completed: !newCompleted } : n));
    }
  };

  // Filter to current user's tasks (case-insensitive match against
  // their assigneeKey), then show incomplete only.
  const myTasks = myAssigneeKey
    ? tasks.filter(t => t.assignee?.toLowerCase() === myAssigneeKey)
    : tasks;
  const incompleteTasks = myTasks.filter(t => !t.completed);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: '#00A5B5' }} />
          <svg className="w-5 h-5" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <h3 className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: '#1B3A6B' }}>
            Today&apos;s Tasks
          </h3>
          {incompleteTasks.length > 0 && (
            <span className="ml-1 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
              {incompleteTasks.length}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Collapsible content */}
      <div
        className="transition-all duration-300 ease-in-out overflow-hidden flex-1 min-h-0"
        style={{ maxHeight: expanded ? '2000px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        <div className="px-6 pb-5">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="w-5 h-5 rounded bg-slate-100" />
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : incompleteTasks.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-slate-400 text-sm">All caught up!</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {incompleteTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors group"
                >
                  <button
                    onClick={() => toggleComplete(task.id)}
                    className="mt-0.5 w-5 h-5 rounded border-2 border-slate-300 flex items-center justify-center flex-shrink-0 hover:border-blue-500 transition-colors"
                  >
                    {task.completed && (
                      <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800 line-clamp-2" title={task.text}>{task.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
