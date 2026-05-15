# Bugfix Requirements Document

## Introduction

After a trade is accepted and team_assignments are updated in the database, the leaderboard page continues to display the old roster (pre-trade team assignments). The transactions page correctly shows the completed trade, confirming the database was updated. The root cause is that none of the trade acceptance server actions call `revalidatePath` for the leaderboard page, so Next.js serves a stale cached version of that page.

Three separate server actions perform trade acceptance and team_assignment swaps:
- `acceptTradeInLeagueAction` (league trades page)
- `acceptTradeAction` (dashboard)
- `approveTradeAction` (admin trades page)

All three update the database correctly but only invalidate their own page's cache, not the leaderboard or other affected pages (team pages, transactions).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a trade is accepted via the league trades page THEN the system only revalidates the `/league/[id]/trades` path, leaving the leaderboard page cache stale

1.2 WHEN a trade is accepted via the dashboard THEN the system only revalidates the `/dashboard` path, leaving the leaderboard page cache stale

1.3 WHEN a trade is approved by an admin via the admin trades page THEN the system only revalidates the `/league/[id]/admin/trades` path, leaving the leaderboard page cache stale

1.4 WHEN a user navigates to the leaderboard after a trade is completed THEN the system displays the pre-trade roster assignments (old team_assignments) instead of the current ones

### Expected Behavior (Correct)

2.1 WHEN a trade is accepted via the league trades page THEN the system SHALL revalidate the leaderboard path (`/league/[id]/leaderboard`) so the next visit shows updated rosters

2.2 WHEN a trade is accepted via the dashboard THEN the system SHALL revalidate the leaderboard path (`/league/[id]/leaderboard`) so the next visit shows updated rosters

2.3 WHEN a trade is approved by an admin via the admin trades page THEN the system SHALL revalidate the leaderboard path (`/league/[id]/leaderboard`) so the next visit shows updated rosters

2.4 WHEN a user navigates to the leaderboard after a trade is completed THEN the system SHALL display the current roster assignments reflecting the completed trade

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a trade is accepted THEN the system SHALL CONTINUE TO update the trade status to "admin_approved" and set resolved_at timestamp

3.2 WHEN a trade is accepted THEN the system SHALL CONTINUE TO delete old team_assignments for both traded castaways and insert new team_assignments with swapped player_ids, correct points_from_episode, and source="trade"

3.3 WHEN a trade is accepted THEN the system SHALL CONTINUE TO revalidate the originating page's path (trades page, dashboard, or admin trades page respectively)

3.4 WHEN a trade is rejected or cancelled THEN the system SHALL CONTINUE TO leave team_assignments unchanged and not revalidate the leaderboard path

3.5 WHEN no trade has occurred THEN the leaderboard SHALL CONTINUE TO display roster assignments based on the existing team_assignments data
