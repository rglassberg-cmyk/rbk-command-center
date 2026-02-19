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
}

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Email;
  old: { id: string };
};

export function useRealtimeEmails(initialEmails: Email[]) {
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
    // Subscribe to realtime changes on the emails table
    const channel = supabase
      .channel('emails-changes')
      .on<Email>(
        'postgres_changes' as const,
        {
          event: '*',
          schema: 'public',
          table: 'emails',
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
  }, [handleRealtimeEvent]);

  // Manual refresh function
  const refreshEmails = useCallback(async () => {
    const { data, error } = await supabase
      .from('emails')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      setEmails(data as Email[]);
    }
  }, []);

  return {
    emails,
    setEmails,
    isConnected,
    refreshEmails,
  };
}
