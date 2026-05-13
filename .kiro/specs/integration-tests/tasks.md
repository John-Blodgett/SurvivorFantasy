# Implementation Plan: Integration Test Suite

## Overview

This plan implements a comprehensive integration test suite for the Fantasy Survivor application. The suite exercises Supabase queries, RLS policies, server action logic, and full data flows against a live Supabase database. Tests use a dedicated Vitest configuration (`vitest.integration.config.ts`) with a `node` environment and 30s timeout, targeting a test league (season 99) to avoid polluting production data.

All code is TypeScript. Tests replicate server action patterns (query → validate → mutate) using Supabase clients directly rather than invoking Next.js server action functions.

## Tasks

- [x] 1. Set up test infrastructure and configuration
  - [x] 1.1 Create `vitest.integration.config.ts` at project root
    - Define Vitest config with `environment: "node"`, `globals: true`
    - Set `include: ["src/test/integration/**/*.test.ts"]`
    - Set `testTimeout: 30000`
    - Configure `resolve.alias` for `@` → `./src`
    - Do NOT include a setupFiles entry (avoids jsdom matchers)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.8_

  - [x] 1.2 Update existing `vitest.config.ts` to exclude integration tests
    - Add `exclude: ["src/test/integration/**"]` to the test config
    - Verify unit tests still run correctly via `npm run test`
    - _Requirements: 1.6_

  - [x] 1.3 Add `test:integration` script to `package.json`
    - Add `"test:integration": "vitest --run --config vitest.integration.config.ts"` to scripts
    - _Requirements: 1.5_

  - [x] 1.4 Create directory structure `src/test/integration/helpers/`
    - Create the directory and placeholder files for the helper modules
    - _Requirements: 1.1_

- [x] 2. Implement helper modules
  - [x] 2.1 Create `src/test/integration/helpers/constants.ts`
    - Export `TEST_LEAGUE` config object (name, season_number, roster_size, consolation_points, waiver_budget, draft_mode, pick_timer_seconds)
    - Export `TEST_PLAYERS` array (10 players with email, password, display_name, is_admin flag)
    - Export `TEST_CASTAWAYS` array (30 castaways with name and tribe assignments: Alpha/Beta/Gamma)
    - Export environment variable validation helper
    - _Requirements: 2.5, 3.4_

  - [x] 2.2 Create `src/test/integration/helpers/supabase.ts`
    - Implement `getAdminClient()` using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env
    - Implement `getScopedClient(email, password)` using anon key + `auth.signInWithPassword`
    - Implement `createTestUser(email, password)` returning UUID
    - Implement `getTestUser(email)` returning user object or null
    - Implement `deleteTestUser(id)` for cleanup
    - Add env var validation that throws descriptive errors if vars are missing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 Create `src/test/integration/helpers/lifecycle.ts`
    - Implement `cleanup()` that deletes test league data in FK-safe order (challenge_submissions → challenges → waiver_claims → episode_events → episodes → trades → team_assignments → draft_picks → draft_preferences → drafts → scoring_rules → castaways → league_members → leagues)
    - Scope all deletions to league with name = "Integ Test League" AND season_number = 99
    - Handle case where league doesn't exist (no-op)
    - Implement `seed()` that creates the test league, 10 members, 30 castaways, and scoring rules via `seed_default_scoring_rules` RPC
    - Implement `getLeagueId()`, `getPlayerIds()`, `getCastawayIds()` helpers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.4 Create `src/test/integration/helpers/actions.ts`
    - Implement draft action helpers: `startLiveDraft`, `makeDraftPick`, `startAutoDraft`
    - Implement episode action helpers: `addEpisodeEvent`, `finalizeEpisode`, `unfinalizeEpisode`, `removeEpisodeEvent`, `eliminateCastaway`
    - Implement trade action helpers: `proposeTrade`, `acceptTrade`, `rejectTrade`, `cancelTrade`
    - Implement waiver action helpers: `submitWaiverClaim`, `processWaivers`
    - Implement challenge action helpers: `createChallenge`, `submitChallengeResponse`, `gradeSubmission`
    - Each helper replicates the server action's query → validate → mutate pattern
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [x] 3. Checkpoint - Verify infrastructure
  - Ensure `npm run test:integration` runs without errors (no test files yet, but config loads)
  - Ensure `npm run test` still runs unit tests and excludes integration directory
  - Ask the user if questions arise.

