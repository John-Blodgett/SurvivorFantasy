# Integration Tests — Fantasy Survivor

End-to-end flows exercising Supabase queries, server actions, RLS policies, and page rendering together.

## Prerequisites

Before any test run, the following must exist (created manually once, reused across runs):

- 10 Supabase auth users (Player 1 = league admin, Players 2–10 = members)
- 1 league: "Integ Test League", season 99, roster_size = 2, consolation_points = 2, waiver_budget = 100, draft_mode = "live", pick_timer_seconds = 300
- All 10 players joined as league_members
- 30 castaways added to the league (Castaway-01 through Castaway-30, tribes: Alpha/Beta/Gamma, 10 each)
- Default scoring rules seeded (from seed_default_scoring_rules RPC)

> The `player_id` column on `episode_events` migration (20240013) must be applied before running scoring tests.

---

## 0 — Cleanup from Previous Runs

Delete all test data in FK-safe order. This targets ONLY the integration test league by its known name/season. Never touches other leagues.

```sql
-- Step 1: Find the integration test league
DO $$
DECLARE
  v_league_id uuid;
BEGIN
  SELECT id INTO v_league_id
  FROM leagues
  WHERE name = 'Integ Test League' AND season_number = 99;

  IF v_league_id IS NULL THEN
    RAISE NOTICE 'No integration test league found — nothing to clean.';
    RETURN;
  END IF;

  -- Step 2: Delete in FK-safe order (children first)
  DELETE FROM challenge_submissions WHERE challenge_id IN (
    SELECT id FROM challenges WHERE league_id = v_league_id
  );
  DELETE FROM challenges WHERE league_id = v_league_id;
  DELETE FROM waiver_claims WHERE league_id = v_league_id;
  DELETE FROM episode_events WHERE episode_id IN (
    SELECT id FROM episodes WHERE league_id = v_league_id
  );
  DELETE FROM episodes WHERE league_id = v_league_id;
  DELETE FROM trades WHERE league_id = v_league_id;
  DELETE FROM team_assignments WHERE league_id = v_league_id;
  DELETE FROM draft_picks WHERE draft_id IN (
    SELECT id FROM drafts WHERE league_id = v_league_id
  );
  DELETE FROM draft_preferences WHERE league_id = v_league_id;
  DELETE FROM drafts WHERE league_id = v_league_id;
  DELETE FROM scoring_rules WHERE league_id = v_league_id;
  DELETE FROM castaways WHERE league_id = v_league_id;
  DELETE FROM league_members WHERE league_id = v_league_id;
  DELETE FROM leagues WHERE id = v_league_id;

  RAISE NOTICE 'Cleaned integration test league %', v_league_id;
END $$;
```

After cleanup, re-run the prerequisite setup (create league, add members, add 30 castaways, seed scoring rules).

---

## 1 — Live Draft (Snake Order, 10 Players × 2 Picks = 20 Picks)

### Setup
- League has 10 players, roster_size = 2, draft_mode = "live"
- 30 castaways available (Castaway-01 through Castaway-30)
- Admin starts the draft via `startDraftAction`

### 1.1 — Draft starts correctly
- **Action**: Admin calls `startDraftAction`
- **Verify**: `drafts` row created with status = "active", current_pick_index = 0, started_at set, pick_started_at set
- **Verify**: Draft page loads for all 10 players showing the draft room

### 1.2 — Snake order is correct
- **Verify**: Round 1 order is Player 1 → Player 10 (by joined_at ascending)
- **Verify**: Round 2 order is Player 10 → Player 1 (reversed)
- **Verify**: Total picks = 20 (10 players × roster_size 2)

### 1.3 — Each player picks in turn (round 1)
For each pick i = 0..9:
- **Verify**: Only the player whose turn it is can submit `makeDraftPickAction`
- **Action**: Current player picks Castaway-(i+1)
- **Verify**: `draft_picks` row inserted with correct pick_number, player_id, castaway_id
- **Verify**: `team_assignments` row inserted with source = "draft", points_from_episode = 1
- **Verify**: `drafts.current_pick_index` advanced to i+1
- **Verify**: `drafts.pick_started_at` updated (timer reset)
- **Verify**: All 10 clients see the updated pick list and the next player's turn highlighted

