'use client';

import { useState, useCallback } from 'react';
import type { Email } from '@/types';

interface UseEmailActionsOptions {
  emails: Email[];
  setEmails: React.Dispatch<React.SetStateAction<Email[]>>;
}

export function useEmailActions({ emails, setEmails }: UseEmailActionsOptions) {
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [sendingBatch, setSendingBatch] = useState(false);
  const [revisionEmailId, setRevisionEmailId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState('');
  const [remindMeEmailId, setRemindMeEmailId] = useState<string | null>(null);
  const [remindMeDate, setRemindMeDate] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const updateStatus = useCallback(async (emailId: string, newStatus: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: newStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: newStatus } : e));
        if (newStatus === 'done') {
          fetch(`/api/emails/${emailId}/archive`, { method: 'POST' })
            .catch(err => console.error('Gmail archive failed:', err));
        }
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const updateActionStatus = useCallback(async (emailId: string, actionStatus: string | null) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, action_status: actionStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, action_status: actionStatus } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const requestRevision = useCallback(async (emailId: string, comment: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          draft_status: 'needs_revision',
          revision_comment: comment,
          priority: 'eg_action',
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e, draft_status: 'needs_revision', priority: 'eg_action',
        } : e));
        setRevisionEmailId(null);
        setRevisionComment('');
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const setReminder = useCallback(async (emailId: string, reminderDate: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          action_status: 'remind_me',
          reminder_date: reminderDate,
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e, action_status: 'remind_me', reminder_date: reminderDate,
        } : e));
        setRemindMeEmailId(null);
        setRemindMeDate('');
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const toggleMeetingFlag = useCallback(async (emailId: string, currentlyFlagged: boolean) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged_for_meeting: !currentlyFlagged }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const updateMeetingNotes = useCallback(async (emailId: string, notes: string) => {
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notes }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
  }, [setEmails]);

  const toggleTaskComplete = useCallback(async (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email?.meeting_notes) return;
    let newNotes = email.meeting_notes;
    if (newNotes.includes('[DONE]')) {
      newNotes = newNotes.replace('[DONE] ', '').replace(' [DONE]', '');
    } else {
      newNotes = newNotes.replace('[@EMILY] ', '[@EMILY] [DONE] ').replace('[@RBK] ', '[@RBK] [DONE] ');
    }
    await updateMeetingNotes(emailId, newNotes);
  }, [emails, updateMeetingNotes]);

  const saveDraft = useCallback(async (emailId: string, draft: string, markReady = false) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_draft: draft, draft_status: markReady ? 'draft_ready' : 'editing' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, ...updated } : e));
        if (markReady) setEditingDraftId(null);
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const approveDraft = useCallback(async (emailId: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_status: 'approved' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  }, [setEmails]);

  const sendEmailAction = useCallback(async (emailId: string) => {
    if (!confirm('Send this email from kraussb@saracademy.org?')) return;
    setSendingEmail(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        alert('Email sent successfully!');
        setEmails(prev => prev.map(e =>
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
  }, [setEmails]);

  const sendBatchEmails = useCallback(async (emailIds: string[]) => {
    if (!confirm(`Send all ${emailIds.length} approved emails?`)) return;
    setSendingBatch(true);
    try {
      const res = await fetch('/api/emails/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds }),
      });
      const result = await res.json();
      if (res.ok) {
        const sentIds = result.results
          .filter((r: { success: boolean }) => r.success)
          .map((r: { id: string }) => r.id);
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
  }, [setEmails]);

  const toggleEmailSelection = useCallback((emailId: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(emailId)) next.delete(emailId);
      else next.add(emailId);
      return next;
    });
  }, []);

  const selectAllInSection = useCallback((emailIds: string[]) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      emailIds.forEach(id => next.add(id));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEmails(new Set());
  }, []);

  const markSelectedDone = useCallback(async () => {
    if (selectedEmails.size === 0) return;
    setBulkUpdating(true);
    try {
      const emailIds = Array.from(selectedEmails);
      await Promise.all(emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      ));
      setEmails(prev => prev.map(e => selectedEmails.has(e.id) ? { ...e, status: 'done' } : e));
      setSelectedEmails(new Set());
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark emails done:', error);
    }
    setBulkUpdating(false);
  }, [selectedEmails, setEmails]);

  const markSectionDone = useCallback(async (emailIds: string[]) => {
    if (emailIds.length === 0) return;
    if (!confirm(`Mark ${emailIds.length} email${emailIds.length > 1 ? 's' : ''} as done?`)) return;
    setBulkUpdating(true);
    try {
      await Promise.all(emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      ));
      setEmails(prev => prev.map(e => emailIds.includes(e.id) ? { ...e, status: 'done' } : e));
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark section done:', error);
    }
    setBulkUpdating(false);
  }, [setEmails]);

  return {
    // Loading states
    sendingEmail,
    updating,
    sendingBatch,
    bulkUpdating,
    // Draft editing
    editingDraftId, setEditingDraftId,
    draftText, setDraftText,
    // Revision modal
    revisionEmailId, setRevisionEmailId,
    revisionComment, setRevisionComment,
    // Remind me modal
    remindMeEmailId, setRemindMeEmailId,
    remindMeDate, setRemindMeDate,
    // Bulk selection
    selectedEmails, toggleEmailSelection, selectAllInSection, clearSelection,
    // Actions
    updateStatus,
    updateActionStatus,
    requestRevision,
    setReminder,
    toggleMeetingFlag,
    updateMeetingNotes,
    toggleTaskComplete,
    saveDraft,
    approveDraft,
    sendEmail: sendEmailAction,
    sendBatchEmails,
    markSelectedDone,
    markSectionDone,
  };
}
