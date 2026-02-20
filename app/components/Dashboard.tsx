'use client';

import { useState, useEffect } from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useSession, signOut } from 'next-auth/react';
import { useRealtimeEmails } from '../hooks/useRealtimeEmails';

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

// Subtle, professional badge colors
const priorityConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  rbk_action: { bg: 'bg-red-50 border border-red-200', text: 'text-red-700', label: 'Action Required', icon: '🔴' },
  eg_action: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'Emily', icon: '🔵' },
  invitation: { bg: 'bg-purple-50 border border-purple-200', text: 'text-purple-700', label: 'Invitation', icon: '🟣' },
  meeting_invite: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Meeting', icon: '🟢' },
  important_no_action: { bg: 'bg-orange-50 border border-orange-200', text: 'text-orange-700', label: 'Important', icon: '🟠' },
  review: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'Review', icon: '🟡' },
  fyi: { bg: 'bg-gray-50 border border-gray-200', text: 'text-gray-600', label: 'FYI', icon: '⚫' },
};

// Status badges with emojis
const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  pending: { bg: 'bg-orange-50 border border-orange-200', text: 'text-orange-700', label: 'Pending', icon: '⏰' },
  in_progress: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'In Progress', icon: '🔄' },
  done: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Done', icon: '✅' },
  archived: { bg: 'bg-gray-50 border border-gray-200', text: 'text-gray-500', label: 'Archived', icon: '📦' },
};

// Action status - simplified per redesign
const actionStatusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  send: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Send', icon: '✉️' },
  sent: { bg: 'bg-emerald-50 border border-emerald-200', text: 'text-emerald-700', label: 'Sent', icon: '✅' },
  remind_me: { bg: 'bg-violet-50 border border-violet-200', text: 'text-violet-700', label: 'Remind Me', icon: '⏰' },
  draft_ready: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'Review Draft', icon: '📝' },
  urgent: { bg: 'bg-red-500 border border-red-600', text: 'text-white', label: 'URGENT', icon: '🚨' },
};

// Draft status
const draftStatusConfig: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Not Started' },
  editing: { bg: 'bg-amber-50', text: 'text-amber-700', label: '✏️ Editing' },
  draft_ready: { bg: 'bg-green-50', text: 'text-green-700', label: '📝 Review Draft' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', label: '👍 Approved' },
  needs_revision: { bg: 'bg-orange-50', text: 'text-orange-700', label: '🔄 Needs Revision' },
};

