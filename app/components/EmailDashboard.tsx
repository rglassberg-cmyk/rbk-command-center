'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from './AuthProvider';
import TodayAgenda from './TodayAgenda';

interface Email {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  summary: string;
  body_text: string;
  action_needed: string | null;
  draft_reply: string | null;
  edited_draft: string | null;
  draft_status: string | null;
  draft_edited_by: string | null;
  draft_edited_at: string | null;
  priority: string;
  status: string;
  action_status: string | null;
  assigned_to: string;
  received_at: string;
  is_unread: boolean;
  flagged_for_meeting: boolean;
  flagged_by: string | null;
  meeting_notes: string | null;
}

interface Stats {
  priority: string;
  count: number;
  unread_count: number;
}

const priorityColors: Record<string, string> = {
  rbk_action: 'bg-red-100 text-red-800 border-red-200',
  eg_action: 'bg-blue-100 text-blue-800 border-blue-200',
  invitation: 'bg-purple-100 text-purple-800 border-purple-200',
  meeting_invite: 'bg-green-100 text-green-800 border-green-200',
  important_no_action: 'bg-orange-100 text-orange-800 border-orange-200',
  review: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  fyi: 'bg-gray-100 text-gray-800 border-gray-200',
};

const priorityLabels: Record<string, string> = {
  rbk_action: 'RBK Action',
  eg_action: 'EG Action',
  invitation: 'Invitation',
  meeting_invite: 'Meeting',
  important_no_action: 'Important',
  review: 'Review',
  fyi: 'FYI',
};

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-500',
};

const draftStatusColors: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  editing: 'bg-yellow-100 text-yellow-800',
  draft_ready: 'bg-green-100 text-green-800',
  approved: 'bg-blue-100 text-blue-800',
};

const draftStatusLabels: Record<string, string> = {
  not_started: 'Not Started',
  editing: 'Editing',
  draft_ready: 'Draft Ready',
  approved: 'Approved',
};

// Action workflow statuses
const actionStatusConfig: Record<string, { label: string; color: string; description: string }> = {
  send: {
    label: 'Send',
    color: 'bg-green-500 text-white',
    description: 'Draft approved, ready to send',
  },
  notify_emily: {
    label: 'Notify Emily',
    color: 'bg-teal-500 text-white',
    description: 'Emily needs to update/revise draft',
  },
  remind_me: {
    label: 'Remind Me',
    color: 'bg-purple-500 text-white',
    description: 'Snooze and remind later',
  },
  escalate_emily: {
    label: 'Escalate to Emily',
    color: 'bg-orange-500 text-white',
    description: 'Move to Emily\'s queue',
  },
  draft_ready: {
    label: 'Draft Ready',
    color: 'bg-blue-500 text-white',
    description: 'Ready for RBK to review',
  },
};

