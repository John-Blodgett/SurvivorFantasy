/**
 * Pure leaderboard computation — no Supabase calls, fully testable.
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

export interface PlayerScore {
  player_id: string;
  display_name: string;
  total: number;
}

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  display_name: string;
  total: number;
}

/**
 * Given an array of player scores, returns a sorted leaderboard with ranks.
 * Ties receive the same rank (dense ranking is NOT used — standard competition ranking).
 * e.g. scores [100, 100, 80] → ranks [1, 1, 3]
 *
 * Requirements: 7.1, 7.2
 */
export function computeLeaderboard(players: PlayerScore[]): LeaderboardEntry[] {
  // Sort descending by total points
  const sorted = [...players].sort((a, b) => b.total - a.total);

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i];
    // Rank = position of first player with this score (1-indexed)
    const rank = i === 0 ? 1 : sorted[i - 1].total === player.total
      ? entries[i - 1].rank
      : i + 1;

    entries.push({
      rank,
      player_id: player.player_id,
      display_name: player.display_name,
      total: player.total,
    });
  }

  return entries;
}
