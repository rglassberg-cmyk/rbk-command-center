-- workspace_settings — generic per-workspace feature-flag / settings store.
-- Unlike workspace_integrations (credentials, service-role only) this is a
-- plain key/value (jsonb value) table for workspace-level UI/feature flags
-- that server routes read + owner-only admin routes toggle.
--
-- First consumer: 'enrollment_projection_enabled' — gates the Admissions →
-- Enrollment Projection tab's 27-28 re-enrollment pipeline view. After
-- Veracross rolled the school year over, students show in their NEXT-year
-- grade, but nobody has registered for 27-28 yet, so the projection view is
-- locked (value false) until Emily/Becca manually unlock it in Jan 2027 via
-- the owner-only PATCH /api/admissions/current-enrollment route — no code
-- deploy required. "Current Enrollment" (26-27 headcount) is always available.
--
-- RLS is enabled with NO client policies; only the service-role admin client
-- (supabaseAdmin) reads/writes it, same pattern as workspace_integrations.
-- The reader route treats a missing table/row as false (feature stays locked),
-- so the app is safe even before this migration runs.

CREATE TABLE IF NOT EXISTS workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE(workspace_id, key)
);

CREATE INDEX IF NOT EXISTS workspace_settings_workspace_idx
  ON workspace_settings(workspace_id);

ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;

-- Seed the SAR workspace row locked (false). ON CONFLICT DO NOTHING so a
-- later re-run never clobbers an unlock Emily/Becca performed in the UI.
INSERT INTO workspace_settings (workspace_id, key, value)
VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'enrollment_projection_enabled', 'false')
ON CONFLICT (workspace_id, key) DO NOTHING;