export default function EmailDashboard({
  initialEmails,
  initialStats
}: {
  initialEmails: Email[];
  initialStats: Stats[];
}) {
  const { user, signOut } = useAuth();
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAssigned, setFilterAssigned] = useState<string>('all');
  const [updating, setUpdating] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState<string>('');
  const [showAgenda, setShowAgenda] = useState(true);

  // Get flagged emails for meeting agenda
  const flaggedEmails = emails.filter(e => e.flagged_for_meeting);

  // Extract tasks from meeting notes
  const extractTasks = () => {
    const tasks: Array<{
      emailId: string;
      subject: string;
      task: string;
      assignee: 'emily' | 'rbk';
      isDiscussed: boolean;
      isComplete: boolean;
    }> = [];

    emails.forEach(email => {
      if (email.meeting_notes) {
        const isDiscussed = email.meeting_notes.startsWith('[DISCUSSED]');
        let rawNotes = email.meeting_notes.replace('[DISCUSSED] ', '');
        const isComplete = rawNotes.includes('[DONE]');
        rawNotes = rawNotes.replace('[DONE] ', '').replace(' [DONE]', '');

        if (rawNotes.startsWith('[@EMILY] ')) {
          tasks.push({
            emailId: email.id,
            subject: email.subject,
            task: rawNotes.replace('[@EMILY] ', ''),
            assignee: 'emily',
            isDiscussed,
            isComplete,
          });
        } else if (rawNotes.startsWith('[@RBK] ')) {
          tasks.push({
            emailId: email.id,
            subject: email.subject,
            task: rawNotes.replace('[@RBK] ', ''),
            assignee: 'rbk',
            isDiscussed,
            isComplete,
          });
        }
      }
    });

    return tasks;
  };

  // Toggle task completion
  const toggleTaskComplete = async (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email?.meeting_notes) return;

    let newNotes = email.meeting_notes;
    if (newNotes.includes('[DONE]')) {
      // Remove [DONE]
      newNotes = newNotes.replace('[DONE] ', '').replace(' [DONE]', '');
    } else {
      // Add [DONE] after the assignee tag
      newNotes = newNotes.replace('[@EMILY] ', '[@EMILY] [DONE] ').replace('[@RBK] ', '[@RBK] [DONE] ');
    }

    await updateMeetingNotes(emailId, newNotes);
  };

  const allTasks = extractTasks();
  const emilyTasks = allTasks.filter(t => t.assignee === 'emily');
  const rbkTasks = allTasks.filter(t => t.assignee === 'rbk');

  // Filter emails
  const filteredEmails = emails.filter(email => {
    const matchesSearch = searchQuery === '' ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.summary.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority = filterPriority === 'all' || email.priority === filterPriority;
    const matchesStatus = filterStatus === 'all' || email.status === filterStatus;
    const matchesAssigned = filterAssigned === 'all' || email.assigned_to === filterAssigned;

    return matchesSearch && matchesPriority && matchesStatus && matchesAssigned;
  });

  // Update email status
  const updateStatus = async (emailId: string, newStatus: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: newStatus }),
      });

      if (res.ok) {
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, status: newStatus } : e
        ));
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
    setUpdating(null);
  };

  // Update action status
  const updateActionStatus = async (emailId: string, actionStatus: string | null) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, action_status: actionStatus }),
      });

      if (res.ok) {
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, action_status: actionStatus } : e
        ));
      }
    } catch (error) {
      console.error('Failed to update action status:', error);
    }
    setUpdating(null);
  };

  // State for action status dropdown
  const [showActionMenu, setShowActionMenu] = useState<string | null>(null);

  // Toggle meeting flag
  const toggleMeetingFlag = async (emailId: string, currentlyFlagged: boolean) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged_for_meeting: !currentlyFlagged }),
      });

      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, ...updated } : e
        ));
      }
    } catch (error) {
      console.error('Failed to toggle flag:', error);
    }
    setUpdating(null);
  };

  // Save draft
  const saveDraft = async (emailId: string, draft: string, markReady: boolean = false) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edited_draft: draft,
          draft_status: markReady ? 'draft_ready' : 'editing',
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, ...updated } : e
        ));
        if (markReady) {
          setEditingDraftId(null);
        }
      }
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
    setUpdating(null);
  };

  // Approve draft (for RBK)
  const approveDraft = async (emailId: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_status: 'approved' }),
      });

      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, ...updated } : e
        ));
      }
    } catch (error) {
      console.error('Failed to approve draft:', error);
    }
    setUpdating(null);
  };

  // Start editing draft
  const startEditingDraft = (email: Email) => {
    setEditingDraftId(email.id);
    setDraftText(email.edited_draft || email.draft_reply || '');
  };

  // Clear meeting agenda
  const clearAgenda = async () => {
    for (const email of flaggedEmails) {
      await toggleMeetingFlag(email.id, true);
    }
  };

  // Update meeting notes
  const updateMeetingNotes = async (emailId: string, notes: string) => {
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notes }),
      });

      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, ...updated } : e
        ));
      }
    } catch (error) {
      console.error('Failed to update notes:', error);
    }
  };

  // State for editing notes
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState<string>('');
  const [notesAssignee, setNotesAssignee] = useState<'rbk' | 'emily'>('emily');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                RBK Command Center
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Email Triage Dashboard
              </p>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2">
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="w-8 h-8 rounded-full"
                    />
                  )}
                  <span className="text-sm text-gray-600">
                    {user.displayName || user.email}
                  </span>
                  <button
                    onClick={() => signOut()}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Sign out
                  </button>
                </div>
              )}
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Today's Calendar */}
        <TodayAgenda />

        {/* Today's Tasks Section */}
        {allTasks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Emily's Tasks */}
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-teal-900 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-teal-500 text-white rounded-full flex items-center justify-center text-sm">E</span>
                Emily's Tasks
                <span className="text-sm font-normal text-teal-600">
                  ({emilyTasks.filter(t => !t.isComplete).length} pending)
                </span>
              </h3>
              {emilyTasks.length === 0 ? (
                <p className="text-teal-600 text-sm">No tasks assigned</p>
              ) : (
                <div className="space-y-2">
                  {emilyTasks.map((task, idx) => (
                    <div
                      key={`emily-${task.emailId}-${idx}`}
                      className={`bg-white rounded border p-2 ${
                        task.isComplete ? 'border-green-300' : 'border-teal-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleTaskComplete(task.emailId)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            task.isComplete
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-teal-300 hover:border-teal-500'
                          }`}
                        >
                          {task.isComplete && '✓'}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                            {task.task}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            Re: {task.subject}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RBK's Tasks */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-indigo-500 text-white rounded-full flex items-center justify-center text-sm">R</span>
                RBK's Tasks
                <span className="text-sm font-normal text-indigo-600">
                  ({rbkTasks.filter(t => !t.isComplete).length} pending)
                </span>
              </h3>
              {rbkTasks.length === 0 ? (
                <p className="text-indigo-600 text-sm">No tasks assigned</p>
              ) : (
                <div className="space-y-2">
                  {rbkTasks.map((task, idx) => (
                    <div
                      key={`rbk-${task.emailId}-${idx}`}
                      className={`bg-white rounded border p-2 ${
                        task.isComplete ? 'border-green-300' : 'border-indigo-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleTaskComplete(task.emailId)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            task.isComplete
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-indigo-300 hover:border-indigo-500'
                          }`}
                        >
                          {task.isComplete && '✓'}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                            {task.task}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            Re: {task.subject}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Meeting Agenda Section */}
        {flaggedEmails.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setShowAgenda(!showAgenda)}
                className="flex items-center gap-2"
              >
                <span className="text-lg font-semibold text-amber-900">
                  Morning Meeting Agenda ({flaggedEmails.length})
                </span>
                <span className={`text-amber-600 transition-transform ${showAgenda ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>
              <button
                onClick={clearAgenda}
                className="text-sm text-amber-700 hover:text-amber-900 px-3 py-1 bg-amber-100 rounded hover:bg-amber-200"
              >
                Clear All
              </button>
            </div>
            {showAgenda && (
              <div className="space-y-3">
                {flaggedEmails.map((email) => {
                  const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');

                  return (
                    <div
                      key={email.id}
                      className={`bg-white rounded border p-3 ${
                        isDiscussed
                          ? 'border-green-300 bg-green-50'
                          : 'border-amber-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Discussed checkbox */}
                        <button
                          onClick={() => {
                            const currentNotes = email.meeting_notes || '';
                            if (isDiscussed) {
                              updateMeetingNotes(email.id, currentNotes.replace('[DISCUSSED] ', ''));
                            } else {
                              updateMeetingNotes(email.id, '[DISCUSSED] ' + currentNotes);
                            }
                          }}
                          className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            isDiscussed
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-amber-400'
                          }`}
                          title={isDiscussed ? 'Mark as not discussed' : 'Mark as discussed'}
                        >
                          {isDiscussed && '✓'}
                        </button>

                        <div className="flex-1 min-w-0">
                          {/* Header */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${priorityColors[email.priority]}`}>
                              {priorityLabels[email.priority]}
                            </span>
                            <span className="text-xs text-gray-500">
                              from {email.from_name || email.from_email}
                            </span>
                            {isDiscussed && (
                              <span className="text-xs text-green-600 font-medium">
                                Discussed
                              </span>
                            )}
                          </div>

                          {/* Subject & Summary */}
                          <p className={`font-medium ${isDiscussed ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                            {email.subject}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">{email.summary}</p>

                          {/* Action Items / Notes */}
                          <div className="mt-2">
                            {editingNotesId === email.id ? (
                              <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={notesText}
                                    onChange={(e) => setNotesText(e.target.value)}
                                    placeholder="Add action item..."
                                    className="flex-1 text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500 outline-none"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && notesText.trim()) {
                                        const prefix = isDiscussed ? '[DISCUSSED] ' : '';
                                        const assigneeTag = `[@${notesAssignee.toUpperCase()}] `;
                                        updateMeetingNotes(email.id, prefix + assigneeTag + notesText);
                                        setEditingNotesId(null);
                                      } else if (e.key === 'Escape') {
                                        setEditingNotesId(null);
                                      }
                                    }}
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Assign to:</span>
                                  <button
                                    onClick={() => setNotesAssignee('emily')}
                                    className={`px-2 py-0.5 text-xs rounded ${
                                      notesAssignee === 'emily'
                                        ? 'bg-teal-500 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    Emily
                                  </button>
                                  <button
                                    onClick={() => setNotesAssignee('rbk')}
                                    className={`px-2 py-0.5 text-xs rounded ${
                                      notesAssignee === 'rbk'
                                        ? 'bg-indigo-500 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    RBK
                                  </button>
                                  <div className="flex-1" />
                                  <button
                                    onClick={() => {
                                      if (notesText.trim()) {
                                        const prefix = isDiscussed ? '[DISCUSSED] ' : '';
                                        const assigneeTag = `[@${notesAssignee.toUpperCase()}] `;
                                        updateMeetingNotes(email.id, prefix + assigneeTag + notesText);
                                      }
                                      setEditingNotesId(null);
                                    }}
                                    className="px-2 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingNotesId(null)}
                                    className="px-2 py-1 text-gray-500 text-xs hover:text-gray-700"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                {(() => {
                                  const rawNotes = email.meeting_notes?.replace('[DISCUSSED] ', '') || '';
                                  const isEmily = rawNotes.startsWith('[@EMILY] ');
                                  const isRbk = rawNotes.startsWith('[@RBK] ');
                                  const noteText = rawNotes.replace('[@EMILY] ', '').replace('[@RBK] ', '');

                                  if (noteText) {
                                    return (
                                      <div className={`text-sm px-2 py-1 rounded flex items-center gap-1 ${
                                        isDiscussed ? 'bg-green-100' : 'bg-amber-100'
                                      }`}>
                                        {isEmily && (
                                          <span className="px-1.5 py-0.5 bg-teal-500 text-white text-xs rounded">Emily</span>
                                        )}
                                        {isRbk && (
                                          <span className="px-1.5 py-0.5 bg-indigo-500 text-white text-xs rounded">RBK</span>
                                        )}
                                        <span className={isDiscussed ? 'text-green-700' : 'text-amber-700'}>
                                          {noteText}
                                        </span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                                <button
                                  onClick={() => {
                                    setEditingNotesId(email.id);
                                    const rawNotes = email.meeting_notes?.replace('[DISCUSSED] ', '') || '';
                                    const noteText = rawNotes.replace('[@EMILY] ', '').replace('[@RBK] ', '');
                                    setNotesText(noteText);
                                    if (rawNotes.startsWith('[@RBK] ')) {
                                      setNotesAssignee('rbk');
                                    } else {
                                      setNotesAssignee('emily');
                                    }
                                  }}
                                  className="text-xs text-amber-600 hover:text-amber-800"
                                >
                                  {email.meeting_notes ? 'Edit' : '+ Add action item'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Remove button */}
                        <button
                          onClick={() => toggleMeetingFlag(email.id, true)}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0"
                          title="Remove from agenda"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {initialStats.map((stat) => (
            <button
              key={stat.priority}
              onClick={() => setFilterPriority(filterPriority === stat.priority ? 'all' : stat.priority)}
              className={`bg-white rounded-lg border p-3 text-left transition-all ${
                filterPriority === stat.priority ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mb-1 ${priorityColors[stat.priority]}`}>
                {priorityLabels[stat.priority]}
              </div>
              <p className="text-xl font-bold text-gray-900">{stat.count}</p>
              <p className="text-xs text-gray-500">{stat.unread_count} unread</p>
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="archived">Archived</option>
            </select>

            {/* Assigned Filter */}
            <select
              value={filterAssigned}
              onChange={(e) => setFilterAssigned(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All Assigned</option>
              <option value="rbk">RBK</option>
              <option value="emily">Emily</option>
            </select>

            {/* Clear Filters */}
            {(filterPriority !== 'all' || filterStatus !== 'all' || filterAssigned !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setFilterPriority('all');
                  setFilterStatus('all');
                  setFilterAssigned('all');
                  setSearchQuery('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Email List */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">
              Emails ({filteredEmails.length})
            </h2>
          </div>

          {filteredEmails.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 mb-2">No emails found</p>
              <p className="text-sm text-gray-400">
                {emails.length === 0
                  ? 'Waiting for emails from Apps Script...'
                  : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredEmails.map((email) => (
                <div key={email.id} className="transition-all">
                  {/* Email Row */}
                  <div
                    onClick={() => setExpandedId(expandedId === email.id ? null : email.id)}
                    className={`px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      expandedId === email.id ? 'bg-blue-50' : ''
                    } ${email.status === 'done' || email.status === 'archived' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${priorityColors[email.priority]}`}>
                            {priorityLabels[email.priority]}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[email.status]}`}>
                            {email.status}
                          </span>
                          {email.draft_status && email.draft_status !== 'not_started' && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${draftStatusColors[email.draft_status]}`}>
                              {draftStatusLabels[email.draft_status]}
                            </span>
                          )}
                          {email.action_status && actionStatusConfig[email.action_status] && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${actionStatusConfig[email.action_status].color}`}>
                              {actionStatusConfig[email.action_status].label}
                            </span>
                          )}
                          {email.flagged_for_meeting && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              Agenda
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                          </span>
                          {email.is_unread && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          )}
                        </div>

                        {/* From */}
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {email.from_name || email.from_email}
                        </p>

                        {/* Subject */}
                        <p className={`text-base font-semibold mb-1 ${
                          email.status === 'done' || email.status === 'archived'
                            ? 'text-gray-500 line-through'
                            : 'text-gray-900'
                        }`}>
                          {email.subject}
                        </p>

                        {/* Summary */}
                        <p className="text-sm text-gray-600">
                          {email.summary}
                        </p>
                      </div>

                      {/* Assigned To & Expand Icon */}
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                          email.assigned_to === 'rbk'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-teal-100 text-teal-800'
                        }`}>
                          {email.assigned_to === 'rbk' ? 'RBK' : 'Emily'}
                        </div>
                        <span className={`text-gray-400 transition-transform ${expandedId === email.id ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedId === email.id && (
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                      {/* Action Needed */}
                      {email.action_needed && email.action_needed !== 'No action needed' && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-gray-700 mb-1">Action Needed</h4>
                          <p className="text-sm text-gray-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                            {email.action_needed}
                          </p>
                        </div>
                      )}

                      {/* Draft Reply Section */}
                      {(email.draft_reply && email.draft_reply !== 'No reply needed') && (
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="text-sm font-semibold text-gray-700">Draft Reply</h4>
                            {email.draft_status && email.draft_status !== 'not_started' && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${draftStatusColors[email.draft_status]}`}>
                                {draftStatusLabels[email.draft_status]}
                                {email.draft_edited_by && ` by ${email.draft_edited_by.split('@')[0]}`}
                              </span>
                            )}
                          </div>

                          {editingDraftId === email.id ? (
                            <div>
                              <textarea
                                value={draftText}
                                onChange={(e) => setDraftText(e.target.value)}
                                className="w-full h-40 text-sm text-gray-800 bg-white border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveDraft(email.id, draftText, false);
                                  }}
                                  disabled={updating === email.id}
                                  className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
                                >
                                  {updating === email.id ? '...' : 'Save Draft'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveDraft(email.id, draftText, true);
                                  }}
                                  disabled={updating === email.id}
                                  className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                                >
                                  {updating === email.id ? '...' : 'Mark Ready'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingDraftId(null);
                                  }}
                                  className="px-3 py-1.5 text-gray-600 text-sm hover:text-gray-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-sm text-gray-800 bg-white border border-gray-200 rounded px-3 py-2 whitespace-pre-wrap">
                                {email.edited_draft || email.draft_reply}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditingDraft(email);
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                  Edit draft
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(email.edited_draft || email.draft_reply || '');
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                  Copy draft
                                </button>
                                {email.draft_status === 'draft_ready' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      approveDraft(email.id);
                                    }}
                                    disabled={updating === email.id}
                                    className="text-xs text-green-600 hover:text-green-800 font-medium"
                                  >
                                    {updating === email.id ? '...' : 'Approve'}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Email Body Preview */}
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-1">Email Content</h4>
                        <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded px-3 py-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {email.body_text?.substring(0, 1000) || 'No content available'}
                          {email.body_text && email.body_text.length > 1000 && '...'}
                        </div>
                      </div>

                      {/* Action Status Tags */}
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Set Action</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(actionStatusConfig).map(([key, config]) => (
                            <button
                              key={key}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateActionStatus(email.id, email.action_status === key ? null : key);
                              }}
                              disabled={updating === email.id}
                              className={`px-3 py-1.5 text-sm rounded transition-all disabled:opacity-50 ${
                                email.action_status === key
                                  ? config.color + ' ring-2 ring-offset-1 ring-gray-400'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                              title={config.description}
                            >
                              {config.label}
                            </button>
                          ))}
                          {email.action_status && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateActionStatus(email.id, null);
                              }}
                              disabled={updating === email.id}
                              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Other Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {/* Meeting Flag Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMeetingFlag(email.id, email.flagged_for_meeting);
                          }}
                          disabled={updating === email.id}
                          className={`px-3 py-1.5 text-sm rounded disabled:opacity-50 ${
                            email.flagged_for_meeting
                              ? 'bg-amber-600 text-white hover:bg-amber-700'
                              : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          }`}
                        >
                          {updating === email.id ? '...' : email.flagged_for_meeting ? 'Remove from Agenda' : 'Add to Agenda'}
                        </button>

                        {email.status !== 'in_progress' && email.status !== 'done' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'in_progress');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Start Working'}
                          </button>
                        )}
                        {email.status !== 'done' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'done');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Mark Done'}
                          </button>
                        )}
                        {email.status !== 'archived' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'archived');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Archive'}
                          </button>
                        )}
                        {(email.status === 'done' || email.status === 'archived') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatus(email.id, 'pending');
                            }}
                            disabled={updating === email.id}
                            className="px-3 py-1.5 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50"
                          >
                            {updating === email.id ? '...' : 'Reopen'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