### 1.4 — Wrong player cannot pick
- **Action**: Player 2 tries to pick when it's Player 1's turn
- **Verify**: Returns error "It is not your turn to pick."
- **Verify**: No draft_pick or team_assignment created

### 1.5 — Cannot pick already-drafted castaway
- **Action**: Current player tries to pick a castaway already drafted
- **Verify**: Returns error "This castaway has already been picked."

### 1.6 — Round 2 picks (snake reversal)
For picks 10..19:
- **Verify**: Order is Player 10, Player 9, ..., Player 1
- **Action**: Each player picks their second castaway (Castaway-11 through Castaway-20)
- **Verify**: Same validations as round 1

### 1.7 — Draft completes
- **Verify**: After pick 20, `drafts.status` = "complete", `completed_at` set
- **Verify**: `drafts.current_pick_index` = 20
- **Verify**: `drafts.pick_started_at` = null
- **Verify**: Each player has exactly 2 team_assignments with source = "draft"
- **Verify**: 20 castaways are assigned, 10 remain unassigned (Castaway-21 through Castaway-30)

### 1.8 — Cannot pick after draft is complete
- **Action**: Any player tries `makeDraftPickAction`
- **Verify**: Returns error "Draft is already complete."

---

## 2 — Auto Draft

### Setup
- Clean draft data (delete draft_picks, team_assignments, drafts for this league)
- Set draft_mode = "auto" on the league
- Players 1, 3, 5 set draft preferences ranking Castaway-01 through Castaway-05 (rank 1–5)
- Players 2, 4 set preferences ranking Castaway-30 through Castaway-26 (rank 1–5)
- Remaining players have no preferences

### 2.1 — Auto draft runs to completion
- **Action**: Admin calls `startDraftAction` (which triggers `runAutoDraftAction` for auto mode)
- **Verify**: Returns success with totalPicks = 20
- **Verify**: `drafts.status` = "complete"
- **Verify**: 20 `draft_picks` rows exist with sequential pick_numbers 1–20

### 2.2 — Preferences are respected
- **Verify**: Player 1's first pick is Castaway-01 (their rank-1 preference)
- **Verify**: Player 2's first pick is Castaway-30 (their rank-1 preference)
- **Verify**: Players with preferences got their top available choices before fallback

### 2.3 — Fallback to alphabetical
- **Verify**: Players without preferences received castaways in alphabetical ID order from the remaining pool

### 2.4 — Team assignments match picks
- **Verify**: Every draft_pick has a corresponding team_assignment with same player_id, castaway_id, source = "draft", points_from_episode = 1
- **Verify**: Each player has exactly 2 team_assignments

### 2.5 — No duplicate castaways
- **Verify**: All 20 assigned castaway_ids are unique
- **Verify**: No castaway appears in more than one team_assignment

---

## 3 — Episode Scoring & Finalization

### Setup
- Draft is complete, each player has 2 castaways
- Scoring rules exist: "Won Immunity" (+5), "Found Idol" (+3), "Voted Out" (-2)
- Retrieve scoring_rule IDs for use in events

### 3.1 — Create episode and add events
- **Action**: Admin calls `addEpisodeEventAction` for episode 1
- **Verify**: Episode row auto-created (number = 1, is_finalized = false)
- **Action**: Add events:
  - Player 1's Castaway-01: "Won Immunity" (+5)
  - Player 2's Castaway-02: "Found Idol" (+3)
  - Player 3's Castaway-03: "Won Immunity" (+5), "Found Idol" (+3)
- **Verify**: 4 episode_events rows exist for episode 1

### 3.2 — Cannot add events to finalized episode
- **Action**: Finalize episode 1 via `finalizeEpisodeAction`
- **Action**: Try to add another event to episode 1
- **Verify**: Redirects with error "Cannot add events to a finalized episode."