- [x] 4. Implement draft test suites
  - [x] 4.1 Create `src/test/integration/draft.test.ts` — Live draft tests
    - Test draft start creates correct `drafts` row (status = "active", current_pick_index = 0)
    - Test snake order: Round 1 ascending, Round 2 descending, 20 total picks
    - Test each pick creates `draft_picks` and `team_assignments` rows correctly
    - Test `current_pick_index` advances and `pick_started_at` resets on each pick
    - Test wrong player cannot pick (error: "It is not your turn to pick")
    - Test already-drafted castaway rejected (error: "This castaway has already been picked")
    - Test draft completion (status = "complete", completed_at set, pick_started_at null)
    - Test each player has exactly 2 team_assignments with source = "draft"
    - Test cannot pick after draft complete (error: "Draft is already complete")
    - Test 20 castaways assigned, 10 remain unassigned
    - Document server action references in comments
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ]* 4.2 Write property test for snake order correctness
    - **Property 1: Snake Order Correctness**
    - Generate random N (1-20 players) and R (1-5 roster_size), verify snake order length = N×R, odd rounds ascending, even rounds descending
    - **Validates: Requirements 4.2, 5.1**

  - [x] 4.3 Create auto draft tests within `src/test/integration/draft.test.ts`
    - Test auto draft runs to completion (20 picks, status = "complete")
    - Test preferences respected (highest-ranked available castaway picked)
    - Test fallback to alphabetical for players without preferences
    - Test every draft_pick has matching team_assignment (source = "draft", points_from_episode = 1)
    - Test all 20 assigned castaway_ids are unique
    - Test cannot start auto draft when draft already complete
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 4.4 Write property test for auto-draft pick selection
    - **Property 5: Auto-Draft Pick Selection**
    - Generate random preference lists and verify picks follow preference order then alphabetical fallback
    - **Validates: Requirements 5.2, 5.3**

- [x] 5. Implement scoring test suite
  - [x] 5.1 Create `src/test/integration/scoring.test.ts`
    - Test episode auto-creation when adding event to non-existent episode
    - Test episode_events row has correct episode_id, castaway_id, scoring_rule_id, points
    - Test cannot add events to finalized episode (error: "finalized episode")
    - Test finalization stamps player_id on each event (matches team_assignment owner)
    - Test consolation events auto-inserted for eliminated castaways (points = consolation_points, scoring_rule_id = null)
    - Test unfinalization: is_finalized = false, consolation events deleted, manual events remain
    - Test consolation accumulates across multiple finalized episodes
    - Test remove event from unfinalized episode succeeds
    - Test cannot remove event from finalized episode (error: "finalized episode")
    - Document server action references in comments
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ]* 5.2 Write property test for finalization player attribution
    - **Property 6: Finalization Player Attribution**
    - Verify every episode_event in a finalized episode has player_id matching the team_assignment owner
    - **Validates: Requirements 6.3**

  - [ ]* 5.3 Write property test for consolation point lifecycle
    - **Property 7: Consolation Point Lifecycle**
    - Verify consolation event count matches finalized episodes after elimination, and unfinalization removes only consolation events
    - **Validates: Requirements 6.4, 6.5, 6.6**

- [x] 6. Implement trade test suite
  - [x] 6.1 Create `src/test/integration/trades.test.ts`
    - Test propose trade creates correct `trades` row (status = "pending")
    - Test accept trade: status → "admin_approved", team_assignments swapped, points_from_episode = latest finalized + 1
    - Test reject trade: status = "rejected", resolved_at set, no assignment changes
    - Test cancel trade: status = "rejected", resolved_at set, no assignment changes
    - Test cannot trade castaway you don't own (error: "You do not own the castaway you are offering")
    - Test cannot trade eliminated castaway (error: "Eliminated castaways cannot be traded")
    - Test cannot accept non-pending trade (error: "no longer pending")
    - Test points boundary: original owner retains pre-trade points, new owner earns from points_from_episode onward
    - Test concurrent trades: second trade fails when first accepted (proposer no longer owns castaway)
    - Document server action references in comments
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 6.2 Write property test for trade validation
    - **Property 8: Trade Validation**
    - Verify non-owner trade proposals return ownership error, eliminated castaway trades return elimination error
    - **Validates: Requirements 7.5, 7.6**

  - [ ]* 6.3 Write property test for trade acceptance assignment swap
    - **Property 9: Trade Acceptance Assignment Swap**
    - Verify accepted trades create correct team_assignments with source = "trade" and points_from_episode = F + 1
    - **Validates: Requirements 7.2**

