# Requirements Document

## Introduction

This feature adds fun, non-scoring **season awards** to Fantasy Survivor. Awards never change anyone's points. They are computed from data the app already stores (episode events, waiver claims, alliances, challenge submissions, draft picks, trades) and are handed out when the League_Admin completes the season.

Design principles agreed with the product owner:

- Awards are for rare, interesting, or funny things. Every award has a qualifying threshold, and an award nobody qualifies for is simply not given.
- When players tie for an award, they share it.
- There are no always-given awards (no Champion, no Wooden Spoon).
- There are no castaway-level awards.
- Limited-time scoring rules (for example "Jeff Says Your Name") count like any other rule. There is no special flagging.
- Before the season is completed, only the League_Admin can see what the awards would be (admin preview). Players see awards only after completion.
- There is no permanent navigation tab for awards. After the season is complete, a link appears at the top of the leaderboard page.

## Glossary

- **Award_Engine**: The pure logic in `src/lib/awards.ts` that evaluates every award from an `AwardsInput` snapshot. No Supabase imports.
- **Awards_Loader**: The module `src/lib/league-awards.ts` that fetches the data needed for an `AwardsInput` (same structural `SupabaseLike` pattern as `src/lib/league-standings.ts`).
- **League_Admin**: The user in `leagues.admin_id`.
- **Player**: A member of the league (`league_members`).
- **Award**: A named recognition with a stable `award_key`, a category, a qualification rule, and a statistic used to pick winners.
- **Candidate**: A player evaluated for an award, with a statistic value, a short detail string, and a `qualifies` flag.
- **Qualifier**: A Candidate whose `qualifies` flag is true.
- **Winner**: A Qualifier whose statistic equals the best statistic among all Qualifiers (highest, or lowest for awards defined as "lowest"). All tied Qualifiers are Winners.
- **Unclaimed**: An award with no Qualifiers.
- **Week**: A finalized episode. "Week N" is finalized episode number N.
- **Weekly_Score**: A player's change in cumulative total between consecutive Weeks, including castaway event points, correct challenge points, and alliance points. For the first Week it is the cumulative total after that Week.
- **Standings_History**: For each Week, every player's cumulative total and competition rank (ties share a rank, as in `computeLeaderboard`).
- **Claim_Episode**: For a processed waiver claim, the first Week whose `finalized_at` is later than the claim's `processed_at`.
- **Admin_Preview**: The admin page that shows live-computed awards before the season is completed.
- **Saved_Awards**: Rows in `league_awards` written when the season is completed.

## Requirements

### Requirement 1: Evaluate awards with thresholds and shared winners

**User Story:** As a league member, I want awards to appear only when something notable happened, and to be shared when players tie, so that every award feels earned.

#### Acceptance Criteria

1. THE Award_Engine SHALL evaluate every award in the catalogue (Requirements 2 to 6) from a single `AwardsInput` and return, for each award, its Candidates, its Winners, and whether it is Unclaimed.
2. WHEN no Candidate qualifies for an award, THE Award_Engine SHALL mark the award Unclaimed and return no Winners.
3. WHEN two or more Qualifiers have the best statistic value, THE Award_Engine SHALL return all of them as Winners.
4. THE Award_Engine SHALL return the same Winners regardless of the order in which players, events, claims, or submissions appear in the input.
5. THE Award_Engine SHALL return no Winners for any award when the league has fewer than 4 players or no finalized episodes.
6. THE Award_Engine SHALL read all thresholds from one exported constants object so thresholds can be tuned in one place.
7. THE Award_Engine SHALL NOT modify the input and SHALL NOT affect any points total.

### Requirement 2: Standings and momentum awards

**User Story:** As a league member, I want awards for dramatic leaderboard stories, so that we can laugh about the season's ups and downs.

#### Acceptance Criteria

