/**
 * Pure episode logic — no Supabase calls, fully testable.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 14.1, 14.2
 */

export interface Episode {
  id: string;
  league_id: string;
  number: number;
  title: string | null;
  is_finalized: boolean;
  finalized_at: string | null;
}

export interface EpisodeEvent {
  id: string;
  episode_id: string;
  castaway_id: string;
  scoring_rule_id: string | null;
  points: number;
  created_at: string;
}

export interface ConsolationEventInput {
  episode_id: string;
  castaway_id: string;
  points: number;
}

/**
 * Computes consolation point events to insert when an episode is finalized.
 * For each eliminated castaway that has a team assignment, we award
 * consolation_points for this episode.
 *
 * Requirements: 14.1, 14.2
 */
export function buildConsolationEvents(
  episodeId: string,
  episodeNumber: number,
  eliminatedCastaways: Array<{ castaway_id: string; eliminated_episode: number }>,
  consolationPointsPerEpisode: number
): ConsolationEventInput[] {
  if (consolationPointsPerEpisode === 0) return [];

  return eliminatedCastaways
    .filter((c) => c.eliminated_episode < episodeNumber)
    .map((c) => ({
      episode_id: episodeId,
      castaway_id: c.castaway_id,
      points: consolationPointsPerEpisode,
    }));
}
