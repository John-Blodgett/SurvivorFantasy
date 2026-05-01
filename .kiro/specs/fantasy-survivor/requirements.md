# Requirements Document

## Introduction

A web-based fantasy game platform for the CBS show Survivor. Players join a league, draft Survivor castaways onto their team, and earn points based on what happens each episode. A league admin scores each episode through a mobile-friendly interface, and players can view a live leaderboard, their own team, and any other player's team with a full points breakdown. The entire application is fully responsive and optimized for both mobile and desktop. All infrastructure and tooling must be free-tier and the codebase must be hosted on GitHub.

## Glossary

- **System**: The Fantasy Survivor web application
- **Player**: A registered user participating in a league
- **Admin**: A designated user with elevated privileges who manages scoring and league settings
- **Castaway**: A contestant on the CBS show Survivor
- **League**: A group of players competing together in a single season
- **Team**: A Player's collection of drafted Castaways
- **Draft**: The process by which Players select Castaways for their Team
- **Episode**: A single aired episode of Survivor, used as the unit of scoring
- **Scoring Rule**: A configurable rule that awards points when a specific event occurs
- **Episode Event**: A recorded occurrence of a Scoring Rule being triggered for a specific Castaway in a specific Episode
- **Leaderboard**: A ranked view of all Players in a League by total points
- **Waiver Wire**: The pool of Castaways in a League who are not assigned to any Team and are not eliminated
- **Waiver Claim**: A Player's blind bid to acquire a specific Castaway from the Waiver Wire in exchange for dropping one of their own Castaways
- **Waiver Budget**: A per-Player seasonal budget of whole-number units used to bid on Waiver Wire claims; once spent it is not replenished

---

## Requirements

### Requirement 1: User Authentication

**User Story:** As a visitor, I want to create an account and log in, so that I can join a league and participate in the game.

#### Acceptance Criteria

1. WHEN a visitor submits a valid email and password, THE System SHALL create a new account and log the user in
2. WHEN a visitor submits an email that is already registered, THE System SHALL display an error message indicating the email is already in use
3. WHEN a registered user submits valid credentials, THE System SHALL authenticate the user and redirect them to their league dashboard
4. WHEN a registered user submits invalid credentials, THE System SHALL display an error message without revealing which field is incorrect
5. WHEN a user requests a magic link login, THE System SHALL send a login link to the provided email address
6. WHEN a user clicks a valid magic link, THE System SHALL authenticate the user and redirect them to their league dashboard
7. WHILE a user is authenticated, THE System SHALL maintain their session across page refreshes
8. WHEN a user logs out, THE System SHALL invalidate their session and redirect them to the login page

---

### Requirement 2: League Management

**User Story:** As a player, I want to join or create a league, so that I can compete with a specific group of friends.

#### Acceptance Criteria

1. WHEN an authenticated user creates a league, THE System SHALL generate a unique shareable invite link for that league
2. WHEN an authenticated user visits a valid invite link, THE System SHALL add them to the corresponding league as a Player
3. WHEN an authenticated user visits an invalid or expired invite link, THE System SHALL display an appropriate error message
4. THE System SHALL allow a league to be configured with a roster size between 1 and 20 Castaways per Team
5. THE System SHALL associate exactly one Admin role with each league
6. WHEN a league is created, THE System SHALL assign the creator as the Admin of that league

---

### Requirement 3: Castaway Roster

**User Story:** As an admin, I want to manage the list of Castaways for a season, so that players can draft from an accurate roster.

#### Acceptance Criteria

1. WHEN an Admin adds a Castaway to a season, THE System SHALL store the Castaway's name, tribe, and photo
2. WHEN a Castaway is eliminated from the game, THE Admin SHALL be able to mark that Castaway as eliminated
3. WHILE a Castaway is marked as eliminated, THE System SHALL display them as eliminated on all roster and team views
4. THE System SHALL prevent a Castaway from being drafted after they have been marked as eliminated