1. **King of the Hill** (`king_of_the_hill`): THE Award_Engine SHALL count each player's Weeks at rank 1, qualify players with at least 3, and pick the highest count.
2. **Peaked Too Early** (`peaked_too_early`): THE Award_Engine SHALL qualify players with at least 3 Weeks at rank 1 whose final rank is greater than 3, and pick the highest count of Weeks at rank 1.
3. **Comeback Kid** (`comeback_kid`): WHERE the league has at least 6 players, THE Award_Engine SHALL qualify players who had rank greater than or equal to (player count - 2) in any Week and whose final rank is 3 or better, and pick the largest value of (worst rank - final rank).
4. **Cellar Dweller** (`cellar_dweller`): THE Award_Engine SHALL count each player's longest run of consecutive Weeks in last place (cumulative total equal to the lowest total, with not every player tied), qualify runs of at least 5 Weeks, and pick the longest run.
5. **Cliff Diver** (`cliff_diver`): THE Award_Engine SHALL compute each player's largest single-Week rank drop, qualify drops of at least 6 places, and pick the largest drop.
6. **Rock Bottom** (`rock_bottom`): THE Award_Engine SHALL qualify players whose lowest Weekly_Score is -8 or lower and pick the lowest Weekly_Score.
7. **Photo Finish** (`photo_finish`): THE Award_Engine SHALL compute the point gaps between adjacent final places among the top 3 places, qualify gaps of at most 2 points (a tie is a gap of 0), pick the smallest gap, and make every player on either side of a smallest gap a Winner.
8. **Rollercoaster** (`rollercoaster`): THE Award_Engine SHALL compute each player's (best Weekly_Score - worst Weekly_Score) over at least 5 Weeks, qualify ranges of at least 30, and pick the largest range.
9. **On Fire** (`on_fire`): THE Award_Engine SHALL find each player's best Weekly_Score, qualify scores of at least 25, pick the highest, and include the Week number in the detail text.

### Requirement 3: Waiver wire awards

**User Story:** As a league member, I want awards for waiver wire drama, so that great and terrible pickups are remembered.

#### Acceptance Criteria

1. **Big Spender** (`big_spender`): THE Award_Engine SHALL sum each player's winning bids, qualify totals equal to or above the full `leagues.waiver_budget`, and pick the highest total.
2. **Sucker Bid** (`sucker_bid`): THE Award_Engine SHALL qualify each won claim with a bid of at least 25 whose castaway was eliminated in the Claim_Episode or the Week after it, and pick the highest such bid.
3. **The One That Got Away** (`one_that_got_away`): THE Award_Engine SHALL sum, for each won claim, the points scored from the Claim_Episode onward by the dropped castaway that were not attributed to the claimant, qualify sums of at least 15, and pick the highest sum.
4. **Going Down With the Ship** (`going_down_with_the_ship`): THE Award_Engine SHALL count, for each player still holding an eliminated castaway at season end, the Weeks after that castaway's elimination, qualify counts of at least 3, and pick the highest count.
5. **Hoarder** (`hoarder`): THE Award_Engine SHALL count each player's won waiver claims, qualify counts of at least 3, and pick the highest count.
6. **Dumpster Diver** (`dumpster_diver`): THE Award_Engine SHALL sum the points a player earned from castaways that a different player had earlier dropped through a won claim (and that the player then acquired through a later won claim), qualify sums of at least 20, and pick the highest sum.
7. **Waiver MVP** (`waiver_mvp`): THE Award_Engine SHALL find, for each player, the most points earned from a single won-claim castaway while the player owned that castaway, qualify values of at least 25, and pick the highest value.
8. **Commitment Issues** (`commitment_issues`): THE Award_Engine SHALL count each player's trades with status `admin_approved` (as proposer or receiver), qualify counts of at least 2, and pick the highest count.

### Requirement 4: Alliance awards

**User Story:** As a league member, I want awards for alliance stories, so that good and unlucky alliances get recognized.

#### Acceptance Criteria

1. **Kiss of Death** (`kiss_of_death`): THE Award_Engine SHALL count each player's alliances whose castaway's `eliminated_episode` is less than or equal to the alliance's `points_from_episode`, qualify counts of at least 2, and pick the highest count.
2. **Coattail Rider** (`coattail_rider`): THE Award_Engine SHALL compute each player's alliance points divided by final total (for totals above 0), qualify shares of at least 25 percent, and pick the highest share.
3. **Sole Survivor Whisperer** (`sole_survivor_whisperer`): WHEN a finalized episode event exists for a scoring rule named "Season Winner" (case-insensitive), THE Award_Engine SHALL qualify the player the event is attributed to and any player with an active alliance with that castaway at season end. All qualifiers are Winners.

