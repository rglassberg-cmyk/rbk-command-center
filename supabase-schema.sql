-- RBK Command Center Database Schema
-- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create emails table
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('rbk_action', 'eg_action', 'invitation', 'meeting_invite', 'important_no_action', 'review', 'fyi')),
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_needed TEXT,
  draft_reply TEXT,
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('rbk', 'emily')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'archived')),
  labels TEXT[] DEFAULT '{}',
  attachments JSONB,
  is_starred BOOLEAN DEFAULT false,
  is_unread BOOLEAN DEFAULT true,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
  assigned_to TEXT NOT NULL CHECK (assigned_to IN ('rbk', 'emily')),
  due_date TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create calendar_events table
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  is_all_day BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'confirmed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_briefing table
CREATE TABLE daily_briefing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date DATE NOT NULL UNIQUE,
  urgent_count INTEGER DEFAULT 0,
  action_items JSONB DEFAULT '[]',
  meetings_today JSONB DEFAULT '[]',
  top_priorities TEXT[] DEFAULT '{}',
  ai_insights TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_priority ON emails(priority);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_assigned_to ON emails(assigned_to);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_is_unread ON emails(is_unread);
CREATE INDEX idx_emails_is_starred ON emails(is_starred);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_email_id ON tasks(email_id);

CREATE INDEX idx_calendar_start_time ON calendar_events(start_time);
CREATE INDEX idx_daily_briefing_date ON daily_briefing(date DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_emails_updated_at
  BEFORE UPDATE ON emails
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_briefing_updated_at
  BEFORE UPDATE ON daily_briefing
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_briefing ENABLE ROW LEVEL SECURITY;

-- Create policies (for now, allow all operations - will refine later with auth)
CREATE POLICY "Allow all operations on emails" ON emails FOR ALL USING (true);
CREATE POLICY "Allow all operations on tasks" ON tasks FOR ALL USING (true);
CREATE POLICY "Allow all operations on calendar_events" ON calendar_events FOR ALL USING (true);
CREATE POLICY "Allow all operations on daily_briefing" ON daily_briefing FOR ALL USING (true);

-- Create a view for today's action items
CREATE VIEW todays_action_items AS
SELECT
  e.id,
  e.subject,
  e.from_name,
  e.from_email,
  e.priority,
  e.summary,
  e.action_needed,
  e.assigned_to,
  e.status,
  e.received_at
FROM emails e
WHERE
  e.status != 'archived'
  AND e.priority IN ('rbk_action', 'eg_action', 'invitation')
  AND e.received_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY
  CASE e.priority
    WHEN 'rbk_action' THEN 1
    WHEN 'invitation' THEN 2
    WHEN 'eg_action' THEN 3
  END,
  e.received_at DESC;

-- Create a function to get email statistics
CREATE OR REPLACE FUNCTION get_email_stats(days_back INTEGER DEFAULT 7)
RETURNS TABLE(
  priority TEXT,
  count BIGINT,
  unread_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.priority,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE e.is_unread) as unread_count
  FROM emails e
  WHERE e.received_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY e.priority
  ORDER BY
    CASE e.priority
      WHEN 'rbk_action' THEN 1
      WHEN 'eg_action' THEN 2
      WHEN 'invitation' THEN 3
      WHEN 'meeting_invite' THEN 4
      WHEN 'important_no_action' THEN 5
      WHEN 'review' THEN 6
      WHEN 'fyi' THEN 7
    END;
END;
$$ LANGUAGE plpgsql;

-- Insert a sample daily briefing for testing
INSERT INTO daily_briefing (date, urgent_count, top_priorities, ai_insights)
VALUES (
  CURRENT_DATE,
  0,
  ARRAY['System setup complete', 'Ready for first email'],
  'Welcome to RBK Command Center! The system is ready to receive emails from your Apps Script.'
);
