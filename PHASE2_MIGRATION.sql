-- ============================================================
-- Phase 2: Multi-Tenant Foundation — Run in Supabase SQL Editor
-- ============================================================

-- Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_email text NOT NULL,
  gmail_refresh_token text,
  modules jsonb DEFAULT '{"calendar": true, "projects": true, "tasks": true, "agenda": true, "absences": true, "simchas": true, "gemara": true, "faculty_absences": false}'::jsonb,
  module_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create workspace_members table
CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'assistant', 'viewer')),
  display_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

-- Insert RBK's seed workspace
INSERT INTO workspaces (id, name, owner_email, modules, module_config)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'SAR Academy — RBK',
  'kraussb@saracademy.org',
  '{"calendar": true, "projects": true, "tasks": true, "agenda": true, "absences": true, "simchas": true, "gemara": true, "faculty_absences": false}'::jsonb,
  '{"absences": {"provider": "veracross", "school_route": "sar"}, "simchas": {"ical_url": "barbatmitzvah@saracademy.org"}, "gemara": {"card_title": "Gemara"}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Add workspace_id to all existing tables (nullable for now — RLS comes later)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE agenda_notes ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE gemara_items ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE important_docs ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE recurring_topics ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE attendance_cache ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);

-- Backfill all existing rows with RBK's workspace_id
UPDATE emails SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE agenda_notes SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE agenda_items SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE projects SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE gemara_items SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE important_docs SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE recurring_topics SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;
UPDATE attendance_cache SET workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' WHERE workspace_id IS NULL;

-- Insert RBK as owner member (user_id will be updated with real Firebase UID after first sign-in)
INSERT INTO workspace_members (workspace_id, user_id, email, role, display_name)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'PLACEHOLDER_RBK',
  'kraussb@saracademy.org',
  'owner',
  'Rabbi Krauss'
)
ON CONFLICT DO NOTHING;

-- Insert Emily as assistant member
INSERT INTO workspace_members (workspace_id, user_id, email, role, display_name)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'PLACEHOLDER_EMILY',
  'egray@saracademy.org',
  'assistant',
  'Emily Gray'
)
ON CONFLICT DO NOTHING;

-- Insert Becca as assistant member for testing
INSERT INTO workspace_members (workspace_id, user_id, email, role, display_name)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'PLACEHOLDER_BECCA',
  'bglassberg@saracademy.org',
  'assistant',
  'Becca Glassberg'
)
ON CONFLICT DO NOTHING;
