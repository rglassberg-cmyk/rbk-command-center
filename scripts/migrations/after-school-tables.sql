-- After School Programs — cache tables for the Veracross Programs API.
-- Applied to the live SAR Supabase project (ftjppqvxthxcvhokrhfw) on
-- 2026-06-14 via the Supabase MCP apply_migration. Kept here as the
-- source-of-truth DDL.
--
-- Both tables are server-only caches: every read/write goes through
-- supabaseAdmin (service role, which bypasses RLS). RLS is enabled with
-- NO client policy so the anon/authenticated client can never read them
-- directly — matching the "service-role only" posture used elsewhere.

-- ---------------------------------------------------------------------------
-- Table 1: after_school_classes_cache
-- One row per Veracross programs class per school year.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS after_school_classes_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  veracross_class_id integer NOT NULL,
  class_id_string text,
  description text NOT NULL,
  course_id integer,
  course_name text,
  course_catalog_title text,
  school_year integer NOT NULL,
  begin_date date,
  end_date date,
  status integer,
  capacity integer,
  program_group text NOT NULL, -- 'tzaharon' | 'after_school' | 'ms_extracurriculars'
  synced_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, veracross_class_id, school_year)
);

CREATE INDEX IF NOT EXISTS idx_after_school_classes_ws_year
  ON after_school_classes_cache (workspace_id, school_year);

ALTER TABLE after_school_classes_cache ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Table 2: after_school_enrollments_cache
-- One row per Veracross programs enrollment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS after_school_enrollments_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  enrollment_id integer NOT NULL,
  veracross_class_id integer NOT NULL,
  class_description text,
  person_id integer NOT NULL,
  grade_level_id integer,
  currently_enrolled boolean DEFAULT true,
  date_withdrawn date,
  late_date_enrolled date,
  school_year integer NOT NULL,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, enrollment_id)
);

CREATE INDEX IF NOT EXISTS idx_after_school_enroll_ws_year
  ON after_school_enrollments_cache (workspace_id, school_year);

CREATE INDEX IF NOT EXISTS idx_after_school_enroll_class
  ON after_school_enrollments_cache (workspace_id, veracross_class_id);

ALTER TABLE after_school_enrollments_cache ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Module enablement + per-user grants (run as part of this migration).
-- After School is a real workspace module so the sidebar/route gating
-- (getEffectiveModules) behaves: owners/assistants see it, viewers need
-- an explicit grant, ungranted viewers are hidden.
-- ---------------------------------------------------------------------------
UPDATE workspaces
  SET modules = modules || '{"after_school": true}'::jsonb
  WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- Debra May (viewer) — merge the grant into her existing allowed_modules.
-- Becca is an owner with allowed_modules = NULL (sees everything); she is
-- intentionally NOT given an allowed_modules object (that would restrict
-- her). Enabling the workspace module above is sufficient for her.
UPDATE workspace_members
  SET allowed_modules = allowed_modules || '{"after_school": true}'::jsonb
  WHERE email = 'debra@saracademy.org'
    AND workspace_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    AND allowed_modules IS NOT NULL;