### 3.3 — Finalization stamps player_id on events
- **Action**: After finalization, query episode_events for episode 1
- **Verify**: Each event's player_id matches the player who owned the castaway at finalization time
- **Verify**: Player 1's events have player_id = Player 1's ID
- **Verify**: Player 3's events both have player_id = Player 3's ID

### 3.4 — Remove event from unfinalized episode
- **Action**: Create episode 2, add an event, then remove it via `removeEpisodeEventAction`
- **Verify**: Event is deleted
- **Verify**: Cannot remove events from finalized episode 1

### 3.5 — Consolation points on finalization
- **Action**: Admin eliminates Castaway-01 at episode 1 via `eliminateCastawayAction`
- **Action**: Add scoring events to episode 2 for other castaways, then finalize episode 2
- **Verify**: A consolation event is auto-inserted for Castaway-01 in episode 2 with points = 2 (league's consolation_points)
- **Verify**: Consolation event has no scoring_rule_id (null)

### 3.6 — Consolation points accumulate across episodes
- **Action**: Finalize episode 3 (with some events for active castaways)
- **Verify**: Another consolation event for Castaway-01 in episode 3 (points = 2)
- **Verify**: Castaway-01 now has 2 consolation events total (ep 2 and ep 3)

### 3.7 — Unfinalize episode
- **Action**: Admin calls `unfinalizeEpisodeAction` on episode 3
- **Verify**: Episode 3 is_finalized = false, finalized_at = null
- **Verify**: Consolation events (scoring_rule_id IS NULL) for episode 3 are deleted
- **Verify**: Manually-added events for episode 3 remain

### 3.8 — Leaderboard reflects correct scores
- **Verify**: Player 1 total = 5 (Won Immunity ep1) + consolation for Castaway-01 if still on team
- **Verify**: Player 3 total = 8 (5 + 3 from ep1)
- **Verify**: Players with no events have total = 0 (plus any consolation)
- **Verify**: Leaderboard is sorted descending by total, ties get same rank

---

## 4 — Trades

### Setup
- Draft complete, each player has 2 castaways
- Episode 1 finalized (so points_from_episode for traded castaways = 2)

### 4.1 — Propose a trade
- **Action**: Player 2 proposes trade: offers their Castaway-A for Player 3's Castaway-B via `proposeTradeFromTradesPageAction`
- **Verify**: `trades` row created with status = "pending", correct proposer/receiver/castaway IDs
- **Verify**: Trade visible to Player 2 (proposer) and Player 3 (receiver)

### 4.2 — Cannot trade with yourself
- **Action**: Player 2 tries to propose a trade with themselves
- **Verify**: Validation error "Cannot trade with yourself."

### 4.3 — Cannot trade eliminated castaway
- **Action**: Player tries to trade an eliminated castaway
- **Verify**: Validation error "Eliminated castaways cannot be traded."

### 4.4 — Cannot trade castaway you don't own
- **Action**: Player 2 tries to offer Player 4's castaway
- **Verify**: Validation error "You do not own the castaway you are offering."

### 4.5 — Receiver accepts trade
- **Action**: Player 3 calls `acceptTradeInLeagueAction`
- **Verify**: Trade status changes to "admin_approved" (direct acceptance flow)
- **Verify**: Team assignments swapped:
  - Player 2 now owns Castaway-B (points_from_episode = 2, source = "trade")
  - Player 3 now owns Castaway-A (points_from_episode = 2, source = "trade")
- **Verify**: Old team_assignments for those castaways are deleted

### 4.6 — Points don't move retroactively after trade
- **Action**: Check Player 2's score for episode 1
- **Verify**: Player 2 still gets points from Castaway-A's episode 1 events (player_id stamped at finalization)
- **Verify**: Player 3 does NOT get Castaway-A's episode 1 points (they didn't own it then)
- **Action**: Score episode 2 with events for Castaway-A (now owned by Player 3)
- **Verify**: After finalization, Castaway-A's episode 2 events have player_id = Player 3

### 4.7 — Receiver rejects trade
- **Action**: Player 4 proposes trade to Player 5
- **Action**: Player 5 calls `rejectTradeInLeagueAction`
- **Verify**: Trade status = "rejected", resolved_at set
- **Verify**: No team_assignment changes

