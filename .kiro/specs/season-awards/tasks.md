# Implementation Plan: Season Awards

## Overview

The pure award logic is built first in `src/lib/awards.ts` and tested thoroughly, because every award is a pure function of an `AwardsInput`. Next come the migration and the data loader, then the admin preview (so thresholds can be tuned against the live season), then the season-completion hooks and the player page. Integration tests come last.

Tasks marked with `*` are optional property tests. Each task references the requirements it satisfies.

## Tasks

- [x] 1. Core types, constants, and winner selection in `src/lib/awards.ts`
  - [x] 1.1 Add types and constants
    - Add `AwardsInput`, `Candidate`, `AwardDefinition`, `AwardResult`, `AwardCategory`
    - Add exported `AWARD_THRESHOLDS` with the initial values from the design catalogue
    - Add `MIN_PLAYERS = 4`
    - _Requirements: 1.1, 1.6_
  - [x] 1.2 Implement `pickWinners(candidates, direction)`
    - Keep qualifiers, find the best value, return all qualifiers tied on it
    - _Requirements: 1.2, 1.3_
  - [x]* 1.3 Property tests for `pickWinners`
    - **Property 1: Winners are the best qualifiers**
    - **Property 2: Ties share**
    - **Property 3: Unclaimed when no qualifiers**
    - **Validates: Requirements 1.2, 1.3**
  - [x] 1.4 Implement `claimEpisode(processedAt, finalizedEpisodes)`
    - Return the first Week finalized after `processedAt`, or null
    - _Requirements: 3.2, 3.3, 6.3_

- [x] 2. Standings history
  - [x] 2.1 Implement `buildStandingsHistory(input)`
    - Per Week: `computePlayerScore` with `upToEpisode`, challenge points capped to that Week, ally points via `computeAllyPoints` with the end-episode cutoff (leaderboard-identical on the last Week), ranks via `computeLeaderboard`, `weeklyScore` as the delta
    - _Requirements: 7.1, 7.2, 7.3_
  - [x]* 2.2 Property test: history consistency
    - **Property 5: Final Week totals equal `computePlayerScore` plus ally points**
    - **Validates: Requirements 7.1, 7.2**
  - [x] 2.3 Unit tests for history
    - Rank ties, ally cutoffs, challenge points by Week, no finalized episodes
    - _Requirements: 7.1, 7.3_

- [x] 3. Standings and momentum awards
  - [x] 3.1 Implement `king_of_the_hill`, `peaked_too_early`, `comeback_kid`
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 3.2 Implement `cellar_dweller`, `cliff_diver`, `rock_bottom`
    - _Requirements: 2.4, 2.5, 2.6_
  - [x] 3.3 Implement `photo_finish`, `rollercoaster`, `on_fire`
    - _Requirements: 2.7, 2.8, 2.9_
  - [x] 3.4 Unit tests for each: given, below threshold, shared tie
    - _Requirements: 12.1_

- [x] 4. Waiver wire awards
  - [x] 4.1 Implement `big_spender`, `sucker_bid`, `hoarder`, `commitment_issues`
    - _Requirements: 3.1, 3.2, 3.5, 3.8_
  - [x] 4.2 Implement `one_that_got_away`, `going_down_with_the_ship`
    - _Requirements: 3.3, 3.4_
  - [x] 4.3 Implement `dumpster_diver`, `waiver_mvp` using stamped `player_id` attribution
    - _Requirements: 3.6, 3.7_
  - [x] 4.4 Unit tests for each: given, below threshold, shared tie
    - Include pending and lost claims being ignored, and claims with no Claim_Episode
    - _Requirements: 12.1_

- [x] 5. Alliance, challenge, and scoring-event awards
  - [x] 5.1 Implement `kiss_of_death`, `coattail_rider`, `sole_survivor_whisperer`
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 5.2 Implement `the_oracle`, `lone_wolf`, `black_sheep`, `participation_trophy`
    - Ignore ungraded submissions
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 5.3 Implement `immunity_magnet`, `blindside_victim`, `jinx` with case-insensitive rule-name matching
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.4 Unit tests for each: given, below threshold, shared tie
    - _Requirements: 12.1_

