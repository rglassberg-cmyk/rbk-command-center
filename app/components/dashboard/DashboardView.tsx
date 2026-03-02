'use client';

import { useState } from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { priorityConfig, draftStatusConfig } from '@/lib/constants';
import type { Email, CalendarEvent } from '@/types';

interface TaskItem {
  emailId: string | null;
  noteId: string | null;
  subject: string | null;
  task: string;
  assignee: string | null;
  isComplete: boolean;
  isDiscussed: boolean;
}

interface DashboardViewProps {
  emails: Email[];
  urgentAlerts: Email[];
  draftsReady: Email[];
  draftsApproved: Email[];
  urgentEmails: Email[];
  tasks: TaskItem[];
  // Calendar
  scheduleEvents: CalendarEvent[];
  selectedDate: Date;
  loadingSchedule: boolean;
  calendarAuthError: boolean;
  // Calendar actions
  onNavigateDate: (direction: 'prev' | 'next') => void;
  onGoToToday: () => void;
  onDeleteCalendarEvent: (eventId: string) => Promise<void>;
  onShowEventModal: () => void;
  onRefreshCalendarToken: () => Promise<boolean>;
  onFetchCalendarForDate: (date: Date) => Promise<void>;
  isDateToday: (date: Date) => boolean;
  // Email actions
  onUpdateStatus: (emailId: string, status: string) => Promise<void>;
  onApproveDraft: (emailId: string) => Promise<void>;
  onSendEmail: (emailId: string) => Promise<void>;
  onSendBatchEmails: (emailIds: string[]) => Promise<void>;
  sendingEmail: string | null;
  sendingBatch: boolean;
  updating: string | null;
  // Draft editing
  onEditDraft: (emailId: string, draftText: string) => void;
  onRequestRevision: (emailId: string) => void;
  // Popups
  onShowUrgentPopup: () => void;
  onShowImportantDocsPopup: () => void;
  onShowAgendaPopup: () => void;
  onViewEmail: (emailId: string) => void;
  onShowTaskModal: (emailId: string) => void;
  // Counts
  importantDocsCount: number;
  agendaItemsCount: number;
  // Task actions
  onToggleTaskComplete: (emailId: string) => Promise<void>;
  // Nav
  onNavigateToInbox: () => void;
}

