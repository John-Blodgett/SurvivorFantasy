-- ============================================================
-- Fix: league_members SELECT policy — remove self-referencing
-- subquery that caused infinite recursion.
--
-- New approach: two non-recursive policies
-- 1. Users can always read their own membership rows
-- 2. League admins can read all members in their leagues
--    (via leagues table, no self-reference)
-- ============================================================

DROP POLICY IF EXISTS "league_members: members can read" ON league_members;

-- Users can see their own memberships
CREATE POLICY "league_members: users read own"
  ON league_members FOR SELECT
  TO authenticated
  USING (player_id = auth.uid());

-- League admins can see all members in their leagues
CREATE POLICY "league_members: admin reads all"
  ON league_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_members.league_id
        AND leagues.admin_id = auth.uid()
    )
  );
