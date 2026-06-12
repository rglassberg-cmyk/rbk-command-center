-- Phase 6: Row Level Security (RLS)
--
-- CRITICAL: Deploy code changes FIRST, then run this SQL.
-- Enabling RLS before set_current_user_id() exists will lock out anon client queries.
--
-- Run this in Supabase SQL Editor AFTER the code is deployed.

-- 1. Create the RPC function that client-side code calls to set the current user
CREATE OR REPLACE FUNCTION set_current_user_id(user_id text)
RETURNS void
LANGUAGE sql
AS $$
  SELECT set_config('app.current_user_id', user_id, true);
$$;

-- 2. Create the helper function that RLS policies use to resolve workspace_id
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT workspace_id
  FROM workspace_members
  WHERE user_id = current_setting('app.current_user_id', true)
  LIMIT 1;
$$;

-- 3. Enable RLS on all workspace-scoped tables
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE gemara_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE important_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies — one per table
-- Service role (supabaseAdmin) bypasses RLS automatically.
-- Anon client must call set_current_user_id() first so current_workspace_id() resolves.

CREATE POLICY workspace_isolation ON emails
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON agenda_notes
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON agenda_items
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON projects
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON gemara_items
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON important_docs
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON recurring_topics
  USING (workspace_id = current_workspace_id());

CREATE POLICY workspace_isolation ON attendance_cache
  USING (workspace_id = current_workspace_id());

-- workspaces — users can only see their own workspace
CREATE POLICY workspace_isolation ON workspaces
  USING (id = current_workspace_id());

-- workspace_members — users can only see members of their workspace
CREATE POLICY workspace_isolation ON workspace_members
  USING (workspace_id = current_workspace_id());
