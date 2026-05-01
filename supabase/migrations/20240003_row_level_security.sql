-- ============================================================
-- Fantasy Survivor: Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues               ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE castaways             ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_picks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades                ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_submissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: is the current user a member of a given league?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league_id
      AND player_id = auth.uid()
  );
$$;

-- ============================================================
-- Helper: is the current user the admin of a given league?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_league_admin(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
      AND admin_id = auth.uid()
  );
$$;

-- ============================================================
-- profiles
-- ============================================================
-- Anyone authenticated can read profiles (needed for leaderboard display names)
CREATE POLICY "profiles: authenticated users can read"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert/update their own profile
CREATE POLICY "profiles: users manage own profile"
  ON profiles FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- leagues
-- ============================================================
-- Members can read leagues they belong to
CREATE POLICY "leagues: members can read"
  ON leagues FOR SELECT
  TO authenticated
  USING (is_league_member(id));

-- Any authenticated user can create a league
CREATE POLICY "leagues: authenticated users can create"
  ON leagues FOR INSERT
  TO authenticated
  WITH CHECK (admin_id = auth.uid());

-- Only the admin can update their league
CREATE POLICY "leagues: admin can update"
  ON leagues FOR UPDATE
  TO authenticated
  USING (admin_id = auth.uid())
  WITH CHECK (admin_id = auth.uid());

-- ============================================================
-- league_members
-- ============================================================
-- Members can see who else is in their leagues
CREATE POLICY "league_members: members can read"
  ON league_members FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

-- Authenticated users can join a league (insert themselves)
CREATE POLICY "league_members: users can join"
  ON league_members FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

-- Users can leave (delete themselves); admins can remove members
CREATE POLICY "league_members: users can leave or admin can remove"
  ON league_members FOR DELETE
  TO authenticated
  USING (player_id = auth.uid() OR is_league_admin(league_id));

-- ============================================================
-- castaways
-- ============================================================
-- League members can read castaways
CREATE POLICY "castaways: members can read"
  ON castaways FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

-- Only league admin can insert/update/delete castaways
CREATE POLICY "castaways: admin can manage"
  ON castaways FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- scoring_rules
-- ============================================================
CREATE POLICY "scoring_rules: members can read"
  ON scoring_rules FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "scoring_rules: admin can manage"
  ON scoring_rules FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- drafts
-- ============================================================
CREATE POLICY "drafts: members can read"
  ON drafts FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "drafts: admin can manage"
  ON drafts FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- draft_picks
-- ============================================================
CREATE POLICY "draft_picks: members can read"
  ON draft_picks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_id
        AND is_league_member(d.league_id)
    )
  );

-- Players can insert their own picks during an active draft
CREATE POLICY "draft_picks: players can pick"
  ON draft_picks FOR INSERT
  TO authenticated
  WITH CHECK (
    player_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM drafts d
      WHERE d.id = draft_id AND d.status = 'active'
        AND is_league_member(d.league_id)
    )
  );

-- ============================================================
-- draft_preferences
-- ============================================================
CREATE POLICY "draft_preferences: players manage own preferences"
  ON draft_preferences FOR ALL
  TO authenticated
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid());

CREATE POLICY "draft_preferences: members can read all preferences"
  ON draft_preferences FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

-- ============================================================
-- team_assignments
-- ============================================================
CREATE POLICY "team_assignments: members can read"
  ON team_assignments FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

-- Only admin can insert/update/delete team assignments
CREATE POLICY "team_assignments: admin can manage"
  ON team_assignments FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- episodes
-- ============================================================
CREATE POLICY "episodes: members can read"
  ON episodes FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "episodes: admin can manage"
  ON episodes FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- episode_events
-- ============================================================
CREATE POLICY "episode_events: members can read"
  ON episode_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = episode_id
        AND is_league_member(e.league_id)
    )
  );

CREATE POLICY "episode_events: admin can manage"
  ON episode_events FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = episode_id
        AND is_league_admin(e.league_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM episodes e
      WHERE e.id = episode_id
        AND is_league_admin(e.league_id)
    )
  );

-- ============================================================
-- trades
-- ============================================================
CREATE POLICY "trades: involved players and admin can read"
  ON trades FOR SELECT
  TO authenticated
  USING (
    proposer_id = auth.uid()
    OR receiver_id = auth.uid()
    OR is_league_admin(league_id)
  );

-- Players can propose trades (insert where they are the proposer)
CREATE POLICY "trades: players can propose"
  ON trades FOR INSERT
  TO authenticated
  WITH CHECK (
    proposer_id = auth.uid()
    AND is_league_member(league_id)
  );

-- Receiver can accept/reject; admin can approve/reject
CREATE POLICY "trades: receiver or admin can update"
  ON trades FOR UPDATE
  TO authenticated
  USING (
    receiver_id = auth.uid()
    OR is_league_admin(league_id)
  );

-- ============================================================
-- challenges
-- ============================================================
CREATE POLICY "challenges: members can read"
  ON challenges FOR SELECT
  TO authenticated
  USING (is_league_member(league_id));

CREATE POLICY "challenges: admin can manage"
  ON challenges FOR ALL
  TO authenticated
  USING (is_league_admin(league_id))
  WITH CHECK (is_league_admin(league_id));

-- ============================================================
-- challenge_submissions
-- ============================================================
-- Players can read their own submissions; admin can read all
CREATE POLICY "challenge_submissions: players read own, admin reads all"
  ON challenge_submissions FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id
        AND is_league_admin(c.league_id)
    )
  );

-- Players can submit their own responses
CREATE POLICY "challenge_submissions: players can submit"
  ON challenge_submissions FOR INSERT
  TO authenticated
  WITH CHECK (player_id = auth.uid());

-- Admin can mark submissions correct/incorrect
CREATE POLICY "challenge_submissions: admin can grade"
  ON challenge_submissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id
        AND is_league_admin(c.league_id)
    )
  );
