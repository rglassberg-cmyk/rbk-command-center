-- board_member_overrides — spouse/joint-record trustees whose gifts sit on
-- a joint household record that has no "Trustee" in its own roles_raw, so
-- the segment classifier can't catch them. constituent_id here is the JOINT
-- record that holds their gifts; it's forced to the "Board Members" segment
-- in the Development Overview (segmentOf in overview/route.ts +
-- segment-donors/route.ts). The Trustee roles_raw check still handles the
-- majority of trustees; this table is the override layer.
--
-- Table created + seeded externally (SAR workspace seed: constituent_ids
-- 9688, 4262, 7775, 5750, 8878, 5271). DDL kept here as source of truth.

CREATE TABLE IF NOT EXISTS board_member_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  constituent_id integer NOT NULL,
  constituent_name text NOT NULL,
  added_by text,
  added_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, constituent_id)
);

CREATE INDEX IF NOT EXISTS board_member_overrides_workspace_idx
  ON board_member_overrides(workspace_id);

ALTER TABLE board_member_overrides ENABLE ROW LEVEL SECURITY;