- [x] 7. Implement waiver test suite
  - [x] 7.1 Create `src/test/integration/waiver.test.ts`
    - Test waiver pool contains only non-eliminated, unassigned castaways
    - Test submit claim creates correct `waiver_claims` row (status = "pending", priority sequential)
    - Test bid exceeds budget rejected (error: "exceeds")
    - Test claim for eliminated castaway rejected (error: "Eliminated castaways")
    - Test drop castaway not owned rejected (error: "do not own")
    - Test waiver processing: highest bidder wins, losers marked "lost", budget deducted from winner only
    - Test duplicate drop castaway invalidation (second claim marked "lost")
    - Test points_from_episode set correctly on waiver assignments
    - Test $0 bid accepted and budget unchanged if won
    - Test negative bid rejected (error: "non-negative")
    - Test process with no pending claims returns error ("No pending claims")
    - Document server action references in comments
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [ ]* 7.2 Write property test for waiver pool composition
    - **Property 11: Waiver Pool Composition**
    - Verify pool = non-eliminated castaways with no active team_assignment
    - **Validates: Requirements 8.1**

  - [ ]* 7.3 Write property test for waiver processing resolution
    - **Property 13: Waiver Processing Resolution**
    - Generate random bids/priorities, verify highest bid wins (priority tiebreak), budgets correct
    - **Validates: Requirements 8.6, 8.7**

- [x] 8. Checkpoint - Verify core test suites
  - Ensure all tests pass via `npm run test:integration`
  - Ensure draft, scoring, trades, and waiver tests execute correctly
  - Ask the user if questions arise.

- [x] 9. Implement challenge test suite
  - [x] 9.1 Create `src/test/integration/challenges.test.ts`
    - Test create challenge with valid inputs creates correct `challenges` row
    - Test validation: empty title (error: "title is required"), points <= 0 (error: "positive number"), no deadline (error: "Deadline is required")
    - Test player submits response creates `challenge_submissions` row (is_correct = null)
    - Test cannot submit after deadline (error: "deadline has passed")
    - Test submission at exactly deadline is accepted
    - Test cannot submit twice (error: "already submitted a response")
    - Test admin grades correct: is_correct = true, leaderboard total increases
    - Test admin grades incorrect: is_correct = false, no points added
    - Document server action references in comments
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 10. Implement leaderboard test suite
  - [x] 10.1 Create `src/test/integration/leaderboard.test.ts`
    - Test total score = episode points + consolation points + challenge points
    - Test multi-week trade scenario (3 episodes, verify points attribution before/after trade)
    - Test multi-week waiver scenario (3 episodes, verify points attribution before/after waiver)
    - Test combined trade + waiver scenario (player trades away one, picks up another)
    - Test consolation only for eliminated castaways with active team_assignment
    - Test standard competition ranking (ties get same rank, next rank skips)
    - Test no points duplication or loss across transfers
    - Test full leaderboard after 3 episodes with trade + waiver
    - Document server action references in comments
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ]* 10.2 Write property test for total score composition
    - **Property 14: Total Score Composition**
    - Verify player total = episode_event points + consolation + challenge points
    - **Validates: Requirements 10.1**

  - [ ]* 10.3 Write property test for standard competition ranking
    - **Property 15: Standard Competition Ranking**
    - Generate random score arrays, verify tied players get same rank, next rank = rank + count of tied
    - **Validates: Requirements 10.6**

  - [ ]* 10.4 Write property test for points attribution integrity
    - **Property 10: Points Attribution Integrity Across Transfers**
    - Verify original owner points + new owner points = total castaway points (no duplication/loss)
    - **Validates: Requirements 10.7**

