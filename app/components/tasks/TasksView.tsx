'use client';

import type { Email } from '@/types';
import type { AgendaNote } from '@/app/hooks/useAgendaNotes';

interface TaskItem {
  emailId: string | null;
  noteId: string | null;
  subject: string | null;
  task: string;
  assignee: string | null;
  isComplete: boolean;
  isDiscussed: boolean;
}

interface TasksViewProps {
  emails: Email[];
  actionNotes: AgendaNote[];
  onToggleTaskComplete: (emailId: string) => Promise<void>;
  onViewEmail: (emailId: string) => void;
}

function deriveTasks(emails: Email[], actionNotes: AgendaNote[]): TaskItem[] {
  const emailTasks = emails
    .filter(e => e.meeting_notes)
    .map(e => {
      const notes = e.meeting_notes || '';
      const isDiscussed = notes.startsWith('[DISCUSSED]');
      let rawNotes = notes.replace('[DISCUSSED] ', '');
      const isComplete = rawNotes.includes('[DONE]');
      rawNotes = rawNotes.replace('[DONE] ', '').replace(' [DONE]', '');
      const isEmily = rawNotes.startsWith('[@EMILY] ');
      const isRbk = rawNotes.startsWith('[@RBK] ');
      const taskText = rawNotes.replace('[@EMILY] ', '').replace('[@RBK] ', '');
      return {
        emailId: e.id,
        noteId: null as string | null,
        subject: e.subject,
        task: taskText,
        assignee: isEmily ? 'emily' : isRbk ? 'rbk' : null,
        isComplete,
        isDiscussed,
      };
    })
    .filter(t => t.assignee && t.task);

  const noteTasks = actionNotes
    .filter(n => n.assignee)
    .map(n => ({
      emailId: null as string | null,
      noteId: n.id,
      subject: null as string | null,
      task: n.text,
      assignee: n.assignee as string | null,
      isComplete: false,
      isDiscussed: false,
    }));

  return [...emailTasks, ...noteTasks];
}

function TaskCard({ task, onToggleComplete, onViewEmail }: {
  task: TaskItem;
  onToggleComplete: (emailId: string) => Promise<void>;
  onViewEmail: (emailId: string) => void;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-start gap-3 transition-all ${task.isComplete ? 'opacity-50' : ''}`}>
      {task.emailId ? (
        <button
          onClick={() => onToggleComplete(task.emailId!)}
          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs mt-0.5 transition-colors ${
            task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
          }`}
        >
          {task.isComplete && '\u2713'}
        </button>
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-amber-300 bg-amber-50 flex-shrink-0 flex items-center justify-center text-[10px] text-amber-500 mt-0.5">A</div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-slate-400' : 'text-slate-800'}`}>{task.task}</p>
        <div className="flex items-center gap-2 mt-1">
          {task.subject ? (
            <>
              <p className="text-xs text-slate-400 truncate">Re: {task.subject}</p>
              <button
                onClick={() => onViewEmail(task.emailId!)}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0 transition-colors"
              >
                View &rarr;
              </button>
            </>
          ) : (
            <p className="text-xs text-amber-500">From agenda notes</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TasksView({ emails, actionNotes, onToggleTaskComplete, onViewEmail }: TasksViewProps) {
  const tasks = deriveTasks(emails, actionNotes);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Tasks</h3>
          <p className="text-sm text-slate-400 mt-0.5">{tasks.filter(t => !t.isComplete).length} pending</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* RBK Tasks */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">RBK</h4>
            <span className="ml-auto text-xs text-slate-400">{tasks.filter(t => t.assignee === 'rbk' && !t.isComplete).length} pending</span>
          </div>
          <div className="space-y-2">
            {tasks.filter(t => t.assignee === 'rbk').length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
                <p className="text-slate-400 text-sm">No tasks assigned</p>
              </div>
            ) : (
              tasks.filter(t => t.assignee === 'rbk').map((task, idx) => (
                <TaskCard
                  key={task.emailId || task.noteId || idx}
                  task={task}
                  onToggleComplete={onToggleTaskComplete}
                  onViewEmail={onViewEmail}
                />
              ))
            )}
          </div>
        </div>

        {/* Emily Tasks */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Emily</h4>
            <span className="ml-auto text-xs text-slate-400">{tasks.filter(t => t.assignee === 'emily' && !t.isComplete).length} pending</span>
          </div>
          <div className="space-y-2">
            {tasks.filter(t => t.assignee === 'emily').length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
                <p className="text-slate-400 text-sm">No tasks assigned</p>
              </div>
            ) : (
              tasks.filter(t => t.assignee === 'emily').map((task, idx) => (
                <TaskCard
                  key={task.emailId || task.noteId || idx}
                  task={task}
                  onToggleComplete={onToggleTaskComplete}
                  onViewEmail={onViewEmail}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TasksView;