### Requirement 5: Challenge awards

**User Story:** As a league member, I want awards for prediction skill and misfortune, so that challenge results are remembered.

#### Acceptance Criteria

1. **The Oracle** (`the_oracle`): THE Award_Engine SHALL compute accuracy (correct graded answers divided by graded answers) for players with at least 8 graded answers and pick the highest accuracy. The detail text SHALL show correct and total answers.
2. **Lone Wolf** (`lone_wolf`): THE Award_Engine SHALL count, for each player, challenges with at least 4 graded submissions where that player gave the only correct answer, qualify counts of at least 1, and pick the highest count.
3. **Black Sheep** (`black_sheep`): THE Award_Engine SHALL count, for each player, challenges with at least 5 graded submissions where that player gave the only incorrect answer, qualify counts of at least 1, and pick the highest count.
4. **Participation Trophy** (`participation_trophy`): WHEN the league has at least 5 challenges, THE Award_Engine SHALL qualify players who submitted an answer to every challenge and whose final rank is greater than half the player count, and pick the lowest accuracy among them.

### Requirement 6: Scoring event awards

**User Story:** As a league member, I want awards tied to what happened on screen, so that the show's drama shows up in our stats.

#### Acceptance Criteria

1. **Immunity Magnet** (`immunity_magnet`): THE Award_Engine SHALL count each player's positive episode events whose scoring rule name contains both "immunity" and "win" (case-insensitive), covering team and individual immunity, qualify counts of at least 8, and pick the highest count.
2. **Blindside Victim** (`blindside_victim`): THE Award_Engine SHALL count each player's episode events whose scoring rule name contains "voted out" (case-insensitive), qualify counts of at least 3, and pick the highest count.
3. **Jinx** (`jinx`): THE Award_Engine SHALL count each player's won waiver claims whose castaway was eliminated in the Claim_Episode or the Week after it, qualify counts of at least 2, and pick the highest count.

### Requirement 7: Standings history consistency

**User Story:** As a league member, I want award statistics to match the leaderboard, so that nobody disputes the numbers.

#### Acceptance Criteria

1. THE Award_Engine SHALL build Standings_History using `computePlayerScore`, `computeAllyPoints`, and `resolveAllyEndEpisode` from `src/lib/scoring.ts` and `computeLeaderboard` from `src/lib/leaderboard.ts`, so that scoring rules are not reimplemented.
2. THE final Week's totals and ranks in Standings_History SHALL equal the output of `computeLeagueLeaderboard` for the same league.
3. THE Award_Engine SHALL include correct challenge points in a Week's total only for challenges belonging to that Week or earlier.

### Requirement 8: Admin preview

**User Story:** As a League_Admin, I want to see what the awards would be before I complete the season, so that I can check them and tune thresholds.

#### Acceptance Criteria

1. THE Admin_Preview SHALL be the Season Recap page (`/league/[id]/recap`) opened by the League_Admin before the season is complete, reachable from a "Season Recap Preview" tile on the admin hub. There is no separate awards preview page.
2. WHILE the season is not complete, THE Season Recap page SHALL be accessible only to the League_Admin and SHALL show a banner saying players cannot see it yet.
3. IN preview, THE awards section SHALL compute awards live from current data and SHALL NOT write to the database. It SHALL list every award that would be given, with its Winners and their statistic detail.

### Requirement 9: Save awards when the season completes

**User Story:** As a League_Admin, I want awards finalized when I complete the season, so that later rescoring cannot change results people have already seen.

#### Acceptance Criteria