### 4.8 — Proposer cancels trade
- **Action**: Player 6 proposes trade to Player 7
- **Action**: Player 6 calls `cancelTradeAction`
- **Verify**: Trade status = "rejected", resolved_at set

### 4.9 — Cannot accept/reject non-pending trade
- **Action**: Try to accept an already-rejected trade
- **Verify**: Error "Trade is no longer pending"

### 4.10 — Admin trade approval flow (via admin actions)
- **Action**: Player 8 proposes trade to Player 9
- **Action**: Player 9 accepts (status → "accepted" if using admin approval flow)
- **Action**: Admin approves via `approveTradeAction`
- **Verify**: Trade status = "admin_approved", team assignments swapped
- **Verify**: points_from_episode set to (latest finalized episode + 1)

### 4.11 — Admin rejects accepted trade
- **Action**: Player proposes, receiver accepts
- **Action**: Admin calls `adminRejectTradeAction`
- **Verify**: Trade status = "admin_rejected"
- **Verify**: No team_assignment changes

---

## 5 — Waiver Wire

### Setup
- Draft complete, 10 unassigned castaways (Castaway-21 through Castaway-30) on the wire
- All players have waiver_budget_remaining = 100
- Castaway-21 is eliminated (to test eliminated exclusion)

### 5.1 — Waiver pool shows correct castaways
- **Verify**: Waiver wire pool contains Castaway-22 through Castaway-30 (9 castaways)
- **Verify**: Castaway-21 (eliminated) is NOT in the pool
- **Verify**: Drafted castaways (Castaway-01 through Castaway-20) are NOT in the pool

### 5.2 — Submit a waiver claim
- **Action**: Player 1 submits claim: pick up Castaway-22, drop their Castaway-X, bid 10
- **Verify**: `waiver_claims` row created with status = "pending", priority = 1, bid_amount = 10
- **Verify**: Claim visible on Player 1's waiver page

### 5.3 — Cannot claim eliminated castaway
- **Action**: Player 2 tries to claim Castaway-21 (eliminated)
- **Verify**: Validation error "Eliminated castaways are not available on the waiver wire."

### 5.4 — Cannot claim already-owned castaway
- **Action**: Player 2 tries to claim Castaway-01 (owned by Player 1)
- **Verify**: Validation error "This castaway is not available on the waiver wire."

### 5.5 — Cannot drop castaway you don't own
- **Action**: Player 2 tries to drop Player 3's castaway
- **Verify**: Validation error "You do not own the castaway you are trying to drop."

### 5.6 — Bid exceeds budget
- **Action**: Player 3 submits claim with bid_amount = 150 (budget is 100)
- **Verify**: Validation error "Bid amount exceeds your remaining waiver budget."

### 5.7 — Duplicate claim prevention
- **Action**: Player 1 submits another claim dropping the same castaway they already have a pending claim for
- **Verify**: Error "You already have a pending claim dropping this castaway."

### 5.8 — Multiple claims with priority ordering
- **Action**: Player 1 submits a second claim (different drop castaway), bid 20 for Castaway-23
- **Verify**: Second claim has priority = 2
- **Action**: Player 1 reorders claims via `reorderWaiverClaimsAction`
- **Verify**: Priorities updated to match new order

### 5.9 — Edit a pending claim
- **Action**: Player 1 edits their claim via `editWaiverClaimAction` (change bid to 15, change drop castaway)
- **Verify**: Claim updated with new bid_amount and drop_castaway_id
- **Verify**: Cannot edit to exceed budget

### 5.10 — Cancel a pending claim
- **Action**: Player 1 cancels one claim via `cancelWaiverClaimAction`
- **Verify**: Claim deleted from waiver_claims

### 5.11 — Process waivers — highest bid wins
- **Setup**: Multiple players claim the same castaway:
  - Player 4 bids 30 for Castaway-24 (drop their Castaway-Y)
  - Player 5 bids 20 for Castaway-24 (drop their Castaway-Z)
  - Player 6 bids 30 for Castaway-24 (drop their Castaway-W), priority = 2
