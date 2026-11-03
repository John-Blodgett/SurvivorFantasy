-- Season completion: let an admin mark a league's season as finished.
-- Completed leagues drop out of the active dashboard list and move to
-- a "Past Seasons" section. The winner is captured at completion time.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS is_complete  bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS winner_id    uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Existing RLS policy "leagues: admin can update" (admin_id = auth.uid())
-- already authorizes the admin to set these columns, so no new policy needed.
