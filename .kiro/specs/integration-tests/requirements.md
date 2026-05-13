# Requirements Document

## Introduction

This document specifies the requirements for a comprehensive integration test suite for the Fantasy Survivor application. The test suite exercises Supabase queries, Row Level Security policies, server action logic, and full data flows against a live Supabase database using the `service_role` key. Tests are isolated from the existing unit test suite via a separate Vitest configuration and run against a dedicated test league (season 99) to avoid polluting production data.

## Glossary

- **Test_Runner**: The Vitest integration test configuration and execution environment
- **Admin_Client**: A Supabase client initialized with the `service_role` key, bypassing RLS for setup/teardown and verification
- **Scoped_Client**: A Supabase client authenticated as a specific test user, subject to RLS policies
- **Test_League**: A league named "Integ Test League" with season_number = 99, used exclusively for integration tests
- **Test_User**: One of 10 Supabase auth users created for integration testing (Player 1 = league admin, Players 2-10 = members)
- **Cleanup_Routine**: A procedure that deletes all test data in FK-safe order scoped to the Test_League
- **Snake_Order**: Draft pick ordering where odd rounds go Player 1-10 and even rounds go Player 10-1
- **Points_From_Episode**: The episode number from which a team assignment begins earning points (trade/waiver boundary)

## Requirements


### Requirement 1: Test Infrastructure Setup

**User Story:** As a developer, I want a separate Vitest configuration for integration tests, so that integration tests do not run alongside unit tests and can be executed independently.

#### Acceptance Criteria

