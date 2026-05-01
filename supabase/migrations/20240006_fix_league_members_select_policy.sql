-- ============================================================
-- Fix: league_members SELECT policy
-- The old policy used is_league_member() which queries
-- league_members itself, creating a circular RLS dependency
-- when the function uses SECURITY INVOKER.
-- Replace with a direct check: users can see memberships
-- for leagues they belong to.
-- ============================================================

DROP POLICY IF EXISTS "league_members: members can read" ON league_members;

CREATE POLICY "league_members: members can read"
  ON league_members FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM league_members my
      WHERE my.league_id = league_members.league_id
        AND my.player_id = auth.uid()
    )
  );
