'use client';

import type { Email } from '@/types';

interface AgendaPopupProps {
  agendaItems: Email[];
  editingAgendaId: string | null;
  setEditingAgendaId: (id: string | null) => void;
  agendaNoteText: string;
  setAgendaNoteText: (text: string) => void;
  onUpdateMeetingNotes: (emailId: string, notes: string) => Promise<void>;
  onToggleMeetingFlag: (emailId: string, currentlyFlagged: boolean) => Promise<void>;
  onViewEmail: (emailId: string) => void;
  onClose: () => void;
}

export function AgendaPopup({
  agendaItems,
  editingAgendaId, setEditingAgendaId,
  agendaNoteText, setAgendaNoteText,
  onUpdateMeetingNotes,
  onToggleMeetingFlag,
  onViewEmail,
  onClose,
}: AgendaPopupProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Meeting Agenda ({agendaItems.length})</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&#10005;</button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-3">
          {agendaItems.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No items on the agenda. Star emails to add them.</p>
          ) : (
            agendaItems.map((email) => {
              const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
              return (
                <div key={email.id} className={`bg-white border border-slate-200 rounded-lg p-4 shadow-sm ${isDiscussed ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => {
                        const notes = email.meeting_notes || '';
                        if (isDiscussed) onUpdateMeetingNotes(email.id, notes.replace('[DISCUSSED] ', ''));
                        else onUpdateMeetingNotes(email.id, '[DISCUSSED] ' + notes);
                      }}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                        isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-blue-500'
                      }`}
                    >
                      {isDiscussed && '\u2713'}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${isDiscussed ? 'line-through text-slate-400' : 'text-slate-900'}`}>{email.subject}</p>
                      <p className="text-sm text-slate-500 mt-1">{email.from_name || email.from_email}</p>
                      {editingAgendaId === email.id ? (
                        <div className="mt-2">
                          <textarea
                            value={agendaNoteText}
                            onChange={(e) => setAgendaNoteText(e.target.value)}
                            placeholder="Add notes for this agenda item..."
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            rows={2}
                            autoFocus
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => {
                                onUpdateMeetingNotes(email.id, (isDiscussed ? '[DISCUSSED] ' : '') + agendaNoteText);
                                setEditingAgendaId(null);
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingAgendaId(null)} className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        email.meeting_notes && (
                          <p className="text-sm text-amber-700 mt-2 bg-amber-100 rounded px-2 py-1">
                            {email.meeting_notes.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '')}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 ml-9">
                    <button
                      onClick={() => { onClose(); onViewEmail(email.id); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      View Email
                    </button>
                    <button
                      onClick={() => {
                        const currentNote = email.meeting_notes?.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '') || '';
                        setEditingAgendaId(email.id);
                        setAgendaNoteText(currentNote);
                      }}
                      className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Edit Notes
                    </button>
                    <button
                      onClick={() => onToggleMeetingFlag(email.id, true)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default AgendaPopup;