---

### Requirement 4: Draft System

**User Story:** As a player, I want to draft Castaways onto my team, so that I can compete based on their in-game performance.

#### Acceptance Criteria

1. THE System SHALL support two draft modes: Auto Draft and Live Draft
2. WHEN Auto Draft mode is used, THE System SHALL conduct a snake-order draft using each Player's pre-submitted preference rankings
3. WHEN a Player has not submitted preference rankings before an Auto Draft, THE System SHALL assign available Castaways in a default order
4. WHEN Live Draft mode is used, THE System SHALL present a shared real-time draft room where Players take turns selecting Castaways
5. WHEN it is a Player's turn in a Live Draft, THE System SHALL enforce a configurable pick timer
6. WHEN a Player's pick timer expires in a Live Draft, THE System SHALL automatically select the highest-ranked available Castaway from that Player's preference list
7. THE System SHALL conduct the Live Draft in snake order (1→N, then N→1, repeating)
8. WHEN a Castaway is selected by any Player during a draft, THE System SHALL immediately mark that Castaway as unavailable to all other Players
9. WHEN all Teams have reached the configured roster size, THE System SHALL mark the draft as complete
10. IF a draft has not yet started, THE Admin SHALL be able to configure the draft mode and pick timer duration

---

### Requirement 5: Custom Scoring Rules

**User Story:** As an admin, I want to define custom scoring rules, so that I can award points for any event that happens in an episode.

#### Acceptance Criteria

1. WHEN an Admin creates a Scoring Rule, THE System SHALL store the rule name and point value
2. THE System SHALL allow a Scoring Rule to have a negative point value to penalize events
3. THE System SHALL include a default set of Scoring Rules based on standard Survivor gameplay events
4. WHEN an Admin updates a Scoring Rule's point value, THE System SHALL apply the new value to all future Episode Events using that rule
5. IF an Admin deletes a Scoring Rule, THEN THE System SHALL retain all historical Episode Events that used that rule

---

### Requirement 6: Episode Scoring (Admin Interface)

**User Story:** As an admin, I want to record what happened each episode from my phone, so that player scores update automatically.

#### Acceptance Criteria

1. THE System SHALL provide a mobile-optimized admin scoring interface accessible at a protected route
2. WHEN an Admin opens the episode scoring interface, THE System SHALL display all active Castaways and all configured Scoring Rules
3. WHEN an Admin records an Episode Event by selecting a Castaway and a Scoring Rule, THE System SHALL immediately update that Player's score whose Team contains that Castaway
4. WHEN an Admin finalizes an episode, THE System SHALL lock that episode's scoring and trigger a leaderboard recalculation
5. WHILE an episode has not been finalized, THE Admin SHALL be able to add, edit, or remove Episode Events for that episode
6. IF an Admin needs to correct a finalized episode, THEN THE Admin SHALL be able to un-finalize it, make corrections, and re-finalize it

---

### Requirement 7: Leaderboard

**User Story:** As a player, I want to see a ranked leaderboard, so that I know where I stand in my league.

#### Acceptance Criteria

1. THE System SHALL display a leaderboard showing all Players ranked by total points in descending order
2. WHEN two Players have equal total points, THE System SHALL display them at the same rank
3. THE System SHALL update the leaderboard after each episode is finalized
4. WHEN a Player views the leaderboard, THE System SHALL display each Player's total points and current rank

---

### Requirement 8: Team and Points Breakdown

**User Story:** As a player, I want to view any team's full points breakdown, so that I can see exactly how each player earned their score.

#### Acceptance Criteria

1. WHEN a Player views their own Team page, THE System SHALL display all Castaways on their Team, total points, and a breakdown of points earned per Castaway per Episode
2. WHEN a Player clicks on another Player's Team from the leaderboard, THE System SHALL display that Team's Castaways, total points, and full points breakdown
3. THE System SHALL display each Episode Event that contributed to a Castaway's points, including the Scoring Rule name and point value
4. WHEN a Castaway on a Team has been eliminated, THE System SHALL visually distinguish them from active Castaways on the Team page

