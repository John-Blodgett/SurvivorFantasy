-- ============================================================
-- 1. Fix RLS policies that still use is_league_member (SECURITY INVOKER)
--    Replace with is_league_member_definer (SECURITY DEFINER)
--    so non-admin members can read data and receive Realtime events
-- ============================================================

-- draft_picks SELECT
DROP POLICY IF EXISTS "draft_picks: members can read" ON draft_picks;
CREATE POLICY "draft_picks: members can read"
  ON draft_picks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_id
        AND is_league_member_definer(d.league_id)
    )
  );

-- drafts SELECT
DROP POLICY IF EXISTS "drafts: members can read" ON drafts;
CREATE POLICY "drafts: members can read"
  ON drafts FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- leagues SELECT
DROP POLICY IF EXISTS "leagues: members can read" ON leagues;
CREATE POLICY "leagues: members can read"
  ON leagues FOR SELECT
  TO authenticated
  USING (is_league_member_definer(id));

-- castaways SELECT
DROP POLICY IF EXISTS "castaways: members can read" ON castaways;
CREATE POLICY "castaways: members can read"
  ON castaways FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- scoring_rules SELECT
DROP POLICY IF EXISTS "scoring_rules: members can read" ON scoring_rules;
CREATE POLICY "scoring_rules: members can read"
  ON scoring_rules FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- team_assignments SELECT
DROP POLICY IF EXISTS "team_assignments: members can read" ON team_assignments;
CREATE POLICY "team_assignments: members can read"
  ON team_assignments FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- episodes SELECT
DROP POLICY IF EXISTS "episodes: members can read" ON episodes;
CREATE POLICY "episodes: members can read"
  ON episodes FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- episode_events SELECT
DROP POLICY IF EXISTS "episode_events: members can read" ON episode_events;
CREATE POLICY "episode_events: members can read"
  ON episode_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = episode_id
        AND is_league_member_definer(e.league_id)
    )
  );

-- draft_preferences SELECT
DROP POLICY IF EXISTS "draft_preferences: members can read all preferences" ON draft_preferences;
CREATE POLICY "draft_preferences: members can read all preferences"
  ON draft_preferences FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- challenges SELECT
DROP POLICY IF EXISTS "challenges: members can read" ON challenges;
CREATE POLICY "challenges: members can read"
  ON challenges FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- trades INSERT
DROP POLICY IF EXISTS "trades: players can propose" ON trades;
CREATE POLICY "trades: players can propose"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (
    proposer_id = auth.uid()
    AND is_league_member_definer(league_id)
  );

-- ============================================================
-- 2. Add pick_started_at column to drafts for synchronized timer
-- ============================================================
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pick_started_at timestamptz;
