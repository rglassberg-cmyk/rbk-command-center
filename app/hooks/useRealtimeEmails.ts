'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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
  tbd_suggestion?: string | null;
  tbd_notes?: string | null;
  thread_id?: string | null;
}

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Email;
  old: { id: string };
};

export function useRealtimeEmails(initialEmails: Email[], workspaceId?: string | null) {
  const [emails, setEmails] = useState<Email[]>(initialEmails);
  const [isConnected, setIsConnected] = useState(false);

  // Handle realtime events
  const handleRealtimeEvent = useCallback((payload: RealtimePayload) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT') {
      setEmails((current) => {
        // Check if email already exists (avoid duplicates)
        if (current.find((e) => e.id === newRecord.id)) {
          return current;
        }
        // Add new email at the beginning (most recent first)
        return [newRecord, ...current];
      });
    } else if (eventType === 'UPDATE') {
      setEmails((current) =>
        current.map((email) =>
          email.id === oldRecord.id ? newRecord : email
        )
      );
    } else if (eventType === 'DELETE') {
      setEmails((current) =>
        current.filter((email) => email.id !== oldRecord.id)
      );
    }
  }, []);

  useEffect(() => {
    // Never subscribe without a workspace_id — prevents cross-workspace data leaks
    if (!workspaceId) {
      setIsConnected(false);
      return;
    }

    // Subscribe to realtime changes on the emails table, filtered by workspace
    const channel = supabase
      .channel(`emails-${workspaceId}`)
      .on<Email>(
        'postgres_changes' as const,
        {
          event: '*',
          schema: 'public',
          table: 'emails',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          handleRealtimeEvent(payload as unknown as RealtimePayload);
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          console.log('Real-time subscription active');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Real-time subscription error');
        }
      });

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleRealtimeEvent, workspaceId]);

  // Manual refresh function — never fetch without workspace_id
  const refreshEmails = useCallback(async () => {
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('received_at', { ascending: false })
      .limit(500);

    if (!error && data) {
      setEmails(data as Email[]);
    }
  }, [workspaceId]);

  return {
    emails,
    setEmails,
    isConnected,
    refreshEmails,
  };
}