---

### Requirement 9: Weekly Challenges

**User Story:** As an admin, I want to optionally create a weekly challenge before each episode, so that players can earn bonus points by completing a pre-episode activity.

#### Acceptance Criteria

1. WHEN an Admin creates a Weekly Challenge for an episode, THE System SHALL store the challenge name, description, point value, and submission deadline
2. WHEN a Player submits a response to a Weekly Challenge before the deadline, THE System SHALL record the submission
3. WHEN the submission deadline passes, THE System SHALL prevent further submissions for that challenge
4. WHEN an Admin marks a Player's challenge submission as correct, THE System SHALL award that Player the configured challenge point value
5. IF no Weekly Challenge is created for an episode, THEN THE System SHALL proceed with standard episode scoring only
6. THE System SHALL display each Player's challenge submission history and earned challenge points on their profile
7. THE Admin SHALL be able to create, edit, or delete a Weekly Challenge at any time before the submission deadline

---

### Requirement 10: Episode Recap

**User Story:** As a player, I want to see a recap of each episode's scoring, so that I can follow along with what happened.

#### Acceptance Criteria

1. WHEN a Player views an episode recap page, THE System SHALL display all Episode Events for that episode, grouped by Castaway
2. THE System SHALL show the Scoring Rule name, point value, and which Player's Team benefited from each Episode Event
3. THE System SHALL list all episode recaps in reverse chronological order on a season summary page

---

### Requirement 12: Late Join and Admin Team Assignment

**User Story:** As an admin, I want to allow players to join the league after the draft has completed, so that latecomers can still participate.

#### Acceptance Criteria

1. WHEN a Player joins a league after the draft has been completed, THE System SHALL place them in the league without a Team
2. WHEN a Player has no Team after the draft, THE Admin SHALL be able to manually assign available Castaways to that Player's Team up to the configured roster size
3. WHEN an Admin assigns a Castaway to a late-joining Player's Team, THE System SHALL only count Episode Events for that Castaway from episodes after the assignment date
4. THE System SHALL visually indicate on a late-joining Player's Team page which Castaways were assigned after the draft and from which episode their points began counting

---

### Requirement 13: Castaway Trades

**User Story:** As a player, I want to trade a Castaway with another player, so that I can adjust my team during the season.

#### Acceptance Criteria

1. WHEN a Player initiates a trade, THE System SHALL require the trade to be exactly one Castaway from each Team (1-for-1 only)
2. WHEN a Player proposes a trade, THE System SHALL notify the other Player and require their explicit acceptance
3. WHEN a trade is accepted, THE System SHALL transfer each Castaway to the other Player's Team
4. WHEN a trade is completed, THE System SHALL only count each traded Castaway's Episode Events from episodes after the trade completion date toward their new Team's score
5. WHEN a trade is completed, THE System SHALL retain each traded Castaway's pre-trade Episode Events on their original Team's historical record
6. IF a Castaway has been eliminated, THEN THE System SHALL prevent that Castaway from being included in a trade
7. THE Admin SHALL be able to approve or reject any pending trade before it takes effect
8. WHEN a Player views their Team page, THE System SHALL display the trade date for any Castaway acquired via trade

---

### Requirement 14: Eliminated Castaway Consolation Points

**User Story:** As a player, I want my eliminated castaways to still earn a small number of points each episode, so that losing a castaway early doesn't completely ruin my season.

#### Acceptance Criteria

1. WHEN a Castaway is marked as eliminated, THE System SHALL award a configurable consolation point value to the Team that owns that Castaway for each subsequent episode that is finalized
2. THE System SHALL include a default consolation point value that the Admin can change at any time
3. WHEN the consolation point value is updated, THE System SHALL apply the new value to all future episode consolation awards only
4. THE System SHALL display consolation points as a distinct line item in the Team's episode-by-episode points breakdown