function SummaryCard({ title, count, subtitle, topBorder, onClick }: {
  title: string;
  count?: number;
  subtitle: string;
  topBorder?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm ${topBorder || ''} ${onClick ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">{title}</p>
          {count !== undefined && <p className="text-slate-900 text-3xl font-bold mt-1">{count}</p>}
          <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
        </div>
        {title === 'Urgent' && count !== undefined && count > 0 ? (
          <span className="w-3 h-3 bg-red-500 rounded-full mt-1"></span>
        ) : null}
      </div>
    </div>
  );
}

const formatTime = (time: string, isAllDay: boolean) => {
  if (isAllDay) return 'All day';
  return format(parseISO(time), 'h:mm a');
};

const getGmailUrl = (messageId: string | null | undefined) => {
  if (!messageId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
};

export function DashboardView({
  emails,
  urgentAlerts,
  draftsReady,
  draftsApproved,
  urgentEmails,
  tasks,
  scheduleEvents,
  selectedDate,
  loadingSchedule,
  calendarAuthError,
  onNavigateDate,
  onGoToToday,
  onDeleteCalendarEvent,
  onShowEventModal,
  onRefreshCalendarToken,
  onFetchCalendarForDate,
  isDateToday,
  onUpdateStatus,
  onApproveDraft,
  onSendEmail,
  onSendBatchEmails,
  sendingEmail,
  sendingBatch,
  updating,
  onEditDraft,
  onRequestRevision,
  onShowUrgentPopup,
  onShowImportantDocsPopup,
  onShowAgendaPopup,
  onViewEmail,
  onShowTaskModal,
  importantDocsCount,
  agendaItemsCount,
  onToggleTaskComplete,
  onNavigateToInbox,
}: DashboardViewProps) {
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard
          title="Urgent"
          count={urgentAlerts.length}
          subtitle={urgentAlerts.length > 0 ? 'needs attention now' : 'all clear'}
          topBorder="border-t-4 border-t-red-500"
          onClick={urgentAlerts.length > 0 ? onShowUrgentPopup : undefined}
        />
        {/* Quick Links Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-blue-500">
          <div className="flex items-start justify-between mb-3">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Quick Links</p>
          </div>
          <div className="space-y-2">
            <a
              href="https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
            >
              Today&apos;s Folder
            </a>
            <a
              href="https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?usp=drive_link"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
            >
              Daily Announcements
            </a>
            <a
              href="https://drive.google.com/drive/folders/1-HDl_sA_9jDZPTEOGPJ7R57O5iU62AwE"
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
            >
              Daily Folder
            </a>
          </div>
        </div>
        <SummaryCard
          title="Important Docs"
          count={importantDocsCount}
          subtitle="click to view"
          topBorder="border-t-4 border-t-amber-500"
          onClick={onShowImportantDocsPopup}
        />
        <SummaryCard
          title="Meeting Agenda"
          count={agendaItemsCount}
          subtitle="click to view"
          topBorder="border-t-4 border-t-emerald-500"
          onClick={onShowAgendaPopup}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Today's Schedule */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => onNavigateDate('prev')}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                &#9664;
              </button>
              <h3 className="text-lg font-semibold text-slate-900">
                {isDateToday(selectedDate) ? "Today's Schedule" : format(selectedDate, 'EEE, MMM d')}
              </h3>
              <button
                onClick={() => onNavigateDate('next')}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                &#9654;
              </button>
              {!isDateToday(selectedDate) && (
                <button
                  onClick={onGoToToday}
                  className="text-xs text-blue-600 hover:text-blue-800 ml-2"
                >
                  Back to Today
                </button>
              )}
            </div>
            <button
              onClick={onShowEventModal}
              className="bg-blue-600 hover:bg-blue-700 text-white w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-colors"
              title="Add event"
            >
              +
            </button>
          </div>
          {loadingSchedule ? (
            <p className="text-slate-400 text-sm">Loading...</p>
          ) : scheduleEvents.length === 0 ? (
            calendarAuthError ? (
              <div className="text-center py-4">
                <p className="text-slate-400 text-xs mb-2">Calendar session expired</p>
                <button
                  onClick={async () => {
                    const refreshed = await onRefreshCalendarToken();
                    if (refreshed) onFetchCalendarForDate(selectedDate);
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                >
                  Reconnect Calendar
                </button>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No events {isDateToday(selectedDate) ? 'today' : 'on this day'}</p>
            )
          ) : (
            <div className="space-y-1">
              {scheduleEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                  <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded min-w-[60px] text-center">
                    {formatTime(event.startTime, event.isAllDay)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">{event.title}</p>
                    {event.location && <p className="text-xs text-slate-500 truncate">{event.location}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    {event.meetingLink && (
                      <a
                        href={event.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                      >
                        Join
                      </a>
                    )}
                    {event.calendarLink && (
                      <a
                        href={event.calendarLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-xs"
                        title="View in Google Calendar"
                      >
                        &#8599;
                      </a>
                    )}
                    <button
                      onClick={() => onDeleteCalendarEvent(event.id)}
                      className="text-slate-400 hover:text-red-500 text-xs p-1"
                      title="Delete event"
                    >
                      &#10005;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* To-Do Today */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900">To-Do Today</h3>
            <button
              onClick={() => setHideCompletedTasks(!hideCompletedTasks)}
              className={`text-xs px-2 py-1 rounded transition-all ${hideCompletedTasks ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500'}`}
            >
              {hideCompletedTasks ? 'Show Completed' : 'Hide Completed'}
            </button>
          </div>

          {/* Urgent Items */}
          {urgentAlerts.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Urgent</p>
              <div className="space-y-2">
                {urgentAlerts.map((email) => (
                  <div
                    key={email.id}
                    className="bg-white border border-red-200 border-l-4 border-l-red-500 rounded-lg p-3 cursor-pointer hover:bg-red-50 transition-colors shadow-sm"
                    onClick={() => onViewEmail(email.id)}
                  >
                    <p className="text-sm font-medium text-slate-900">{email.subject}</p>
                    <p className="text-xs text-slate-500">{email.from_name || email.from_email}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Drafts */}
          {draftsReady.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Review Drafts ({draftsReady.length})</p>
              <div className="space-y-2">
                {draftsReady.slice(0, 3).map((email) => (
                  <div key={email.id} className="bg-white border border-green-200 border-l-4 border-l-green-500 rounded-lg p-3 shadow-sm">
                    <p className="text-sm font-medium text-slate-900 truncate">{email.subject}</p>
                    <p className="text-xs text-slate-500 mb-2">To: {email.from_email}</p>
                    <p className="text-xs text-slate-600 line-clamp-2 mb-2">{(email.edited_draft || email.draft_reply || '').substring(0, 100)}...</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onEditDraft(email.id, email.edited_draft || email.draft_reply || '')}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onApproveDraft(email.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => onRequestRevision(email.id)}
                        className="border border-amber-200 text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded text-xs font-medium"
                      >
                        Request Revision
                      </button>
                    </div>
                  </div>
                ))}
                {draftsReady.length > 3 && (
                  <button
                    onClick={onNavigateToInbox}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    View all {draftsReady.length} drafts &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Approved Drafts Ready to Send */}
          {draftsApproved.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Ready to Send ({draftsApproved.length})</p>
                {draftsApproved.length > 1 && (
                  <button
                    onClick={() => onSendBatchEmails(draftsApproved.map(e => e.id))}
                    disabled={sendingBatch}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                  >
                    {sendingBatch ? 'Sending...' : 'Send All'}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {draftsApproved.map((email) => (
                  <div key={email.id} className="bg-white border border-blue-200 border-l-4 border-l-blue-500 rounded-lg p-3 shadow-sm">
                    <p className="text-sm font-medium text-slate-900 truncate">{email.subject}</p>
                    <p className="text-xs text-slate-500 mb-2">To: {email.from_email}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onSendEmail(email.id)}
                        disabled={sendingEmail === email.id}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                      >
                        {sendingEmail === email.id ? 'Sending...' : 'Send'}
                      </button>
                      <button
                        onClick={() => onEditDraft(email.id, email.edited_draft || email.draft_reply || '')}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-medium"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {tasks.filter(t => t.assignee === 'rbk' && (!hideCompletedTasks || !t.isComplete)).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tasks</p>
              <div className="space-y-2">
                {tasks.filter(t => t.assignee === 'rbk' && (!hideCompletedTasks || !t.isComplete)).map((task, idx) => {
                  const taskEmail = task.emailId ? emails.find(e => e.id === task.emailId) : null;
                  const taskKey = task.emailId || task.noteId || String(idx);
                  const isExpanded = expandedTask === taskKey;
                  return (
                    <div
                      key={taskKey}
                      className={`rounded-lg transition-all ${task.isComplete ? 'bg-slate-50' : 'bg-white border border-slate-200 shadow-sm'} ${isExpanded ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                    >
                      <div
                        className="flex items-start gap-3 p-3 cursor-pointer"
                        onClick={() => setExpandedTask(isExpanded ? null : taskKey)}
                      >
                        {task.emailId ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleTaskComplete(task.emailId!); }}
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                              task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-blue-500'
                            }`}
                          >
                            {task.isComplete && '\u2713'}
                          </button>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-amber-300 bg-amber-50 flex-shrink-0 flex items-center justify-center text-[10px] text-amber-500">A</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-slate-400' : 'text-slate-900'}`}>{task.task}</p>
                          {task.subject ? (
                            <p className="text-xs text-slate-400 truncate">Re: {task.subject}</p>
                          ) : (
                            <p className="text-xs text-amber-500">From agenda notes</p>
                          )}
                        </div>
                        {taskEmail && <span className="text-slate-400 text-xs">{isExpanded ? '\u25B2' : '\u25BC'}</span>}
                      </div>
                      {isExpanded && taskEmail && (
                        <div className="px-3 pb-3 pt-0">
                          <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs text-slate-500">From:</span>
                              <span className="text-xs font-medium text-slate-700">{taskEmail.from_name || taskEmail.from_email}</span>
                            </div>
                            <p className="text-sm text-slate-600 mb-3">{taskEmail.summary}</p>
                            {taskEmail.draft_reply && taskEmail.draft_reply !== 'No reply needed' && (
                              <div className="mb-3 p-2 bg-white rounded border border-slate-200">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-slate-600">Draft Reply</span>
                                  {taskEmail.draft_status && draftStatusConfig[taskEmail.draft_status] && (
                                    <span className={`${draftStatusConfig[taskEmail.draft_status].bgColor} ${draftStatusConfig[taskEmail.draft_status].textColor} px-2 py-0.5 rounded text-xs`}>
                                      {draftStatusConfig[taskEmail.draft_status].label}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 line-clamp-2">{(taskEmail.edited_draft || taskEmail.draft_reply).substring(0, 100)}...</p>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); onViewEmail(taskEmail.id); }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                              >
                                View Email
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onEditDraft(taskEmail.id, taskEmail.edited_draft || taskEmail.draft_reply || ''); }}
                                className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1 rounded text-xs font-medium transition-colors"
                              >
                                Edit Draft
                              </button>
                              {taskEmail.draft_status === 'approved' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onSendEmail(taskEmail.id); }}
                                  disabled={sendingEmail === taskEmail.id}
                                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                  {sendingEmail === taskEmail.id ? 'Sending...' : 'Send'}
                                </button>
                              )}
                              {taskEmail.draft_status === 'draft_ready' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onApproveDraft(taskEmail.id); }}
                                  disabled={updating === taskEmail.id}
                                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                              )}
                              {taskEmail.attachments && taskEmail.attachments.length > 0 && getGmailUrl(taskEmail.message_id) && (
                                <a
                                  href={getGmailUrl(taskEmail.message_id)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded text-xs font-medium transition-colors"
                                >
                                  View Attachments
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {urgentAlerts.length === 0 && draftsReady.length === 0 && draftsApproved.length === 0 && tasks.filter(t => t.assignee === 'rbk' && (!hideCompletedTasks || !t.isComplete)).length === 0 && (
            <p className="text-slate-400 text-sm text-center py-4">All caught up! Nothing to do right now.</p>
          )}
        </div>
      </div>

      {/* RBK Action Emails */}
      {urgentEmails.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            RBK Action Emails
          </h3>
          <div className="space-y-4">
            {urgentEmails.map((email) => {
              const priority = priorityConfig[email.priority] || priorityConfig.fyi;
              return (
                <div
                  key={email.id}
                  className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 ${priority.borderLeft} hover:shadow-md transition-all cursor-pointer`}
                  onClick={() => onViewEmail(email.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <h4 className="text-slate-800 text-sm font-semibold leading-snug">{email.subject}</h4>
                    <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                      {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs">{email.from_name || email.from_email}</p>
                  <p className="text-slate-400 text-xs leading-relaxed line-clamp-2 mt-1">{email.summary}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardView;
