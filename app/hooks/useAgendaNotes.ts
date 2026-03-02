'use client';

import { useState, useEffect, useCallback } from 'react';

export interface AgendaNote {
  id: string;
  email_id: string;
  text: string;
  type: 'note' | 'decision' | 'action';
  assignee: 'rbk' | 'emily' | null;
  created_at: string;
}

export function useAgendaNotes() {
  const [agendaNotes, setAgendaNotes] = useState<Record<string, AgendaNote[]>>({});
  const [actionNotes, setActionNotes] = useState<AgendaNote[]>([]);
  const [addingNoteToId, setAddingNoteToId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');

  const fetchAgendaNotes = useCallback(async (emailId: string) => {
    try {
      const res = await fetch(`/api/agenda-notes?emailId=${emailId}`);
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({ ...prev, [emailId]: data.notes || [] }));
      }
    } catch (e) {
      console.error('Failed to fetch agenda notes:', e);
    }
  }, []);

  const fetchActionNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/agenda-notes?type=action');
      if (res.ok) {
        const data = await res.json();
        setActionNotes(data.notes || []);
      }
    } catch (e) {
      console.error('Failed to fetch action notes:', e);
    }
  }, []);

  // Load action notes on mount
  useEffect(() => {
    fetchActionNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAgendaNote = useCallback(async (emailId: string) => {
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
  }, [newNoteText]);

  const deleteAgendaNote = useCallback(async (emailId: string, noteId: string) => {
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
  }, []);

  const updateAgendaNote = useCallback(async (emailId: string, noteId: string, updates: { type?: string; assignee?: string | null }) => {
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
        fetchActionNotes();
      }
    } catch (e) {
      console.error('Failed to update agenda note:', e);
    }
  }, [fetchActionNotes]);

  const ensureNotesLoaded = useCallback((emailId: string) => {
    if (!agendaNotes[emailId]) {
      agendaNotes[emailId] = []; // prevent duplicate fetches
      fetchAgendaNotes(emailId);
    }
  }, [agendaNotes, fetchAgendaNotes]);

  return {
    agendaNotes,
    actionNotes,
    addingNoteToId, setAddingNoteToId,
    newNoteText, setNewNoteText,
    fetchAgendaNotes,
    fetchActionNotes,
    addAgendaNote,
    deleteAgendaNote,
    updateAgendaNote,
    ensureNotesLoaded,
  };
}
