# Implementation Plan: Fantasy Survivor

## Overview

Build the Fantasy Survivor web app incrementally, starting with the project foundation and auth, then core game data, then the draft system, then scoring and leaderboard, then trades and challenges, and finally polish. Each task builds on the previous ones and ends with wired-together functionality.

## Tasks

- [x] 1. Initialize project and configure infrastructure
  - Scaffold a Next.js 14 App Router project with TypeScript and Tailwind CSS
  - Install and configure shadcn/ui component library
  - Create a Supabase project and connect it via environment variables
  - Install Supabase client libraries (`@supabase/supabase-js`, `@supabase/ssr`)
  - Install Vitest and fast-check for testing
  - Set up GitHub repository and connect to Vercel for auto-deploy
  - _Requirements: 17.1_

- [x] 2. Implement database schema
  - [x] 2.1 Create all Supabase tables via SQL migrations
    - Create tables: `profiles`, `leagues`, `league_members`, `castaways`, `scoring_rules`, `drafts`, `draft_picks`, `draft_preferences`, `team_assignments`, `episodes`, `episode_events`, `trades`, `challenges`, `challenge_submissions`
    - Add all foreign key constraints, check constraints, and unique constraints as defined in the design
    - _Requirements: 2.4, 2.5, 4.8, 13.1, 16.2_
  - [x] 2.2 Seed default scoring rules
    - Insert default scoring rules (Immunity Win, Tribal Council Vote, Season Winner, etc.) for new leagues
    - _Requirements: 5.3, 15.1_

- [x] 3. Implement authentication
  - [x] 3.1 Build registration, login, and magic link pages
    - Create `/register` page with email/password form
    - Create `/` login page with email/password and magic link options
    - Wire Supabase Auth for all three flows
    - Redirect authenticated users to `/dashboard` on login
    - _Requirements: 1.1, 1.3, 1.5, 1.6_
  - [x] 3.2 Implement session management and logout
    - Use Supabase SSR cookie-based session so sessions persist across page refreshes
    - Add logout button that calls `supabase.auth.signOut()` and redirects to login
    - Create middleware to protect authenticated routes
    - _Requirements: 1.7, 1.8_
  - [x] 3.3 Write property test for duplicate email rejection
    - **Property 11: Duplicate email registration is rejected**
    - **Validates: Requirements 1.2, 16.1**

- [x] 4. Implement league creation and joining
  - [x] 4.1 Build league creation flow
    - Create league creation form (name, season number, roster size 1–20)
    - On submit, insert into `leagues` with a generated `invite_code` (UUID or short code), set `admin_id` to current user
    - Insert current user into `league_members`
    - Seed default scoring rules for the new league
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 5.3_
  - [x] 4.2 Build invite link join flow
    - Create `/join/[invite_code]` route that looks up the league and adds the user to `league_members`
    - Reject if invite code is invalid, or if user is already a member
    - _Requirements: 2.2, 2.3, 16.3_
  - [x] 4.3 Build dashboard page
    - Show all leagues the user belongs to with links to each league's leaderboard
    - _Requirements: 2.1_
  - [x] 4.4 Write property test for unique invite codes
    - **Property: For any set of leagues created, all invite_code values must be unique**
    - **Validates: Requirements 2.1**

- [x] 5. Implement castaway roster management
  - [x] 5.1 Build admin castaway management page (`/admin/castaways`)
    - Form to add a castaway (name, tribe, photo upload to Supabase Storage)
    - List of all castaways with ability to mark as eliminated
    - _Requirements: 3.1, 3.2_
  - [x] 5.2 Write property test for castaway round trip
    - **Property: For any castaway created, reading it back must return the same name, tribe, and photo_url**
    - **Validates: Requirements 3.1**