---

### Requirement 15: Season Winner Scoring

**User Story:** As an admin, I want to award bonus points when the season winner is revealed, so that having the winner on your team is meaningfully rewarded.

#### Acceptance Criteria

1. THE System SHALL include a default Scoring Rule for "Season Winner" with a configurable point value
2. WHEN an Admin applies the Season Winner rule to a Castaway, THE System SHALL award the configured point value to the Team that owns that Castaway
3. THE System SHALL treat the Season Winner rule identically to any other Scoring Rule so it appears in the episode recap and points breakdown

---

### Requirement 16: One Account Per User

**User Story:** As an admin, I want each person to have only one account, so that no one can game the league with multiple teams.

#### Acceptance Criteria

1. WHEN a visitor attempts to register with an email address that already has an account, THE System SHALL reject the registration and display an error
2. THE System SHALL enforce one Team per Player per League
3. WHEN a Player joins a league, THE System SHALL prevent them from joining the same league a second time

---

### Requirement 18: Waiver Wire

**User Story:** As a player, I want to claim unowned castaways from the waiver wire using a blind bidding budget, so that I can strategically compete for available players during the season.

#### Acceptance Criteria

1. THE System SHALL maintain a waiver wire consisting of all Castaways in the league who are not currently assigned to any Team and are not eliminated
2. WHEN a League is created, THE System SHALL assign each Player a configurable starting waiver budget (in whole number units), with a default value set by the Admin
3. WHEN a Player submits a waiver claim, THE System SHALL require the Player to specify a whole-number bid amount between 0 and their current remaining budget, and to designate one Castaway from their Team to drop in exchange
4. WHEN multiple Players submit waiver claims for the same Castaway before the processing deadline, THE System SHALL award the Castaway to the Player with the highest bid; in the event of a tied bid, THE System SHALL resolve the tie by randomly selecting one of the tied claimants
5. WHEN a waiver claim is fulfilled, THE System SHALL deduct the winning bid amount from the winning Player's remaining budget, remove the claimed Castaway from the waiver wire, add them to the winning Player's Team, and drop the designated Castaway back to the waiver wire
6. WHEN a waiver claim is not fulfilled, THE System SHALL not deduct any budget from the Player and SHALL notify the Player that their claim was unsuccessful
7. THE Admin SHALL be able to configure a recurring waiver wire processing schedule (day of week and time of day)
8. WHEN the configured processing time arrives, THE System SHALL process all pending waiver claims and notify all affected Players of the outcome
9. WHEN a waiver claim is fulfilled, THE System SHALL set the claimed Castaway's `points_from_episode` to the first episode that begins after the processing time
10. IF a Player has no Castaways on their Team to drop, THEN THE System SHALL prevent them from submitting a waiver claim
11. THE Admin SHALL be able to view and manually trigger waiver wire processing at any time from the admin tools
12. WHEN a Player views the waiver wire, THE System SHALL display all available Castaways, each Player's remaining budget (visible only to themselves), and any pending claims the Player has already submitted
13. THE System SHALL display each Player's remaining waiver budget on their Team page

---

### Requirement 17: Responsive Design and User Experience

**User Story:** As a user, I want the website to look great and work smoothly on both my phone and computer, so that I can access it from any device.

#### Acceptance Criteria

1. THE System SHALL render all pages responsively across mobile, tablet, and desktop screen sizes
2. WHEN a user accesses the System from a mobile device, THE System SHALL optimize touch targets and navigation for mobile interaction
3. WHEN a user accesses the System from a desktop device, THE System SHALL utilize available screen space for enhanced data visualization
4. THE System SHALL maintain consistent visual design language across all pages and components
5. THE System SHALL use modern UI patterns and visual polish to create an engaging user experience
