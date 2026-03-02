'use client';

import { useState, useEffect } from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useAuth } from './AuthProvider';
import { useRealtimeEmails } from '../hooks/useRealtimeEmails';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';

interface Attachment {
  name: string;
  type: string;
  size: number;
}

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
  message_id?: string | null;
  attachments?: Attachment[] | null;
  reminder_date?: string | null;
  revision_comment?: string | null;
}

interface AgendaNote {
  id: string;
  email_id: string;
  text: string;
  type: 'note' | 'decision' | 'action';
  assignee: 'rbk' | 'emily' | null;
  created_at: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  meetingLink?: string | null;
  calendarLink?: string | null;
}

interface Props {
  emails: Email[];
  calendarEvents: CalendarEvent[];
}

// Priority dot colors for minimal indicators
const priorityConfig: Record<string, { bg: string; text: string; label: string; icon: string; dot: string; borderLeft: string }> = {
  rbk_action: { bg: 'bg-red-50 border border-red-200', text: 'text-red-700', label: 'Action Required', icon: '🔴', dot: 'bg-red-500', borderLeft: 'border-l-4 border-l-red-600' },
  eg_action: { bg: 'bg-violet-50 border border-violet-200', text: 'text-violet-700', label: 'Emily', icon: '🔵', dot: 'bg-violet-500', borderLeft: 'border-l-4 border-l-violet-600' },
  invitation: { bg: 'bg-cyan-50 border border-cyan-200', text: 'text-cyan-700', label: 'Invitation', icon: '🟣', dot: 'bg-cyan-500', borderLeft: 'border-l-4 border-l-cyan-600' },
  meeting_invite: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Meeting', icon: '🟢', dot: 'bg-green-500', borderLeft: 'border-l-4 border-l-green-500' },
  important_no_action: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-600', label: 'Important', icon: '🟠', dot: 'bg-slate-400', borderLeft: 'border-l-4 border-l-amber-400' },
  review: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'Review', icon: '🟡', dot: 'bg-amber-400', borderLeft: 'border-l-4 border-l-amber-400' },
  fyi: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-500', label: 'FYI', icon: '⚫', dot: 'bg-slate-300', borderLeft: 'border-l-4 border-l-slate-300' },
};

// Status dot colors for minimal indicators
const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string; dot: string }> = {
  pending: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'Pending', icon: '⏰', dot: 'bg-amber-400' },
  in_progress: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'In Progress', icon: '🔄', dot: 'bg-blue-500' },
  done: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Done', icon: '✅', dot: 'bg-green-500' },
  archived: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-500', label: 'Archived', icon: '📦', dot: 'bg-slate-300' },
};

// Action status - simplified per redesign
const actionStatusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  send: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Send', icon: '✉️' },
  sent: { bg: 'bg-emerald-50 border border-emerald-200', text: 'text-emerald-700', label: 'Sent', icon: '✅' },
  remind_me: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-600', label: 'Remind Me', icon: '⏰' },
  draft_ready: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'Review Draft', icon: '📝' },
  urgent: { bg: 'bg-red-50 border border-red-200', text: 'text-red-700', label: 'URGENT', icon: '🚨' },
};

// Draft status
const draftStatusConfig: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-slate-50', text: 'text-slate-500', label: 'Not Started' },
  editing: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Editing' },
  draft_ready: { bg: 'bg-green-50', text: 'text-green-700', label: 'Review Draft' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Approved' },
  needs_revision: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Needs Revision' },
};

