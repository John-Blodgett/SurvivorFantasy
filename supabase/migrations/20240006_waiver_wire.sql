-- ============================================================
-- Fantasy Survivor: Waiver Wire Schema Migration
-- Requirements: 18.2, 18.3, 18.7
-- ============================================================

-- Add waiver wire configuration columns to leagues
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS waiver_budget int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS waiver_process_day int CHECK (waiver_process_day BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS waiver_process_hour int CHECK (waiver_process_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS waiver_process_minute int NOT NULL DEFAULT 0 CHECK (waiver_process_minute BETWEEN 0 AND 59);

-- Add waiver budget remaining to league members
ALTER TABLE league_members
  ADD COLUMN IF NOT EXISTS waiver_budget_remaining int NOT NULL DEFAULT 100;

-- Update team_assignments source constraint to include 'waiver'
ALTER TABLE team_assignments DROP CONSTRAINT IF EXISTS team_assignments_source_check;
ALTER TABLE team_assignments ADD CONSTRAINT team_assignments_source_check
  CHECK (source IN ('draft', 'admin_assign', 'trade', 'waiver'));

-- Create waiver_claims table
CREATE TABLE IF NOT EXISTS waiver_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id        uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  castaway_id      uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  drop_castaway_id uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  bid_amount       int NOT NULL CHECK (bid_amount >= 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
