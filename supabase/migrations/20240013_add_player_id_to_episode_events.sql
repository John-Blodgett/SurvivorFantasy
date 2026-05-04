-- Add player_id to episode_events so points are permanently attributed
-- to the player who owned the castaway when the episode was finalized.
-- This decouples scoring from current team_assignments, so trades don't
-- retroactively move points between players.

ALTER TABLE episode_events
  ADD COLUMN player_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Backfill existing finalized episode events with the current owner.
-- This is a best-effort backfill; for already-traded castaways the current
-- owner gets credit (which matches the old behavior).
UPDATE episode_events ee
SET player_id = ta.player_id
FROM episodes e, team_assignments ta
WHERE ee.episode_id = e.id
  AND e.is_finalized = true
  AND ta.league_id = e.league_id
  AND ta.castaway_id = ee.castaway_id
  AND ee.player_id IS NULL;
