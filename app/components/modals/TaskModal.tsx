'use client';

import type { Email } from '@/types';

interface TaskModalProps {
  email: Email | undefined;
  taskText: string;
  setTaskText: (text: string) => void;
  taskAssignee: 'rbk' | 'emily';
  setTaskAssignee: (assignee: 'rbk' | 'emily') => void;
  onSaveTask: () => Promise<void>;
  onClose: () => void;
}

export function TaskModal({ email, taskText, setTaskText, taskAssignee, setTaskAssignee, onSaveTask, onClose }: TaskModalProps) {
  if (!email) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h3 className="text-lg font-semibold text-slate-900">Add Task</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">Related to email:</p>
            <p className="font-medium text-slate-900 truncate">{email.subject}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Task Description</label>
            <input
              type="text"
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Enter task description..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && taskText.trim()) onSaveTask();
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Assign to</label>
            <div className="flex gap-3">
              <button
                onClick={() => setTaskAssignee('emily')}
                className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                  taskAssignee === 'emily' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Emily
              </button>
              <button
                onClick={() => setTaskAssignee('rbk')}
                className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                  taskAssignee === 'rbk' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                RBK
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={onSaveTask}
              disabled={!taskText.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add Task
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TaskModal;
