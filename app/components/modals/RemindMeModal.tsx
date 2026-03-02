'use client';

import type { Email } from '@/types';

interface RemindMeModalProps {
  email: Email | undefined;
  remindMeDate: string;
  setRemindMeDate: (date: string) => void;
  updating: string | null;
  onSetReminder: (emailId: string, date: string) => Promise<void>;
  onClose: () => void;
}

export function RemindMeModal({ email, remindMeDate, setRemindMeDate, updating, onSetReminder, onClose }: RemindMeModalProps) {
  if (!email) return null;

  const setQuickReminder = (hours: number) => {
    const reminder = new Date();
    reminder.setHours(reminder.getHours() + hours);
    setRemindMeDate(reminder.toISOString());
  };

  const setReminderForTime = (hour: number) => {
    const reminder = new Date();
    reminder.setHours(hour, 0, 0, 0);
    if (reminder <= new Date()) {
      reminder.setDate(reminder.getDate() + 1);
    }
    setRemindMeDate(reminder.toISOString());
  };

  const setReminderForDay = (daysAhead: number) => {
    const reminder = new Date();
    reminder.setDate(reminder.getDate() + daysAhead);
    reminder.setHours(9, 0, 0, 0);
    setRemindMeDate(reminder.toISOString());
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Set Reminder</h3>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="font-medium text-slate-900 text-sm truncate">{email.subject}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Quick Options</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setQuickReminder(1)} className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">
                In 1 hour
              </button>
              <button onClick={() => setQuickReminder(2)} className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">
                In 2 hours
              </button>
              <button onClick={() => setReminderForTime(14)} className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">
                This afternoon
              </button>
              <button onClick={() => setReminderForTime(17)} className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200">
                End of day
              </button>
              <button onClick={() => setReminderForDay(1)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700">
                Tomorrow 9am
              </button>
              <button onClick={() => setReminderForDay(7)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700">
                Next week
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Or pick a date & time</label>
            <input
              type="datetime-local"
              value={remindMeDate ? remindMeDate.slice(0, 16) : ''}
              onChange={(e) => setRemindMeDate(new Date(e.target.value).toISOString())}
              min={new Date().toISOString().slice(0, 16)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button
              onClick={() => onSetReminder(email.id, remindMeDate)}
              disabled={updating === email.id || !remindMeDate}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Set Reminder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RemindMeModal;