- [x] 6. `computeAwards` orchestrator and catalogue metadata
  - [x] 6.1 Implement `AWARD_CATALOGUE` metadata (name, description, category, thresholdText) and `computeAwards(input)`
    - Return all-unclaimed results when players < `MIN_PLAYERS` or there are no finalized episodes
    - _Requirements: 1.1, 1.5, 1.7_
  - [x]* 6.2 Property tests
    - **Property 4: Order independence** (shuffle players, events, claims, submissions)
    - **Property 6: Input immutability**
    - **Validates: Requirements 1.4, 1.7**
  - [x] 6.3 Checkpoint: run `npm run test` and `npm run lint`, fix failures

- [x] 7. Migration `supabase/migrations/20240024_add_league_awards.sql`
  - [x] 7.1 Create `league_awards`, RLS select policy, and `replace_league_awards` function with grants as in the design
    - _Requirements: 9.5, 11.1, 11.2, 11.3_
  - [ ] 7.2 Apply to the Supabase project and verify the policy and function exist
    - Confirm with the user before applying to the live project

- [x] 8. Data loader `src/lib/league-awards.ts`
  - [x] 8.1 Implement `loadAwardsInput(supabase, leagueId)`
    - Fetch league, members with profiles, finalized episodes, castaways, events with rule names, assignments, draft picks, claims, allies, trades, challenges, submissions
    - Map rows to `AwardsInput` (keep the structural `SupabaseLike` type like `league-standings.ts`)
    - _Requirements: 1.1, 7.1_

- [x] 9. Admin preview page
  - [x] 9.1 Create `src/app/league/[id]/admin/awards/page.tsx`
    - `requireLeagueAdmin`, load input, `computeAwards`, render summary, per-award cards grouped by category, top 3 candidates with "below threshold" tags, empty state
    - Use `AppShell`, `role="status"` for the summary, semantic headings
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 9.2 Add an "Awards preview" link on `src/app/league/[id]/admin/page.tsx`
    - _Requirements: 8.1_
  - [ ] 9.3 Checkpoint: open the preview against the current season and review thresholds with the product owner

- [x] 10. Season completion hooks
  - [x] 10.1 Extend `markSeasonCompleteAction` in `src/app/league/[id]/admin/actions.ts`
    - Compute awards, flatten winners to rows, call `replace_league_awards`, then mark complete. On error redirect with `?error=` and leave the league open.
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 10.2 Extend `reopenSeasonAction` to call `replace_league_awards` with `[]`
    - _Requirements: 9.4_
  - [x] 10.3 Revalidate the awards pages after both actions

- [x] 11. Player awards page and navigation
  - [x] 11.1 Create `src/app/league/[id]/awards/page.tsx`
    - Not complete: redirect to the leaderboard and show nothing
    - Complete: read `league_awards`, group by key, skip unknown keys, show names, descriptions, winners, stat detail by category, plus empty state and a back link to the leaderboard
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 11.2 Add the awards link at the top of `src/app/league/[id]/leaderboard/page.tsx`
    - Select `is_complete` with the league and render the link only when it is true
    - Do not change `league-nav.tsx`
    - _Requirements: 10.1, 10.2_

- [ ] 12. Integration tests (`src/test/integration/awards.test.ts`)
  - [ ] 12.1 Final-Week history equals `computeLeagueLeaderboard` for a seeded league
    - _Requirements: 7.2, 12.3_
  - [ ] 12.2 Completing the season saves winner rows. Reopening deletes them. Non-admin calls to `replace_league_awards` are rejected. Non-members cannot read `league_awards`.
    - _Requirements: 9.1, 9.4, 9.5, 11.2_

- [x] 13. Final checkpoint

- [x] 14. Season Recap page
  - [x] 14.1 Pure helpers in `src/lib/season-recap.ts` with tests in `src/test/season-recap.test.ts`
    - _Requirements: 10a.2, 10a.3, 10a.4_
  - [x] 14.2 Animated SVG replay chart `src/components/season-replay-chart.tsx`
    - _Requirements: 10a.3, 10a.4, 10a.5, 10a.6, 10a.7_
  - [x] 14.3 Move the awards page to `/league/[id]/recap` with podium, chart, and awards; update the leaderboard link and revalidation paths
    - _Requirements: 10a.1, 10a.2, 10a.8_
  - [x] 14.5 Admin can preview the recap before completion (live awards, preview banner); remove the separate `/admin/awards` page
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ] 14.4 Manual check: watch the replay on desktop and mobile after the season is complete
  - Run `npm run validate` (test, lint, build) and fix failures
  - Update `README.md` Features list with "Season awards"