- [x] 6. Implement scoring rules management
  - [x] 6.1 Build admin scoring rules page (`/admin/rules`)
    - List all scoring rules with name and point value (including negative values)
    - Forms to create, edit, and delete rules
    - Deleting a rule must not delete existing `episode_events` rows (use soft delete or set `scoring_rule_id` to null with a snapshot of points)
    - _Requirements: 5.1, 5.2, 5.4, 5.5_
  - [x] 6.2 Write property test for scoring rule serialization round trip
    - **Property 10: Scoring rule serialization round trip**
    - **Validates: Requirements 5.1, 5.2**

- [x] 7. Implement points computation engine
  - [x] 7.1 Write `computePlayerScore(leagueId, playerId, upToEpisode?)` function
    - Sum `episode_events.points` for all castaways on the player's team, filtered by `points_from_episode` cutoff
    - Add consolation points: `leagues.consolation_points × episodes_after_elimination` for each eliminated castaway
    - Add challenge points: sum of `challenges.points` for correct submissions
    - Return total and a breakdown object (per castaway, per episode)
    - _Requirements: 6.3, 8.1, 14.1, 14.3_
  - [x] 7.2 Write property test for points computation
    - **Property 1: Points computation equals sum of eligible episode events**
    - **Validates: Requirements 6.3, 8.1, 8.2**
  - [x] 7.3 Write property test for consolation points
    - **Property 2: Consolation points accrue correctly for eliminated castaways**
    - **Validates: Requirements 14.1, 14.3**
  - [x] 7.4 Write property test for late-join point cutoff
    - **Property 6: Late-join point cutoff is respected**
    - **Validates: Requirements 12.3**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement draft system — core logic
  - [x] 9.1 Write snake order and auto-pick functions
    - `generateSnakeOrder(playerIds, rosterSize)` — returns ordered array of player IDs for all picks
    - `autoPickCastaway(preferences, draftedIds, availableCastaways)` — returns the highest-ranked available castaway
    - _Requirements: 4.2, 4.3, 4.6, 4.7_
  - [x] 9.2 Write property test for snake draft order and uniqueness
    - **Property 3: Draft snake order is correct and produces unique assignments**
    - **Validates: Requirements 4.2, 4.7, 4.8**
  - [x] 9.3 Write property test for auto-pick selection
    - **Property 4: Auto-pick selects highest-ranked available castaway**
    - **Validates: Requirements 4.6**
  - [x] 9.4 Build auto draft execution
    - API route that runs the full auto draft: generate snake order, iterate picks, call auto-pick for each player, insert `draft_picks` and `team_assignments` rows
    - Mark draft status as 'complete' when all picks are done
    - _Requirements: 4.2, 4.3, 4.9_

- [x] 10. Implement draft system — live draft room
  - [x] 10.1 Build draft configuration page (`/admin/draft`)
    - Form to set draft mode (auto/live), pick timer duration
    - Button to start the draft (sets status to 'active')
    - _Requirements: 4.1, 4.10_
  - [x] 10.2 Build live draft room page (`/league/[id]/draft`)
    - Subscribe to Supabase Realtime on the `draft_picks` table for the current draft
    - Display current pick, pick timer countdown, available castaways grid, and pick history
    - When it's the current user's turn, enable castaway selection
    - On pick, insert into `draft_picks` and `team_assignments`, advance `current_pick_index`
    - _Requirements: 4.4, 4.5, 4.8_
  - [x] 10.3 Implement pick timer auto-expiry
    - Server-side: a Supabase Edge Function or API route that fires when the timer expires and calls the auto-pick logic
    - _Requirements: 4.6_
  - [x] 10.4 Build player draft preferences page
    - Allow players to rank available castaways before the draft starts
    - Store rankings in `draft_preferences`
    - _Requirements: 4.2, 4.3_

