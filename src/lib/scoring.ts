/**
 * Pure points computation logic — no Supabase calls, fully testable.
 * Requirements: 6.3, 8.1, 8.2, 12.3, 14.1, 14.3
 */

// ---------------------------------------------------------------------------
// Data types (mirror the DB schema, but plain objects for pure computation)
// ---------------------------------------------------------------------------

export interface TeamAssignment {
  castaway_id: string;
  points_from_episode: number; // only count events from episodes >= this number
  source: "draft" | "admin_assign" | "trade";
}

export interface EpisodeEvent {
  episode_number: number;
  castaway_id: string;
  points: number;
}

export interface EliminatedCastaway {
  castaway_id: string;
  eliminated_episode: number; // the episode in which they were eliminated
}

export interface FinalizedEpisode {
  number: number;
}

export interface ChallengeSubmission {
  points: number; // the challenge's point value
  is_correct: boolean | null;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CastawayEpisodeBreakdown {
  [episodeNumber: number]: number; // points earned in that episode
}

export interface CastawayBreakdown {
  castaway_id: string;
  episode_points: CastawayEpisodeBreakdown;
  consolation_points: number;
  total: number;
}

export interface PlayerScoreBreakdown {
  castaways: CastawayBreakdown[];
  challenge_points: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Computes a player's total score and a full breakdown.
 *
 * @param teamAssignments  - All castaways assigned to this player in this league
 * @param episodeEvents    - All episode events for this league (all castaways, all episodes)
 * @param eliminatedCastaways - Castaways that have been eliminated, with their elimination episode
 * @param finalizedEpisodes   - All finalized episodes in the league
 * @param consolationPointsPerEpisode - The league's consolation_points value
 * @param challengeSubmissions - The player's challenge submissions
 * @param upToEpisode      - Optional cap: only count events/consolation up to (and including) this episode number
 *
 * Requirements: 6.3, 8.1, 8.2, 12.3, 14.1, 14.3
 */
export function computePlayerScore(
  teamAssignments: TeamAssignment[],
  episodeEvents: EpisodeEvent[],
  eliminatedCastaways: EliminatedCastaway[],
  finalizedEpisodes: FinalizedEpisode[],
  consolationPointsPerEpisode: number,
  challengeSubmissions: ChallengeSubmission[],
  upToEpisode?: number
): PlayerScoreBreakdown {
  // Build a set of castaway IDs on this player's team for fast lookup
  const assignmentMap = new Map<string, TeamAssignment>();
  for (const a of teamAssignments) {
    assignmentMap.set(a.castaway_id, a);
  }

  // Build a map of eliminated castaways for fast lookup
  const eliminationMap = new Map<string, number>();
  for (const e of eliminatedCastaways) {
    eliminationMap.set(e.castaway_id, e.eliminated_episode);
  }

  // Determine the effective episode ceiling
  const maxEpisode =
    upToEpisode !== undefined
      ? upToEpisode
      : Math.max(0, ...finalizedEpisodes.map((e) => e.number));

  // Finalized episode numbers up to the ceiling (for consolation calculation)
  const finalizedNumbers = finalizedEpisodes
    .map((e) => e.number)
    .filter((n) => n <= maxEpisode);

  // ---------------------------------------------------------------------------
  // Per-castaway breakdown
  // ---------------------------------------------------------------------------
  const castawayBreakdowns: CastawayBreakdown[] = [];

  for (const assignment of teamAssignments) {
    const { castaway_id, points_from_episode } = assignment;
    const episodePointsMap: CastawayEpisodeBreakdown = {};

    // Sum episode events for this castaway, respecting the points_from_episode cutoff
    for (const event of episodeEvents) {
      if (event.castaway_id !== castaway_id) continue;
      if (event.episode_number < points_from_episode) continue;
      if (event.episode_number > maxEpisode) continue;

      episodePointsMap[event.episode_number] =
        (episodePointsMap[event.episode_number] ?? 0) + event.points;
    }

    // Consolation points for eliminated castaways
    let consolationPoints = 0;
    const eliminatedEpisode = eliminationMap.get(castaway_id);
    if (eliminatedEpisode !== undefined) {
      // Count finalized episodes that come AFTER the elimination episode
      // and are within the points_from_episode cutoff and the upToEpisode cap
      const eligibleEpisodes = finalizedNumbers.filter(
        (n) => n > eliminatedEpisode && n >= points_from_episode
      );
      consolationPoints = consolationPointsPerEpisode * eligibleEpisodes.length;
    }

    const episodeTotal = Object.values(episodePointsMap).reduce((s, p) => s + p, 0);

    castawayBreakdowns.push({
      castaway_id,
      episode_points: episodePointsMap,
      consolation_points: consolationPoints,
      total: episodeTotal + consolationPoints,
    });
  }

  // ---------------------------------------------------------------------------
  // Challenge points — only correct submissions
  // ---------------------------------------------------------------------------
  const challengePoints = challengeSubmissions
    .filter((s) => s.is_correct === true)
    .reduce((sum, s) => sum + s.points, 0);

  // ---------------------------------------------------------------------------
  // Grand total
  // ---------------------------------------------------------------------------
  const total =
    castawayBreakdowns.reduce((s, c) => s + c.total, 0) + challengePoints;

  return {
    castaways: castawayBreakdowns,
    challenge_points: challengePoints,
    total,
  };
}
