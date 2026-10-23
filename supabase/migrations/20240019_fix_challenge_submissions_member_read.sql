-- ============================================================
-- Fix: league members cannot see other players' challenge points
-- ============================================================
-- The original SELECT policy on challenge_submissions restricted reads
-- to the submitting player (player_id = auth.uid()) plus the league
-- admin. As a result, non-admin members saw zero challenge points for
-- every other player on the leaderboard / scoring views, while the
-- admin saw everything.
--
-- Challenge results are league-public data (the leaderboard aggregates
-- correct submissions into each player's total, matching how
-- episode_events and team_assignments are already readable by any
-- league member). This migration widens the SELECT policy so any
-- member of the challenge's league can read submissions for that
-- league, keeping it consistent with the "members can read" pattern
-- used across the schema.
--
-- INSERT (own submissions only) and UPDATE (admin grading only)
-- policies are unchanged.

BEGIN;

DROP POLICY IF EXISTS
  "challenge_submissions: players read own, admin reads all"
  ON challenge_submissions;

CREATE POLICY "challenge_submissions: league members can read"
  ON challenge_submissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = challenge_id
        AND is_league_member_definer(c.league_id)
    )
  );

COMMIT;
