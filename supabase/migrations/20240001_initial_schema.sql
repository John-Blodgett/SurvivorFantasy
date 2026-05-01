-- ============================================================
-- Fantasy Survivor: Initial Schema Migration
-- ============================================================

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Leagues
CREATE TABLE IF NOT EXISTS leagues (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  invite_code         text UNIQUE NOT NULL,
  admin_id            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  roster_size         int NOT NULL DEFAULT 5 CHECK (roster_size BETWEEN 1 AND 20),
  season_number       int NOT NULL,
  draft_mode          text CHECK (draft_mode IN ('auto', 'live')),
  pick_timer_seconds  int NOT NULL DEFAULT 90,
  consolation_points  int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- League membership
CREATE TABLE IF NOT EXISTS league_members (
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, player_id)
);

-- Castaways
CREATE TABLE IF NOT EXISTS castaways (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id          uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name               text NOT NULL,
  tribe              text,
  photo_url          text,
  is_eliminated      bool NOT NULL DEFAULT false,
  eliminated_episode int,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Scoring rules
CREATE TABLE IF NOT EXISTS scoring_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  points     int NOT NULL,
  is_default bool NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Draft state (one draft per league)
CREATE TABLE IF NOT EXISTS drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id          uuid UNIQUE NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'complete')),
  current_pick_index int NOT NULL DEFAULT 0,
  started_at         timestamptz,
  completed_at       timestamptz
);

-- Draft picks
CREATE TABLE IF NOT EXISTS draft_picks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id    uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  castaway_id uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  pick_number int NOT NULL,
  picked_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, castaway_id),
  UNIQUE (draft_id, pick_number)
);

-- Player preferences for auto draft
CREATE TABLE IF NOT EXISTS draft_preferences (
  league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  castaway_id uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  rank        int NOT NULL,
  PRIMARY KEY (league_id, player_id, castaway_id)
);

-- Team assignments (draft, late-join, and trade assignments)
CREATE TABLE IF NOT EXISTS team_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  castaway_id         uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  points_from_episode int NOT NULL DEFAULT 1,
  source              text NOT NULL CHECK (source IN ('draft', 'admin_assign', 'trade')),
  UNIQUE (league_id, castaway_id)
);

-- Episodes
CREATE TABLE IF NOT EXISTS episodes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id    uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  number       int NOT NULL,
  title        text,
  is_finalized bool NOT NULL DEFAULT false,
  finalized_at timestamptz,
  UNIQUE (league_id, number)
);

-- Episode events (scored by admin)
CREATE TABLE IF NOT EXISTS episode_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id      uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  castaway_id     uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  scoring_rule_id uuid REFERENCES scoring_rules(id) ON DELETE SET NULL,
  points          int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Trades
CREATE TABLE IF NOT EXISTS trades (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  proposer_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposer_castaway uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  receiver_castaway uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'admin_approved', 'admin_rejected')),
  proposed_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  CHECK (proposer_id <> receiver_id),
  CHECK (proposer_castaway <> receiver_castaway)
);

-- Weekly challenges
CREATE TABLE IF NOT EXISTS challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  episode_id  uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  points      int NOT NULL,
  deadline    timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Challenge submissions (one per player per challenge)
CREATE TABLE IF NOT EXISTS challenge_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  response     text NOT NULL,
  is_correct   bool,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, player_id)
);
