-- giving_history_cache — full Operating gift history from the nightly
-- Veracross export delivered to gs://rbk-cmd-center-sftp/veracross/giving-history/
-- via SFTP (~185k rows, all years). Server-only (RLS on, no client policy;
-- all access via supabaseAdmin). Applied to the live SAR Supabase project.

CREATE TABLE IF NOT EXISTS giving_history_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  gift_record_id text NOT NULL,
  constituent_id integer NOT NULL,
  constituent_name text,
  amount numeric DEFAULT 0,
  gift_type integer NOT NULL DEFAULT 0,
  gift_type_text text,
  gift_date date,
  campaign text,
  fundraising_activity text,
  fiscal_year text,
  soft_credit_type_text text,
  studio_hard_credit_id text,
  imported_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, gift_record_id)
);

CREATE INDEX IF NOT EXISTS giving_history_cache_constituent_idx
  ON giving_history_cache(workspace_id, constituent_id);
CREATE INDEX IF NOT EXISTS giving_history_cache_activity_gift_type_idx
  ON giving_history_cache(workspace_id, fundraising_activity, gift_type);
CREATE INDEX IF NOT EXISTS giving_history_cache_fiscal_year_idx
  ON giving_history_cache(workspace_id, fiscal_year, gift_type);

ALTER TABLE giving_history_cache ENABLE ROW LEVEL SECURITY;