export default function Dashboard({ emails: initialEmails, calendarEvents }: Props) {
  const { data: session } = useSession();
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

  const fetchCalendarForDate = async (date: Date) => {
    setLoadingSchedule(true);
    try {
      // Use local date string to avoid timezone issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const res = await fetch(`/api/calendar/today?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setScheduleEvents(data.events || []);
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
  const popupEmail = popupEmailId ? emails.find(e => e.id === popupEmailId) : null;

  // Task creation modal (standalone modal for adding tasks from emails)
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
  const tasks = emails
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
      return { emailId: e.id, subject: e.subject, task: taskText, assignee: isEmily ? 'emily' : isRbk ? 'rbk' : null, isComplete, isDiscussed };
    })
    .filter(t => t.assignee && t.task);

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

  // Filter calendar events to show only current/upcoming (only for today)
  const now = new Date();
  const upcomingEvents = isToday(selectedDate)
    ? scheduleEvents.filter(event => {
        // For all-day events, show until end of day
        if (event.isAllDay) {
          const eventDate = new Date(event.endTime);
          return eventDate >= now;
        }
        // For timed events, hide if already ended
        const endTime = new Date(event.endTime);
        return endTime > now;
      })
    : scheduleEvents; // Show all events for other days

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

  // Badge Component
  const Badge = ({ config }: { config: { bg: string; text: string; label: string; icon: string } }) => (
    <span className={`${config.bg} ${config.text} px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1`}>
      {config.icon} {config.label}
    </span>
  );

  // Email Card Component
  const EmailCard = ({ email }: { email: Email }) => {
    const priority = priorityConfig[email.priority] || priorityConfig.fyi;
    const status = statusConfig[email.status] || statusConfig.pending;
    const isExpanded = expandedEmail === email.id;

    return (
      <div
        className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-150 ${isExpanded ? 'ring-2 ring-sky-500' : ''} ${email.status === 'done' ? 'opacity-60' : ''}`}
      >
        <div
          onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
          className="p-4 cursor-pointer"
        >
          {/* Header Row */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge config={priority} />
            <Badge config={status} />
            {email.action_status && actionStatusConfig[email.action_status] && (
              <Badge config={actionStatusConfig[email.action_status]} />
            )}
            {email.flagged_for_meeting && (
              <span className="text-amber-500">⭐</span>
            )}
            {email.is_unread && (
              <span className="w-2 h-2 bg-sky-500 rounded-full"></span>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
            </span>
          </div>

          {/* Subject */}
          <h3 className={`font-semibold text-gray-900 ${email.status === 'done' ? 'line-through text-gray-400' : ''}`}>
            {email.subject}
          </h3>

          {/* From */}
          <p className="text-sm text-gray-500 mt-1">
            {email.from_name || email.from_email}
          </p>

          {/* Preview */}
          {!isExpanded && (
            <p className="text-sm text-gray-400 mt-2 line-clamp-2">
              {email.summary}
            </p>
          )}
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            {/* Summary */}
            <p className="text-gray-600">{email.summary}</p>

            {/* Action Needed */}
            {email.action_needed && email.action_needed !== 'No action needed' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800">⚠️ Action Needed</p>
                <p className="text-sm text-amber-700 mt-1">{email.action_needed}</p>
              </div>
            )}

            {/* Primary Actions Row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Main action buttons */}
              <button
                onClick={() => updateStatus(email.id, 'done')}
                disabled={updating === email.id || email.status === 'done'}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                  email.status === 'done'
                    ? 'bg-green-100 text-green-700 cursor-default'
                    : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
                } ${updating === email.id ? 'opacity-50' : ''}`}
              >
                {email.status === 'done' ? '✓ Done' : '✓ Mark Done'}
              </button>

              <button
                onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')}
                disabled={updating === email.id}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                  email.action_status === 'urgent'
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700'
                } ${updating === email.id ? 'opacity-50' : ''}`}
              >
                🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}
              </button>

              <button
                onClick={() => {
                  setRemindMeEmailId(email.id);
                  // Default to tomorrow
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  setRemindMeDate(tomorrow.toISOString().split('T')[0]);
                }}
                disabled={updating === email.id}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                  email.action_status === 'remind_me'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-violet-100 hover:text-violet-700'
                } ${updating === email.id ? 'opacity-50' : ''}`}
              >
                ⏰ Remind Me
              </button>

              {/* More actions */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)}
                  disabled={updating === email.id}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    email.flagged_for_meeting
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-amber-100 hover:text-amber-700'
                  }`}
                  title="Add to meeting agenda"
                >
                  {email.flagged_for_meeting ? '⭐' : '☆'}
                </button>
                <button
                  onClick={() => createEventFromEmail(email)}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all bg-gray-100 text-gray-600 hover:bg-sky-100 hover:text-sky-700"
                  title="Add to calendar"
                >
                  📅
                </button>
                <button
                  onClick={() => openTaskModal(email)}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-700"
                  title="Add as task"
                >
                  ✓
                </button>
              </div>
            </div>

            {/* Draft Section - Always show */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">📝 Draft Reply</span>
                {email.draft_status && draftStatusConfig[email.draft_status] && (
                  <span className={`${draftStatusConfig[email.draft_status].bg} ${draftStatusConfig[email.draft_status].text} px-2 py-0.5 rounded text-xs`}>
                    {draftStatusConfig[email.draft_status].label}
                  </span>
                )}
              </div>

              {editingDraftId === email.id ? (
                <div>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className="w-full h-32 p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none text-sm"
                    placeholder="Write your reply here..."
                  />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => saveDraft(email.id, draftText)} className="px-3 py-1.5 bg-gray-600 text-white rounded-lg text-xs font-medium">Save</button>
                    <button onClick={() => saveDraft(email.id, draftText, true)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium">Mark Ready</button>
                    <button onClick={() => setEditingDraftId(null)} className="px-3 py-1.5 text-gray-500 text-xs">Cancel</button>
                  </div>
                </div>
              ) : email.draft_reply && email.draft_reply !== 'No reply needed' ? (
                <div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{(email.edited_draft || email.draft_reply)?.substring(0, 300)}...</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="text-xs text-sky-600 hover:text-sky-800">✏️ Edit</button>
                    <button onClick={() => navigator.clipboard.writeText(email.edited_draft || email.draft_reply || '')} className="text-xs text-sky-600 hover:text-sky-800">📋 Copy</button>
                    {email.draft_status === 'draft_ready' && <button onClick={() => approveDraft(email.id)} className="text-xs text-green-600 hover:text-green-800">👍 Approve</button>}
                    {email.draft_status === 'approved' && (
                      <button
                        onClick={() => sendEmail(email.id)}
                        disabled={sendingEmail === email.id}
                        className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                      >
                        {sendingEmail === email.id ? '📤 Sending...' : '📤 Send Email'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-400 italic mb-2">
                    {email.draft_reply === 'No reply needed' ? 'AI suggests no reply needed' : 'No draft yet'}
                  </p>
                  <button
                    onClick={() => { setEditingDraftId(email.id); setDraftText(''); }}
                    className="px-3 py-1.5 bg-sky-500 text-white rounded-lg text-xs font-medium hover:bg-sky-600"
                  >
                    + Add Draft Reply
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Summary Card Component
  const SummaryCard = ({ icon, title, count, subtitle, gradient, onClick }: {
    icon: string; title: string; count?: number; subtitle: string; gradient: string; onClick?: () => void;
  }) => (
    <div
      className={`${gradient} rounded-xl p-5 text-white shadow-xl border-t border-white/20 ${onClick ? 'cursor-pointer hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200' : ''}`}
      style={{ boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.2)' }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-lg font-semibold">{title}</p>
          {count !== undefined && <p className="text-3xl font-bold mt-1">{count}</p>}
          <p className="text-sm opacity-90 mt-1">{subtitle}</p>
        </div>
        <span className="text-3xl opacity-80">{icon}</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold">RBK Command Center</h1>
          <p className="text-xs text-gray-400 mt-1">{format(new Date(), 'EEEE, MMM d')}</p>
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
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeNav === item.id
                  ? 'bg-sky-500 text-white'
                  : 'text-white hover:bg-gray-800'
              }`}
            >
              {item.icon}
              {item.label}
              {item.id === 'inbox' && emails.filter(e => e.is_unread).length > 0 && (
                <span className="ml-auto bg-sky-400 text-white text-xs px-2 py-0.5 rounded-full">
                  {emails.filter(e => e.is_unread).length}
                </span>
              )}
              {item.id === 'emily' && emilyQueue.length > 0 && (
                <span className="ml-auto bg-blue-400 text-white text-xs px-2 py-0.5 rounded-full">
                  {emilyQueue.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* User */}
        {session?.user && (
          <div className="p-4 border-t border-gray-800">
            <div className="flex items-center gap-3">
              {session.user.image && (
                <img src={session.user.image} alt="" className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{session.user.name}</p>
                <button onClick={() => signOut()} className="text-xs text-gray-400 hover:text-white">Sign out</button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <header className="bg-gradient-to-r from-sky-500 to-sky-600 text-white px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Welcome back, {session?.user?.name?.split(' ')[0] || 'RBK'}</h2>
              <p className="text-sky-100 mt-1">Here's what needs your attention today</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Meeting Countdown Alert */}
              {upcomingMeeting && (
                <div className="bg-amber-500 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 animate-pulse">
                  <span>📅</span>
                  <span className="font-bold truncate max-w-[200px]">{upcomingMeeting.title}</span>
                  <span className="whitespace-nowrap">in {upcomingMeeting.minutesUntil} min{upcomingMeeting.minutesUntil !== 1 ? 's' : ''}</span>
                  {upcomingMeeting.meetingLink && (
                    <a
                      href={upcomingMeeting.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white text-amber-600 px-3 py-1 rounded font-bold hover:bg-amber-100 transition-colors ml-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Join
                    </a>
                  )}
                </div>
              )}
              {isConnected && (
                <span className="flex items-center gap-1 text-sm text-sky-100">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
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
                  className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg text-sm font-medium transition-all animate-pulse flex items-center gap-2"
                >
                  🚨 {urgentAlerts.length} Urgent
                </button>
              )}
              <button
                onClick={refreshEmails}
                className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              >
                🔄 Refresh
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
                  gradient={urgentAlerts.length > 0 ? "bg-gradient-to-b from-red-400 via-red-500 to-red-700" : "bg-gradient-to-b from-gray-400 via-gray-500 to-gray-600"}
                  onClick={urgentAlerts.length > 0 ? () => setShowUrgentPopup(true) : undefined}
                />
                {/* Quick Links Card */}
                <div
                  className="bg-gradient-to-b from-sky-400 via-sky-500 to-sky-700 rounded-xl p-5 text-white shadow-xl border-t border-white/20"
                  style={{ boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.2)' }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-lg font-semibold">Quick Links</p>
                    <span className="text-2xl opacity-80">📁</span>
                  </div>
                  <div className="space-y-2">
                    <a
                      href="https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white/20 hover:bg-white/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    >
                      📂 Today's Folder
                    </a>
                    <a
                      href="https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white/20 hover:bg-white/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    >
                      📄 Daily Announcements
                    </a>
                    <a
                      href="https://drive.google.com/drive/folders/1-HDl_sA_9jDZPTEOGPJ7R57O5iU62AwE"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white/20 hover:bg-white/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
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
                  gradient="bg-gradient-to-b from-indigo-400 via-indigo-500 to-indigo-700"
                  onClick={() => setShowImportantDocsPopup(true)}
                />
                <SummaryCard
                  icon="⭐"
                  title="Meeting Agenda"
                  count={agendaItems.length}
                  subtitle="click to view"
                  gradient="bg-gradient-to-b from-amber-400 via-amber-500 to-amber-700"
                  onClick={() => setShowAgendaPopup(true)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Today's Schedule */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigateDate('prev')}
                        className="text-gray-400 hover:text-gray-600 p-1"
                      >
                        ◀
                      </button>
                      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <span className="text-sky-500">📅</span>
                        {isToday(selectedDate) ? "Today's Schedule" : format(selectedDate, 'EEE, MMM d')}
                      </h3>
                      <button
                        onClick={() => navigateDate('next')}
                        className="text-gray-400 hover:text-gray-600 p-1"
                      >
                        ▶
                      </button>
                      {!isToday(selectedDate) && (
                        <button
                          onClick={() => { setSelectedDate(new Date()); setScheduleEvents(calendarEvents); }}
                          className="text-xs text-sky-500 hover:text-sky-700 ml-2"
                        >
                          Back to Today
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowEventModal(true)}
                      className="bg-sky-500 hover:bg-sky-600 text-white w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-colors"
                      title="Add event"
                    >
                      +
                    </button>
                  </div>
                  {loadingSchedule ? (
                    <p className="text-gray-400 text-sm">Loading...</p>
                  ) : scheduleEvents.length === 0 ? (
                    <p className="text-gray-400 text-sm">No events {isToday(selectedDate) ? 'today' : 'on this day'}</p>
                  ) : upcomingEvents.length === 0 && isToday(selectedDate) ? (
                    <p className="text-gray-400 text-sm">No more events today</p>
                  ) : upcomingEvents.length === 0 ? (
                    <p className="text-gray-400 text-sm">No events on this day</p>
                  ) : (
                    <div className="space-y-1">
                      {upcomingEvents.map((event) => (
                        <div key={event.id} className="flex items-center gap-2 p-2 bg-sky-50 rounded-lg hover:bg-sky-100 transition-colors">
                          <span className="bg-sky-500 text-white text-xs font-medium px-2 py-0.5 rounded min-w-[60px] text-center">
                            {formatTime(event.startTime, event.isAllDay)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 text-sm truncate">{event.title}</p>
                            {event.location && <p className="text-xs text-gray-500 truncate">📍 {event.location}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            {event.meetingLink && (
                              <a
                                href={event.meetingLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-sky-500 hover:bg-sky-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                              >
                                Join
                              </a>
                            )}
                            {event.calendarLink && (
                              <a
                                href={event.calendarLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-600 hover:text-sky-800 text-xs"
                                title="View in Google Calendar"
                              >
                                ↗
                              </a>
                            )}
                            <button
                              onClick={() => deleteCalendarEvent(event.id)}
                              className="text-gray-400 hover:text-red-500 text-xs"
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
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <span className="text-indigo-500">✅</span> To-Do Today
                    </h3>
                    <button
                      onClick={() => setHideCompletedTasks(!hideCompletedTasks)}
                      className={`text-xs px-2 py-1 rounded transition-all ${hideCompletedTasks ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {hideCompletedTasks ? 'Show Completed' : 'Hide Completed'}
                    </button>
                  </div>

                  {/* Urgent Items - Always at Top */}
                  {urgentAlerts.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">🚨 Urgent</p>
                      <div className="space-y-2">
                        {urgentAlerts.map((email) => (
                          <div
                            key={email.id}
                            className="bg-red-50 border border-red-200 rounded-lg p-3 cursor-pointer hover:bg-red-100 transition-colors"
                            onClick={() => setPopupEmailId(email.id)}
                          >
                            <p className="text-sm font-medium text-red-900">{email.subject}</p>
                            <p className="text-xs text-red-600">{email.from_name || email.from_email}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Review Drafts Sub-section */}
                  {draftsReady.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">📝 Review Drafts ({draftsReady.length})</p>
                      <div className="space-y-2">
                        {draftsReady.slice(0, 3).map((email) => (
                          <div key={email.id} className="bg-green-50 border border-green-200 rounded-lg p-3">
                            <p className="text-sm font-medium text-gray-900 truncate">{email.subject}</p>
                            <p className="text-xs text-gray-500 mb-2">To: {email.from_email}</p>
                            <p className="text-xs text-gray-600 line-clamp-2 mb-2">{(email.edited_draft || email.draft_reply || '').substring(0, 100)}...</p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-medium"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => approveDraft(email.id)}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium"
                              >
                                👍 Approve
                              </button>
                              <button
                                onClick={() => setRevisionEmailId(email.id)}
                                className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded text-xs font-medium"
                              >
                                🔄 Request Revision
                              </button>
                            </div>
                          </div>
                        ))}
                        {draftsReady.length > 3 && (
                          <button
                            onClick={() => setActiveNav('inbox')}
                            className="text-xs text-green-600 hover:text-green-800"
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
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">📤 Ready to Send ({draftsApproved.length})</p>
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
                            {sendingBatch ? 'Sending...' : '📤 Send All'}
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {draftsApproved.map((email) => (
                          <div key={email.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-sm font-medium text-gray-900 truncate">{email.subject}</p>
                            <p className="text-xs text-gray-500 mb-2">To: {email.from_email}</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => sendEmail(email.id)}
                                disabled={sendingEmail === email.id}
                                className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                              >
                                {sendingEmail === email.id ? 'Sending...' : '📤 Send'}
                              </button>
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-medium"
                              >
                                ✏️ Edit
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
                      <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-2">📋 Tasks</p>
                      <div className="space-y-2">
                        {tasks.filter(t => t.assignee === 'rbk' && (!hideCompletedTasks || !t.isComplete)).map((task, idx) => {
                          const taskEmail = emails.find(e => e.id === task.emailId);
                          const isExpanded = expandedTask === task.emailId;
                          return (
                            <div
                              key={idx}
                              className={`rounded-lg transition-all ${task.isComplete ? 'bg-gray-50' : 'bg-indigo-50'} ${isExpanded ? 'ring-2 ring-indigo-300' : ''}`}
                            >
                              <div
                                className="flex items-start gap-3 p-3 cursor-pointer"
                                onClick={() => setExpandedTask(isExpanded ? null : task.emailId)}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleTaskComplete(task.emailId); }}
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                                    task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-indigo-500'
                                  }`}
                                >
                                  {task.isComplete && '✓'}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.task}</p>
                                  <p className="text-xs text-gray-400 truncate">Re: {task.subject}</p>
                                </div>
                                <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                              </div>
                              {isExpanded && taskEmail && (
                                <div className="px-3 pb-3 pt-0">
                                  <div className="bg-white rounded-lg p-3 border border-indigo-100">
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-xs text-gray-500">From:</span>
                                      <span className="text-xs font-medium text-gray-700">{taskEmail.from_name || taskEmail.from_email}</span>
                                    </div>
                                    <p className="text-sm text-gray-600 mb-3">{taskEmail.summary}</p>
                                    {/* Draft status indicator */}
                                    {taskEmail.draft_reply && taskEmail.draft_reply !== 'No reply needed' && (
                                      <div className="mb-3 p-2 bg-gray-50 rounded border border-gray-200">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-xs font-medium text-gray-600">Draft Reply</span>
                                          {taskEmail.draft_status && draftStatusConfig[taskEmail.draft_status] && (
                                            <span className={`${draftStatusConfig[taskEmail.draft_status].bg} ${draftStatusConfig[taskEmail.draft_status].text} px-2 py-0.5 rounded text-xs`}>
                                              {draftStatusConfig[taskEmail.draft_status].label}
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-gray-500 line-clamp-2">{(taskEmail.edited_draft || taskEmail.draft_reply).substring(0, 100)}...</p>
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setPopupEmailId(taskEmail.id); }}
                                        className="bg-indigo-500 hover:bg-indigo-600 active:scale-95 text-white px-3 py-1 rounded text-xs font-medium transition-transform"
                                      >
                                        View Email
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setEditingDraftId(taskEmail.id); setDraftText(taskEmail.edited_draft || taskEmail.draft_reply || ''); }}
                                        className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white px-3 py-1 rounded text-xs font-medium transition-transform"
                                      >
                                        ✏️ Edit Draft
                                      </button>
                                      {taskEmail.draft_status === 'approved' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); sendEmail(taskEmail.id); }}
                                          disabled={sendingEmail === taskEmail.id}
                                          className="bg-green-500 hover:bg-green-600 active:scale-95 text-white px-3 py-1 rounded text-xs font-medium transition-transform disabled:opacity-50"
                                        >
                                          {sendingEmail === taskEmail.id ? 'Sending...' : '📤 Send'}
                                        </button>
                                      )}
                                      {taskEmail.draft_status === 'draft_ready' && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); approveDraft(taskEmail.id); }}
                                          disabled={updating === taskEmail.id}
                                          className="bg-blue-500 hover:bg-blue-600 active:scale-95 text-white px-3 py-1 rounded text-xs font-medium transition-transform disabled:opacity-50"
                                        >
                                          👍 Approve
                                        </button>
                                      )}
                                      {taskEmail.attachments && taskEmail.attachments.length > 0 && getGmailUrl(taskEmail.message_id) && (
                                        <a
                                          href={getGmailUrl(taskEmail.message_id)!}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 px-3 py-1 rounded text-xs font-medium transition-transform"
                                        >
                                          📎 View Attachments
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
                    <p className="text-gray-400 text-sm text-center py-4">All caught up! Nothing to do right now.</p>
                  )}
                </div>
              </div>

              {/* RBK Action Emails */}
              {urgentEmails.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <span className="text-sky-500">📧</span> RBK Action Emails
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
                <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-xl p-4 shadow-lg animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-white">
                      <span className="text-2xl">🚨</span>
                      <div>
                        <p className="font-bold text-lg">URGENT: {urgentAlerts.length} email{urgentAlerts.length > 1 ? 's' : ''} need immediate attention</p>
                        <p className="text-sm opacity-90">{urgentAlerts[0].subject}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setExpandedEmail(urgentAlerts[0].id);
                        updateActionStatus(urgentAlerts[0].id, null);
                      }}
                      className="bg-white text-red-600 px-4 py-2 rounded-lg font-semibold hover:bg-red-50 transition-all"
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
                  className="w-full px-4 py-3 pl-10 bg-white border border-gray-200 rounded-xl shadow-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none"
                />
                <svg className="absolute left-3 top-3.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
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
                  <div className="bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl p-5 shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white">RBK Action Emails</h3>
                      <div className="flex items-center gap-2">
                        {rbkActionEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(rbkActionEmails.map(e => e.id)); }}
                            disabled={bulkUpdating}
                            className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-medium">
                          {rbkActionEmails.length}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {rbkActionEmails.length === 0 ? (
                        <p className="text-white/70 text-sm">No action items</p>
                      ) : (
                        rbkActionEmails.map((email) => (
                          <div
                            key={email.id}
                            onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            className={`bg-white/50 hover:bg-white/60 rounded-lg p-3 cursor-pointer transition-all backdrop-blur-sm shadow-sm ${selectedEmails.has(email.id) ? 'ring-2 ring-white' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(email.id)}
                                onChange={(e) => { e.stopPropagation(); toggleEmailSelection(email.id); }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0 flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-900 font-bold text-sm truncate">{email.subject}</p>
                                  <p className="text-gray-700 font-semibold text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                    📎 {email.attachments.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            {expandedEmail === email.id && (
                              <div className="mt-3 pt-3 border-t border-white/40">
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
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">
                                            {att.name} ({formatFileSize(att.size)})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto">
                                  <p className="text-gray-800 text-sm whitespace-pre-wrap">
                                    {email.body_text || email.summary}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateStatus(email.id, 'done'); }}
                                    className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ✓ Done
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent'); }}
                                    className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${
                                      email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'
                                    }`}
                                  >
                                    🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleMeetingFlag(email.id, email.flagged_for_meeting); }}
                                    className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    {email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                    className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ✏️ Edit Draft
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEventModalFromEmail(email); }}
                                    className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    📅 Add to Calendar
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }}
                                    className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ⏰ Remind Me
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Emily Action Emails */}
                  <div className="bg-gradient-to-br from-blue-400 to-sky-500 rounded-xl p-5 shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white">Emily Action Emails</h3>
                      <div className="flex items-center gap-2">
                        {emilyActionEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(emilyActionEmails.map(e => e.id)); }}
                            disabled={bulkUpdating}
                            className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-medium">
                          {emilyActionEmails.length}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {emilyActionEmails.length === 0 ? (
                        <p className="text-white/70 text-sm">No action items</p>
                      ) : (
                        emilyActionEmails.map((email) => (
                          <div
                            key={email.id}
                            onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            className={`bg-white/50 hover:bg-white/60 rounded-lg p-3 cursor-pointer transition-all backdrop-blur-sm shadow-sm ${selectedEmails.has(email.id) ? 'ring-2 ring-white' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(email.id)}
                                onChange={(e) => { e.stopPropagation(); toggleEmailSelection(email.id); }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0 flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-900 font-bold text-sm truncate">{email.subject}</p>
                                  <p className="text-gray-700 font-semibold text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                                    📎 {email.attachments.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            {expandedEmail === email.id && (
                              <div className="mt-3 pt-3 border-t border-white/40">
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
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">
                                            {att.name} ({formatFileSize(att.size)})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="bg-white/80 rounded-lg p-3 max-h-60 overflow-y-auto">
                                  <p className="text-gray-800 text-sm whitespace-pre-wrap">
                                    {email.body_text || email.summary}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateStatus(email.id, 'done'); }}
                                    className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ✓ Done
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent'); }}
                                    className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${
                                      email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'
                                    }`}
                                  >
                                    🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleMeetingFlag(email.id, email.flagged_for_meeting); }}
                                    className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    {email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                    className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ✏️ Edit Draft
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openEventModalFromEmail(email); }}
                                    className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    📅 Add to Calendar
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }}
                                    className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow"
                                  >
                                    ⏰ Remind Me
                                  </button>
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
                      className="flex-1 bg-gradient-to-r from-sky-500 to-blue-500 text-white px-4 py-3 rounded-xl font-semibold hover:from-sky-600 hover:to-blue-600 transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      <span>📝</span> Drafts Ready
                      {draftsReady.length > 0 && (
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{draftsReady.length}</span>
                      )}
                    </button>
                    <button
                      disabled
                      className="flex-1 bg-gray-300 text-gray-500 px-4 py-3 rounded-xl font-semibold cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <span>📌</span> TBD
                    </button>
                  </div>
                </div>

                {/* Right Column - Collapsible Categories */}
                <div className="space-y-4">
                  {/* Important No Action */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, important_no_action: !s.important_no_action }))}
                      className="w-full bg-gradient-to-r from-gray-600 to-gray-700 px-4 py-3 flex items-center justify-between text-white"
                    >
                      <span className="font-semibold">Important No Action</span>
                      <div className="flex items-center gap-2">
                        {importantNoAction.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(importantNoAction.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{importantNoAction.length}</span>
                        <span className={`transition-transform ${expandedSections.important_no_action ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.important_no_action && (
                      <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {importantNoAction.length === 0 ? (
                          <p className="text-gray-400 text-sm">No emails</p>
                        ) : (
                          importantNoAction.map((email) => (
                            <div
                              key={email.id}
                              className={`p-3 bg-gray-50 rounded-lg cursor-pointer transition-all ${expandedEmail === email.id ? 'ring-2 ring-gray-400' : 'hover:bg-gray-100'}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 text-sm">{email.subject}</p>
                                  <p className="text-gray-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-xs">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="bg-white rounded-lg p-3 max-h-48 overflow-y-auto mb-3 border border-gray-100">
                                    <p className="text-gray-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                                      <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="bg-white text-gray-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">📎 View Attachments</a>
                                    )}
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✓ Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'}`}>🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}</button>
                                    <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">{email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}</button>
                                    <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✏️ Edit Draft</button>
                                    <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">⏰ Remind Me</button>
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
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, review: !s.review }))}
                      className="w-full bg-gradient-to-r from-gray-500 to-gray-600 px-4 py-3 flex items-center justify-between text-white"
                    >
                      <span className="font-semibold">Review</span>
                      <div className="flex items-center gap-2">
                        {reviewEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(reviewEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{reviewEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.review ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.review && (
                      <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {reviewEmails.length === 0 ? (
                          <p className="text-gray-400 text-sm">No emails</p>
                        ) : (
                          reviewEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`p-3 bg-gray-50 rounded-lg cursor-pointer transition-all ${expandedEmail === email.id ? 'ring-2 ring-gray-400' : 'hover:bg-gray-100'}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 text-sm">{email.subject}</p>
                                  <p className="text-gray-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-xs">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="bg-white rounded-lg p-3 max-h-48 overflow-y-auto mb-3 border border-gray-100">
                                    <p className="text-gray-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                                      <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="bg-white text-gray-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">📎 View Attachments</a>
                                    )}
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✓ Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'}`}>🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}</button>
                                    <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">{email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}</button>
                                    <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✏️ Edit Draft</button>
                                    <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">⏰ Remind Me</button>
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
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, invitation: !s.invitation }))}
                      className="w-full bg-gradient-to-r from-gray-400 to-gray-500 px-4 py-3 flex items-center justify-between text-white"
                    >
                      <span className="font-semibold">Invitations</span>
                      <div className="flex items-center gap-2">
                        {invitationEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(invitationEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{invitationEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.invitation ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.invitation && (
                      <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {invitationEmails.length === 0 ? (
                          <p className="text-gray-400 text-sm">No emails</p>
                        ) : (
                          invitationEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`p-3 bg-gray-50 rounded-lg cursor-pointer transition-all ${expandedEmail === email.id ? 'ring-2 ring-gray-400' : 'hover:bg-gray-100'}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 text-sm">{email.subject}</p>
                                  <p className="text-gray-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-xs">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="bg-white rounded-lg p-3 max-h-48 overflow-y-auto mb-3 border border-gray-100">
                                    <p className="text-gray-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                                      <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="bg-white text-gray-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">📎 View Attachments</a>
                                    )}
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✓ Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'}`}>🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}</button>
                                    <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">{email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}</button>
                                    <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✏️ Edit Draft</button>
                                    <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">⏰ Remind Me</button>
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
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, fyi: !s.fyi }))}
                      className="w-full bg-gradient-to-r from-gray-300 to-gray-400 px-4 py-3 flex items-center justify-between text-gray-800"
                    >
                      <span className="font-semibold">FYI</span>
                      <div className="flex items-center gap-2">
                        {fyiEmails.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markSectionDone(fyiEmails.map(em => em.id)); }}
                            disabled={bulkUpdating}
                            className="bg-gray-600 hover:bg-gray-700 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            ✓ All Done
                          </button>
                        )}
                        <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{fyiEmails.length}</span>
                        <span className={`transition-transform ${expandedSections.fyi ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {expandedSections.fyi && (
                      <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                        {fyiEmails.length === 0 ? (
                          <p className="text-gray-400 text-sm">No emails</p>
                        ) : (
                          fyiEmails.map((email) => (
                            <div
                              key={email.id}
                              className={`p-3 bg-gray-50 rounded-lg cursor-pointer transition-all ${expandedEmail === email.id ? 'ring-2 ring-gray-300' : 'hover:bg-gray-100'}`}
                              onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 text-sm">{email.subject}</p>
                                  <p className="text-gray-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                </div>
                                {email.attachments && email.attachments.length > 0 && (
                                  <span className="ml-2 bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-xs">📎 {email.attachments.length}</span>
                                )}
                              </div>
                              {expandedEmail === email.id && (
                                <div className="mt-3 pt-3 border-t border-gray-200" onClick={(e) => e.stopPropagation()}>
                                  {email.attachments && email.attachments.length > 0 && (
                                    <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
                                      <p className="text-xs font-semibold text-amber-800 mb-1">📎 Attachments:</p>
                                      <div className="flex flex-wrap gap-1">
                                        {email.attachments.map((att, idx) => (
                                          <span key={idx} className="bg-white text-gray-700 px-2 py-0.5 rounded text-xs border border-amber-200">{att.name} ({formatFileSize(att.size)})</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div className="bg-white rounded-lg p-3 max-h-48 overflow-y-auto mb-3 border border-gray-100">
                                    <p className="text-gray-700 text-sm whitespace-pre-wrap">
                                      {email.body_text || email.summary}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                                      <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="bg-white text-gray-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">📎 View Attachments</a>
                                    )}
                                    <button onClick={() => updateStatus(email.id, 'done')} className="bg-white text-green-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✓ Done</button>
                                    <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow ${email.action_status === 'urgent' ? 'bg-red-500 text-white' : 'bg-white text-red-500'}`}>🚨 {email.action_status === 'urgent' ? 'Urgent' : 'Mark Urgent'}</button>
                                    <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className="bg-white text-amber-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">{email.flagged_for_meeting ? '⭐ On Agenda' : '☆ On Agenda'}</button>
                                    <button onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }} className="bg-white text-blue-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">✏️ Edit Draft</button>
                                    <button onClick={() => { setRemindMeEmailId(email.id); const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); setRemindMeDate(t.toISOString().slice(0, 16)); }} className="bg-white text-violet-600 px-4 py-2 rounded-full text-sm font-medium shadow-sm hover:shadow-md transition-shadow">⏰ Remind Me</button>
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
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-4 flex items-center justify-between">
                      <h3 className="text-xl font-bold text-white">📝 Drafts Ready for Review</h3>
                      <button onClick={() => setShowDraftsPopup(false)} className="text-white/80 hover:text-white text-2xl">&times;</button>
                    </div>
                    <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
                      {draftsReady.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No drafts ready for review</p>
                      ) : (
                        draftsReady.map((email) => (
                          <div key={email.id} className="border border-gray-200 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="font-semibold text-gray-900">{email.subject}</p>
                                <p className="text-sm text-gray-500">To: {email.from_email}</p>
                              </div>
                              <button
                                onClick={() => sendEmail(email.id)}
                                disabled={sendingEmail === email.id}
                                className="bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50"
                              >
                                {sendingEmail === email.id ? 'Sending...' : 'Send'}
                              </button>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 mt-2">
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                {(email.edited_draft || email.draft_reply)?.substring(0, 200)}...
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {draftsApproved.length > 0 && (
                      <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
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
                          className="w-full bg-gradient-to-r from-green-500 to-emerald-500 text-white py-3 rounded-xl font-bold hover:from-green-600 hover:to-emerald-600 disabled:opacity-50"
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
              <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-40">
                <span className="font-medium">{selectedEmails.size} selected</span>
                <button
                  onClick={markSelectedDone}
                  disabled={bulkUpdating}
                  className="bg-green-500 hover:bg-green-600 px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {bulkUpdating ? 'Updating...' : '✓ Mark Done'}
                </button>
                <button
                  onClick={clearSelection}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Clear
                </button>
              </div>
            )}
            </>
          )}

          {/* Agenda View */}
          {activeNav === 'agenda' && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-6">⭐ Meeting Agenda</h3>
              {agendaItems.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                  <p className="text-gray-400">No items on the agenda</p>
                  <p className="text-sm text-gray-400 mt-1">Star emails to add them here</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {agendaItems.map((email) => {
                    const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
                    return (
                      <div key={email.id} className={`bg-white rounded-xl shadow-sm p-4 ${isDiscussed ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => {
                              const notes = email.meeting_notes || '';
                              if (isDiscussed) updateMeetingNotes(email.id, notes.replace('[DISCUSSED] ', ''));
                              else updateMeetingNotes(email.id, '[DISCUSSED] ' + notes);
                            }}
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs ${
                              isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-amber-500'
                            }`}
                          >
                            {isDiscussed && '✓'}
                          </button>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge config={priorityConfig[email.priority] || priorityConfig.fyi} />
                            </div>
                            <p className={`font-medium ${isDiscussed ? 'line-through text-gray-400' : 'text-gray-900'}`}>{email.subject}</p>
                            <p className="text-sm text-gray-500">{email.from_name || email.from_email}</p>

                            {/* Action Item */}
                            <div className="mt-3">
                              {editingNotesId === email.id ? (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={notesText}
                                    onChange={(e) => setNotesText(e.target.value)}
                                    placeholder="Add action item..."
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && notesText.trim()) {
                                        const prefix = isDiscussed ? '[DISCUSSED] ' : '';
                                        updateMeetingNotes(email.id, prefix + `[@${notesAssignee.toUpperCase()}] ` + notesText);
                                        setEditingNotesId(null);
                                      }
                                    }}
                                  />
                                  <div className="flex gap-2">
                                    <button onClick={() => setNotesAssignee('emily')} className={`px-3 py-1 rounded text-xs ${notesAssignee === 'emily' ? 'bg-teal-500 text-white' : 'bg-gray-100'}`}>Emily</button>
                                    <button onClick={() => setNotesAssignee('rbk')} className={`px-3 py-1 rounded text-xs ${notesAssignee === 'rbk' ? 'bg-indigo-500 text-white' : 'bg-gray-100'}`}>RBK</button>
                                    <button onClick={() => setEditingNotesId(null)} className="text-xs text-gray-400">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  {(() => {
                                    const rawNotes = (email.meeting_notes || '').replace('[DISCUSSED] ', '');
                                    const isE = rawNotes.startsWith('[@EMILY] ');
                                    const isR = rawNotes.startsWith('[@RBK] ');
                                    const text = rawNotes.replace('[@EMILY] ', '').replace('[@RBK] ', '').replace('[DONE] ', '');
                                    if (text) return (
                                      <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded text-sm">
                                        {isE && '🔵 Emily: '}{isR && '🟣 RBK: '}{text}
                                      </span>
                                    );
                                    return null;
                                  })()}
                                  <button onClick={() => { setEditingNotesId(email.id); setNotesText(''); }} className="text-sm text-sky-600 hover:text-sky-800">
                                    {email.meeting_notes ? '✏️ Edit' : '➕ Add action'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <button onClick={() => toggleMeetingFlag(email.id, true)} className="text-gray-300 hover:text-red-500">✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tasks View */}
          {activeNav === 'tasks' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* RBK Tasks */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="text-indigo-500">🟣</span> RBK's Tasks
                  <span className="ml-auto text-sm font-normal text-gray-400">
                    {tasks.filter(t => t.assignee === 'rbk' && !t.isComplete).length} pending
                  </span>
                </h3>
                <div className="space-y-2">
                  {tasks.filter(t => t.assignee === 'rbk').map((task, idx) => (
                    <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg ${task.isComplete ? 'bg-gray-50' : 'bg-indigo-50'}`}>
                      <button
                        onClick={() => toggleTaskComplete(task.emailId)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs ${
                          task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-indigo-500'
                        }`}
                      >
                        {task.isComplete && '✓'}
                      </button>
                      <div>
                        <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.task}</p>
                        <p className="text-xs text-gray-400">Re: {task.subject}</p>
                      </div>
                    </div>
                  ))}
                  {tasks.filter(t => t.assignee === 'rbk').length === 0 && (
                    <p className="text-gray-400 text-sm">No tasks assigned</p>
                  )}
                </div>
              </div>

              {/* Emily Tasks */}
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="text-teal-500">🔵</span> Emily's Tasks
                  <span className="ml-auto text-sm font-normal text-gray-400">
                    {tasks.filter(t => t.assignee === 'emily' && !t.isComplete).length} pending
                  </span>
                </h3>
                <div className="space-y-2">
                  {tasks.filter(t => t.assignee === 'emily').map((task, idx) => (
                    <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg ${task.isComplete ? 'bg-gray-50' : 'bg-teal-50'}`}>
                      <button
                        onClick={() => toggleTaskComplete(task.emailId)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs ${
                          task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-teal-500'
                        }`}
                      >
                        {task.isComplete && '✓'}
                      </button>
                      <div>
                        <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.task}</p>
                        <p className="text-xs text-gray-400">Re: {task.subject}</p>
                      </div>
                    </div>
                  ))}
                  {tasks.filter(t => t.assignee === 'emily').length === 0 && (
                    <p className="text-gray-400 text-sm">No tasks assigned</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Emily's Queue View */}
          {activeNav === 'emily' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <span className="text-blue-500">🔵</span> Emily's Queue
                  <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-sm font-medium">
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
                <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                  <p className="text-gray-400">No emails in Emily's queue</p>
                  <p className="text-sm text-gray-400 mt-1">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Needs Revision Section */}
                  {needsRevisionEmails.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-orange-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                        🔄 Needs Revision ({needsRevisionEmails.length})
                      </h4>
                      <div className="space-y-3">
                        {needsRevisionEmails.map((email) => (
                          <div key={email.id} className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="font-medium text-gray-900">{email.subject}</p>
                                <p className="text-sm text-gray-500">{email.from_name || email.from_email}</p>
                              </div>
                              <span className="bg-orange-500 text-white px-2 py-1 rounded text-xs font-medium">
                                Needs Revision
                              </span>
                            </div>
                            {email.revision_comment && (
                              <div className="bg-white rounded-lg p-3 mt-2 border border-orange-200">
                                <p className="text-xs font-medium text-orange-700 mb-1">Comment from RBK:</p>
                                <p className="text-sm text-gray-700">{email.revision_comment}</p>
                              </div>
                            )}
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                              >
                                ✏️ Edit Draft
                              </button>
                              <button
                                onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium"
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
                        <h4 className="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-3">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">✏️ Edit Draft Response</h3>
              <button onClick={() => setEditingDraftId(null)} className="text-white/80 hover:text-white text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === editingDraftId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="font-semibold text-gray-900">{email.subject}</p>
                    <p className="text-sm text-gray-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Draft Response</label>
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none resize-none"
                      placeholder="Type your response here..."
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setEditingDraftId(null)}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, false);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 disabled:opacity-50"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, true);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 disabled:opacity-50"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="text-orange-500">🔄</span> Request Revision
            </h3>
            {(() => {
              const email = emails.find(e => e.id === revisionEmailId);
              if (!email) return null;
              return (
                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="font-medium text-gray-900 text-sm">{email.subject}</p>
                    <p className="text-xs text-gray-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Comment for Emily</label>
                    <textarea
                      value={revisionComment}
                      onChange={(e) => setRevisionComment(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                      placeholder="What changes are needed?"
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setRevisionEmailId(null)}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => requestRevision(revisionEmailId, revisionComment)}
                      disabled={updating === revisionEmailId}
                      className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="text-violet-500">⏰</span> Set Reminder
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
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="font-medium text-gray-900 text-sm truncate">{email.subject}</p>
                  </div>

                  {/* Quick time options */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Quick Options</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setQuickReminder(1)}
                        className="px-3 py-2 bg-violet-50 hover:bg-violet-100 rounded-lg text-sm font-medium text-violet-700 border border-violet-200"
                      >
                        In 1 hour
                      </button>
                      <button
                        onClick={() => setQuickReminder(2)}
                        className="px-3 py-2 bg-violet-50 hover:bg-violet-100 rounded-lg text-sm font-medium text-violet-700 border border-violet-200"
                      >
                        In 2 hours
                      </button>
                      <button
                        onClick={() => setReminderForTime(14)}
                        className="px-3 py-2 bg-violet-50 hover:bg-violet-100 rounded-lg text-sm font-medium text-violet-700 border border-violet-200"
                      >
                        This afternoon
                      </button>
                      <button
                        onClick={() => setReminderForTime(17)}
                        className="px-3 py-2 bg-violet-50 hover:bg-violet-100 rounded-lg text-sm font-medium text-violet-700 border border-violet-200"
                      >
                        End of day
                      </button>
                      <button
                        onClick={() => setReminderForDay(1)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
                      >
                        Tomorrow 9am
                      </button>
                      <button
                        onClick={() => setReminderForDay(7)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700"
                      >
                        Next week
                      </button>
                    </div>
                  </div>

                  {/* Custom date/time */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Or pick a date & time</label>
                    <input
                      type="datetime-local"
                      value={remindMeDate ? remindMeDate.slice(0, 16) : ''}
                      onChange={(e) => setRemindMeDate(new Date(e.target.value).toISOString())}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 outline-none text-sm"
                    />
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      onClick={() => setRemindMeEmailId(null)}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setReminder(remindMeEmailId, remindMeDate)}
                      disabled={updating === remindMeEmailId || !remindMeDate}
                      className="bg-violet-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-violet-600 disabled:opacity-50"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="text-sky-500">📅</span> Create Calendar Event
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                  placeholder="Event title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={eventFormData.date}
                  onChange={(e) => setEventFormData({ ...eventFormData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={eventFormData.startTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, startTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={eventFormData.endTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={eventFormData.location}
                  onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none resize-none"
                  rows={3}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowEventModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createCalendarEvent}
                disabled={!eventFormData.title || creatingEvent}
                className="flex-1 px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span className="text-red-500">🚨</span> Urgent ({urgentAlerts.length})
              </h3>
              <button
                onClick={() => setShowUrgentPopup(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3">
              {urgentAlerts.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No urgent items</p>
              ) : (
                urgentAlerts.map((email) => (
                  <div key={email.id} className="bg-red-50 rounded-lg p-4 border border-red-100">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{email.subject}</p>
                        <p className="text-sm text-gray-500 mt-1">{email.from_name || email.from_email}</p>
                        <p className="text-sm text-gray-600 mt-2">{email.summary}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          setShowUrgentPopup(false);
                          setActiveNav('inbox');
                          setExpandedEmail(email.id);
                        }}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        View & Respond
                      </button>
                      <button
                        onClick={() => updateStatus(email.id, 'done')}
                        className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        ✓ Done
                      </button>
                      {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                        <a
                          href={getGmailUrl(email.message_id)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
                        >
                          📎 View Attachments
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span className="text-amber-500">⭐</span> Meeting Agenda ({agendaItems.length})
              </h3>
              <button
                onClick={() => setShowAgendaPopup(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3">
              {agendaItems.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No items on the agenda. Star emails to add them.</p>
              ) : (
                agendaItems.map((email) => {
                  const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
                  return (
                    <div key={email.id} className={`bg-amber-50 rounded-lg p-4 border border-amber-100 ${isDiscussed ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => {
                            const notes = email.meeting_notes || '';
                            if (isDiscussed) updateMeetingNotes(email.id, notes.replace('[DISCUSSED] ', ''));
                            else updateMeetingNotes(email.id, '[DISCUSSED] ' + notes);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                            isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-amber-400 hover:border-amber-600'
                          }`}
                        >
                          {isDiscussed && '✓'}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium ${isDiscussed ? 'line-through text-gray-400' : 'text-gray-900'}`}>{email.subject}</p>
                          <p className="text-sm text-gray-500 mt-1">{email.from_name || email.from_email}</p>
                          {editingAgendaId === email.id ? (
                            <div className="mt-2">
                              <textarea
                                value={agendaNoteText}
                                onChange={(e) => setAgendaNoteText(e.target.value)}
                                placeholder="Add notes for this agenda item..."
                                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => {
                                    updateMeetingNotes(email.id, (isDiscussed ? '[DISCUSSED] ' : '') + agendaNoteText);
                                    setEditingAgendaId(null);
                                  }}
                                  className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingAgendaId(null)}
                                  className="text-gray-500 hover:text-gray-700 px-2 py-1 text-xs"
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
                          className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-transform"
                        >
                          View Email
                        </button>
                        <button
                          onClick={() => {
                            const currentNote = email.meeting_notes?.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '') || '';
                            setEditingAgendaId(email.id);
                            setAgendaNoteText(currentNote);
                          }}
                          className="bg-amber-100 hover:bg-amber-200 active:scale-95 text-amber-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-transform"
                        >
                          ✏️ Edit Notes
                        </button>
                        <button
                          onClick={() => toggleMeetingFlag(email.id, true)}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"
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
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <span className="text-indigo-500">📄</span> Important Docs
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingImportantDocs(!editingImportantDocs)}
                  className="text-gray-400 hover:text-gray-600 text-sm"
                >
                  {editingImportantDocs ? 'Done' : '✏️ Edit'}
                </button>
                <button
                  onClick={() => setShowImportantDocsPopup(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {loadingDocs ? (
                <p className="text-gray-400 text-center py-4">Loading...</p>
              ) : importantDocs.length === 0 ? (
                <p className="text-gray-400 text-center py-4">No documents added yet</p>
              ) : (
                importantDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2">
                    {editingDocId === doc.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingDocTitle}
                          onChange={(e) => setEditingDocTitle(e.target.value)}
                          className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
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
                          className="text-gray-400 hover:text-gray-600 p-1"
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
                          className="flex-1 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-4 py-3 text-indigo-700 font-medium transition-colors"
                        >
                          📎 {doc.title}
                        </a>
                        {editingImportantDocs && (
                          <>
                            <button
                              onClick={() => { setEditingDocId(doc.id); setEditingDocTitle(doc.title); }}
                              className="text-indigo-400 hover:text-indigo-600 p-2"
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
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-2">Add New Document</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <input
                    type="url"
                    placeholder="URL"
                    value={newDocUrl}
                    onChange={(e) => setNewDocUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
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
                    className="w-full bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPopupEmailId(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-4 flex items-center justify-between">
              <div className="text-white">
                <p className="font-bold text-lg truncate">{popupEmail.subject}</p>
                <p className="text-sm text-sky-100">From: {popupEmail.from_name || popupEmail.from_email}</p>
              </div>
              <button onClick={() => setPopupEmailId(null)} className="text-white/80 hover:text-white text-2xl">&times;</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center gap-2 mb-4">
                {popupEmail.priority && priorityConfig[popupEmail.priority] && (
                  <span className={`${priorityConfig[popupEmail.priority].bg} ${priorityConfig[popupEmail.priority].text} px-2 py-0.5 rounded text-xs font-medium`}>
                    {priorityConfig[popupEmail.priority].icon} {priorityConfig[popupEmail.priority].label}
                  </span>
                )}
                <span className="text-xs text-gray-400">{formatDistanceToNow(parseISO(popupEmail.received_at), { addSuffix: true })}</span>
              </div>

              <div className="bg-sky-50 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">Summary</p>
                <p className="text-gray-600">{popupEmail.summary}</p>
              </div>

              {popupEmail.action_needed && popupEmail.action_needed !== 'None' && (
                <div className="bg-amber-50 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-amber-800 mb-1">Action Needed</p>
                  <p className="text-amber-700">{popupEmail.action_needed}</p>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">Full Email</p>
                <p className="text-gray-600 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">{popupEmail.body_text}</p>
              </div>

              {(popupEmail.draft_reply && popupEmail.draft_reply !== 'No reply needed') && (
                <div className="bg-green-50 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-green-800 mb-1">Draft Reply</p>
                  <p className="text-green-700 text-sm whitespace-pre-wrap">{popupEmail.edited_draft || popupEmail.draft_reply}</p>
                </div>
              )}
            </div>
            <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex gap-3">
              <button
                onClick={() => {
                  setPopupEmailId(null);
                  setExpandedEmail(popupEmail.id);
                  setActiveNav('inbox');
                }}
                className="bg-sky-500 hover:bg-sky-600 active:scale-95 text-white px-4 py-2 rounded-lg text-sm font-medium transition-transform"
              >
                Open Full View
              </button>
              {popupEmail.attachments && popupEmail.attachments.length > 0 && getGmailUrl(popupEmail.message_id) && (
                <a
                  href={getGmailUrl(popupEmail.message_id)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-transform"
                >
                  📎 View Attachments
                </a>
              )}
              <button
                onClick={() => setPopupEmailId(null)}
                className="ml-auto text-gray-500 hover:text-gray-700 px-4 py-2 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      {showTaskModal && taskModalEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTaskModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h3 className="text-lg font-bold text-white">Add Task</h3>
              <button onClick={() => setShowTaskModal(false)} className="text-white/80 hover:text-white text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === taskModalEmailId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">Related to email:</p>
                    <p className="font-medium text-gray-900 truncate">{email.subject}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Task Description</label>
                    <input
                      type="text"
                      value={taskModalText}
                      onChange={(e) => setTaskModalText(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setTaskModalAssignee('emily')}
                        className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                          taskModalAssignee === 'emily'
                            ? 'bg-teal-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Emily
                      </button>
                      <button
                        onClick={() => setTaskModalAssignee('rbk')}
                        className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                          taskModalAssignee === 'rbk'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        RBK
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setShowTaskModal(false)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveTaskFromModal}
                      disabled={!taskModalText.trim()}
                      className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
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
