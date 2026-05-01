# Design Document: Fantasy Survivor

## Overview

Fantasy Survivor is a web application that lets a group of friends play a fantasy game around the CBS show Survivor. Players draft castaways, earn points based on in-episode events scored by an admin, and compete on a live leaderboard. The application is fully responsive, visually polished, and built entirely on free-tier infrastructure hosted on GitHub.

The stack is:
- **Frontend + API**: Next.js 14 (App Router) with TypeScript
- **Database + Auth + Realtime**: Supabase (free tier — 500MB DB, 50K MAUs, 200 concurrent realtime connections)
- **Hosting**: Vercel (free Hobby tier — auto-deploys from GitHub on every push)
- **Styling**: Tailwind CSS + shadcn/ui component library
- **Property-Based Testing**: fast-check (TypeScript PBT library)
- **Unit Testing**: Vitest

All services are free at the scale of a friend-group league (10–30 users). The codebase lives on GitHub and Vercel deploys automatically on every push to `main`.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Vercel (CDN)                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           Next.js App (App Router)            │   │
│  │                                              │   │
│  │  ┌─────────────┐   ┌──────────────────────┐ │   │
│  │  │  React UI   │   │  API Route Handlers  │ │   │
│  │  │  (pages,    │   │  (/api/*)            │ │   │
│  │  │  components)│   │                      │ │   │
│  │  └──────┬──────┘   └──────────┬───────────┘ │   │
│  └─────────┼────────────────────┼─────────────┘   │
└────────────┼────────────────────┼─────────────────┘
             │                    │
             ▼                    ▼
┌─────────────────────────────────────────────────────┐
│                   Supabase                           │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │   Auth   │  │ Postgres │  │  Realtime Engine  │ │
│  │ (email,  │  │   DB     │  │  (live draft room)│ │
│  │  magic   │  │          │  │                   │ │
│  │  link)   │  │          │  │                   │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────┘
```

The Next.js app handles both the React frontend and server-side API logic via Route Handlers. Supabase provides the database, authentication, and real-time pub/sub for the live draft room. Vercel serves the app globally from its CDN.

---

## Components and Interfaces

### Page Routes

| Route | Description | Access |
|---|---|---|
| `/` | Landing / login page | Public |
| `/register` | Account creation | Public |
| `/dashboard` | Player's league overview | Authenticated |
| `/league/[id]/leaderboard` | League leaderboard | Authenticated |
| `/league/[id]/team/[userId]` | Any player's team view | Authenticated |
| `/league/[id]/draft` | Draft room (live or auto) | Authenticated |
| `/league/[id]/episode/[num]` | Episode recap | Authenticated |
| `/league/[id]/challenges` | Weekly challenges list | Authenticated |
| `/admin` | Admin dashboard | Admin only |
| `/admin/episode/[num]` | Episode scoring interface | Admin only |
| `/admin/rules` | Scoring rules management | Admin only |
| `/admin/castaways` | Castaway roster management | Admin only |
| `/admin/draft` | Draft configuration | Admin only |
| `/admin/trades` | Trade approval queue | Admin only |
| `/league/[id]/waiver` | Waiver wire — browse & claim | Authenticated |
| `/admin/waiver` | Waiver wire schedule & manual trigger | Admin only |

### Key Components

- `LeaderboardTable` — ranked player list with points, rank delta, and team link
- `TeamView` — castaway grid with per-episode points breakdown table
- `EpisodeScorer` — mobile-optimized castaway grid + rule selector for admin
- `DraftRoom` — real-time draft interface with pick timer and pick history
- `CastawayCard` — photo, name, tribe, status (active/eliminated), points
- `ScoringRuleEditor` — form for creating/editing scoring rules
- `ChallengeForm` — player submission form for weekly challenges
- `TradeProposal` — UI for initiating and responding to trade offers
- `WaiverWireList` — list of available castaways with bid form and pending claims
- `WaiverClaimForm` — blind bid input, castaway-to-drop selector, submit button
- `WaiverAdminPanel` — schedule configuration, pending claims overview, manual trigger button

---

## Data Models

### Database Schema (Supabase / PostgreSQL)

```sql
-- Users (extends Supabase auth.users)
profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users,
  display_name text NOT NULL,
  created_at  timestamptz DEFAULT now()
)

-- Leagues
leagues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  invite_code   text UNIQUE NOT NULL,
  admin_id      uuid REFERENCES profiles(id),
  roster_size   int NOT NULL DEFAULT 5,
  season_number int NOT NULL,
  draft_mode    text CHECK (draft_mode IN ('auto', 'live')),
  pick_timer_seconds int DEFAULT 90,
  consolation_points int NOT NULL DEFAULT 1,
  waiver_budget  int NOT NULL DEFAULT 100,
  waiver_process_day  int CHECK (waiver_process_day BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  waiver_process_hour int CHECK (waiver_process_hour BETWEEN 0 AND 23),
  waiver_process_minute int CHECK (waiver_process_minute BETWEEN 0 AND 59) DEFAULT 0,
  created_at    timestamptz DEFAULT now()
)

-- League membership
league_members (
  league_id        uuid REFERENCES leagues(id),
  player_id        uuid REFERENCES profiles(id),
  joined_at        timestamptz DEFAULT now(),
  waiver_budget_remaining int NOT NULL DEFAULT 100,
  PRIMARY KEY (league_id, player_id)
)

-- Castaways
castaways (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid REFERENCES leagues(id),
  name          text NOT NULL,
  tribe         text,
  photo_url     text,
  is_eliminated bool NOT NULL DEFAULT false,
  eliminated_episode int,
  created_at    timestamptz DEFAULT now()
)

-- Scoring rules
scoring_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id),
  name        text NOT NULL,
  points      int NOT NULL,
  is_default  bool NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now()
)

-- Draft state
drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid UNIQUE REFERENCES leagues(id),
  status      text CHECK (status IN ('pending', 'active', 'complete')),
  current_pick_index int DEFAULT 0,
  started_at  timestamptz,
  completed_at timestamptz
)

-- Draft picks
draft_picks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id    uuid REFERENCES drafts(id),
  player_id   uuid REFERENCES profiles(id),
  castaway_id uuid REFERENCES castaways(id),
  pick_number int NOT NULL,
  picked_at   timestamptz DEFAULT now()
)

-- Player preferences for auto draft
draft_preferences (
  league_id   uuid REFERENCES leagues(id),
  player_id   uuid REFERENCES profiles(id),
  castaway_id uuid REFERENCES castaways(id),
  rank        int NOT NULL,
  PRIMARY KEY (league_id, player_id, castaway_id)
)

-- Team assignments (includes late-join and trade assignments)
team_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid REFERENCES leagues(id),
  player_id     uuid REFERENCES profiles(id),
  castaway_id   uuid REFERENCES castaways(id),
  assigned_at   timestamptz DEFAULT now(),
  points_from_episode int NOT NULL DEFAULT 1,
  source        text CHECK (source IN ('draft', 'admin_assign', 'trade'))
)

-- Episodes
episodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id),
  number      int NOT NULL,
  title       text,
  is_finalized bool NOT NULL DEFAULT false,
  finalized_at timestamptz,
  UNIQUE (league_id, number)
)

-- Episode events (scored by admin)
episode_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id      uuid REFERENCES episodes(id),
  castaway_id     uuid REFERENCES castaways(id),
  scoring_rule_id uuid REFERENCES scoring_rules(id),
  points          int NOT NULL,
  created_at      timestamptz DEFAULT now()
)

-- Trades
trades (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id         uuid REFERENCES leagues(id),
  proposer_id       uuid REFERENCES profiles(id),
  receiver_id       uuid REFERENCES profiles(id),
  proposer_castaway uuid REFERENCES castaways(id),
  receiver_castaway uuid REFERENCES castaways(id),
  status            text CHECK (status IN ('pending', 'accepted', 'rejected', 'admin_approved', 'admin_rejected')),
  proposed_at       timestamptz DEFAULT now(),
  resolved_at       timestamptz
)

-- Waiver wire claims
waiver_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid REFERENCES leagues(id),
  player_id       uuid REFERENCES profiles(id),
  castaway_id     uuid REFERENCES castaways(id),  -- castaway being claimed
  drop_castaway_id uuid REFERENCES castaways(id), -- castaway being dropped
  bid_amount      int NOT NULL CHECK (bid_amount >= 0),
  status          text CHECK (status IN ('pending', 'won', 'lost')),
  submitted_at    timestamptz DEFAULT now(),
  processed_at    timestamptz
)

-- Weekly challenges
challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id),
  episode_id  uuid REFERENCES episodes(id),
  title       text NOT NULL,
  description text,
  points      int NOT NULL,
  deadline    timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now()
)

-- Challenge submissions
challenge_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid REFERENCES challenges(id),
  player_id     uuid REFERENCES profiles(id),
  response      text NOT NULL,
  is_correct    bool,
  submitted_at  timestamptz DEFAULT now(),
  PRIMARY KEY (challenge_id, player_id)
)
```

### Computed Points Logic

Points for a player are not stored as a single aggregate. They are computed on-demand (or cached after episode finalization) by summing:

1. `episode_events.points` for all castaways on the player's team, filtered to events from episodes where `episode_number >= team_assignments.points_from_episode`
2. Consolation points: `leagues.consolation_points` × (number of finalized episodes after a castaway's `eliminated_episode`) for each eliminated castaway on the team
3. Challenge points: `challenges.points` for each `challenge_submissions` row where `is_correct = true`

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property-Based Testing Overview

Property-based testing (PBT) validates software correctness by testing universal properties across many generated inputs. Each property is a formal specification that should hold for all valid inputs. We use **fast-check** as the PBT library for TypeScript.

Each property test runs a minimum of 100 iterations.

---

### Property 1: Points computation equals sum of eligible episode events

*For any* player, team assignment, and set of finalized episode events, the total computed score must equal the sum of all episode event point values for castaways on their team, filtered to events from episodes at or after each castaway's `points_from_episode` value, plus consolation points and challenge points.

**Validates: Requirements 6.3, 8.1, 8.2**

---

### Property 2: Consolation points accrue correctly for eliminated castaways

*For any* eliminated castaway on a team, the consolation points awarded must equal `consolation_points_per_episode × (number of finalized episodes with episode_number > castaway.eliminated_episode)`.

**Validates: Requirements 14.1, 14.3**

---

### Property 3: Draft snake order is correct and produces unique assignments

*For any* league with N players and a roster size of R, the completed draft must satisfy two conditions: (1) the pick order follows a snake pattern (1..N forward, then N..1 reverse, repeating), and (2) each castaway ID appears at most once across all picks.

**Validates: Requirements 4.2, 4.7, 4.8**

---

### Property 4: Auto-pick selects highest-ranked available castaway

*For any* player preference list and set of already-drafted castaways, the auto-pick function must select the castaway with the lowest rank number that is not already in the drafted set.

**Validates: Requirements 4.6**

---

### Property 5: Trade point cutoff is respected for both sides

*For any* completed trade, the traded castaway's episode events from episodes finalized before the trade must not contribute to the new owner's score, and must still be included in the original owner's historical score.

**Validates: Requirements 13.3, 13.4, 13.5**

---

### Property 6: Late-join point cutoff is respected

*For any* admin-assigned castaway (source = 'admin_assign'), episode events from episodes numbered less than `points_from_episode` must not be included in the player's score.

**Validates: Requirements 12.3**

---

### Property 7: Challenge points are only awarded for correct submissions

*For any* player, the total challenge points in their score must equal the sum of `challenges.points` for all submissions where `is_correct = true`. Submissions where `is_correct = false` or `is_correct = null` must contribute zero points.

**Validates: Requirements 9.4**

---

### Property 8: Leaderboard is sorted in non-increasing order of total points

*For any* league with computed player scores, the leaderboard array must be sorted such that for every adjacent pair of entries, the first entry's total points is greater than or equal to the second entry's total points.

**Validates: Requirements 7.1, 7.2**

---

### Property 9: Eliminated castaways cannot be traded

*For any* trade proposal where either castaway has `is_eliminated = true`, the trade validation function must return an error and the trade must not be created with a non-rejected status.

**Validates: Requirements 13.6**

---

### Property 10: Scoring rule serialization round trip

*For any* valid `ScoringRule` object (including negative point values), serializing it to JSON and deserializing it back must produce an object that is deeply equal to the original.

**Validates: Requirements 5.1, 5.2**

---

### Property 11: Duplicate email registration is rejected

*For any* email address that already exists in the system, a second registration attempt with that email must return an error and must not create a second account.

**Validates: Requirements 1.2, 16.1**

---

### Property 12: Episode recap contains all and only events for that episode

*For any* finalized episode, the recap data must include every `episode_events` row for that episode and must not include events from any other episode.

**Validates: Requirements 10.1, 10.2**

---

### Property 13: Episode recap is sorted in reverse chronological order

*For any* list of finalized episodes on the season summary page, the episodes must be ordered such that higher episode numbers appear before lower episode numbers.

**Validates: Requirements 10.3**

---

### Property 14: Waiver claim winner has highest bid

*For any* set of waiver claims for the same castaway processed in the same batch, the claim that is fulfilled must belong to the player with the highest bid amount. If multiple claims share the highest bid, exactly one of them must be fulfilled (chosen at random) and the rest must be marked as lost.

**Validates: Requirements 18.4**

---

### Property 15: Waiver budget is never over-spent

*For any* player in a league, the sum of all their fulfilled waiver claim bid amounts must never exceed their starting waiver budget, and their `waiver_budget_remaining` must equal `starting_budget − sum(won_bids)`.

**Validates: Requirements 18.2, 18.5**

---

### Property 16: Losing waiver claimants are not charged

*For any* waiver claim with status 'lost', the player's `waiver_budget_remaining` must be unchanged compared to before the claim was submitted.

**Validates: Requirements 18.6**

---

### Property 17: Waiver wire contains only unowned, non-eliminated castaways

*For any* league, the set of castaways returned by the waiver wire query must be disjoint from the set of castaways currently assigned to any team, and must not include any castaway where `is_eliminated = true`.

**Validates: Requirements 18.1**

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Duplicate email registration | Return 409 with message "An account with this email already exists" |
| Invalid invite code | Return 404 with message "League not found or invite link is invalid" |
| Joining a league twice | Return 409 with message "You are already a member of this league" |
| Draft pick on eliminated castaway | Return 400 with message "This castaway is no longer available" |
| Trade involving eliminated castaway | Return 400 with message "Eliminated castaways cannot be traded" |
| Waiver claim with insufficient budget | Return 400 with message "Bid amount exceeds your remaining waiver budget" |
| Waiver claim with no castaway to drop | Return 400 with message "You must have at least one castaway on your team to submit a waiver claim" |
| Waiver claim on an eliminated castaway | Return 400 with message "Eliminated castaways are not available on the waiver wire" |
| Waiver claim on a castaway already on a team | Return 400 with message "This castaway is not available on the waiver wire" |
| Challenge submission after deadline | Return 403 with message "The submission deadline for this challenge has passed" |
| Non-admin accessing admin routes | Redirect to `/dashboard` with a toast error |
| Supabase connection failure | Display a user-friendly error banner; log error server-side |
| Pick timer expiry with no preferences | Auto-select the first available castaway alphabetically |

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. They are complementary:

- **Unit tests** (Vitest): verify specific examples, edge cases, and error conditions
- **Property tests** (fast-check): verify universal properties hold across all generated inputs

### Unit Test Coverage

- Auth flows: registration, login, magic link, session persistence
- Admin route protection: non-admin users are redirected
- Episode finalization: locking events, triggering score recalculation
- Trade lifecycle: propose → accept → admin approve → team update
- Challenge deadline enforcement: submissions blocked after deadline
- Consolation points: correct calculation for various elimination episodes

### Property Test Configuration

Each property test must:
- Run a minimum of **100 iterations** (fast-check default is 100)
- Include a comment referencing the design property number
- Use the tag format: `Feature: fantasy-survivor, Property N: <property_text>`

### Property Test Generators

Key generators needed:
- `arbitraryLeague()` — generates a league with random roster size (1–10), random consolation points (0–5)
- `arbitraryPlayers(n)` — generates N player profiles with unique IDs
- `arbitraryCastaways(n, leagueId)` — generates N castaways, some eliminated at random episodes
- `arbitraryDraft(players, castaways)` — generates a valid completed snake-order draft
- `arbitraryEpisodeEvents(castaways, rules)` — generates random episode events with valid castaway/rule pairs
- `arbitraryScoringRule()` — generates a rule with name and integer point value (can be negative)
- `arbitraryTrade(teams)` — generates a valid 1-for-1 trade between two players with non-eliminated castaways
- `arbitraryWaiverClaim(league, player, availableCastaways)` — generates a valid waiver claim with a bid between 0 and the player's remaining budget and a valid drop castaway
- `arbitraryWaiverClaimBatch(league, players, castaway)` — generates multiple claims from different players for the same castaway, with varying bid amounts