- **Action**: Admin calls `processWaiversAction`
- **Verify**: Player 4 wins (highest bid, lower priority number as tiebreak with Player 6)
- **Verify**: Player 4's claim status = "won", Players 5 & 6 status = "lost"
- **Verify**: Player 4's team_assignment updated: Castaway-Y removed, Castaway-24 added (source = "waiver")
- **Verify**: Player 4's waiver_budget_remaining reduced by 30 (now 70)
- **Verify**: Players 5 & 6 budget unchanged

### 5.12 — Waiver claim invalidation (drop castaway already used)
- **Setup**: Player 7 has two pending claims both dropping the same castaway
  - Claim A: pick Castaway-25, drop Castaway-X, bid 10, priority 1
  - Claim B: pick Castaway-26, drop Castaway-X, bid 5, priority 2
- **Action**: Process waivers
- **Verify**: Claim A wins (higher priority)
- **Verify**: Claim B is "lost" because the drop castaway was already used

### 5.13 — Points from episode set correctly on waiver assignment
- **Verify**: New team_assignment from waiver has points_from_episode = (latest episode number + 1)
- **Verify**: This means the new castaway only earns points from future episodes

---

## 6 — Challenges

### Setup
- Episode 1 exists and is finalized
- Episode 2 exists (unfinalized)

### 6.1 — Admin creates a challenge
- **Action**: Admin calls `createChallengeAction` for episode 2: title = "Who gets voted out?", points = 5, deadline = future timestamp
- **Verify**: `challenges` row created with correct league_id, episode_id, title, points, deadline

### 6.2 — Validation on challenge creation
- **Action**: Try to create challenge with empty title → error "Challenge title is required."
- **Action**: Try to create challenge with points = 0 → error "Points must be a positive number."
- **Action**: Try to create challenge with no deadline → error "Deadline is required."

### 6.3 — Player submits a response
- **Action**: Player 2 calls `submitChallengeResponseAction` with response = "Castaway-05"
- **Verify**: `challenge_submissions` row created with player_id, response, is_correct = null

### 6.4 — Cannot submit after deadline
- **Action**: Create a challenge with deadline in the past
- **Action**: Player 3 tries to submit
- **Verify**: Error "The submission deadline for this challenge has passed."

### 6.5 — Cannot submit twice
- **Action**: Player 2 tries to submit again for the same challenge
- **Verify**: Error "You have already submitted a response to this challenge."

### 6.6 — Admin grades submissions
- **Action**: Admin calls `gradeChallengeSubmissionAction` marking Player 2's submission is_correct = true
- **Verify**: Submission updated with is_correct = true
- **Action**: Admin grades Player 4's submission as is_correct = false
- **Verify**: Submission updated with is_correct = false

### 6.7 — Challenge points reflected in leaderboard
- **Verify**: Player 2's total includes +5 challenge points
- **Verify**: Player 4's total does NOT include challenge points (incorrect answer)
- **Verify**: Players who didn't submit get 0 challenge points

### 6.8 — Update a challenge before deadline
- **Action**: Admin calls `updateChallengeAction` changing points to 10
- **Verify**: Challenge updated
- **Verify**: Cannot update after deadline passes

### 6.9 — Delete a challenge before deadline
- **Action**: Admin creates a second challenge, then deletes it via `deleteChallengeAction`
- **Verify**: Challenge and its submissions are cascade-deleted
- **Verify**: Cannot delete after deadline passes

---

## 7 — Leaderboard & Points Integrity Over Time

### Setup
- Episodes 1–3 finalized with various scoring events
- Trades have occurred (some castaways changed hands)
- Waiver claims processed (some roster changes)
- Challenges graded

### 7.1 — Total score = episode points + consolation + challenge points
For each player:
- **Verify**: Episode points = sum of episode_events where player_id = this player
- **Verify**: Consolation points = (consolation_points_per_episode × number of finalized episodes after elimination) for each eliminated castaway currently on team
- **Verify**: Challenge points = sum of points for correct submissions
- **Verify**: Total = episode + consolation + challenge

