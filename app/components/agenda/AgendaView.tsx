'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { priorityConfig } from '@/lib/constants';
import type { Email, CalendarEvent } from '@/types';
import type { AgendaNote } from '@/app/hooks/useAgendaNotes';

interface AgendaViewProps {
  emails: Email[];
  scheduleEvents: CalendarEvent[];
  selectedDate: Date;
  loadingSchedule: boolean;
  agendaNotes: Record<string, AgendaNote[]>;
  addingNoteToId: string | null;
  setAddingNoteToId: (id: string | null) => void;
  newNoteText: string;
  setNewNoteText: (text: string) => void;
  onAddAgendaNote: (emailId: string) => Promise<void>;
  onDeleteAgendaNote: (emailId: string, noteId: string) => Promise<void>;
  onUpdateAgendaNote: (emailId: string, noteId: string, updates: { type?: string; assignee?: string | null }) => Promise<void>;
  onEnsureNotesLoaded: (emailId: string) => void;
  onUpdateMeetingNotes: (emailId: string, notes: string) => Promise<void>;
  onToggleMeetingFlag: (emailId: string, currentlyFlagged: boolean) => Promise<void>;
  onViewEmail: (emailId: string) => void;
}

export function AgendaView({
  emails,
  scheduleEvents,
  selectedDate,
  loadingSchedule,
  agendaNotes,
  addingNoteToId, setAddingNoteToId,
  newNoteText, setNewNoteText,
  onAddAgendaNote,
  onDeleteAgendaNote,
  onUpdateAgendaNote,
  onEnsureNotesLoaded,
  onUpdateMeetingNotes,
  onToggleMeetingFlag,
  onViewEmail,
}: AgendaViewProps) {
  const agendaItems = emails.filter(e => e.flagged_for_meeting);
  const [agendaTab, setAgendaTab] = useState<'all' | 'note' | 'decision' | 'action'>('all');
  const [currentAgendaItemId, setCurrentAgendaItemId] = useState<string | null>(null);

  return (
    <div className="flex gap-6">
      {/* Schedule Sidebar */}
      <div className="w-56 flex-shrink-0">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sticky top-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Today&apos;s Schedule</h4>
            <span className="text-xs text-slate-400">{format(selectedDate, 'MMM d')}</span>
          </div>
          {loadingSchedule ? (
            <p className="text-xs text-slate-400">Loading...</p>
          ) : scheduleEvents.length === 0 ? (
            <p className="text-xs text-slate-400">No events today</p>
          ) : (
            <div className="space-y-2">
              {scheduleEvents.map((event) => {
                const startTime = event.isAllDay ? 'All day' : format(new Date(event.startTime), 'h:mm a');
                return (
                  <div key={event.id} className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <p className="text-xs font-medium text-slate-800 leading-tight">{event.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{startTime}</p>
                    {event.meetingLink && (
                      <a href={event.meetingLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-0.5 block">
                        Join
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Agenda Main */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            Meeting Agenda
            <span className="ml-2 text-sm font-normal text-slate-400">{agendaItems.length} items</span>
          </h3>
          {currentAgendaItemId && (
            <button onClick={() => setCurrentAgendaItemId(null)} className="text-xs text-slate-400 hover:text-slate-600">
              Clear current
            </button>
          )}
        </div>

        {/* Tab Strip */}
        <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
          {(['all', 'note', 'decision', 'action'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setAgendaTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                agendaTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'all' ? 'All' : tab === 'note' ? 'Notes' : tab === 'decision' ? 'Decisions' : 'Actions'}
            </button>
          ))}
        </div>

        {agendaItems.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
            <p className="text-slate-500 font-medium">No items on the agenda</p>
            <p className="text-sm text-slate-400 mt-1">Star emails from any view to add them here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agendaItems.map((email, idx) => {
              const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
              const isCurrent = currentAgendaItemId === email.id;
              onEnsureNotesLoaded(email.id);
              const notes = agendaNotes[email.id] || [];
              const filteredNotes = agendaTab === 'all' ? notes : notes.filter(n => n.type === agendaTab);
              const config = priorityConfig[email.priority] || priorityConfig.fyi;

              return (
                <div
                  key={email.id}
                  className={`bg-white border border-slate-200 rounded-xl shadow-sm transition-all ${
                    isCurrent ? 'border-l-4 border-l-blue-500 ring-1 ring-blue-100' : ''
                  } ${isDiscussed ? 'opacity-60' : ''}`}
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-slate-400 font-medium w-5 text-center">{idx + 1}</span>
                        <button
                          onClick={() => {
                            const n = email.meeting_notes || '';
                            if (isDiscussed) onUpdateMeetingNotes(email.id, n.replace('[DISCUSSED] ', ''));
                            else onUpdateMeetingNotes(email.id, '[DISCUSSED] ' + n);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs transition-colors ${
                            isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
                          }`}
                          title={isDiscussed ? 'Mark undiscussed' : 'Mark discussed'}
                        >
                          {isDiscussed && '\u2713'}
                        </button>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="inline-flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full inline-block ${config.dot || ''}`}></span>
                                <span className="text-slate-500 text-xs">{config.label}</span>
                              </span>
                              {isCurrent && (
                                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">CURRENT</span>
                              )}
                            </div>
                            <p className={`font-semibold text-sm ${isDiscussed ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {email.subject}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">{email.from_name || email.from_email}</p>
                          </div>
                          <button
                            onClick={() => onToggleMeetingFlag(email.id, true)}
                            className="text-slate-300 hover:text-red-400 text-lg leading-none flex-shrink-0"
                            title="Remove from agenda"
                          >&#10005;</button>
                        </div>

                        {/* Notes thread */}
                        {filteredNotes.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {filteredNotes.map((note) => (
                              <div key={note.id} className="flex items-start gap-2 group">
                                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                  note.type === 'decision' ? 'bg-blue-500' : note.type === 'action' ? 'bg-amber-500' : 'bg-slate-400'
                                }`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm text-slate-700">{note.text}</p>
                                    <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                                      {(['note', 'decision', 'action'] as const).map((t) => (
                                        <button
                                          key={t}
                                          onClick={() => {
                                            if (note.type !== t) onUpdateAgendaNote(email.id, note.id, { type: t, assignee: t === 'action' ? (note.assignee || 'emily') : null });
                                          }}
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                            note.type === t
                                              ? t === 'decision' ? 'bg-blue-100 text-blue-700' : t === 'action' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-700'
                                              : 'text-slate-300 hover:text-slate-500'
                                          }`}
                                        >
                                          {t === 'note' ? 'Note' : t === 'decision' ? 'Decision' : 'Action'}
                                        </button>
                                      ))}
                                      {note.type === 'action' && (
                                        <div className="flex items-center gap-0.5 ml-1 border-l border-slate-200 pl-1.5">
                                          <button
                                            onClick={() => onUpdateAgendaNote(email.id, note.id, { assignee: 'emily' })}
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                              note.assignee === 'emily' ? 'bg-blue-100 text-blue-700' : 'text-slate-300 hover:text-slate-500'
                                            }`}
                                          >Emily</button>
                                          <button
                                            onClick={() => onUpdateAgendaNote(email.id, note.id, { assignee: 'rbk' })}
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                              note.assignee === 'rbk' ? 'bg-violet-100 text-violet-700' : 'text-slate-300 hover:text-slate-500'
                                            }`}
                                          >RBK</button>
                                        </div>
                                      )}
                                      <button
                                        onClick={() => onDeleteAgendaNote(email.id, note.id)}
                                        className="ml-1 text-slate-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                                      >&#10005;</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline add note */}
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            type="text"
                            value={addingNoteToId === email.id ? newNoteText : ''}
                            onFocus={() => { setAddingNoteToId(email.id); }}
                            onChange={(e) => { setAddingNoteToId(email.id); setNewNoteText(e.target.value); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newNoteText.trim()) onAddAgendaNote(email.id);
                              if (e.key === 'Escape') { setAddingNoteToId(null); setNewNoteText(''); }
                            }}
                            placeholder="Add a note..."
                            className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          />
                          <button
                            onClick={() => { if (newNoteText.trim()) onAddAgendaNote(email.id); }}
                            disabled={addingNoteToId !== email.id || !newNoteText.trim()}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                          >
                            Add
                          </button>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-slate-50">
                          <button
                            onClick={() => setCurrentAgendaItemId(isCurrent ? null : email.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                            }`}
                          >
                            {isCurrent ? 'Current' : 'Set as Current'}
                          </button>
                          <button
                            onClick={() => onViewEmail(email.id)}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200"
                          >
                            View Email
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgendaView;