- [x] 11. Implement episode scoring admin interface
  - [x] 11.1 Build episode management (`/admin/episode/[num]`)
    - Create episode if it doesn't exist
    - Display grid of active castaways and list of scoring rules
    - Tapping a castaway + rule creates an `episode_events` row and shows it in a running log
    - Allow removing events while episode is not finalized
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 11.2 Implement episode finalization and un-finalization
    - "Finalize Episode" button sets `is_finalized = true` and locks the episode
    - "Un-finalize" button sets `is_finalized = false` to allow corrections
    - _Requirements: 6.4, 6.6_
  - [x] 11.3 Implement consolation points on finalization
    - When an episode is finalized, compute and store consolation point events for all eliminated castaways
    - _Requirements: 14.1, 14.2_

- [x] 12. Implement leaderboard
  - [x] 12.1 Build leaderboard page (`/league/[id]/leaderboard`)
    - Call `computePlayerScore` for all league members, sort descending, assign ranks (ties get same rank)
    - Display rank, player name, total points, link to their team page
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 12.2 Write property test for leaderboard sort order
    - **Property 8: Leaderboard is sorted in non-increasing order of total points**
    - **Validates: Requirements 7.1, 7.2**

- [x] 13. Implement team and points breakdown pages
  - [x] 13.1 Build team view page (`/league/[id]/team/[userId]`)
    - Display all castaways on the team (active vs eliminated visually distinguished)
    - Show total points and per-castaway per-episode breakdown table
    - Show consolation points as a distinct line item per episode
    - Show trade date for traded castaways, assignment episode for late-join castaways
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 12.4, 13.8, 14.4_

- [x] 14. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement trades
  - [x] 15.1 Build trade proposal UI
    - On a player's team page, allow the viewing player to propose a trade (select one of their castaways, select one of the other player's castaways)
    - Validate: both castaways must be active (not eliminated), must be 1-for-1
    - Insert into `trades` with status 'pending', notify receiver via in-app notification
    - _Requirements: 13.1, 13.2, 13.6_
  - [x] 15.2 Write property test for eliminated castaway trade rejection
    - **Property 9: Eliminated castaways cannot be traded**
    - **Validates: Requirements 13.6**
  - [x] 15.3 Build trade acceptance and admin approval flow
    - Receiver sees pending trade on their dashboard, can accept or reject
    - On acceptance, trade moves to 'accepted', admin sees it in `/admin/trades` queue
    - Admin approves → status becomes 'admin_approved', team_assignments are updated with new `points_from_episode` cutoff
    - _Requirements: 13.2, 13.3, 13.7_
  - [x] 15.4 Write property test for trade point cutoff
    - **Property 5: Trade point cutoff is respected for both sides**
    - **Validates: Requirements 13.3, 13.4, 13.5**

- [x] 16. Implement late-join admin assignment
  - [x] 16.1 Build late-join assignment UI in admin
    - In `/admin`, show players with no team assignments after draft completion
    - Allow admin to assign available castaways to those players, setting `points_from_episode` to the next unfinalized episode number
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 17. Implement weekly challenges
  - [x] 17.1 Build challenge creation and management (`/admin/episode/[num]`)
    - Add challenge creation form to the episode admin page (title, description, points, deadline)
    - Allow editing and deleting challenges before the deadline
    - _Requirements: 9.1, 9.7_
  - [x] 17.2 Build player challenge submission page (`/league/[id]/challenges`)
    - List all challenges for the season with deadlines
    - Allow players to submit a text response before the deadline
    - Block submissions after the deadline
    - _Requirements: 9.2, 9.3_
  - [x] 17.3 Build admin challenge grading UI
    - In the admin episode view, show all submissions for each challenge
    - Toggle to mark submissions as correct (awards points) or incorrect
    - _Requirements: 9.4_
  - [x] 17.4 Write property test for challenge deadline enforcement
    - **Property: For any submission with submitted_at > challenge.deadline, the system must reject it**
    - **Validates: Requirements 9.3**
  - [x] 17.5 Write property test for challenge points
    - **Property 7: Challenge points are only awarded for correct submissions**
    - **Validates: Requirements 9.4**

