-- ============================================================
-- Add customizable draft order to league_members
--
-- Purpose:
--  - Allow the league admin to set an explicit draft order
--    (e.g. randomized) for a live draft, instead of relying
--    solely on join order.
--
-- Behavior:
--  - draft_position is nullable. When NULL, ordering falls back
--    to joined_at (existing behavior).
--  - When set, players are ordered by draft_position ascending,
--    with NULLs sorted last, then by joined_at as a tiebreaker.
-- ============================================================

ALTER TABLE league_members
  ADD COLUMN IF NOT EXISTS draft_position int;

-- ============================================================
-- Allow the league admin to update member rows (needed to
-- assign draft_position). Existing policies only cover SELECT,
-- INSERT (self join), and DELETE.
-- ============================================================

DROP POLICY IF EXISTS "league_members: admin can update" ON league_members;

CREATE POLICY "league_members: admin can update"
  ON league_members FOR UPDATE
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));