1. WHEN the League_Admin completes the season, THE system SHALL compute awards and replace any existing Saved_Awards for the league in the same operation that marks the league complete.
2. THE system SHALL save one row per Winner per award. Unclaimed awards SHALL have no rows.
3. IF saving awards fails, THEN THE system SHALL leave the league not complete and show an error message.
4. WHEN the League_Admin reopens a completed season, THE system SHALL delete the league's Saved_Awards.
5. THE system SHALL perform the save and delete through a `SECURITY DEFINER` function that verifies the caller is the league admin.

### Requirement 10: Player-facing awards page

**User Story:** As a Player, I want to see the awards after the season ends, so that we can enjoy them together.

#### Acceptance Criteria

1. THE app SHALL provide a page at `/league/[id]/recap`. THE league navigation SHALL NOT include a link to it.
2. WHEN the league is complete, THE leaderboard page SHALL show a link to the awards page at the top of the page. WHILE the league is not complete, THE leaderboard page SHALL NOT show the link.
3. WHILE the league is not complete, THE awards page SHALL redirect to the leaderboard page and SHALL NOT show any award results or counts.
4. WHEN the league is complete, THE awards page SHALL show every Saved_Award that has at least one Winner as one flat list (no category headings), with the award name, description, Winner display names, and statistic detail.
5. WHEN the league is complete and has no Saved_Awards, THE awards page SHALL show an empty-state message.
6. THE awards page SHALL be readable only by league members.
7. IF a saved `award_key` is not in the current catalogue, THEN THE awards page SHALL skip that row.

### Requirement 10a: Season Recap page

**User Story:** As a Player, I want a season recap that shows the final podium and replays the season, so that we can relive how it played out.

#### Acceptance Criteria

1. THE awards page SHALL be a Season Recap page at `/league/[id]/recap` with three sections in this order: Final Podium, the animated replay chart, and Season Awards.
2. THE Final Podium SHALL be drawn as a podium: three stepped blocks in the order 2nd, 1st, 3rd (1st tallest), with the finishers standing on top of their step. It SHALL show each finisher's name, final points, and the castaways (and active ally) they ended the season with. Tied players SHALL share a step, and a place nobody holds SHALL show as an empty step.
3. THE replay chart SHALL draw one colored line per player of cumulative points, starting at 0 before episode 1, and SHALL animate forward one episode at a time, moving each line smoothly from one episode total to the next (about 1.5 seconds per episode).
4. THE replay chart SHALL show each player's name and running total at the tip of their line, and SHALL keep each player's color stable.
5. THE replay chart SHALL start playing when scrolled into view and SHALL provide Play/Pause and Replay controls and an episode counter.
6. WHEN a viewer taps a player's line, label, or legend entry, THE chart SHALL highlight that player and fade the others. The viewer's own line SHALL be drawn bolder.
7. WHERE the viewer's device requests reduced motion, THE chart SHALL show the finished chart without animating.
8. THE podium and chart SHALL be computed from current data with the same standings history used by the awards. THE replay chart SHALL NOT appear anywhere other than the Season Recap page.

### Requirement 11: Persistence and security

**User Story:** As a League_Admin, I want awards stored safely, so that only the admin can create them and only members can read them.

#### Acceptance Criteria

1. THE migration SHALL create a `league_awards` table with `league_id`, `award_key`, `player_id`, `stat_value`, `stat_detail`, and `created_at`, with a unique constraint on (`league_id`, `award_key`, `player_id`) and cascading deletes from `leagues` and `profiles`.
2. THE migration SHALL enable Row Level Security on `league_awards` and allow SELECT only for members of the league.
3. THE migration SHALL grant no direct INSERT, UPDATE, or DELETE to clients. Writes SHALL go only through the `replace_league_awards` function.

### Requirement 12: Testing

**User Story:** As a developer, I want the award logic well tested, so that awards are correct and stable.

#### Acceptance Criteria

1. THE project SHALL include unit tests in `src/test/awards.test.ts` covering, for every award, a case where it is given, a case where it is Unclaimed because of the threshold, and a case with a shared tie.
2. THE project SHALL include `fast-check` property tests for the shared-winner rule, order independence, and Unclaimed behavior.
3. THE project SHALL include an integration test that confirms final-Week Standings_History equals the leaderboard.