- [x] 18. Implement episode recap
  - [x] 18.1 Build episode recap page (`/league/[id]/episode/[num]`)
    - Display all episode events grouped by castaway, showing rule name, points, and benefiting player
    - _Requirements: 10.1, 10.2_
  - [x] 18.2 Build season summary page with episode list
    - List all finalized episodes in reverse chronological order, each linking to its recap
    - _Requirements: 10.3_
  - [x] 18.3 Write property test for episode recap completeness
    - **Property 12: Episode recap contains all and only events for that episode**
    - **Validates: Requirements 10.1, 10.2**
  - [x] 18.4 Write property test for episode list sort order
    - **Property 13: Episode recap is sorted in reverse chronological order**
    - **Validates: Requirements 10.3**

- [x] 19. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Implement waiver wire
  - [x] 20.1 Add waiver wire database columns and table
    - Add `waiver_budget`, `waiver_process_day`, `waiver_process_hour`, `waiver_process_minute` columns to `leagues`
    - Add `waiver_budget_remaining` column to `league_members`
    - Create `waiver_claims` table with all columns as defined in the design
    - _Requirements: 18.2, 18.3, 18.7_
  - [x] 20.2 Write waiver wire query and claim validation logic
    - `getWaiverWire(leagueId)` — returns all castaways not on any team and not eliminated
    - `validateWaiverClaim(leagueId, playerId, castawayId, dropCastawayId, bidAmount)` — validates budget, drop castaway ownership, castaway availability
    - _Requirements: 18.1, 18.3, 18.10_
  - [x] 20.3 Write property test for waiver wire pool correctness
    - **Property 17: Waiver wire contains only unowned, non-eliminated castaways**
    - **Validates: Requirements 18.1**
  - [x] 20.4 Write waiver claim processing logic
    - `processWaiverClaims(leagueId)` — groups pending claims by castaway, resolves each group by highest bid (random tiebreak), updates `team_assignments`, deducts budget from winners, marks all claims as won/lost, sets `points_from_episode` on new assignment
    - _Requirements: 18.4, 18.5, 18.6, 18.8, 18.9_
  - [x] 20.5 Write property test for waiver claim winner selection
    - **Property 14: Waiver claim winner has highest bid**
    - **Validates: Requirements 18.4**
  - [x] 20.6 Write property test for waiver budget invariant
    - **Property 15: Waiver budget is never over-spent**
    - **Property 16: Losing waiver claimants are not charged**
    - **Validates: Requirements 18.2, 18.5, 18.6**
  - [x] 20.7 Build waiver wire player page (`/league/[id]/waiver`)
    - Display all available castaways on the waiver wire
    - Allow player to submit a claim: select castaway to claim, castaway to drop, enter bid amount
    - Show player's own remaining budget and their pending claims
    - _Requirements: 18.3, 18.12_
  - [x] 20.8 Build admin waiver wire panel (`/admin/waiver`)
    - Form to configure processing schedule (day of week, hour, minute)
    - List of all pending claims across all players
    - Button to manually trigger processing immediately
    - _Requirements: 18.7, 18.11_

- [x] 21. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Polish and responsive design
  - [x] 22.1 Audit all pages for mobile responsiveness
    - Ensure all touch targets are at least 44×44px on mobile
    - Test navigation on small screens, add a mobile-friendly nav menu
    - _Requirements: 17.1, 17.2_
  - [x] 22.2 Apply consistent visual design
    - Apply a cohesive color scheme and typography using Tailwind and shadcn/ui tokens
    - Ensure all pages use the same layout shell, header, and navigation
    - _Requirements: 17.4, 17.5_
  - [x] 22.3 Desktop layout enhancements
    - On wide screens, use multi-column layouts for leaderboard and team breakdown
    - _Requirements: 17.3_

## Notes

- All tasks are required, including tests
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check (min 100 iterations each)
- Unit tests validate specific examples and edge cases using Vitest