1. THE Test_Runner SHALL use a dedicated Vitest configuration file (`vitest.integration.config.ts`) separate from the unit test configuration
2. THE Test_Runner SHALL resolve the `@/*` path alias to `./src/*` identically to the unit test configuration
3. THE Test_Runner SHALL use a `node` environment (not jsdom) since integration tests do not render DOM
4. THE Test_Runner SHALL load environment variables from `.env.local` including `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
5. WHEN the `npm run test:integration` script is executed, THE Test_Runner SHALL run only files matching `src/test/integration/**/*.test.ts`
6. THE Test_Runner SHALL exclude the `src/test/integration/**` path from the unit test configuration so that integration tests are NOT executed when `npm run test` is invoked
7. THE Test_Runner SHALL set a per-test timeout of 30000 milliseconds for integration tests to accommodate network round-trips to Supabase
8. THE Test_Runner SHALL NOT use the unit test setup file (`src/test/setup.ts`) for integration tests, since it imports jsdom-specific matchers incompatible with the node environment

### Requirement 2: Supabase Client Factory for Tests

**User Story:** As a developer, I want helper functions that create admin and user-scoped Supabase clients, so that tests can perform setup/teardown with full access and verify RLS enforcement with scoped access.

#### Acceptance Criteria

1. THE Admin_Client SHALL be initialized with the Supabase URL and `service_role` key from environment variables (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)
2. THE Admin_Client SHALL bypass all Row Level Security policies
3. WHEN a Scoped_Client is created for a Test_User, THE Scoped_Client SHALL be initialized with the Supabase `anon` key and signed in as that user via `auth.signInWithPassword`, so that all subsequent queries are subject to RLS policies using that user's `auth.uid()`
4. THE Admin_Client SHALL provide helper functions that accept an email and password to create a Test_User in Supabase Auth and return the user's UUID, retrieve a Test_User by email, and delete a Test_User by UUID
5. IF the `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` environment variable is missing, THEN THE Test_Runner SHALL fail with a descriptive error message before any tests execute
6. THE Scoped_Client SHALL NOT use the `service_role` key, ensuring Row Level Security policies are enforced for all queries made through it

### Requirement 3: Test Data Lifecycle Management

**User Story:** As a developer, I want automated cleanup and seeding routines, so that each test run starts from a known state regardless of previous run outcomes.

#### Acceptance Criteria

1. WHEN a test suite begins, THE Cleanup_Routine SHALL delete all data associated with the Test_League in FK-safe order (children before parents) across the following tables: challenge_submissions, challenges, waiver_claims, episode_events, episodes, trades, team_assignments, draft_picks, draft_preferences, drafts, scoring_rules, castaways, league_members, and leagues
2. THE Cleanup_Routine SHALL scope deletion exclusively to the Test_League (identified by name = "Integ Test League" AND season_number = 99)
3. THE Cleanup_Routine SHALL NOT modify data belonging to other leagues
4. WHEN cleanup completes, THE Admin_Client SHALL seed the Test_League with the following configuration: roster_size = 2, consolation_points = 2, waiver_budget = 100, draft_mode = "live", pick_timer_seconds = 300, 10 league members (Player 1 as admin, Players 2-10 as members), 30 castaways (tribes Alpha/Beta/Gamma, 10 each, named Castaway-01 through Castaway-30), and scoring rules seeded via the seed_default_scoring_rules RPC
5. IF a previous test run crashed mid-execution, THEN THE Cleanup_Routine SHALL still successfully remove partial state on the next run
6. IF the Test_League does not exist (first run or fully cleaned), THEN THE Cleanup_Routine SHALL complete without error and proceed directly to seeding
7. THE Admin_Client SHALL provide a helper function to retrieve the current Test_League ID for use in test assertions
8. THE Cleanup_Routine SHALL complete all deletion operations within 10 seconds

### Requirement 4: Live Draft Integration Tests

**User Story:** As a developer, I want integration tests that verify the complete live draft flow against the database, so that I can confirm snake order, pick validation, team assignment creation, and draft completion work end-to-end.

#### Acceptance Criteria

1. WHEN the admin starts a live draft, THE Admin_Client SHALL verify a `drafts` row is created with status = "active", current_pick_index = 0, started_at set to a non-null timestamp, and pick_started_at set to a non-null timestamp
2. WHEN the draft is started with 10 players (ordered by joined_at ascending) and roster_size = 2, THE Test_Runner SHALL verify snake order: Round 1 picks go Player 1 through Player 10 in joined_at ascending order, and Round 2 picks go Player 10 through Player 1 in joined_at descending order, for a total of 20 picks
3. WHEN a player makes a valid pick, THE Admin_Client SHALL verify a `draft_picks` row is inserted with correct pick_number (1-based sequential), player_id matching the picking player, and castaway_id matching the selected castaway
4. WHEN a player makes a valid pick, THE Admin_Client SHALL verify a `team_assignments` row is inserted with source = "draft" and points_from_episode = 1
5. WHEN a player makes a valid pick, THE Admin_Client SHALL verify `drafts.current_pick_index` advances by 1 and `drafts.pick_started_at` is updated to a new non-null timestamp
6. IF a player attempts to pick when it is not their turn, THEN the pick operation SHALL return an error containing "It is not your turn to pick"
7. IF a player attempts to pick an already-drafted castaway, THEN the pick operation SHALL return an error containing "This castaway has already been picked"
8. WHEN all 20 picks are complete, THE Admin_Client SHALL verify `drafts.status` = "complete", `completed_at` is set to a non-null timestamp, `current_pick_index` = 20, and `pick_started_at` is null
9. WHEN the draft is complete, THE Admin_Client SHALL verify each player has exactly 2 team_assignments with source = "draft"
10. IF a player attempts to pick after the draft is complete, THEN the pick operation SHALL return an error containing "Draft is already complete"
11. WHEN the draft is complete, THE Admin_Client SHALL verify that exactly 20 castaways have been assigned via draft_picks and the remaining 10 castaways (out of 30 total) have no draft_picks or team_assignments with source = "draft"

### Requirement 5: Auto Draft Integration Tests

**User Story:** As a developer, I want integration tests that verify the auto draft respects player preferences and falls back to alphabetical order, so that I can confirm the full auto-draft pipeline works against the database.

#### Acceptance Criteria

1. WHEN the admin starts an auto draft for a league with 10 players and roster_size = 2, THE Admin_Client SHALL verify `drafts.status` = "complete" and 20 `draft_picks` rows exist with sequential pick_numbers 1–20 assigned to players in snake order (round 1: Player 1→10 by joined_at ascending, round 2: Player 10→1)
2. WHEN a player with draft preferences has their turn in the snake order, THE Test_Runner SHALL verify that player's pick is the highest-ranked castaway (lowest rank number) from their preference list that has not been drafted by a prior pick in the sequence
3. WHEN a player without draft preferences has their turn in the snake order, THE Test_Runner SHALL verify that player's pick is the castaway with the earliest alphabetical ID among castaways not yet drafted by any prior pick
4. THE Test_Runner SHALL verify every draft_pick has a corresponding team_assignment row with matching player_id, castaway_id, source = "draft", and points_from_episode = 1
5. THE Test_Runner SHALL verify all 20 assigned castaway_ids are unique (no duplicate assignments across all team_assignments created by the draft)
6. IF the admin attempts to start an auto draft when a draft with status = "complete" already exists for the league, THEN THE Admin_Client SHALL receive an error indicating the draft is already complete and no new draft_picks or team_assignments are created

### Requirement 6: Episode Scoring and Finalization Integration Tests

**User Story:** As a developer, I want integration tests that verify episode creation, event scoring, finalization (including player_id stamping and consolation points), and unfinalization, so that I can confirm the scoring pipeline works end-to-end.

#### Acceptance Criteria

1. WHEN the admin adds an episode event for an episode number that does not yet exist, THE Admin_Client SHALL verify the episode row is auto-created with is_finalized = false, and the episode_events row is inserted with the correct episode_id, castaway_id, scoring_rule_id, and points matching the scoring rule's configured point value
2. IF the admin attempts to add an event to a finalized episode, THEN the operation SHALL fail with an error containing "finalized episode"
3. WHEN an episode is finalized, THE Admin_Client SHALL verify each episode_event has its player_id set to the player who currently owns the castaway via team_assignments at the time of finalization
4. WHEN an episode is finalized and castaways exist whose eliminated_episode is less than the current episode number, THE Admin_Client SHALL verify consolation events are auto-inserted for each such castaway with points equal to the league's consolation_points value and scoring_rule_id = null
5. WHEN an episode is unfinalized, THE Admin_Client SHALL verify is_finalized = false, finalized_at = null, consolation events (scoring_rule_id IS NULL) for that episode are deleted, and manually-added events (scoring_rule_id IS NOT NULL) remain
6. WHEN at least 2 episodes are finalized after a castaway's eliminated_episode, THE Test_Runner SHALL verify that the eliminated castaway has one consolation event per post-elimination finalized episode, with total consolation points equal to the league's consolation_points value multiplied by the number of those episodes
7. WHEN the admin removes an event from an unfinalized episode, THE Admin_Client SHALL verify the event is deleted
8. IF the admin attempts to remove an event from a finalized episode, THEN the operation SHALL fail with an error containing "finalized episode"


### Requirement 4: Live Draft Integration Tests

**User Story:** As a developer, I want integration tests that verify the complete live draft flow against the database, so that I can confirm snake order, pick validation, team assignment creation, and draft completion work end-to-end.

#### Acceptance Criteria

1. WHEN the admin starts a live draft, THE Admin_Client SHALL verify a `drafts` row is created with status = "active", current_pick_index = 0, started_at set to a non-null timestamp, and pick_started_at set to a non-null timestamp
2. WHEN the draft is started with 10 players (ordered by joined_at ascending) and roster_size = 2, THE Test_Runner SHALL verify snake order: Round 1 picks go Player 1 through Player 10 in joined_at ascending order, and Round 2 picks go Player 10 through Player 1 in joined_at descending order, for a total of 20 picks
3. WHEN a player makes a valid pick, THE Admin_Client SHALL verify a `draft_picks` row is inserted with correct pick_number (1-based sequential), player_id matching the picking player, and castaway_id matching the selected castaway
4. WHEN a player makes a valid pick, THE Admin_Client SHALL verify a `team_assignments` row is inserted with source = "draft" and points_from_episode = 1
5. WHEN a player makes a valid pick, THE Admin_Client SHALL verify `drafts.current_pick_index` advances by 1 and `drafts.pick_started_at` is updated to a new non-null timestamp
6. IF a player attempts to pick when it is not their turn, THEN the pick operation SHALL return an error containing "It is not your turn to pick"
7. IF a player attempts to pick an already-drafted castaway, THEN the pick operation SHALL return an error containing "This castaway has already been picked"
8. WHEN all 20 picks are complete, THE Admin_Client SHALL verify `drafts.status` = "complete", `completed_at` is set to a non-null timestamp, `current_pick_index` = 20, and `pick_started_at` is null
9. WHEN the draft is complete, THE Admin_Client SHALL verify each player has exactly 2 team_assignments with source = "draft"
10. IF a player attempts to pick after the draft is complete, THEN the pick operation SHALL return an error containing "Draft is already complete"
11. WHEN the draft is complete, THE Admin_Client SHALL verify that exactly 20 castaways have been assigned via draft_picks and the remaining 10 castaways (out of 30 total) have no draft_picks or team_assignments with source = "draft"

### Requirement 5: Auto Draft Integration Tests

**User Story:** As a developer, I want integration tests that verify the auto draft respects player preferences and falls back to alphabetical order, so that I can confirm the full auto-draft pipeline works against the database.

#### Acceptance Criteria

1. WHEN the admin starts an auto draft for a league with 10 players and roster_size = 2, THE Admin_Client SHALL verify `drafts.status` = "complete" and 20 `draft_picks` rows exist with sequential pick_numbers 1-20 assigned to players in snake order (round 1: Player 1-10 by joined_at ascending, round 2: Player 10-1)
2. WHEN a player with draft preferences has their turn in the snake order, THE Test_Runner SHALL verify that player's pick is the highest-ranked castaway (lowest rank number) from their preference list that has not been drafted by a prior pick in the sequence
3. WHEN a player without draft preferences has their turn in the snake order, THE Test_Runner SHALL verify that player's pick is the castaway with the earliest alphabetical ID among castaways not yet drafted by any prior pick
4. THE Test_Runner SHALL verify every draft_pick has a corresponding team_assignment row with matching player_id, castaway_id, source = "draft", and points_from_episode = 1
5. THE Test_Runner SHALL verify all 20 assigned castaway_ids are unique (no duplicate assignments across all team_assignments created by the draft)
6. IF the admin attempts to start an auto draft when a draft with status = "complete" already exists for the league, THEN THE Admin_Client SHALL receive an error indicating the draft is already complete and no new draft_picks or team_assignments are created

### Requirement 6: Episode Scoring and Finalization Integration Tests

**User Story:** As a developer, I want integration tests that verify episode creation, event scoring, finalization (including player_id stamping and consolation points), and unfinalization, so that I can confirm the scoring pipeline works end-to-end.

#### Acceptance Criteria

1. WHEN the admin adds an episode event for an episode number that does not yet exist, THE Admin_Client SHALL verify the episode row is auto-created with is_finalized = false, and the episode_events row is inserted with the correct episode_id, castaway_id, scoring_rule_id, and points matching the scoring rule's configured point value
2. IF the admin attempts to add an event to a finalized episode, THEN the operation SHALL fail with an error containing "finalized episode"
3. WHEN an episode is finalized, THE Admin_Client SHALL verify each episode_event has its player_id set to the player who currently owns the castaway via team_assignments at the time of finalization
4. WHEN an episode is finalized and castaways exist whose eliminated_episode is less than the current episode number, THE Admin_Client SHALL verify consolation events are auto-inserted for each such castaway with points equal to the league's consolation_points value and scoring_rule_id = null
5. WHEN an episode is unfinalized, THE Admin_Client SHALL verify is_finalized = false, finalized_at = null, consolation events (scoring_rule_id IS NULL) for that episode are deleted, and manually-added events (scoring_rule_id IS NOT NULL) remain
6. WHEN at least 2 episodes are finalized after a castaway's eliminated_episode, THE Test_Runner SHALL verify that the eliminated castaway has one consolation event per post-elimination finalized episode, with total consolation points equal to the league's consolation_points value multiplied by the number of those episodes
7. WHEN the admin removes an event from an unfinalized episode, THE Admin_Client SHALL verify the event is deleted
8. IF the admin attempts to remove an event from a finalized episode, THEN the operation SHALL fail with an error containing "finalized episode"

### Requirement 7: Trade Integration Tests

**User Story:** As a developer, I want integration tests that verify the full trade lifecycle (propose, accept, reject, cancel) and confirm that points boundaries are respected after trades, so that I can confirm trades work correctly against the database.

#### Acceptance Criteria

1. WHEN a player proposes a trade, THE Admin_Client SHALL verify a `trades` row is created with status = "pending", correct proposer_id, receiver_id, proposer_castaway, and receiver_castaway
2. WHEN the receiver accepts a trade, THE Admin_Client SHALL verify trade status changes to "admin_approved", team_assignments are swapped with source = "trade", and points_from_episode is set to (latest finalized episode number + 1), defaulting to 1 if no episodes have been finalized
3. WHEN the receiver rejects a trade, THE Admin_Client SHALL verify trade status = "rejected" and resolved_at is set, with no team_assignment changes
4. WHEN the proposer cancels a trade, THE Admin_Client SHALL verify trade status = "rejected" and resolved_at is set, with no team_assignment changes
5. IF a player attempts to trade a castaway they do not own, THEN the operation SHALL return a validation error containing "You do not own the castaway you are offering"
6. IF a player attempts to trade an eliminated castaway, THEN the operation SHALL return a validation error containing "Eliminated castaways cannot be traded"
7. IF a player attempts to accept a non-pending trade, THEN the operation SHALL return an error containing "no longer pending"
8. WHEN a trade is accepted and a subsequent episode is finalized, THE Test_Runner SHALL verify that the original owner retains episode points earned before the trade (player_id stamped at finalization) and the new owner only earns points from episodes where episode number >= the trade's points_from_episode value
9. WHEN multiple pending trades reference the same castaway and the first is accepted, THE Test_Runner SHALL verify the second trade fails validation at acceptance time because the proposer no longer owns the castaway

### Requirement 8: Waiver Wire Integration Tests

**User Story:** As a developer, I want integration tests that verify waiver claim submission, validation, processing (bid resolution, budget deduction, team assignment updates), and edge cases, so that I can confirm the waiver wire works end-to-end.

#### Acceptance Criteria

1. THE Test_Runner SHALL verify the waiver pool contains only castaways that are not eliminated and not assigned to any player's team in the league
2. WHEN a player submits a valid waiver claim, THE Admin_Client SHALL verify a `waiver_claims` row is created with status = "pending", the submitted bid_amount, and priority equal to the player's next sequential priority number (1 for their first pending claim, 2 for their second, etc.)
3. IF a player submits a claim with bid_amount exceeding their waiver_budget_remaining, THEN the operation SHALL return a validation error containing "exceeds"
4. IF a player submits a claim for an eliminated castaway, THEN the operation SHALL return a validation error containing "Eliminated castaways"
5. IF a player submits a claim dropping a castaway they do not own, THEN the operation SHALL return a validation error containing "do not own"
6. WHEN waivers are processed with multiple claims for the same castaway, THE Admin_Client SHALL verify the highest bidder wins (with lowest priority number as tiebreak for equal bids), losers are marked "lost", the winner's team_assignment is updated (source = "waiver"), the winner's waiver_budget_remaining is reduced by the bid amount, and losing bidders' waiver_budget_remaining is unchanged
7. WHEN a player has two pending claims dropping the same castaway and the claim with the lower priority number wins, THE Admin_Client SHALL verify the other claim is marked "lost" because the drop castaway was already used
8. THE Test_Runner SHALL verify new team_assignments from waivers have points_from_episode = (latest finalized episode number + 1), or points_from_episode = 1 if no episodes have been finalized
9. WHEN a player submits a claim with bid_amount = 0, THE Admin_Client SHALL verify the claim is accepted and if won, budget_remaining is unchanged
10. IF a player submits a negative bid_amount, THEN the operation SHALL return a validation error containing "non-negative"
11. IF the admin processes waivers with no pending claims, THEN the operation SHALL return an error containing "No pending claims"

### Requirement 9: Challenge Integration Tests

**User Story:** As a developer, I want integration tests that verify challenge creation, submission, deadline enforcement, grading, and point attribution, so that I can confirm challenges work end-to-end.

#### Acceptance Criteria

1. WHEN the admin creates a challenge with a valid title (1–200 characters), points (integer >= 1), episode_id, and a deadline (valid ISO timestamp), THE Admin_Client SHALL verify a `challenges` row is created with the provided league_id, episode_id, title, points, and deadline values
2. IF the admin creates a challenge with an empty or whitespace-only title, THEN the operation SHALL return a validation error containing "title is required"
3. IF the admin creates a challenge with points <= 0, THEN the operation SHALL return a validation error containing "positive number"
4. IF the admin creates a challenge with no deadline or an invalid deadline value, THEN the operation SHALL return a validation error containing "Deadline is required"
5. WHEN a player submits a challenge response with a non-empty trimmed string, THE Admin_Client SHALL verify a `challenge_submissions` row is created with the player's player_id, the trimmed response text, and is_correct = null
6. IF a player submits a response after the deadline (submittedAt > deadline), THEN the operation SHALL return an error containing "deadline has passed"; a submission at exactly the deadline timestamp SHALL be accepted
7. IF a player submits a second response to the same challenge, THEN the operation SHALL return an error containing "already submitted a response"
8. WHEN the admin grades a submission as correct (is_correct = true), THE Admin_Client SHALL verify is_correct = true on the submission row and the player's leaderboard total increases by the challenge's points value
9. WHEN the admin grades a submission as incorrect (is_correct = false), THE Admin_Client SHALL verify is_correct = false on the submission row and the player's leaderboard total does NOT include that challenge's points value


### Requirement 7: Trade Integration Tests

**User Story:** As a developer, I want integration tests that verify the full trade lifecycle (propose, accept, reject, cancel) and confirm that points boundaries are respected after trades, so that I can confirm trades work correctly against the database.

#### Acceptance Criteria

1. WHEN a player proposes a trade, THE Admin_Client SHALL verify a `trades` row is created with status = "pending", correct proposer_id, receiver_id, proposer_castaway, and receiver_castaway
2. WHEN the receiver accepts a trade, THE Admin_Client SHALL verify trade status changes to "admin_approved", team_assignments are swapped with source = "trade", and points_from_episode is set to (latest finalized episode number + 1), defaulting to 1 if no episodes have been finalized
3. WHEN the receiver rejects a trade, THE Admin_Client SHALL verify trade status = "rejected" and resolved_at is set, with no team_assignment changes
4. WHEN the proposer cancels a trade, THE Admin_Client SHALL verify trade status = "rejected" and resolved_at is set, with no team_assignment changes
5. IF a player attempts to trade a castaway they do not own, THEN the operation SHALL return a validation error containing "You do not own the castaway you are offering"
6. IF a player attempts to trade an eliminated castaway, THEN the operation SHALL return a validation error containing "Eliminated castaways cannot be traded"
7. IF a player attempts to accept a non-pending trade, THEN the operation SHALL return an error containing "no longer pending"
8. WHEN a trade is accepted and a subsequent episode is finalized, THE Test_Runner SHALL verify that the original owner retains episode points earned before the trade (player_id stamped at finalization) and the new owner only earns points from episodes where episode number >= the trade's points_from_episode value
9. WHEN multiple pending trades reference the same castaway and the first is accepted, THE Test_Runner SHALL verify the second trade fails validation at acceptance time because the proposer no longer owns the castaway

### Requirement 8: Waiver Wire Integration Tests

**User Story:** As a developer, I want integration tests that verify waiver claim submission, validation, processing (bid resolution, budget deduction, team assignment updates), and edge cases, so that I can confirm the waiver wire works end-to-end.

#### Acceptance Criteria

1. THE Test_Runner SHALL verify the waiver pool contains only castaways that are not eliminated and not assigned to any player's team in the league
2. WHEN a player submits a valid waiver claim, THE Admin_Client SHALL verify a `waiver_claims` row is created with status = "pending", the submitted bid_amount, and priority equal to the player's next sequential priority number (1 for their first pending claim, 2 for their second, etc.)
3. IF a player submits a claim with bid_amount exceeding their waiver_budget_remaining, THEN the operation SHALL return a validation error containing "exceeds"
4. IF a player submits a claim for an eliminated castaway, THEN the operation SHALL return a validation error containing "Eliminated castaways"
5. IF a player submits a claim dropping a castaway they do not own, THEN the operation SHALL return a validation error containing "do not own"
6. WHEN waivers are processed with multiple claims for the same castaway, THE Admin_Client SHALL verify the highest bidder wins (with lowest priority number as tiebreak for equal bids), losers are marked "lost", the winner's team_assignment is updated (source = "waiver"), the winner's waiver_budget_remaining is reduced by the bid amount, and losing bidders' waiver_budget_remaining is unchanged
7. WHEN a player has two pending claims dropping the same castaway and the claim with the lower priority number wins, THE Admin_Client SHALL verify the other claim is marked "lost" because the drop castaway was already used
8. THE Test_Runner SHALL verify new team_assignments from waivers have points_from_episode = (latest finalized episode number + 1), or points_from_episode = 1 if no episodes have been finalized
9. WHEN a player submits a claim with bid_amount = 0, THE Admin_Client SHALL verify the claim is accepted and if won, budget_remaining is unchanged
10. IF a player submits a negative bid_amount, THEN the operation SHALL return a validation error containing "non-negative"
11. IF the admin processes waivers with no pending claims, THEN the operation SHALL return an error containing "No pending claims"

### Requirement 9: Challenge Integration Tests

**User Story:** As a developer, I want integration tests that verify challenge creation, submission, deadline enforcement, grading, and point attribution, so that I can confirm challenges work end-to-end.

#### Acceptance Criteria

1. WHEN the admin creates a challenge with a valid title (1-200 characters), points (integer >= 1), episode_id, and a deadline (valid ISO timestamp), THE Admin_Client SHALL verify a `challenges` row is created with the provided league_id, episode_id, title, points, and deadline values
2. IF the admin creates a challenge with an empty or whitespace-only title, THEN the operation SHALL return a validation error containing "title is required"
3. IF the admin creates a challenge with points <= 0, THEN the operation SHALL return a validation error containing "positive number"
4. IF the admin creates a challenge with no deadline or an invalid deadline value, THEN the operation SHALL return a validation error containing "Deadline is required" or "Invalid deadline date"
5. WHEN a player submits a challenge response with a non-empty trimmed string, THE Admin_Client SHALL verify a `challenge_submissions` row is created with the player's player_id, the trimmed response text, and is_correct = null
6. IF a player submits a response after the deadline (submittedAt > deadline), THEN the operation SHALL return an error containing "deadline has passed"; a submission at exactly the deadline timestamp SHALL be accepted
7. IF a player submits a second response to the same challenge, THEN the operation SHALL return an error containing "already submitted a response"
8. IF a player submits a challenge response with an empty or whitespace-only response field, THEN the operation SHALL return a validation error indicating that a response is required
9. WHEN the admin grades a submission as correct (is_correct = true), THE Admin_Client SHALL verify is_correct = true on the submission row and the player's leaderboard total increases by the challenge's points value
10. WHEN the admin grades a submission as incorrect (is_correct = false), THE Admin_Client SHALL verify is_correct = false on the submission row and the player's leaderboard total does NOT include that challenge's points value

### Requirement 10: Leaderboard and Points Integrity Tests

**User Story:** As a developer, I want integration tests that verify the leaderboard correctly aggregates episode points, consolation points, and challenge points while respecting trade/waiver boundaries across multiple weeks of a season, so that I can confirm scoring integrity as rosters change over time.

#### Acceptance Criteria

1. THE Test_Runner SHALL verify each player's total score equals the sum of: episode_event points attributed to them (where episode_event.player_id matches the player), consolation points for eliminated castaways currently on their team (active team_assignment exists), and challenge points for submissions where is_correct equals true
2. THE Test_Runner SHALL verify a multi-week trade scenario using at least 2 players and 3 finalized episodes: Player A owns Castaway-X from episode 1 with points_from_episode=1, earns episode points in episodes 1 and 2, trades Castaway-X to Player B before episode 3 (Player B receives team_assignment with points_from_episode=3), then Player A retains episodes 1–2 points for Castaway-X and Player B earns Castaway-X points only from episode 3 onward
3. THE Test_Runner SHALL verify a multi-week waiver scenario using at least 2 players and 3 finalized episodes: Player C owns Castaway-Y from episode 1 with points_from_episode=1, earns episode points in episodes 1 and 2, drops Castaway-Y (team_assignment removed), Player D picks up Castaway-Y via waiver (new team_assignment with source="waiver" and points_from_episode=3), then Player C retains episodes 1–2 points via player_id attribution and Player D earns Castaway-Y points only from episode 3 onward
4. THE Test_Runner SHALL verify that a player who trades away one castaway and picks up another via waiver has a total that equals: historical points from the traded-away castaway (episodes before trade cutoff, retained via player_id attribution) plus points from the new castaway (episodes >= waiver's points_from_episode) plus points from any castaways they kept the entire season (points_from_episode=1)
5. THE Test_Runner SHALL verify consolation points are only earned for eliminated castaways where the player holds an active team_assignment, and that if a player trades away an eliminated castaway (team_assignment removed from original owner, created for new owner), the original owner stops earning consolation and the new owner earns consolation only for finalized episodes >= their points_from_episode that are after the castaway's eliminated_episode
6. WHEN two players have identical total scores, THE Test_Runner SHALL verify both receive the same rank using standard competition ranking (e.g., scores [100, 100, 80] produce ranks [1, 1, 3] — the rank after a tie is 1 + count of tied players, not the next sequential integer)
7. THE Test_Runner SHALL verify that for any castaway involved in a trade or waiver, the sum of points earned by the original owner (pre-transfer episodes) plus points earned by the new owner (post-transfer episodes) equals the castaway's total episode_event points across all finalized episodes, confirming no points are duplicated or lost
8. THE Test_Runner SHALL verify the leaderboard is correct after at least 3 finalized episodes with at least 1 trade and 1 waiver occurring between episodes, confirming that each player's cumulative total (episode points + consolation points + challenge points) matches their leaderboard entry and that rank ordering is descending by total

### Requirement 11: Admin Tools Integration Tests

**User Story:** As a developer, I want integration tests that verify admin CRUD operations (castaways, scoring rules, draft config, waiver schedule, late-join assignments), so that I can confirm admin tools work correctly against the database.

#### Acceptance Criteria

1. WHEN the admin adds a castaway, THE Admin_Client SHALL verify the castaway row is created with correct league_id, name, and tribe
2. WHEN the admin eliminates a castaway at a specific episode number, THE Admin_Client SHALL verify is_eliminated = true and eliminated_episode equals the specified episode number
3. WHEN the admin restores a castaway, THE Admin_Client SHALL verify is_eliminated = false and eliminated_episode = null
4. WHEN the admin creates a scoring rule, THE Admin_Client SHALL verify the rule row is created with correct name and points
5. WHEN the admin updates a scoring rule's name and points, THE Admin_Client SHALL verify the rule row reflects the new name and points values
6. WHEN the admin deletes a scoring rule that is referenced by episode_events, THE Admin_Client SHALL verify the rule is deleted and any episode_events referencing it have scoring_rule_id set to null (ON DELETE SET NULL)
7. WHEN the admin configures draft settings, THE Admin_Client SHALL verify the league row is updated with the new draft_mode and pick_timer_seconds
8. WHEN the admin updates the waiver schedule, THE Admin_Client SHALL verify the league row is updated with new waiver_process_day, waiver_process_hour, and waiver_process_minute
9. WHEN the admin assigns a castaway to a player via late-join, THE Admin_Client SHALL verify a team_assignment is created with source = "admin_assign" and points_from_episode = (latest finalized episode + 1), or points_from_episode = 1 if no episodes have been finalized
10. IF the admin attempts to assign an already-owned castaway via late-join, THEN the operation SHALL return an error indicating the castaway is already on a team
11. IF the admin attempts to assign an eliminated castaway via late-join, THEN the operation SHALL return an error indicating eliminated castaways cannot be assigned
12. IF the admin attempts to assign a castaway to a player who has already reached roster_size, THEN the operation SHALL return an error indicating the roster size limit has been reached

### Requirement 12: RLS Policy Enforcement Tests

**User Story:** As a developer, I want integration tests that verify Row Level Security policies are correctly enforced, so that I can confirm data isolation, admin-only writes, and visibility rules work as designed.

#### Acceptance Criteria

1. WHEN a Scoped_Client for a non-member queries castaways for the Test_League, THE Scoped_Client SHALL receive zero rows (the query returns an empty array with no error)
2. WHEN a Scoped_Client for a non-admin member attempts to insert a castaway, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
3. WHEN a Scoped_Client for a non-admin member attempts to insert or update scoring_rules, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
4. WHEN a Scoped_Client for a non-admin member attempts to insert or update episodes, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
5. WHEN a Scoped_Client for a non-admin member attempts to insert or update episode_events, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
6. WHEN a Scoped_Client for Player 2 queries trades, THE Scoped_Client SHALL only see trades where Player 2 is the proposer or receiver, and SHALL NOT see trades between other players
7. WHEN a Scoped_Client for the admin queries trades, THE Scoped_Client SHALL see all trades in the Test_League regardless of whether the admin is a proposer or receiver
8. WHEN a Scoped_Client for a player queries challenge_submissions, THE Scoped_Client SHALL only see submissions where player_id matches their own ID, and SHALL NOT see other players' submissions
9. WHEN a Scoped_Client for the admin queries challenge_submissions, THE Scoped_Client SHALL see all submissions for challenges in their league
10. WHEN a Scoped_Client for a non-admin member attempts to directly insert or delete team_assignments, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
11. WHEN a Scoped_Client for a player inserts a draft_pick with player_id = their own ID and the draft status is "active", THE Scoped_Client SHALL succeed; IF the draft status is not "active" or player_id does not match their own ID, THEN THE Scoped_Client SHALL receive a row-level security violation error
12. WHEN a Scoped_Client for a non-admin member attempts to insert a trade where proposer_id does not match their own ID, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation


### Requirement 10: Leaderboard and Points Integrity Tests

**User Story:** As a developer, I want integration tests that verify the leaderboard correctly aggregates episode points, consolation points, and challenge points while respecting trade/waiver boundaries across multiple weeks of a season, so that I can confirm scoring integrity as rosters change over time.

#### Acceptance Criteria

1. THE Test_Runner SHALL verify each player's total score equals the sum of: episode_event points attributed to them (where episode_event.player_id matches the player), consolation points for eliminated castaways currently on their team (active team_assignment exists), and challenge points for submissions where is_correct equals true
2. THE Test_Runner SHALL verify a multi-week trade scenario using at least 2 players and 3 finalized episodes: Player A owns Castaway-X from episode 1 with points_from_episode=1, earns episode points in episodes 1 and 2, trades Castaway-X to Player B before episode 3 (Player B receives team_assignment with points_from_episode=3), then Player A retains episodes 1-2 points for Castaway-X and Player B earns Castaway-X points only from episode 3 onward
3. THE Test_Runner SHALL verify a multi-week waiver scenario using at least 2 players and 3 finalized episodes: Player C owns Castaway-Y from episode 1 with points_from_episode=1, earns episode points in episodes 1 and 2, drops Castaway-Y (team_assignment removed), Player D picks up Castaway-Y via waiver (new team_assignment with source="waiver" and points_from_episode=3), then Player C retains episodes 1-2 points via player_id attribution and Player D earns Castaway-Y points only from episode 3 onward
4. THE Test_Runner SHALL verify that a player who trades away one castaway and picks up another via waiver has a total that equals: historical points from the traded-away castaway (episodes before trade cutoff, retained via player_id attribution) plus points from the new castaway (episodes >= waiver's points_from_episode) plus points from any castaways they kept the entire season (points_from_episode=1)
5. THE Test_Runner SHALL verify consolation points are only earned for eliminated castaways where the player holds an active team_assignment, and that if a player trades away an eliminated castaway (team_assignment removed from original owner, created for new owner), the original owner stops earning consolation and the new owner earns consolation only for finalized episodes >= their points_from_episode that are after the castaway's eliminated_episode
6. WHEN two players have identical total scores, THE Test_Runner SHALL verify both receive the same rank using standard competition ranking (e.g., scores [100, 100, 80] produce ranks [1, 1, 3] — the rank after a tie is 1 + count of tied players, not the next sequential integer)
7. THE Test_Runner SHALL verify that for any castaway involved in a trade or waiver, the sum of points earned by the original owner (pre-transfer episodes) plus points earned by the new owner (post-transfer episodes) equals the castaway's total episode_event points across all finalized episodes, confirming no points are duplicated or lost
8. THE Test_Runner SHALL verify the leaderboard is correct after at least 3 finalized episodes with at least 1 trade and 1 waiver occurring between episodes, confirming that each player's cumulative total (episode points + consolation points + challenge points) matches their leaderboard entry and that rank ordering is descending by total

### Requirement 11: Admin Tools Integration Tests

**User Story:** As a developer, I want integration tests that verify admin CRUD operations (castaways, scoring rules, draft config, waiver schedule, late-join assignments), so that I can confirm admin tools work correctly against the database.

#### Acceptance Criteria

1. WHEN the admin adds a castaway, THE Admin_Client SHALL verify the castaway row is created with correct league_id, name, and tribe
2. WHEN the admin eliminates a castaway at a specific episode number, THE Admin_Client SHALL verify is_eliminated = true and eliminated_episode equals the specified episode number
3. WHEN the admin restores a castaway, THE Admin_Client SHALL verify is_eliminated = false and eliminated_episode = null
4. IF the admin attempts to add a castaway with an empty or whitespace-only name, THEN the operation SHALL return a validation error containing "name is required"
5. WHEN the admin creates a scoring rule, THE Admin_Client SHALL verify the rule row is created with correct name and points
6. WHEN the admin updates a scoring rule's name and points, THE Admin_Client SHALL verify the rule row reflects the new values
7. WHEN the admin deletes a scoring rule that is referenced by episode_events, THE Admin_Client SHALL verify the rule is deleted and any episode_events referencing it have scoring_rule_id set to null (ON DELETE SET NULL behavior)
8. WHEN the admin configures draft settings, THE Admin_Client SHALL verify the league row is updated with the new draft_mode and pick_timer_seconds
9. WHEN the admin updates the waiver schedule, THE Admin_Client SHALL verify the league row is updated with new waiver_process_day, waiver_process_hour, and waiver_process_minute
10. WHEN the admin assigns a castaway to a player via late-join and at least one episode has been finalized, THE Admin_Client SHALL verify a team_assignment is created with source = "admin_assign" and points_from_episode = (latest finalized episode number + 1)
11. WHEN the admin assigns a castaway to a player via late-join and no episodes have been finalized, THE Admin_Client SHALL verify points_from_episode = 1
12. IF the admin attempts to assign an already-owned castaway, THEN the operation SHALL return an error indicating the castaway is already on a team
13. IF the admin attempts to assign an eliminated castaway, THEN the operation SHALL return an error indicating eliminated castaways cannot be assigned
14. IF the admin attempts to assign a castaway to a player who already has roster_size castaways, THEN the operation SHALL return an error indicating the roster size limit has been reached

### Requirement 12: RLS Policy Enforcement Tests

**User Story:** As a developer, I want integration tests that verify Row Level Security policies are correctly enforced, so that I can confirm data isolation, admin-only writes, and visibility rules work as designed.

#### Acceptance Criteria

1. WHEN a Scoped_Client for a non-member queries castaways for the Test_League, THE Scoped_Client SHALL receive zero rows (the query returns an empty array with no error)
2. WHEN a Scoped_Client for a non-admin member attempts to insert a castaway, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
3. WHEN a Scoped_Client for a non-admin member attempts to insert or update scoring_rules, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
4. WHEN a Scoped_Client for a non-admin member attempts to insert or update episodes, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
5. WHEN a Scoped_Client for a non-admin member attempts to insert or update episode_events, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
6. WHEN a Scoped_Client for Player 2 queries trades, THE Scoped_Client SHALL only see trades where Player 2 is the proposer or receiver, and SHALL NOT see trades between other players
7. WHEN a Scoped_Client for the admin queries trades, THE Scoped_Client SHALL see all trades in the Test_League regardless of whether the admin is a proposer or receiver
8. WHEN a Scoped_Client for a player queries challenge_submissions, THE Scoped_Client SHALL only see submissions where player_id matches their own ID, and SHALL NOT see other players' submissions
9. WHEN a Scoped_Client for the admin queries challenge_submissions, THE Scoped_Client SHALL see all submissions for challenges in their league
10. WHEN a Scoped_Client for a non-admin member attempts to directly insert or delete team_assignments, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation
11. WHEN a Scoped_Client for a player inserts a draft_pick with player_id = their own ID and the draft status is "active", THE Scoped_Client SHALL succeed; IF the draft status is not "active" or player_id does not match their own ID, THEN THE Scoped_Client SHALL receive a row-level security violation error
12. WHEN a Scoped_Client for a non-admin member attempts to insert a trade where proposer_id does not match their own ID, THE Scoped_Client SHALL receive a response where `error` is non-null and `data` is null, indicating a row-level security violation

### Requirement 13: Edge Case and Error Handling Tests

**User Story:** As a developer, I want integration tests that cover edge cases and error conditions (insufficient castaways, concurrent trades, race conditions, zero-event episodes), so that I can confirm the system handles boundary conditions gracefully.

#### Acceptance Criteria

1. WHEN a draft has fewer available castaways than total picks needed (e.g., 15 castaways for 10 players x 2 roster = 20 picks), THE Test_Runner SHALL verify the draft stops after all 15 castaways are assigned and is marked complete with current_pick_index = 15
2. WHEN a castaway is eliminated between trade proposal and acceptance, THE Test_Runner SHALL verify the acceptance fails with a validation error containing "Eliminated castaways cannot be traded"
3. WHEN 5 players all claim the same unowned castaway with different bids, THE Test_Runner SHALL verify only the highest bidder wins, all others are marked "lost", and budget is only deducted from the winner
4. WHEN a player submits a waiver claim with bid_amount = 0 and wins, THE Test_Runner SHALL verify budget_remaining is unchanged (still equals the value before the claim)
5. WHEN an episode is finalized with zero manually-added events but eliminated castaways exist, THE Test_Runner SHALL verify only consolation events are generated and the episode is finalized successfully with is_finalized = true
6. WHEN multiple pending trades reference the same castaway and the first is accepted (team_assignment transferred), THE Test_Runner SHALL verify the second trade fails at acceptance time because the proposer no longer owns the castaway
7. WHEN the admin processes waivers with no pending claims, THE Test_Runner SHALL verify an error is returned containing "No pending claims"

### Requirement 14: Full Season Smoke Test

**User Story:** As a developer, I want a single end-to-end smoke test that simulates a complete mini-season (draft → episodes → trades → waivers → challenges → leaderboard) spanning at least 3 episodes with roster changes between them, so that I can verify all subsystems integrate correctly in sequence and points accumulate correctly week over week.

#### Acceptance Criteria

1. THE Test_Runner SHALL execute the following steps in sequence: cleanup, setup (10 players, 30 castaways, roster_size = 2, consolation_points = 2), live draft (20 picks), episode 1 scoring (at least 4 events across at least 3 castaways with known point values) with one challenge (worth 5 points, at least 2 players submit, at least 1 graded correct), trade between two players (Player A gives Castaway-X to Player B with points_from_episode set to 2), episode 2 scoring (including at least 1 event for traded Castaway-X now owned by Player B), eliminate 2 castaways after episode 2 finalization, waiver processing (Player C drops Castaway-Y, Player D picks up Castaway-Z with points_from_episode set to 3), episode 3 scoring with at least 1 event for an active castaway, challenge grading, and final leaderboard verification
2. WHEN the smoke test completes, THE Test_Runner SHALL verify Player A's cumulative total includes Castaway-X's episode 1 points but NOT episode 2–3 points, and Player B's cumulative total includes Castaway-X's episode 2–3 points but NOT episode 1 points
3. WHEN the smoke test completes, THE Test_Runner SHALL verify Player C retains points from Castaway-Y for episodes 1–2 (before the waiver drop), and Player D earns Castaway-Z points only from episode 3 onward (points_from_episode = 3)
4. WHEN the smoke test completes, THE Test_Runner SHALL verify all 10 players have cumulative totals equal to the sum of: episode points (sum of episode_events where player_id matches, attributed at finalization time), consolation points (2 points per finalized episode after elimination for each eliminated castaway still on the player's team), challenge points (sum of points for submissions where is_correct = true), with no double-counting across trade or waiver boundaries
5. IF any step in the smoke test sequence fails, THEN THE Test_Runner SHALL halt execution and report which step failed, the assertion that was violated, and the actual versus expected values
6. THE Test_Runner SHALL complete the full smoke test within 60 seconds (performance guard against runaway queries)

### Requirement 15: Bug Discovery and Tracking Protocol

**User Story:** As a developer, I want integration tests to clearly mark discovered bugs rather than working around them, so that failing tests serve as documentation of issues that need fixing.

#### Acceptance Criteria

1. WHEN an integration test discovers behavior that contradicts the expected requirement, THE Test_Runner SHALL mark the test with a `// BUG:` comment describing the expected vs actual behavior
2. WHEN a test documents a bug where the test can be written and the assertion fails against current behavior, THE Test_Runner SHALL use Vitest's `it.fails()` annotation so the test suite remains green while the bug is tracked
3. WHEN a test documents a bug where the test cannot yet be fully implemented, THE Test_Runner SHALL use Vitest's `it.todo()` annotation as a placeholder
4. THE Test_Runner SHALL NOT modify test assertions to match buggy behavior — tests SHALL assert the correct expected behavior as defined by the corresponding requirement
5. WHEN a bug is discovered, THE Test_Runner SHALL include in the test name a prefix of "BUG:" followed by a summary and the violated requirement ID (e.g., "BUG: Trade acceptance should fail for eliminated castaways — Req 7.6")
6. THE Test_Runner SHALL maintain a `KNOWN_BUGS.md` file at `src/test/integration/KNOWN_BUGS.md` listing all discovered bugs with the following fields per entry: test file path, test name, expected behavior, actual behavior, and affected requirement ID
7. WHEN a bug documented via `it.fails()` is fixed and the test begins passing, THE Test_Runner SHALL convert the test to a standard `it()` call and remove the corresponding entry from `KNOWN_BUGS.md`

### Requirement 16: Server Action Testing Strategy

**User Story:** As a developer, I want a clear strategy for testing server actions that use Next.js `redirect` and `revalidatePath`, so that integration tests can exercise the business logic without requiring a running Next.js server.

#### Acceptance Criteria

1. THE Test_Runner SHALL test server action logic by executing the same sequence of Supabase queries, lib-layer validation calls, and mutations that the server action performs, rather than invoking the server action function directly
2. THE Test_Runner SHALL replicate the query + validation + mutation pattern from server actions using the Admin_Client or Scoped_Client and SHALL verify the expected database state change (inserted, updated, or deleted rows) after each mutation step
3. WHEN a server action's behavior depends on the authenticated user, THE Test_Runner SHALL use a Scoped_Client authenticated as the Test_User whose role matches the action's expected caller (e.g., the trade receiver for accept-trade, the league admin for approve-trade)
4. THE Test_Runner SHALL document in a test file comment above each test block the server action function name and its source file path (e.g., `// Tests: acceptTradeAction from src/app/dashboard/trade-actions.ts`)
5. IF a server action would reject the operation and redirect with an error (e.g., invalid ownership, non-pending status), THEN THE Test_Runner SHALL verify that the equivalent query or validation check returns the rejection condition and that no database mutation has occurred
6. WHEN a server action relies on RLS to restrict access, THE Test_Runner SHALL execute the equivalent query using a Scoped_Client authenticated as an unauthorized Test_User and SHALL verify that the operation returns no data or is rejected by the database


### Requirement 13: Edge Case and Error Handling Tests

**User Story:** As a developer, I want integration tests that cover edge cases and error conditions (insufficient castaways, concurrent trades, race conditions, zero-event episodes), so that I can confirm the system handles boundary conditions gracefully.

#### Acceptance Criteria

1. WHEN a draft has fewer available castaways than total picks needed (e.g., 15 castaways for 10 players x 2 roster = 20 picks), THE Test_Runner SHALL verify the draft stops after all 15 castaways are assigned and is marked complete with current_pick_index = 15
2. WHEN a castaway is eliminated between trade proposal and acceptance, THE Test_Runner SHALL verify the acceptance fails with a validation error containing "Eliminated castaways cannot be traded"
3. WHEN 5 players all claim the same unowned castaway with different bids, THE Test_Runner SHALL verify only the highest bidder wins, all others are marked "lost", and budget is only deducted from the winner
4. WHEN a player submits a waiver claim with bid_amount = 0 and wins, THE Test_Runner SHALL verify budget_remaining is unchanged (still equals the value before the claim)
5. WHEN an episode is finalized with zero manually-added events but eliminated castaways exist, THE Test_Runner SHALL verify only consolation events are generated and the episode is finalized successfully with is_finalized = true
6. WHEN multiple pending trades reference the same castaway and the first is accepted (team_assignment transferred), THE Test_Runner SHALL verify the second trade fails at acceptance time because the proposer no longer owns the castaway
7. WHEN the admin processes waivers with no pending claims, THE Test_Runner SHALL verify an error is returned containing "No pending claims"

### Requirement 14: Full Season Smoke Test

**User Story:** As a developer, I want a single end-to-end smoke test that simulates a complete mini-season (draft -> episodes -> trades -> waivers -> challenges -> leaderboard) spanning at least 3 episodes with roster changes between them, so that I can verify all subsystems integrate correctly in sequence and points accumulate correctly week over week.

#### Acceptance Criteria

1. THE Test_Runner SHALL execute the following steps in sequence: cleanup, setup (10 players, 30 castaways, roster_size = 2, consolation_points = 2), live draft (20 picks), episode 1 scoring (at least 4 events across at least 3 castaways with known point values) with one challenge (worth 5 points, at least 2 players submit, at least 1 graded correct), trade between two players (Player A gives Castaway-X to Player B with points_from_episode set to 2), episode 2 scoring (including at least 1 event for traded Castaway-X now owned by Player B), eliminate 2 castaways after episode 2 finalization, waiver processing (Player C drops Castaway-Y, Player D picks up Castaway-Z with points_from_episode set to 3), episode 3 scoring with at least 1 event for an active castaway, challenge grading, and final leaderboard verification
2. WHEN the smoke test completes, THE Test_Runner SHALL verify Player A's cumulative total includes Castaway-X's episode 1 points but NOT episode 2-3 points, and Player B's cumulative total includes Castaway-X's episode 2-3 points but NOT episode 1 points
3. WHEN the smoke test completes, THE Test_Runner SHALL verify Player C retains points from Castaway-Y for episodes 1-2 (before the waiver drop), and Player D earns Castaway-Z points only from episode 3 onward (points_from_episode = 3)
4. WHEN the smoke test completes, THE Test_Runner SHALL verify all 10 players have cumulative totals equal to the sum of: episode points (sum of episode_events where player_id matches, attributed at finalization time), consolation points (2 points per finalized episode after elimination for each eliminated castaway still on the player's team), challenge points (sum of points for submissions where is_correct = true), with no double-counting across trade or waiver boundaries
5. IF any step in the smoke test sequence fails, THEN THE Test_Runner SHALL halt execution and report which step failed, the assertion that was violated, and the actual versus expected values
6. THE Test_Runner SHALL complete the full smoke test within 60 seconds (performance guard against runaway queries)

### Requirement 15: Castaway Image Upload Integration Tests

**User Story:** As a developer, I want integration tests that verify castaway photo uploads via Supabase Storage, so that admins can upload images when adding castaways and the photo_url is correctly stored and accessible.

#### Acceptance Criteria

1. WHEN the admin uploads a valid image file (JPEG, PNG, or WebP, under 5MB) for a new castaway, THE Admin_Client SHALL verify the file is stored in the Supabase Storage bucket named "photos" under the path `castaways/{timestamp}-{random}.{ext}`
2. WHEN the upload succeeds, THE Admin_Client SHALL verify the castaway row's photo_url is set to the public URL of the uploaded file
3. THE Test_Runner SHALL verify the uploaded image's public URL is accessible (returns HTTP 200)
4. THE Test_Runner SHALL clean up any uploaded test images from the Storage bucket after the test completes

### Requirement 16: Bug Discovery and Tracking Protocol

**User Story:** As a developer, I want integration tests to clearly mark discovered bugs rather than working around them, so that failing tests serve as documentation of issues that need fixing.

#### Acceptance Criteria

1. WHEN an integration test discovers behavior that contradicts the expected requirement, THE Test_Runner SHALL mark the test with a `// BUG:` comment describing the expected vs actual behavior
2. WHEN a test documents a bug where the test can be written and the assertion fails against current behavior, THE Test_Runner SHALL use Vitest's `it.fails()` annotation so the test suite remains green while the bug is tracked
3. WHEN a test documents a bug where the test cannot yet be fully implemented (e.g., missing infrastructure or unclear reproduction), THE Test_Runner SHALL use Vitest's `it.todo()` annotation as a placeholder
4. THE Test_Runner SHALL NOT modify test assertions to match buggy behavior — tests SHALL assert the correct expected behavior as defined by the corresponding requirement
5. WHEN a bug is discovered, THE Test_Runner SHALL include in the test name a prefix of "BUG:" followed by a summary and the violated requirement ID (e.g., "BUG: Trade acceptance should fail for eliminated castaways - Req 7.6")
6. THE Test_Runner SHALL maintain a `KNOWN_BUGS.md` file at `src/test/integration/KNOWN_BUGS.md` listing all discovered bugs with the following fields per entry: test file path, test name, expected behavior, actual behavior, and affected requirement ID
7. WHEN a bug documented via `it.fails()` is fixed and the test begins passing, THE Test_Runner SHALL convert the test to a standard `it()` call and remove the corresponding entry from `KNOWN_BUGS.md`

### Requirement 17: Server Action Testing Strategy

**User Story:** As a developer, I want a clear strategy for testing server actions that use Next.js `redirect` and `revalidatePath`, so that integration tests can exercise the business logic without requiring a running Next.js server.

#### Acceptance Criteria

1. THE Test_Runner SHALL test server action logic by executing the same sequence of Supabase queries, lib-layer validation calls, and mutations that the server action performs, rather than invoking the server action function directly
2. THE Test_Runner SHALL replicate the query + validation + mutation pattern from server actions using the Admin_Client or Scoped_Client and SHALL verify the expected database state change (inserted, updated, or deleted rows) after each mutation step
3. WHEN a server action's behavior depends on the authenticated user, THE Test_Runner SHALL use a Scoped_Client authenticated as the Test_User whose role matches the action's expected caller (e.g., the trade receiver for accept-trade, the league admin for approve-trade)
4. THE Test_Runner SHALL document in a test file comment above each test block the server action function name and its source file path (e.g., `// Tests: acceptTradeAction from src/app/dashboard/trade-actions.ts`)
5. IF a server action would reject the operation and redirect with an error (e.g., invalid ownership, non-pending status), THEN THE Test_Runner SHALL verify that the equivalent query or validation check returns the rejection condition and that no database mutation has occurred
6. WHEN a server action relies on RLS to restrict access, THE Test_Runner SHALL execute the equivalent query using a Scoped_Client authenticated as an unauthorized Test_User and SHALL verify that the operation returns no data or is rejected by the database