export default function Dashboard({ emails: initialEmails, calendarEvents }: Props) {
  const { user, signOut } = useAuth();
  const { emails, setEmails, isConnected, refreshEmails } = useRealtimeEmails(initialEmails);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Draft editing
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  // Meeting notes
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [notesAssignee, setNotesAssignee] = useState<'rbk' | 'emily'>('emily');

  // Drafts Ready popup
  const [showDraftsPopup, setShowDraftsPopup] = useState(false);
  const [sendingBatch, setSendingBatch] = useState(false);

  // Request Revision modal
  const [revisionEmailId, setRevisionEmailId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState('');

  // Remind Me modal
  const [remindMeEmailId, setRemindMeEmailId] = useState<string | null>(null);
  const [remindMeDate, setRemindMeDate] = useState('');

  // Bulk email selection
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const toggleEmailSelection = (emailId: string) => {
    const newSelected = new Set(selectedEmails);
    if (newSelected.has(emailId)) {
      newSelected.delete(emailId);
    } else {
      newSelected.add(emailId);
    }
    setSelectedEmails(newSelected);
  };

  const selectAllInSection = (emailIds: string[]) => {
    const newSelected = new Set(selectedEmails);
    emailIds.forEach(id => newSelected.add(id));
    setSelectedEmails(newSelected);
  };

  const clearSelection = () => {
    setSelectedEmails(new Set());
  };

  const markSelectedDone = async () => {
    if (selectedEmails.size === 0) return;
    setBulkUpdating(true);
    try {
      const emailIds = Array.from(selectedEmails);
      const promises = emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      );
      await Promise.all(promises);
      setEmails(emails.map(e => selectedEmails.has(e.id) ? { ...e, status: 'done' } : e));
      setSelectedEmails(new Set());

      // Archive all in Gmail (fire and forget)
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark emails done:', error);
    }
    setBulkUpdating(false);
  };

  const markSectionDone = async (emailIds: string[]) => {
    if (emailIds.length === 0) return;
    if (!confirm(`Mark ${emailIds.length} email${emailIds.length > 1 ? 's' : ''} as done?`)) return;
    setBulkUpdating(true);
    try {
      const promises = emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      );
      await Promise.all(promises);
      setEmails(emails.map(e => emailIds.includes(e.id) ? { ...e, status: 'done' } : e));

      // Archive all in Gmail (fire and forget)
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark section done:', error);
    }
    setBulkUpdating(false);
  };

  // Calendar event creation
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventFormData, setEventFormData] = useState({
    title: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    description: '',
  });
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Calendar navigation
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleEvents, setScheduleEvents] = useState<CalendarEvent[]>(calendarEvents);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // Fetch calendar on mount to ensure it works in production
  useEffect(() => {
    fetchCalendarForDate(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch action notes for tasks view
  useEffect(() => {
    fetchActionNotes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Meeting countdown alert
  const [upcomingMeeting, setUpcomingMeeting] = useState<{ title: string; minutesUntil: number; meetingLink?: string | null } | null>(null);

  // Check for upcoming meetings every 30 seconds
  useEffect(() => {
    const checkUpcomingMeetings = () => {
      const now = new Date();
      // Only check today's events from scheduleEvents
      for (const event of scheduleEvents) {
        if (event.isAllDay) continue;
        const startTime = new Date(event.startTime);
        const diffMs = startTime.getTime() - now.getTime();
        const diffMinutes = Math.ceil(diffMs / 60000);

        // Show alert if meeting is within 5 minutes and hasn't started yet
        if (diffMinutes > 0 && diffMinutes <= 5) {
          setUpcomingMeeting({ title: event.title, minutesUntil: diffMinutes, meetingLink: event.meetingLink });
          return;
        }
      }
      setUpcomingMeeting(null);
    };

    checkUpcomingMeetings();
    const interval = setInterval(checkUpcomingMeetings, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [scheduleEvents]);

  const refreshCalendarToken = async (): Promise<boolean> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.setCustomParameters({ prompt: 'none' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;
      const idToken = await result.user.getIdToken();
      if (!accessToken) return false;
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, accessToken }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const fetchAgendaNotes = async (emailId: string) => {
    try {
      const res = await fetch(`/api/agenda-notes?emailId=${emailId}`);
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({ ...prev, [emailId]: data.notes || [] }));
      }
    } catch (e) {
      console.error('Failed to fetch agenda notes:', e);
    }
  };

  const addAgendaNote = async (emailId: string) => {
    if (!newNoteText.trim()) return;
    try {
      const res = await fetch('/api/agenda-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: emailId,
          text: newNoteText.trim(),
          type: 'note',
          assignee: null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({
          ...prev,
          [emailId]: [...(prev[emailId] || []), data.note],
        }));
        setNewNoteText('');
        setAddingNoteToId(null);
      }
    } catch (e) {
      console.error('Failed to add agenda note:', e);
    }
  };

  const deleteAgendaNote = async (emailId: string, noteId: string) => {
    try {
      await fetch(`/api/agenda-notes?id=${noteId}`, { method: 'DELETE' });
      setAgendaNotes(prev => ({
        ...prev,
        [emailId]: (prev[emailId] || []).filter(n => n.id !== noteId),
      }));
      setActionNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (e) {
      console.error('Failed to delete agenda note:', e);
    }
  };

  const fetchActionNotes = async () => {
    try {
      const res = await fetch('/api/agenda-notes?type=action');
      if (res.ok) {
        const data = await res.json();
        setActionNotes(data.notes || []);
      }
    } catch (e) {
      console.error('Failed to fetch action notes:', e);
    }
  };

  const updateAgendaNote = async (emailId: string, noteId: string, updates: { type?: string; assignee?: string | null }) => {
    try {
      const res = await fetch(`/api/agenda-notes?id=${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({
          ...prev,
          [emailId]: (prev[emailId] || []).map(n => n.id === noteId ? data.note : n),
        }));
        // Refresh action notes so tasks view stays in sync
        fetchActionNotes();
      }
    } catch (e) {
      console.error('Failed to update agenda note:', e);
    }
  };

    const fetchCalendarForDate = async (date: Date, isRetry = false) => {
    setLoadingSchedule(true);
    setCalendarAuthError(false);
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const res = await fetch(`/api/calendar/today?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setScheduleEvents(data.events || []);
        setCalendarAuthError(false);
      } else if (res.status === 401 && !isRetry) {
        // Token expired — try silent refresh
        const refreshed = await refreshCalendarToken();
        if (refreshed) {
          await fetchCalendarForDate(date, true);
          return;
        } else {
          setCalendarAuthError(true);
          setScheduleEvents([]);
        }
      } else {
        console.error('Calendar API returned error:', res.status);
        setScheduleEvents([]);
      }
    } catch (e) {
      console.error('Failed to fetch calendar:', e);
      setScheduleEvents([]);
    }
    setLoadingSchedule(false);
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setSelectedDate(newDate);
    fetchCalendarForDate(newDate);
  };

  const deleteCalendarEvent = async (eventId: string) => {
    if (!confirm('Delete this calendar event?')) return;
    try {
      const res = await fetch(`/api/calendar/delete?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setScheduleEvents(scheduleEvents.filter(e => e.id !== eventId));
      } else {
        alert('Failed to delete event');
      }
    } catch (e) {
      console.error('Failed to delete event:', e);
      alert('Failed to delete event');
    }
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // Create calendar event from email
  const createEventFromEmail = (email: Email) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setEventFormData({
      title: email.subject,
      date: tomorrow.toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00',
      location: '',
      description: `From: ${email.from_name || email.from_email}\n\n${email.summary}`,
    });
    setShowEventModal(true);
  };

  // Dashboard popups
  const [showUrgentPopup, setShowUrgentPopup] = useState(false);
  const [showAgendaPopup, setShowAgendaPopup] = useState(false);
  const [showImportantDocsPopup, setShowImportantDocsPopup] = useState(false);
  const [editingImportantDocs, setEditingImportantDocs] = useState(false);
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);
  const [agendaNoteText, setAgendaNoteText] = useState('');

  // Email popup (for viewing from tasks/agenda)
  const [popupEmailId, setPopupEmailId] = useState<string | null>(null);
  const [popupDraftText, setPopupDraftText] = useState('');
  const [calendarAuthError, setCalendarAuthError] = useState(false);
  const popupEmail = popupEmailId ? emails.find(e => e.id === popupEmailId) : null;
  useEffect(() => {
    if (popupEmail) {
      setPopupDraftText(popupEmail.edited_draft || popupEmail.draft_reply || '');
    }
  }, [popupEmailId]);

  // Task creation modal (standalone modal for adding tasks from emails)
  const [currentAgendaItemId, setCurrentAgendaItemId] = useState<string | null>(null);
  const [agendaNotes, setAgendaNotes] = useState<Record<string, AgendaNote[]>>({});
  const [actionNotes, setActionNotes] = useState<AgendaNote[]>([]);
  const [agendaTab, setAgendaTab] = useState<'all' | 'note' | 'decision' | 'action'>('all');
  const [addingNoteToId, setAddingNoteToId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteType, setNewNoteType] = useState<'note' | 'decision' | 'action'>('note');
  const [newNoteAssignee, setNewNoteAssignee] = useState<'rbk' | 'emily'>('emily');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalEmailId, setTaskModalEmailId] = useState<string | null>(null);
  const [taskModalText, setTaskModalText] = useState('');
  const [taskModalAssignee, setTaskModalAssignee] = useState<'rbk' | 'emily'>('emily');

  const openTaskModal = (email: Email) => {
    setTaskModalEmailId(email.id);
    setTaskModalText(`Task: Follow up on "${email.subject}"`);
    setTaskModalAssignee('emily');
    setShowTaskModal(true);
  };

  const saveTaskFromModal = async () => {
    if (!taskModalEmailId || !taskModalText.trim()) return;
    const notes = `[@${taskModalAssignee.toUpperCase()}] ${taskModalText}`;
    await updateMeetingNotes(taskModalEmailId, notes);
    setShowTaskModal(false);
    setTaskModalEmailId(null);
    setTaskModalText('');
  };

  // Hide completed tasks toggle
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);

  // Important Docs - stored in database
  const [importantDocs, setImportantDocs] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState('');

  // Load Important Docs from database on mount
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/important-docs');
        if (res.ok) {
          const data = await res.json();
          setImportantDocs(data.docs || []);
        }
      } catch (e) {
        console.error('Failed to load important docs:', e);
      }
      setLoadingDocs(false);
    };
    fetchDocs();
  }, []);

  const addImportantDoc = async (title: string, url: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportantDocs([...importantDocs, data.doc]);
      }
    } catch (e) {
      console.error('Failed to add doc:', e);
    }
  };

  const deleteImportantDoc = async (id: string) => {
    try {
      const res = await fetch(`/api/important-docs?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setImportantDocs(importantDocs.filter(d => d.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete doc:', e);
    }
  };

  const updateImportantDoc = async (id: string, title: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title }),
      });
      if (res.ok) {
        setImportantDocs(importantDocs.map(d => d.id === id ? { ...d, title } : d));
        setEditingDocId(null);
        setEditingDocTitle('');
      }
    } catch (e) {
      console.error('Failed to update doc:', e);
    }
  };

  // Expanded task in My Tasks section
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Collapsible sections for inbox
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    important_no_action: false,
    review: false,
    invitation: false,
    fyi: false,
  });

  // Derived data
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
      return { emailId: e.id, noteId: null as string | null, subject: e.subject, task: taskText, assignee: isEmily ? 'emily' : isRbk ? 'rbk' : null, isComplete, isDiscussed };
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

  const tasks = [...emailTasks, ...noteTasks];

  const agendaItems = emails.filter(e => e.flagged_for_meeting);
  const urgentEmails = emails.filter(e => e.priority === 'rbk_action' && e.status !== 'done' && e.status !== 'archived');
  const activeEmails = emails.filter(e => showArchived || (e.status !== 'archived'));
  const emilyQueue = emails.filter(e => (e.priority === 'eg_action' || e.draft_status === 'needs_revision') && e.status !== 'done' && e.status !== 'archived');
  const needsRevisionEmails = emails.filter(e => e.draft_status === 'needs_revision' && e.status !== 'done' && e.status !== 'archived');

  // Search filter helper
  const matchesSearch = (email: Email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(query) ||
      email.from_email.toLowerCase().includes(query) ||
      (email.from_name && email.from_name.toLowerCase().includes(query)) ||
      email.summary.toLowerCase().includes(query) ||
      email.body_text.toLowerCase().includes(query)
    );
  };

  // Inbox view filtered lists (with search)
  const urgentAlerts = emails.filter(e => e.action_status === 'urgent' && e.status !== 'done' && e.status !== 'archived' && matchesSearch(e));
  // Helper to check if email is snoozed (has future reminder date/time)
  const isSnoozed = (email: Email) => {
    if (!email.reminder_date) return false;
    const reminderDate = new Date(email.reminder_date);
    return reminderDate > new Date();
  };

  // Filter out snoozed emails from main lists
  const rbkActionEmails = emails.filter(e => e.priority === 'rbk_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const emilyActionEmails = emails.filter(e => e.priority === 'eg_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const importantNoAction = emails.filter(e => e.priority === 'important_no_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const reviewEmails = emails.filter(e => e.priority === 'review' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const invitationEmails = emails.filter(e => e.priority === 'invitation' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const fyiEmails = emails.filter(e => e.priority === 'fyi' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const draftsReady = emails.filter(e => e.draft_status === 'draft_ready' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e));
  const draftsApproved = emails.filter(e => e.draft_status === 'approved' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e));

  // Show all events; mark past ones as ended for dimming
  const now = new Date();
  const upcomingEvents = scheduleEvents; // Show all events, past ones are dimmed in UI
  const isEventPast = (event: CalendarEvent) => {
    if (event.isAllDay) return false;
    return new Date(event.endTime) < now;
  };

  const formatTime = (time: string, isAllDay: boolean) => {
    if (isAllDay) return 'All day';
    return format(parseISO(time), 'h:mm a');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getGmailUrl = (messageId: string | null | undefined) => {
    if (!messageId) return null;
    // Gmail URL format for opening a specific message
    return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  };

  // API Functions
  const updateStatus = async (emailId: string, newStatus: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: newStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: newStatus } : e));

        // If marking as done, also archive in Gmail
        if (newStatus === 'done') {
          fetch(`/api/emails/${emailId}/archive`, { method: 'POST' })
            .catch(err => console.error('Gmail archive failed:', err));
        }
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const updateActionStatus = async (emailId: string, actionStatus: string | null) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, action_status: actionStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, action_status: actionStatus } : e));
      } else {
        console.error('Failed to update action status:', await res.text());
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  // Request revision - sends draft back to Emily with comment
  const requestRevision = async (emailId: string, comment: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          draft_status: 'needs_revision',
          revision_comment: comment,
          priority: 'eg_action' // Move to Emily's queue
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e,
          draft_status: 'needs_revision',
          priority: 'eg_action'
        } : e));
        setRevisionEmailId(null);
        setRevisionComment('');
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  // Set reminder - hides email until reminder date
  const setReminder = async (emailId: string, reminderDate: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          action_status: 'remind_me',
          reminder_date: reminderDate
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e,
          action_status: 'remind_me',
          reminder_date: reminderDate
        } : e));
        setRemindMeEmailId(null);
        setRemindMeDate('');
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

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
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const updateMeetingNotes = async (emailId: string, notes: string) => {
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notes }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
  };

  const toggleTaskComplete = async (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email?.meeting_notes) return;
    let newNotes = email.meeting_notes;
    if (newNotes.includes('[DONE]')) {
      newNotes = newNotes.replace('[DONE] ', '').replace(' [DONE]', '');
    } else {
      newNotes = newNotes.replace('[@EMILY] ', '[@EMILY] [DONE] ').replace('[@RBK] ', '[@RBK] [DONE] ');
    }
    await updateMeetingNotes(emailId, newNotes);
  };

  const saveDraft = async (emailId: string, draft: string, markReady = false) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_draft: draft, draft_status: markReady ? 'draft_ready' : 'editing' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
        if (markReady) setEditingDraftId(null);
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

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
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const sendEmail = async (emailId: string) => {
    if (!confirm('Send this email from kraussb@saracademy.org?')) return;

    setSendingEmail(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const result = await res.json();
        alert('Email sent successfully!');
        // Update local state
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, status: 'done', action_status: 'sent' } : e
        ));
      } else {
        const error = await res.json();
        alert(`Failed to send: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to send:', error);
      alert('Failed to send email. Please try again.');
    }
    setSendingEmail(null);
  };

  const createCalendarEvent = async () => {
    setCreatingEvent(true);
    try {
      const startDateTime = new Date(`${eventFormData.date}T${eventFormData.startTime}:00`);
      const endDateTime = new Date(`${eventFormData.date}T${eventFormData.endTime}:00`);

      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: eventFormData.title,
          description: eventFormData.description || undefined,
          location: eventFormData.location || undefined,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
        }),
      });

      if (res.ok) {
        alert('Event created successfully!');
        setShowEventModal(false);
        setEventFormData({
          title: '',
          date: new Date().toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '10:00',
          location: '',
          description: '',
        });
        // Refresh the page to get updated calendar
        window.location.reload();
      } else {
        const error = await res.json();
        alert(`Failed to create event: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to create event:', error);
      alert('Failed to create event. Please try again.');
    }
    setCreatingEvent(false);
  };

  const openEventModalFromEmail = (email: Email) => {
    setEventFormData({
      title: email.subject,
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00',
      location: '',
      description: `From: ${email.from_name || email.from_email}\n\n${email.summary || ''}`,
    });
    setShowEventModal(true);
  };

  // Badge Component - minimal dot indicator
  const Badge = ({ config }: { config: { bg: string; text: string; label: string; icon: string; dot?: string } }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full inline-block ${config.dot || config.bg.split(' ')[0]}`}></span>
      <span className="text-slate-500 text-xs">{config.label}</span>
    </span>
  );

  // Email Card Component
  const EmailCard = ({ email }: { email: Email }) => {
    const priority = priorityConfig[email.priority] || priorityConfig.fyi;
    const status = statusConfig[email.status] || statusConfig.pending;
    const isExpanded = expandedEmail === email.id;

    const stripSignature = (text: string): string => {
      if (!text) return '';
      const lines = text.split('\n');
      const cutPatterns = [
        /^--\s*$/,
        /^_{3,}/,
        /principal/i,
        /head of school/i,
        /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
        /www\./i,
        /@\w+\.\w+/,
        /sent from my/i,
      ];
      let cutIndex = lines.length;
      for (let i = 0; i < lines.length; i++) {
        if (cutPatterns.some(p => p.test(lines[i]))) {
          cutIndex = i;
          break;
        }
      }
      return lines.slice(0, cutIndex).join('\n').replace(/^>+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    };

    const cleanBody = stripSignature(email.body_text || email.summary);
    const draftValue = email.edited_draft || email.draft_reply || '';

    return (
      <div className={`bg-white border border-slate-200 rounded-xl mb-2 shadow-sm transition-all duration-150 ${priority.borderLeft} ${isExpanded ? 'ring-2 ring-blue-200 ring-offset-1' : 'hover:shadow-md'} ${email.status === 'done' ? 'opacity-60' : ''}`}>

        {/* COLLAPSED / HEADER ROW — always visible */}
        <div className="p-3 cursor-pointer" onClick={() => setExpandedEmail(isExpanded ? null : email.id)}>
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className={`text-slate-800 text-sm font-semibold leading-snug ${email.status === 'done' ? 'line-through text-slate-400' : ''}`}>
              {email.subject}
            </h3>
            <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
            </span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-xs">{email.from_name || email.from_email}</p>
            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <div className="relative group">
                <button onClick={() => updateStatus(email.id, 'done')} className={`p-1.5 rounded-md transition-colors hover:bg-green-50 ${email.status === 'done' ? 'text-green-600' : 'text-slate-500 hover:text-green-600'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Mark Done</span>
              </div>
              <div className="relative group">
                <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`p-1.5 rounded-md transition-colors hover:bg-red-50 ${email.action_status === 'urgent' ? 'text-red-600' : 'text-slate-500 hover:text-red-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Mark Urgent</span>
              </div>
              <div className="relative group">
                <button onClick={() => { setRemindMeEmailId(email.id); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setRemindMeDate(tomorrow.toISOString().split('T')[0]); }} className="p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Remind Me</span>
              </div>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <div className="relative group">
                <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-1.5 rounded-md transition-colors hover:bg-amber-50 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-500 hover:text-amber-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill={email.flagged_for_meeting ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add to Agenda</span>
              </div>
              <div className="relative group">
                <button onClick={() => createEventFromEmail(email)} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add to Calendar</span>
              </div>
              <div className="relative group">
                <button onClick={() => { setTaskModalEmailId(email.id); setShowTaskModal(true); }} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add Task</span>
              </div>
            </div>
          </div>

          {/* Summary preview — only when collapsed */}
          {!isExpanded && (
            <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{email.summary}</p>
          )}
        </div>

        {/* EXPANDED PANEL */}
        {isExpanded && (
          <div className="px-3 pb-3" onClick={(e) => e.stopPropagation()}>

            {/* Action needed banner — full width */}
            {email.action_needed && email.action_needed !== 'No action needed' && (
              <div className="mb-3 bg-white border border-slate-100 border-l-4 border-l-orange-400 rounded-xl shadow-md px-4 py-3 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Action Needed</p>
                  <p className="text-sm text-slate-700">{email.action_needed}</p>
                </div>
              </div>
            )}

            {/* Two column layout */}
            <div className="flex gap-3">

              {/* Left: original email */}
              <div className="flex-[4] min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Original Email</p>
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {cleanBody || email.summary}
                </div>
              </div>

              {/* Right: draft reply */}
              <div className="flex-[5] min-w-0">
                <div className="bg-white rounded-xl shadow-md border border-slate-100 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Draft Reply</p>
                    <span className={`text-xs font-medium ${email.draft_status === 'draft_ready' ? 'text-green-600' : email.draft_status === 'approved' ? 'text-blue-600' : 'text-slate-400'}`}>
                      {email.draft_status === 'draft_ready' ? '✓ Ready' : email.draft_status === 'approved' ? '✓ Approved' : 'Not Started'}
                    </span>
                  </div>
                  <textarea
                    className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
                    rows={6}
                    placeholder="Draft a reply..."
                    defaultValue={draftValue}
                    onChange={(e) => setDraftText(e.target.value)}
                    onBlur={() => saveDraft(email.id, draftText)}
                  />
                  <button onClick={() => saveDraft(email.id, draftText, true)} className="w-full px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
                    Mark Ready
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    );
  };

  // Summary Card Component
  const SummaryCard = ({ icon, title, count, subtitle, gradient, topBorder, onClick }: {
    icon: string; title: string; count?: number; subtitle: string; gradient: string; topBorder?: string; onClick?: () => void;
  }) => (
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
        ) : title === 'Urgent' ? null : (
          <span className="text-2xl opacity-60">{icon}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-white font-semibold text-lg">RBK Command Center</h1>
          <p className="text-slate-500 text-xs mt-1">{format(new Date(), 'EEEE, MMM d')}</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            )},
            { id: 'inbox', label: 'All Emails', icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )},
            { id: 'emily', label: "Emily's Queue", icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )},
            { id: 'agenda', label: 'Meeting Agenda', icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            )},
            { id: 'tasks', label: 'Tasks', icon: (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            )},
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeNav === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
              {item.id === 'inbox' && emails.filter(e => e.is_unread).length > 0 && (
                <span className="ml-auto bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                  {emails.filter(e => e.is_unread).length}
                </span>
              )}
              {item.id === 'emily' && emilyQueue.length > 0 && (
                <span className="ml-auto bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                  {emilyQueue.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* User */}
        {user && (
          <div className="p-4 border-t border-slate-800">
            <div className="flex items-center gap-3">
              {user.photoURL && (
                <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
                <button onClick={() => signOut()} className="text-xs text-slate-500 hover:text-white transition-colors">Sign out</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 font-semibold text-xl">Welcome back, {user?.displayName?.split(' ')[0] || 'RBK'}</h2>
              <p className="text-slate-500 text-sm mt-0.5">Here's what needs your attention today</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Meeting Countdown Alert */}
              {upcomingMeeting && (
                <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                  <span className="font-medium text-amber-800 truncate max-w-[200px]">{upcomingMeeting.title}</span>
                  <span className="whitespace-nowrap text-amber-600">in {upcomingMeeting.minutesUntil} min{upcomingMeeting.minutesUntil !== 1 ? 's' : ''}</span>
                  {upcomingMeeting.meetingLink && (
                    <a
                      href={upcomingMeeting.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-amber-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-amber-700 transition-colors ml-1 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Join
                    </a>
                  )}
                </div>
              )}
              {isConnected && (
                <span className="flex items-center gap-1.5 text-sm text-slate-500">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  Live
                </span>
              )}
              {/* Urgent Alert Button - shows on all pages except inbox (which has banner) */}
              {urgentAlerts.length > 0 && activeNav !== 'inbox' && (
                <button
                  onClick={() => {
                    setActiveNav('inbox');
                    setExpandedEmail(urgentAlerts[0].id);
                  }}
                  className="bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  {urgentAlerts.length} Urgent
                </button>
              )}
              <button
                onClick={refreshEmails}
                className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-sm transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </header>

        <div className="p-8">
          {/* Dashboard View */}
          {activeNav === 'dashboard' && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <SummaryCard
                  icon="🔴"
                  title="Urgent"
                  count={urgentAlerts.length}
                  subtitle={urgentAlerts.length > 0 ? "needs attention now" : "all clear"}
                  gradient={urgentAlerts.length > 0 ? "" : ""}
                  topBorder="border-t-4 border-t-red-500"
                  onClick={urgentAlerts.length > 0 ? () => setShowUrgentPopup(true) : undefined}
                />
                {/* Quick Links Card */}
                <div
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-blue-500"
                >
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Quick Links</p>
                    <span className="text-lg text-slate-400">📁</span>
                  </div>
                  <div className="space-y-2">
                    <a
                      href="https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
                    >
                      📂 Today's Folder
                    </a>
                    <a
                      href="https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
                    >
                      📄 Daily Announcements
                    </a>
                    <a
                      href="https://drive.google.com/drive/folders/1-HDl_sA_9jDZPTEOGPJ7R57O5iU62AwE"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
                    >
                      📁 Daily Folder
                    </a>
                  </div>
                </div>
                <SummaryCard
                  icon="📄"
                  title="Important Docs"
                  count={importantDocs.length}
                  subtitle="click to view"
                  gradient=""
                  topBorder="border-t-4 border-t-amber-500"
                  onClick={() => setShowImportantDocsPopup(true)}
                />
                <SummaryCard
                  icon="⭐"
                  title="Meeting Agenda"
                  count={agendaItems.length}
                  subtitle="click to view"
                  gradient=""
                  topBorder="border-t-4 border-t-emerald-500"
                  onClick={() => setShowAgendaPopup(true)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Today's Schedule */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigateDate('prev')}
                        className="text-slate-400 hover:text-slate-600 p-1"
                      >
                        ◀
                      </button>
                      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <span className="text-blue-500">📅</span>
                        {isToday(selectedDate) ? "Today's Schedule" : format(selectedDate, 'EEE, MMM d')}
                      </h3>
                      <button
                        onClick={() => navigateDate('next')}
                        className="text-slate-400 hover:text-slate-600 p-1"
                      >
                        ▶
                      </button>
                      {!isToday(selectedDate) && (
                        <button
                          onClick={() => { setSelectedDate(new Date()); setScheduleEvents(calendarEvents); }}
                          className="text-xs text-blue-600 hover:text-blue-800 ml-2"
                        >
                          Back to Today
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowEventModal(true)}
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
                            const refreshed = await refreshCalendarToken();
                            if (refreshed) fetchCalendarForDate(selectedDate);
                          }}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                        >
                          Reconnect Calendar
                        </button>
                      </div>
                    ) : (
                      <p className="text-slate-400 text-sm">No events {isToday(selectedDate) ? 'today' : 'on this day'}</p>
                    )
                  ) : upcomingEvents.length === 0 ? (
                    <p className="text-slate-400 text-sm">No events on this day</p>
                  ) : (
                    <div className="space-y-1">
                      {upcomingEvents.map((event) => (
                        <div key={event.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                          <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded min-w-[60px] text-center">
                            {formatTime(event.startTime, event.isAllDay)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-900 text-sm truncate">{event.title}</p>
                            {event.location && <p className="text-xs text-slate-500 truncate">📍 {event.location}</p>}
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
                                ↗
                              </a>
                            )}
                            <button
                              onClick={() => deleteCalendarEvent(event.id)}
                              className="text-slate-400 hover:text-red-500 text-xs"
                              title="Delete event"
                            >
                              🗑️
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
                    <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                      <span className="text-blue-500">✅</span> To-Do Today
                    </h3>
                    <button
                      onClick={() => setHideCompletedTasks(!hideCompletedTasks)}
                      className={`text-xs px-2 py-1 rounded transition-all ${hideCompletedTasks ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {hideCompletedTasks ? 'Show Completed' : 'Hide Completed'}
                    </button>
                  </div>

                  {/* Urgent Items - Always at Top */}
                  {urgentAlerts.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Urgent</p>
                      <div className="space-y-2">
                        {urgentAlerts.map((email) => (
                          <div
                            key={email.id}
                            className="bg-white border border-red-200 border-l-4 border-l-red-500 rounded-lg p-3 cursor-pointer hover:bg-red-50 transition-colors shadow-sm"
                            onClick={() => setPopupEmailId(email.id)}
                          >
                            <p className="text-sm font-medium text-slate-900">{email.subject}</p>
                            <p className="text-xs text-slate-500">{email.from_name || email.from_email}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Review Drafts Sub-section */}
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
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => approveDraft(email.id)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => setRevisionEmailId(email.id)}
                                className="border border-amber-200 text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded text-xs font-medium"
                              >
                                Request Revision
                              </button>
                            </div>
                          </div>
                        ))}
                        {draftsReady.length > 3 && (
                          <button
                            onClick={() => setActiveNav('inbox')}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            View all {draftsReady.length} drafts →
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
                            onClick={async () => {
                              if (!confirm(`Send all ${draftsApproved.length} approved emails?`)) return;
                              setSendingBatch(true);
                              try {
                                const res = await fetch('/api/emails/send-batch', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ emailIds: draftsApproved.map(e => e.id) }),
                                });
                                const result = await res.json();
                                if (res.ok) {
                                  const sentIds = result.results.filter((r: { success: boolean }) => r.success).map((r: { id: string }) => r.id);
                                  setEmails(prev => prev.map(e =>
                                    sentIds.includes(e.id) ? { ...e, status: 'done', action_status: 'sent' } : e
                                  ));
                                  alert(result.message);
                                } else {
                                  alert(`Failed: ${result.error}`);
                                }
                              } catch (error) {
                                console.error('Batch send error:', error);
                                alert('Failed to send emails.');
                              }
                              setSendingBatch(false);
                            }}
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
                                onClick={() => sendEmail(email.id)}
                                disabled={sendingEmail === email.id}
                                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                              >
                                {sendingEmail === email.id ? 'Sending...' : 'Send'}
                              </button>
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
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
                                    onClick={(e) => { e.stopPropagation(); toggleTaskComplete(task.emailId!); }}
                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                                      task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-blue-500'
                                    }`}
                                  >
                                    {task.isComplete && '✓'}
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
                                {taskEmail && <span className="text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</span>}
                              </div>
                              {isExpanded && taskEmail && (
                                <div className="px-3 pb-3 pt-0">
                                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-xs text-slate-500">From:</span>
                                      <span className="text-xs font-medium text-slate-700">{taskEmail.from_name || taskEmail.from_email}</span>
                                    </div>
                                    <p className="text-sm text-slate-600 mb-3">{taskEmail.summary}</p>
                                    {/* Draft status indicator */}
                                    {taskEmail.draft_reply && taskEmail.draft_reply !== 'No reply needed' && (
                                      <div className="mb-3 p-2 bg-white rounded border border-slate-200">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-xs font-medium text-slate-600">Draft Reply</span>
                                          {taskEmail.draft_status && draftStatusConfig[taskEmail.draft_status] && (
                                            <span className={`${draftStatusConfig[taskEmail.draft_status].bg} ${draftStatusConfig[taskEmail.draft_status].text} px-2 py-0.5 rounded text-xs`}>
                                              {draftStatusConfig[taskEmail.draft_status].label}
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-slate-500 line-clamp-2">{(taskEmail.edited_draft || taskEmail.draft_reply).substring(0, 100)}...</p>
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setPopupEmailId(taskEmail.id); }}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                                      >
                                        View Email
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingDraftId(taskEmail.id); setDraftText(taskEmail.edited_draft || taskEmail.draft_reply || ''); }}
                                        className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1 rounded text-xs font-medium transition-colors"
                                      >
                                        Edit Draft
                                      </button>
                                      {taskEmail.draft_status === 'approved' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); sendEmail(taskEmail.id); }}
                                          disabled={sendingEmail === taskEmail.id}
                                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                        >
                                          {sendingEmail === taskEmail.id ? 'Sending...' : 'Send'}
                                        </button>
                                      )}
                                      {taskEmail.draft_status === 'draft_ready' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); approveDraft(taskEmail.id); }}
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
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
RBK Action Emails
                  </h3>
                  <div className="space-y-4">
                    {urgentEmails.map((email) => (
                      <EmailCard key={email.id} email={email} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Inbox View - Redesigned */}
          {activeNav === 'inbox' && (
            <>
            <div className="space-y-6">
              {/* Urgent Alert Banner */}
              {urgentAlerts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                      <div>
                        <p className="font-semibold text-slate-900">URGENT: {urgentAlerts.length} email{urgentAlerts.length > 1 ? 's' : ''} need immediate attention</p>
                        <p className="text-sm text-slate-600">{urgentAlerts[0].subject}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setExpandedEmail(urgentAlerts[0].id);
                        updateActionStatus(urgentAlerts[0].id, null);
                      }}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
                    >
                      View Now
                    </button>
                  </div>
                </div>
              )}

              {/* Search Bar */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search emails by subject, sender, or content..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 pl-10 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <svg className="absolute left-3 top-3.5 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Two Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Action Emails */}
                <div className="space-y-6">
                  {/* RBK Action Emails */}
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                    <div className="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white pb-2">
                      <h3 className="text-lg font-semibold text-slate-900">RBK Action Emails</h3>
                      <div className="flex items-center gap-2">
                        {rbkActionEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(rbkActionEmails.map(e => e.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${rbkActionEmails.length > 0 ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>
                          {rbkActionEmails.length}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {rbkActionEmails.length === 0 ? (
                        <p className="text-slate-500 text-sm">No action items</p>
                      ) : (
                        rbkActionEmails.map((email) => (
                          <div
                            key={email.id}
                            onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            className={`bg-white border border-slate-200 border-l-4 border-l-red-600 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${selectedEmails.has(email.id) ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(email.id)}
                                onChange={(e) => { e.stopPropagation(); toggleEmailSelection(email.id); }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0 flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="text-slate-900 font-medium text-sm truncate">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                    📎 {email.attachments.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            {expandedEmail === email.id && (
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                {/* Attachments */}
                                {email.attachments && email.attachments.length > 0 && (
                                  <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                    <div className="flex items-center justify-between mb-1">
                                      <p className="text-xs font-semibold text-amber-800">
                                        📎 {email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}
                                      </p>
                                      {getGmailUrl(email.message_id) && (
                                        <a
                                          href={getGmailUrl(email.message_id)!}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                                        >
                                          View Attachments →
                                        </a>
                                      )}
                                    </div>
                                    {email.attachments && email.attachments.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">
                                            {att.name} ({formatFileSize(att.size)})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="bg-slate-50 rounded-lg p-3 max-h-60 overflow-y-auto">
                                  <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                    {email.body_text || email.summary}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-3">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateStatus(email.id, 'done'); }}
                                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                                  >
                                    Done
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent'); }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                                      email.action_status === 'urgent' ? 'bg-red-600 text-white' : 'border border-red-200 text-red-600 hover:bg-red-50'
                                    }`}
                                  >
                                    {email.action_status === 'urgent' ? 'Urgent' : 'Urgent'}
                                  </button>
                                  <div className="flex items-center gap-1 ml-auto">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleMeetingFlag(email.id, email.flagged_for_meeting); }}
                                      className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`}
                                      title="Add to Agenda"
                                    >
                                      {email.flagged_for_meeting ? '⭐' : '☆'}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Edit Draft"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEventModalFromEmail(email); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Add to Calendar"
                                    >
                                      📅
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Remind Me"
                                    >
                                      ⏰
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Emily Action Emails */}
                  <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                    <div className="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white pb-2">
                      <h3 className="text-lg font-semibold text-slate-900">Emily Action Emails</h3>
                      <div className="flex items-center gap-2">
                        {emilyActionEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(emilyActionEmails.map(e => e.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${emilyActionEmails.length > 0 ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>
                          {emilyActionEmails.length}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {emilyActionEmails.length === 0 ? (
                        <p className="text-slate-500 text-sm">No action items</p>
                      ) : (
                        emilyActionEmails.map((email) => (
                          <div
                            key={email.id}
                            onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            className={`bg-white border border-slate-200 border-l-4 border-l-violet-600 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${selectedEmails.has(email.id) ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(email.id)}
                                onChange={(e) => { e.stopPropagation(); toggleEmailSelection(email.id); }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0 flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="text-slate-900 font-medium text-sm truncate">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                    📎 {email.attachments.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            {expandedEmail === email.id && (
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                {/* Attachments */}
                                {email.attachments && email.attachments.length > 0 && (
                                  <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                    <div className="flex items-center justify-between mb-1">
                                      <p className="text-xs font-semibold text-amber-800">
                                        📎 {email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}
                                      </p>
                                      {getGmailUrl(email.message_id) && (
                                        <a
                                          href={getGmailUrl(email.message_id)!}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                                        >
                                          View Attachments →
                                        </a>
                                      )}
                                    </div>
                                    {email.attachments && email.attachments.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">
                                            {att.name} ({formatFileSize(att.size)})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="bg-slate-50 rounded-lg p-3 max-h-60 overflow-y-auto">
                                  <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                    {email.body_text || email.summary}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-3">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateStatus(email.id, 'done'); }}
                                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                                  >
                                    Done
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent'); }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                                      email.action_status === 'urgent' ? 'bg-red-600 text-white' : 'border border-red-200 text-red-600 hover:bg-red-50'
                                    }`}
                                  >
                                    Urgent
                                  </button>
                                  <div className="flex items-center gap-1 ml-auto">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleMeetingFlag(email.id, email.flagged_for_meeting); }}
                                      className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`}
                                      title="Add to Agenda"
                                    >
                                      {email.flagged_for_meeting ? '⭐' : '☆'}
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Edit Draft"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEventModalFromEmail(email); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Add to Calendar"
                                    >
                                      📅
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }}
                                      className="p-2 rounded-full hover:bg-slate-100 text-slate-500"
                                      title="Remind Me"
                                    >
                                      ⏰
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Bottom Buttons */}
                  <div className="flex gap-4">
                    <button
                      onClick={() => setShowDraftsPopup(true)}
                      className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      Drafts Ready
                      {draftsReady.length > 0 && (
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{draftsReady.length}</span>
                      )}
                    </button>
                    <button
                      disabled
                      className="flex-1 bg-slate-100 text-slate-400 px-4 py-3 rounded-xl font-medium cursor-not-allowed border border-slate-200 flex items-center justify-center gap-2"
                    >
                      TBD
                    </button>
                  </div>
                </div>

                {/* Right Column - Collapsible Categories */}
                <div className="space-y-4">
                  {/* Important No Action */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, important_no_action: !s.important_no_action }))}
                      className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-slate-100"
                    >
                      <span className="font-semibold text-sm">Important No Action</span>
                      <div className="flex items-center gap-2">
                        {importantNoAction.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(importantNoAction.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${importantNoAction.length > 0 ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{importantNoAction.length}</span>
                        <span className={`transition-transform ${expandedSections.important_no_action ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.important_no_action && (
                      <div className="p-4 space-y-3">
                        {importantNoAction.length === 0 ? (
                          <p className="text-slate-500 text-sm">No emails</p>
                        ) : (
                          importantNoAction.map((email) => (
                            <div
                              key={email.id}
                              className={`bg-white border border-slate-200 border-l-4 border-l-amber-400 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${expandedEmail === email.id ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                      {getGmailUrl(email.message_id) && (
                                        <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">View Attachments →</a>
                                      )}
                                    </div>
                                  )}
                                  <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto mb-3">
                                    <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${email.action_status === 'urgent' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-600 hover:bg-red-50'}`}>Urgent</button>
                                    <div className="flex items-center gap-1 ml-auto">
                                      <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`} title="Add to Agenda">{email.flagged_for_meeting ? '⭐' : '☆'}</button>
                                      <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Edit Draft">✏️</button>
                                      <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Remind Me">⏰</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Review */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, review: !s.review }))}
                      className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-slate-100"
                    >
                      <span className="font-semibold text-sm">Review</span>
                      <div className="flex items-center gap-2">
                        {reviewEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(reviewEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${reviewEmails.length > 0 ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{reviewEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.review ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.review && (
                      <div className="p-4 space-y-3">
                        {reviewEmails.length === 0 ? (
                          <p className="text-slate-500 text-sm">No emails</p>
                        ) : (
                          reviewEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`bg-white border border-slate-200 border-l-4 border-l-amber-400 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${expandedEmail === email.id ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                      {getGmailUrl(email.message_id) && (
                                        <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">View Attachments →</a>
                                      )}
                                    </div>
                                  )}
                                  <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto mb-3">
                                    <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${email.action_status === 'urgent' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-600 hover:bg-red-50'}`}>Urgent</button>
                                    <div className="flex items-center gap-1 ml-auto">
                                      <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`} title="Add to Agenda">{email.flagged_for_meeting ? '⭐' : '☆'}</button>
                                      <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Edit Draft">✏️</button>
                                      <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Remind Me">⏰</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Invitations */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, invitation: !s.invitation }))}
                      className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-slate-100"
                    >
                      <span className="font-semibold text-sm">Invitations</span>
                      <div className="flex items-center gap-2">
                        {invitationEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(invitationEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${invitationEmails.length > 0 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{invitationEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.invitation ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.invitation && (
                      <div className="p-4 space-y-3">
                        {invitationEmails.length === 0 ? (
                          <p className="text-slate-500 text-sm">No emails</p>
                        ) : (
                          invitationEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`bg-white border border-slate-200 border-l-4 border-l-cyan-600 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${expandedEmail === email.id ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                      {getGmailUrl(email.message_id) && (
                                        <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">View Attachments →</a>
                                      )}
                                    </div>
                                  )}
                                  <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto mb-3">
                                    <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${email.action_status === 'urgent' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-600 hover:bg-red-50'}`}>Urgent</button>
                                    <div className="flex items-center gap-1 ml-auto">
                                      <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`} title="Add to Agenda">{email.flagged_for_meeting ? '⭐' : '☆'}</button>
                                      <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Edit Draft">✏️</button>
                                      <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Remind Me">⏰</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* FYI */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, fyi: !s.fyi }))}
                      className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-slate-100"
                    >
                      <span className="font-semibold text-sm">FYI</span>
                      <div className="flex items-center gap-2">
                        {fyiEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(fyiEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            All Done
                          </button>
                        )}
                        <span className={`${fyiEmails.length > 0 ? 'bg-slate-400 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{fyiEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.fyi ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.fyi && (
                      <div className="p-4 space-y-3">
                        {fyiEmails.length === 0 ? (
                          <p className="text-slate-500 text-sm">No emails</p>
                        ) : (
                          fyiEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`bg-white border border-slate-200 border-l-4 border-l-slate-300 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${expandedEmail === email.id ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                  <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                      {getGmailUrl(email.message_id) && (
                                        <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">View Attachments →</a>
                                      )}
                                    </div>
                                  )}
                                  <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto mb-3">
                                    <p className="text-slate-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${email.action_status === 'urgent' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-600 hover:bg-red-50'}`}>Urgent</button>
                                    <div className="flex items-center gap-1 ml-auto">
                                      <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`} title="Add to Agenda">{email.flagged_for_meeting ? '⭐' : '☆'}</button>
                                      <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Edit Draft">✏️</button>
                                      <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Remind Me">⏰</button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Drafts Ready Popup */}
              {showDraftsPopup && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDraftsPopup(false)}>
                  <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">Drafts Ready for Review</h3>
                      <button onClick={() => setShowDraftsPopup(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
                    </div>
                    <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
                      {draftsReady.length === 0 ? (
                        <p className="text-slate-500 text-center py-8">No drafts ready for review</p>
                      ) : (
                        draftsReady.map((email) => (
                          <div key={email.id} className="border border-slate-200 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="font-medium text-slate-900">{email.subject}</p>
                                <p className="text-sm text-slate-500">To: {email.from_email}</p>
                              </div>
                              <button
                                onClick={() => sendEmail(email.id)}
                                disabled={sendingEmail === email.id}
                                className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                              >
                                {sendingEmail === email.id ? 'Sending...' : 'Send'}
                              </button>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-3 mt-2">
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                {(email.edited_draft || email.draft_reply)?.substring(0, 200)}...
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {draftsApproved.length > 0 && (
                      <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
                        <button
                          onClick={async () => {
                            if (!confirm(`Send all ${draftsApproved.length} approved drafts?`)) return;
                            setSendingBatch(true);
                            try {
                              const res = await fetch('/api/emails/send-batch', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email_ids: draftsApproved.map(e => e.id) }),
                              });
                              const result = await res.json();
                              if (res.ok) {
                                // Update local state for successfully sent emails
                                const sentIds = result.results.filter((r: { success: boolean }) => r.success).map((r: { id: string }) => r.id);
                                setEmails(emails.map(e =>
                                  sentIds.includes(e.id) ? { ...e, status: 'done', action_status: 'sent' } : e
                                ));
                                alert(result.message);
                              } else {
                                alert(`Failed: ${result.error}`);
                              }
                            } catch (error) {
                              console.error('Batch send error:', error);
                              alert('Failed to send emails. Please try again.');
                            }
                            setSendingBatch(false);
                            setShowDraftsPopup(false);
                          }}
                          disabled={sendingBatch}
                          className="w-full bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {sendingBatch ? 'Sending All...' : `Send All Approved (${draftsApproved.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Floating Selection Action Bar */}
            {selectedEmails.size > 0 && (
              <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 z-40">
                <span className="font-medium text-sm">{selectedEmails.size} selected</span>
                <button
                  onClick={markSelectedDone}
                  disabled={bulkUpdating}
                  className="bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {bulkUpdating ? 'Updating...' : 'Mark Done'}
                </button>
                <button
                  onClick={clearSelection}
                  className="text-slate-400 hover:text-white transition-colors text-sm"
                >
                  Clear
                </button>
              </div>
            )}
            </>
          )}

          {/* Agenda View */}
          {activeNav === 'agenda' && (
            <div className="flex gap-6">
              {/* Schedule Sidebar */}
              <div className="w-56 flex-shrink-0">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 sticky top-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Today's Schedule</h4>
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
                              <a href={event.meetingLink} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline mt-0.5 block">
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
                {/* Header + Tab Strip */}
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
                    <p className="text-2xl mb-2">⭐</p>
                    <p className="text-slate-500 font-medium">No items on the agenda</p>
                    <p className="text-sm text-slate-400 mt-1">Star emails from any view to add them here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {agendaItems.map((email, idx) => {
                      const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
                      const isCurrent = currentAgendaItemId === email.id;
                      const notes = agendaNotes[email.id] || [];
                      const filteredNotes = agendaTab === 'all' ? notes : notes.filter(n => n.type === agendaTab);

                      // Load notes when item first appears
                      if (!agendaNotes[email.id]) {
                        fetchAgendaNotes(email.id);
      agendaNotes[email.id] = []; // prevent duplicate fetches
                      }

                      return (
                        <div
                          key={email.id}
                          className={`bg-white border border-slate-200 rounded-xl shadow-sm transition-all ${
                            isCurrent ? 'border-l-4 border-l-blue-500 ring-1 ring-blue-100' : ''
                          } ${isDiscussed ? 'opacity-60' : ''}`}
                        >
                          <div className="p-4">
                            <div className="flex items-start gap-3">
                              {/* Number + Check */}
                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                <span className="text-xs text-slate-400 font-medium w-5 text-center">{idx + 1}</span>
                                <button
                                  onClick={() => {
                                    const n = email.meeting_notes || '';
                                    if (isDiscussed) updateMeetingNotes(email.id, n.replace('[DISCUSSED] ', ''));
                                    else updateMeetingNotes(email.id, '[DISCUSSED] ' + n);
                                  }}
                                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs transition-colors ${
                                    isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
                                  }`}
                                  title={isDiscussed ? 'Mark undiscussed' : 'Mark discussed'}
                                >
                                  {isDiscussed && '✓'}
                                </button>
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <Badge config={priorityConfig[email.priority] || priorityConfig.fyi} />
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
                                    onClick={() => toggleMeetingFlag(email.id, true)}
                                    className="text-slate-300 hover:text-red-400 text-lg leading-none flex-shrink-0"
                                    title="Remove from agenda"
                                  >✕</button>
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
                                                    if (note.type !== t) updateAgendaNote(email.id, note.id, { type: t, assignee: t === 'action' ? (note.assignee || 'emily') : null });
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
                                                    onClick={() => updateAgendaNote(email.id, note.id, { assignee: 'emily' })}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                                      note.assignee === 'emily' ? 'bg-blue-100 text-blue-700' : 'text-slate-300 hover:text-slate-500'
                                                    }`}
                                                  >Emily</button>
                                                  <button
                                                    onClick={() => updateAgendaNote(email.id, note.id, { assignee: 'rbk' })}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                                      note.assignee === 'rbk' ? 'bg-violet-100 text-violet-700' : 'text-slate-300 hover:text-slate-500'
                                                    }`}
                                                  >RBK</button>
                                                </div>
                                              )}
                                              <button
                                                onClick={() => deleteAgendaNote(email.id, note.id)}
                                                className="ml-1 text-slate-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                                              >✕</button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Inline add note input */}
                                <div className="mt-3 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={addingNoteToId === email.id ? newNoteText : ''}
                                    onFocus={() => { setAddingNoteToId(email.id); }}
                                    onChange={(e) => { setAddingNoteToId(email.id); setNewNoteText(e.target.value); }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && newNoteText.trim()) addAgendaNote(email.id);
                                      if (e.key === 'Escape') { setAddingNoteToId(null); setNewNoteText(''); }
                                    }}
                                    placeholder="Add a note..."
                                    className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                  />
                                  <button
                                    onClick={() => { if (newNoteText.trim()) addAgendaNote(email.id); }}
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
                                    {isCurrent ? '▶ Current' : 'Set as Current'}
                                  </button>
                                  <button
                                    onClick={() => setPopupEmailId(email.id)}
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
          )}

          {/* Tasks View */}
          {activeNav === 'tasks' && (
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
                        <div key={task.emailId || task.noteId || idx} className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-start gap-3 transition-all ${task.isComplete ? 'opacity-50' : ''}`}>
                          {task.emailId ? (
                            <button
                              onClick={() => toggleTaskComplete(task.emailId!)}
                              className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs mt-0.5 transition-colors ${
                                task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
                              }`}
                            >
                              {task.isComplete && '✓'}
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
                                    onClick={() => setPopupEmailId(task.emailId!)}
                                    className="text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0 transition-colors"
                                  >
                                    View →
                                  </button>
                                </>
                              ) : (
                                <p className="text-xs text-amber-500">From agenda notes</p>
                              )}
                            </div>
                          </div>
                        </div>
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
                        <div key={task.emailId || task.noteId || idx} className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex items-start gap-3 transition-all ${task.isComplete ? 'opacity-50' : ''}`}>
                          {task.emailId ? (
                            <button
                              onClick={() => toggleTaskComplete(task.emailId!)}
                              className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs mt-0.5 transition-colors ${
                                task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
                              }`}
                            >
                              {task.isComplete && '✓'}
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
                                    onClick={() => setPopupEmailId(task.emailId!)}
                                    className="text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0 transition-colors"
                                  >
                                    View →
                                  </button>
                                </>
                              ) : (
                                <p className="text-xs text-amber-500">From agenda notes</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Emily's Queue View */}
          {activeNav === 'emily' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  Emily's Queue
                  <span className="ml-2 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-sm font-medium">
                    {emilyQueue.length}
                  </span>
                </h3>
                {emilyQueue.length > 0 && (
                  <button
                    onClick={() => markSectionDone(emilyQueue.map(e => e.id))}
                    disabled={bulkUpdating}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    ✓ Mark All Done
                  </button>
                )}
              </div>

              {emilyQueue.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
                  <p className="text-slate-400">No emails in Emily's queue</p>
                  <p className="text-sm text-slate-400 mt-1">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Needs Revision Section */}
                  {needsRevisionEmails.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                        Needs Revision ({needsRevisionEmails.length})
                      </h4>
                      <div className="space-y-3">
                        {needsRevisionEmails.map((email) => (
                          <div key={email.id} className="bg-white border border-amber-200 border-l-4 border-l-amber-500 rounded-xl p-4 shadow-sm">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="font-medium text-slate-900">{email.subject}</p>
                                <p className="text-sm text-slate-500">{email.from_name || email.from_email}</p>
                              </div>
                              <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded text-xs font-medium">
                                Needs Revision
                              </span>
                            </div>
                            {email.revision_comment && (
                              <div className="bg-slate-50 rounded-lg p-3 mt-2 border border-slate-100">
                                <p className="text-xs font-medium text-amber-700 mb-1">Comment from RBK:</p>
                                <p className="text-sm text-slate-700">{email.revision_comment}</p>
                              </div>
                            )}
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                              >
                                Edit Draft
                              </button>
                              <button
                                onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium"
                              >
                                View Email
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Regular Emily Queue */}
                  {emilyQueue.filter(e => e.draft_status !== 'needs_revision').length > 0 && (
                    <div>
                      {needsRevisionEmails.length > 0 && (
                        <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">
                          Other Emails
                        </h4>
                      )}
                      <div className="space-y-4">
                        {emilyQueue.filter(e => e.draft_status !== 'needs_revision').map((email) => (
                          <EmailCard key={email.id} email={email} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Draft Editor Modal - Global */}
      {editingDraftId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingDraftId(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Draft Response</h3>
              <button onClick={() => setEditingDraftId(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === editingDraftId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="font-medium text-slate-900">{email.subject}</p>
                    <p className="text-sm text-slate-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Draft Response</label>
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                      placeholder="Type your response here..."
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setEditingDraftId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, false);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, true);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      Mark Ready for Review
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Request Revision Modal */}
      {revisionEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRevisionEmailId(null)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Request Revision
            </h3>
            {(() => {
              const email = emails.find(e => e.id === revisionEmailId);
              if (!email) return null;
              return (
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                    <p className="text-xs text-slate-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Comment for Emily</label>
                    <textarea
                      value={revisionComment}
                      onChange={(e) => setRevisionComment(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      placeholder="What changes are needed?"
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setRevisionEmailId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => requestRevision(revisionEmailId, revisionComment)}
                      disabled={updating === revisionEmailId}
                      className="bg-amber-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      Send to Emily
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Remind Me Modal */}
      {remindMeEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRemindMeEmailId(null)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Set Reminder
            </h3>
            {(() => {
              const email = emails.find(e => e.id === remindMeEmailId);
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
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="font-medium text-slate-900 text-sm truncate">{email.subject}</p>
                  </div>

                  {/* Quick time options */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Quick Options</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setQuickReminder(1)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        In 1 hour
                      </button>
                      <button
                        onClick={() => setQuickReminder(2)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        In 2 hours
                      </button>
                      <button
                        onClick={() => setReminderForTime(14)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        This afternoon
                      </button>
                      <button
                        onClick={() => setReminderForTime(17)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        End of day
                      </button>
                      <button
                        onClick={() => setReminderForDay(1)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
                      >
                        Tomorrow 9am
                      </button>
                      <button
                        onClick={() => setReminderForDay(7)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
                      >
                        Next week
                      </button>
                    </div>
                  </div>

                  {/* Custom date/time */}
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
                    <button
                      onClick={() => setRemindMeEmailId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setReminder(remindMeEmailId, remindMeDate)}
                      disabled={updating === remindMeEmailId || !remindMeDate}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      Set Reminder
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Create Calendar Event
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Event title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={eventFormData.date}
                  onChange={(e) => setEventFormData({ ...eventFormData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={eventFormData.startTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, startTime: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={eventFormData.endTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={eventFormData.location}
                  onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  rows={3}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowEventModal(false)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createCalendarEvent}
                disabled={!eventFormData.title || creatingEvent}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingEvent ? 'Creating...' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Urgent Actions Popup */}
      {showUrgentPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Urgent ({urgentAlerts.length})
              </h3>
              <button
                onClick={() => setShowUrgentPopup(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3">
              {urgentAlerts.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No urgent items</p>
              ) : (
                urgentAlerts.map((email) => (
                  <div key={email.id} className="bg-white border border-red-200 border-l-4 border-l-red-500 rounded-lg p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{email.subject}</p>
                        <p className="text-sm text-slate-500 mt-1">{email.from_name || email.from_email}</p>
                        <p className="text-sm text-slate-600 mt-2">{email.summary}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          setShowUrgentPopup(false);
                          setActiveNav('inbox');
                          setExpandedEmail(email.id);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        View & Respond
                      </button>
                      <button
                        onClick={() => updateStatus(email.id, 'done')}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        ✓ Done
                      </button>
                      {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                        <a
                          href={getGmailUrl(email.message_id)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium"
                        >
                          View Attachments
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Meeting Agenda Popup */}
      {showAgendaPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Meeting Agenda ({agendaItems.length})
              </h3>
              <button
                onClick={() => setShowAgendaPopup(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
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
                            if (isDiscussed) updateMeetingNotes(email.id, notes.replace('[DISCUSSED] ', ''));
                            else updateMeetingNotes(email.id, '[DISCUSSED] ' + notes);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                            isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-blue-500'
                          }`}
                        >
                          {isDiscussed && '✓'}
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
                                    updateMeetingNotes(email.id, (isDiscussed ? '[DISCUSSED] ' : '') + agendaNoteText);
                                    setEditingAgendaId(null);
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingAgendaId(null)}
                                  className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            email.meeting_notes && (
                              <p className="text-sm text-amber-700 mt-2 bg-amber-100 rounded px-2 py-1">
                                📝 {email.meeting_notes.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '')}
                              </p>
                            )
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 ml-9">
                        <button
                          onClick={() => {
                            setShowAgendaPopup(false);
                            setPopupEmailId(email.id);
                          }}
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
                          onClick={() => toggleMeetingFlag(email.id, true)}
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
      )}

      {/* Important Docs Popup */}
      {showImportantDocsPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Important Docs
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingImportantDocs(!editingImportantDocs)}
                  className="text-slate-400 hover:text-slate-600 text-sm"
                >
                  {editingImportantDocs ? 'Done' : '✏️ Edit'}
                </button>
                <button
                  onClick={() => setShowImportantDocsPopup(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {loadingDocs ? (
                <p className="text-slate-400 text-center py-4">Loading...</p>
              ) : importantDocs.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No documents added yet</p>
              ) : (
                importantDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2">
                    {editingDocId === doc.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingDocTitle}
                          onChange={(e) => setEditingDocTitle(e.target.value)}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => updateImportantDoc(doc.id, editingDocTitle)}
                          className="text-green-500 hover:text-green-700 p-1"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => { setEditingDocId(null); setEditingDocTitle(''); }}
                          className="text-slate-400 hover:text-slate-600 p-1"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-slate-50 hover:bg-slate-100 rounded-lg px-4 py-3 text-slate-700 font-medium transition-colors"
                        >
                          📎 {doc.title}
                        </a>
                        {editingImportantDocs && (
                          <>
                            <button
                              onClick={() => { setEditingDocId(doc.id); setEditingDocTitle(doc.title); }}
                              className="text-slate-400 hover:text-slate-600 p-2"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteImportantDoc(doc.id)}
                              className="text-red-400 hover:text-red-600 p-2"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            {editingImportantDocs && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-sm font-medium text-slate-700 mb-2">Add New Document</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="url"
                    placeholder="URL"
                    value={newDocUrl}
                    onChange={(e) => setNewDocUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (newDocTitle && newDocUrl) {
                        await addImportantDoc(newDocTitle, newDocUrl);
                        setNewDocTitle('');
                        setNewDocUrl('');
                      }
                    }}
                    disabled={!newDocTitle || !newDocUrl}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Add Document
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Popup (for viewing from tasks/agenda) */}
      {popupEmail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPopupEmailId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900 text-base leading-snug truncate">{popupEmail.subject}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{popupEmail.from_name || popupEmail.from_email}</p>
              </div>
              <button onClick={() => setPopupEmailId(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">

              {/* Meta row */}
              <div className="flex items-center gap-3">
                {popupEmail.priority && priorityConfig[popupEmail.priority] && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${priorityConfig[popupEmail.priority].bg} ${priorityConfig[popupEmail.priority].text}`}>
                    {priorityConfig[popupEmail.priority].label}
                  </span>
                )}
                <span className="text-xs text-slate-400">{formatDistanceToNow(parseISO(popupEmail.received_at), { addSuffix: true })}</span>
              </div>

              {/* Summary */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Summary</p>
                <p className="text-sm text-slate-700 leading-relaxed">{popupEmail.summary}</p>
              </div>

              {/* Action needed */}
              {popupEmail.action_needed && popupEmail.action_needed !== 'None' && popupEmail.action_needed !== 'No action needed' && (
                <div className="bg-white border border-slate-100 border-l-4 border-l-orange-400 rounded-xl shadow-md px-4 py-3 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-orange-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Action Needed</p>
                    <p className="text-sm text-slate-700">{popupEmail.action_needed}</p>
                  </div>
                </div>
              )}

              {/* Original email */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Full Email</p>
                <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {(popupEmail.body_text || '').replace(/^>+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim()}
                </div>
              </div>

              {/* Draft reply */}
              <div className="bg-white rounded-xl shadow-md border border-slate-100 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Draft Reply</p>
                  <span className={`text-xs font-medium ${popupEmail.draft_status === 'draft_ready' ? 'text-green-600' : popupEmail.draft_status === 'approved' ? 'text-blue-600' : 'text-slate-400'}`}>
                    {popupEmail.draft_status === 'draft_ready' ? '✓ Ready' : popupEmail.draft_status === 'approved' ? '✓ Approved' : 'Editing'}
                  </span>
                </div>
                <textarea
                  className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white leading-relaxed"
                  rows={6}
                  placeholder="Draft a reply..."
                  value={popupDraftText}
                  onChange={(e) => setPopupDraftText(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveDraft(popupEmail.id, popupDraftText, false)}
                    className="px-4 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={() => saveDraft(popupEmail.id, popupDraftText, true)}
                    className="flex-1 px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
                  >
                    Mark Ready for Review
                  </button>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                onClick={() => { setPopupEmailId(null); setExpandedEmail(popupEmail.id); setActiveNav('inbox'); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Open Full View
              </button>
              {popupEmail.attachments && popupEmail.attachments.length > 0 && getGmailUrl(popupEmail.message_id) && (
                <a href={getGmailUrl(popupEmail.message_id)!} target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  View in Gmail
                </a>
              )}
              <button onClick={() => setPopupEmailId(null)} className="ml-auto text-sm text-slate-400 hover:text-slate-600 transition-colors">
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      {showTaskModal && taskModalEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTaskModal(false)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h3 className="text-lg font-semibold text-slate-900">Add Task</h3>
              <button onClick={() => setShowTaskModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === taskModalEmailId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Related to email:</p>
                    <p className="font-medium text-slate-900 truncate">{email.subject}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Task Description</label>
                    <input
                      type="text"
                      value={taskModalText}
                      onChange={(e) => setTaskModalText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="Enter task description..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && taskModalText.trim()) {
                          saveTaskFromModal();
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Assign to</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setTaskModalAssignee('emily')}
                        className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                          taskModalAssignee === 'emily'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        Emily
                      </button>
                      <button
                        onClick={() => setTaskModalAssignee('rbk')}
                        className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                          taskModalAssignee === 'rbk'
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        RBK
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setShowTaskModal(false)}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveTaskFromModal}
                      disabled={!taskModalText.trim()}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Task
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