### 7.2 — Points persist from previous owners after trade
- **Scenario**: Player A owned Castaway-X during episode 1 (earned 5 pts). Traded to Player B before episode 2.
- **Verify**: Player A's total still includes 5 pts from Castaway-X's episode 1 events
- **Verify**: Player B's total does NOT include Castaway-X's episode 1 points
- **Verify**: Player B's total DOES include Castaway-X's episode 2+ points (if any)

### 7.3 — Points persist from previous owners after waiver
- **Scenario**: Player C owned Castaway-Y during episodes 1–2. Dropped via waiver, Player D picks up.
- **Verify**: Player C retains episode 1–2 points for Castaway-Y
- **Verify**: Player D only gets points from the episode after the waiver (points_from_episode)

### 7.4 — Consolation points only for currently-owned eliminated castaways
- **Scenario**: Player A's castaway is eliminated at episode 2. Player A trades it away.
- **Verify**: Player A no longer earns consolation for that castaway (not on their team)
- **Verify**: New owner earns consolation from their points_from_episode onward

### 7.5 — Ranking with ties
- **Scenario**: Two players have identical totals
- **Verify**: Both get the same rank (standard competition ranking)
- **Verify**: Next rank skips (e.g., 1, 1, 3 — not 1, 1, 2)

### 7.6 — Leaderboard page renders correctly
- **Verify**: All 10 players appear on the leaderboard page
- **Verify**: Sorted by total descending
- **Verify**: Display names shown correctly

---

## 8 — Admin Tools

### 8.1 — Castaway management
- **Action**: Admin adds Castaway-31 via `addCastawayAction`
- **Verify**: Castaway created with correct league_id, name, tribe
- **Action**: Admin eliminates Castaway-31 at episode 2 via `eliminateCastawayAction`
- **Verify**: is_eliminated = true, eliminated_episode = 2
- **Action**: Admin restores Castaway-31 via `restoreCastawayAction`
- **Verify**: is_eliminated = false, eliminated_episode = null

### 8.2 — Castaway validation
- **Action**: Try to add castaway with empty name
- **Verify**: Validation error

### 8.3 — Scoring rules CRUD
- **Action**: Admin creates rule "Found Advantage" (+2) via `createRuleAction`
- **Verify**: Rule created
- **Action**: Admin updates rule to +4 via `updateRuleAction`
- **Verify**: Rule updated
- **Action**: Admin deletes rule via `deleteRuleAction`
- **Verify**: Rule deleted, any episode_events referencing it have scoring_rule_id set to null

### 8.4 — Draft configuration
- **Action**: Admin calls `configureDraftAction` with draft_mode = "live", pick_timer_seconds = 60
- **Verify**: League updated with new draft settings

### 8.5 — Waiver schedule configuration
- **Action**: Admin calls `updateWaiverScheduleAction` with day = 3, hour = 18, minute = 0
- **Verify**: League updated with waiver_process_day = 3, waiver_process_hour = 18, waiver_process_minute = 0

### 8.6 — Late-join assignment
- **Setup**: Player 10 has fewer than roster_size castaways (e.g., after a trade left them short, or they joined late)
- **Action**: Admin assigns an unowned castaway to Player 10 via `assignCastawayAction`
- **Verify**: team_assignment created with source = "admin_assign", points_from_episode = (latest finalized episode + 1)
- **Verify**: Cannot assign an already-owned castaway
- **Verify**: Cannot assign an eliminated castaway
- **Verify**: Cannot exceed roster_size limit

### 8.7 — Admin hub page loads
- **Verify**: Admin hub page shows all 7 tool links (Castaways, Scoring Rules, Draft Setup, Score Episode, Trade Approval, Waiver Wire, Late-Join)
- **Verify**: Non-admin player cannot access admin pages (redirected to /dashboard)

---

## 9 — RLS Policy Enforcement

### 9.1 — League data isolation
- **Verify**: Player in League A cannot read castaways/episodes/trades from League B
- **Verify**: Non-member cannot read league details

