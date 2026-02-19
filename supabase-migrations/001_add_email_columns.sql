-- Migration: Add columns for draft editing, meeting flags, and email sending
-- Run this in your Supabase SQL Editor

-- Add draft editing columns
ALTER TABLE emails ADD COLUMN IF NOT EXISTS edited_draft TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS draft_status TEXT DEFAULT 'not_started' CHECK (draft_status IN ('not_started', 'editing', 'draft_ready', 'approved'));
ALTER TABLE emails ADD COLUMN IF NOT EXISTS draft_edited_by TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS draft_edited_at TIMESTAMP WITH TIME ZONE;

-- Add meeting/agenda columns
ALTER TABLE emails ADD COLUMN IF NOT EXISTS flagged_for_meeting BOOLEAN DEFAULT false;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS flagged_by TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS meeting_notes TEXT;

-- Add action status column
ALTER TABLE emails ADD COLUMN IF NOT EXISTS action_status TEXT;

-- Add email sending columns
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_by TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_message_id TEXT;

-- Create index for flagged emails
CREATE INDEX IF NOT EXISTS idx_emails_flagged ON emails(flagged_for_meeting) WHERE flagged_for_meeting = true;

-- Enable Realtime for emails table
-- Note: This may require running via Supabase Dashboard if you don't have superuser access
ALTER PUBLICATION supabase_realtime ADD TABLE emails;
