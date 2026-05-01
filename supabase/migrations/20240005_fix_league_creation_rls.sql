-- ============================================================
-- Fix: Allow league admin to SELECT their own league
-- The existing "leagues: members can read" policy requires
-- is_league_member(id), but during creation the league_members
-- row doesn't exist yet. The admin needs to read the league
-- immediately after insert (for the .select().single() call).
-- ============================================================

CREATE POLICY "leagues: admin can read own league"
  ON leagues FOR SELECT
  TO authenticated
  USING (admin_id = auth.uid());

-- ============================================================
-- Fix: seed_default_scoring_rules needs to be callable by
-- authenticated users (server actions use the anon key with
-- user session, not service_role).
-- ============================================================

GRANT EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) TO authenticated;