### 9.2 — Admin-only write operations
- **Verify**: Non-admin player cannot insert/update castaways
- **Verify**: Non-admin player cannot insert/update scoring_rules
- **Verify**: Non-admin player cannot insert/update episodes
- **Verify**: Non-admin player cannot manage episode_events

### 9.3 — Trade visibility
- **Verify**: Only proposer, receiver, and admin can see a trade
- **Verify**: Other league members cannot see trades they're not involved in

### 9.4 — Challenge submission privacy
- **Verify**: Players can only read their own submissions
- **Verify**: Admin can read all submissions for grading

### 9.5 — Draft pick insertion
- **Verify**: Players can only insert draft_picks for themselves during an active draft
- **Verify**: Cannot insert picks for other players

### 9.6 — Team assignment protection
- **Verify**: Only admin can directly insert/update/delete team_assignments
- **Verify**: Players cannot modify team_assignments directly (only through server actions)

---

## 10 — Edge Cases & Error Handling

### 10.1 — Draft with fewer castaways than needed
- **Scenario**: Only 15 castaways available for 10 players × 2 roster = 20 picks needed
- **Verify**: Draft stops after 15 picks (no castaways left), draft marked complete

### 10.2 — Trade after castaway elimination
- **Scenario**: Castaway is eliminated between trade proposal and acceptance
- **Verify**: Trade validation catches this at acceptance time

### 10.3 — Concurrent waiver claims for same castaway
- **Scenario**: 5 players all claim the same unowned castaway with different bids
- **Verify**: Only highest bidder wins, all others marked "lost"
- **Verify**: Budget only deducted from winner

### 10.4 — Waiver claim with $0 bid
- **Action**: Player submits claim with bid_amount = 0
- **Verify**: Claim accepted (0 is valid)
- **Verify**: If they win, budget_remaining unchanged

### 10.5 — Negative bid amount
- **Action**: Player tries bid_amount = -5
- **Verify**: Validation error "Bid amount must be a non-negative whole number."

### 10.6 — Score episode with no events
- **Action**: Finalize an episode with 0 manually-added events
- **Verify**: Only consolation events are generated (if applicable)
- **Verify**: Episode is finalized successfully

### 10.7 — Multiple trades involving same castaway
- **Scenario**: Player A proposes trade of Castaway-X to Player B. Before B responds, Player A proposes same Castaway-X to Player C.
- **Verify**: Both trades can be pending simultaneously
- **Verify**: If B accepts first, C's trade should fail validation (A no longer owns Castaway-X)

### 10.8 — Waiver processing with no pending claims
- **Action**: Admin calls `processWaiversAction` with no pending claims
- **Verify**: Redirects with error "No pending claims to process."

### 10.9 — Challenge submission exactly at deadline
- **Verify**: Submission at exactly the deadline timestamp is accepted (submittedAt <= deadline)

### 10.10 — Player leaves league mid-season
- **Scenario**: Player is removed from league_members
- **Verify**: Their team_assignments, draft_preferences, and pending trades are handled gracefully
- **Verify**: Historical episode_events with their player_id remain (points attributed)

---

## Full Scenario Walkthrough (Smoke Test)

Run these steps in sequence to simulate a complete season:

1. **Cleanup** — Run cleanup SQL
2. **Setup** — Create league, 10 players join, add 30 castaways, seed scoring rules
3. **Draft** — Run live draft (20 picks), verify all teams
4. **Episode 1** — Score events for 6 castaways, create challenge, players submit answers, finalize
5. **Trades** — Player 2 trades with Player 3, verify points don't move
6. **Episode 2** — Score events (including traded castaways), eliminate 2 castaways, finalize
7. **Waiver** — 3 players claim unowned castaways, process waivers, verify assignments
8. **Episode 3** — Score events, verify consolation points for eliminated castaways, finalize
9. **Challenges** — Grade all submissions, verify challenge points in leaderboard
10. **Final leaderboard** — Verify all 10 players have correct totals accounting for:
    - Episode points (attributed to owner at finalization time)
    - Consolation points (for eliminated castaways still on team)
    - Challenge points (correct submissions only)
    - Trade/waiver boundaries (points_from_episode cutoffs)
