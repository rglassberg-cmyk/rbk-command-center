export interface Attachment {
  name: string;
  type: string;
  size: number;
}

export interface Email {
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

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  meetingLink?: string | null;
  calendarLink?: string | null;
}

export interface EventData {
  summary: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
}

export interface Doc {
  id: string;
  title: string;
  url: string;
  created_at?: string;
}

export type Priority = 'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi';
export type Status = 'pending' | 'in_progress' | 'done' | 'archived';
export type DraftStatus = 'not_started' | 'editing' | 'draft_ready' | 'approved' | 'needs_revision';
export type ActionStatus = 'send' | 'sent' | 'remind_me' | 'draft_ready' | 'urgent';