- [x] 11. Implement admin test suite
  - [x] 11.1 Create `src/test/integration/admin.test.ts`
    - Test add castaway creates correct row (league_id, name, tribe)
    - Test eliminate castaway sets is_eliminated = true, eliminated_episode
    - Test restore castaway sets is_eliminated = false, eliminated_episode = null
    - Test castaway validation (empty name error)
    - Test create scoring rule (name, points)
    - Test update scoring rule (new name, new points)
    - Test delete scoring rule with ON DELETE SET NULL behavior
    - Test configure draft settings (draft_mode, pick_timer_seconds)
    - Test update waiver schedule (day, hour, minute)
    - Test late-join assignment (source = "admin_assign", correct points_from_episode)
    - Test cannot assign already-owned castaway
    - Test cannot assign eliminated castaway
    - Test cannot exceed roster_size
    - Document server action references in comments
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14_

- [x] 12. Implement RLS policy test suite
  - [x] 12.1 Create `src/test/integration/rls.test.ts`
    - Test non-member cannot read league castaways (zero rows returned)
    - Test non-admin cannot insert castaways (RLS violation error)
    - Test non-admin cannot insert/update scoring_rules (RLS violation error)
    - Test non-admin cannot insert/update episodes (RLS violation error)
    - Test non-admin cannot insert/update episode_events (RLS violation error)
    - Test trade visibility: player sees only own trades, admin sees all
    - Test challenge_submissions visibility: player sees only own, admin sees all
    - Test non-admin cannot directly insert/delete team_assignments (RLS violation error)
    - Test draft_pick insertion: own player_id + active draft succeeds, otherwise fails
    - Test cannot insert trade with mismatched proposer_id (RLS violation error)
    - Use Scoped_Client for all RLS tests (authenticated as specific test users)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12_

- [x] 13. Implement edge cases test suite
  - [x] 13.1 Create `src/test/integration/edge-cases.test.ts`
    - Test draft with fewer castaways than needed (stops early, marked complete)
    - Test trade after castaway elimination between proposal and acceptance
    - Test concurrent waiver claims (5 players, different bids, only highest wins)
    - Test $0 bid waiver claim (accepted, budget unchanged if won)
    - Test negative bid rejected (error: "non-negative")
    - Test finalize episode with zero events (only consolation generated)
    - Test multiple pending trades for same castaway (second fails after first accepted)
    - Test process waivers with no pending claims (error: "No pending claims")
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

- [x] 14. Implement smoke test
  - [x] 14.1 Create `src/test/integration/smoke.test.ts`
    - Implement full season simulation in sequence: cleanup → setup → draft → episode 1 + challenge → trade → episode 2 + eliminations → waiver → episode 3 → challenge grading → leaderboard
    - Verify Player A retains pre-trade points, Player B earns post-trade points
    - Verify Player C retains pre-waiver points, Player D earns post-waiver points
    - Verify all 10 players have correct cumulative totals (episode + consolation + challenge)
    - Verify no double-counting across trade/waiver boundaries
    - Set test timeout to 60000ms for this file
    - Halt and report on first failure with step, assertion, actual vs expected
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 15. Create bug tracking document
  - [x] 15.1 Create `src/test/integration/KNOWN_BUGS.md`
    - Add header explaining the bug tracking protocol
    - Document format: test file path, test name, expected behavior, actual behavior, affected requirement ID
    - Explain `it.fails()` and `it.todo()` conventions
    - Explain conversion process when bugs are fixed
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

- [x] 16. Final checkpoint - Full suite verification
  - Ensure all tests pass via `npm run test:integration`
  - Ensure `npm run test` still passes (unit tests only, no integration tests)
  - Ensure `npm run validate` passes (test + lint + build)
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Integration tests replicate server action patterns (query → validate → mutate) rather than invoking Next.js server actions directly
- All tests use the Admin_Client for setup/teardown and Scoped_Client for RLS verification
- The smoke test (14.1) must run in isolation with its own cleanup/seed cycle
- Bug discovery uses `it.fails()` for known bugs and `it.todo()` for unimplemented tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "6.1", "6.2", "6.3"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "9.1"] },
    { "id": 6, "tasks": ["10.1", "10.2", "10.3", "10.4", "11.1"] },
    { "id": 7, "tasks": ["12.1", "13.1"] },
    { "id": 8, "tasks": ["14.1", "15.1"] }
  ]
}
```
