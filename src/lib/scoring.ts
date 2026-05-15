/**
 * Pure points computation logic — no Supabase calls, fully testable.
 * Requirements: 6.3, 8.1, 8.2, 12.3, 14.1, 14.3
 *
 * Points are attributed to the player who owned the castaway when the
 * episode was finalized (stored as player_id on episode_events).
 * Trades do not retroactively move points between players.
 */

// ---------------------------------------------------------------------------
// Batch event builder
// ---------------------------------------------------------------------------

/**
 * Builds N×M episode event records from arrays of castaways and rules.
 * Each castaway gets one event per rule, using the points from rulePointsMap.
 */
export function buildBatchEvents(
  episodeId: string,
  castawayIds: string[],
  ruleIds: string[],
  rulePointsMap: Map<string, number>
): Array<{ episode_id: string; castaway_id: string; scoring_rule_id: string; points: number }> {
  const events: Array<{ episode_id: string; castaway_id: string; scoring_rule_id: string; points: number }> = [];
  for (const castawayId of castawayIds) {
    for (const ruleId of ruleIds) {
      events.push({
        episode_id: episodeId,
        castaway_id: castawayId,
        scoring_rule_id: ruleId,
        points: rulePointsMap.get(ruleId) ?? 0,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface TeamAssignment {
  castaway_id: string;
  points_from_episode: number;
  source: "draft" | "admin_assign" | "trade" | "waiver";
}

export interface EpisodeEvent {
  episode_number: number;
  castaway_id: string;
  points: number;
  player_id?: string | null;
}

export interface EliminatedCastaway {
  castaway_id: string;
  eliminated_episode: number;
}

export interface FinalizedEpisode {
  number: number;
}

export interface ChallengeSubmission {
  points: number;
  is_correct: boolean | null;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CastawayEpisodeBreakdown {
  [episodeNumber: number]: number;
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
 * When episode events have a player_id set (stamped at finalization time),
 * only events attributed to this player are counted — regardless of current
 * team assignments. This means trades don't move historical points.
 *
 * For events without player_id (legacy or pre-finalization preview), falls
 * back to the team_assignments + points_from_episode approach.
 *
 * @param playerId             - The player whose score we're computing
 * @param teamAssignments      - All castaways currently assigned to this player
 * @param episodeEvents        - All episode events for this league
 * @param eliminatedCastaways  - Castaways that have been eliminated
 * @param finalizedEpisodes    - All finalized episodes in the league
 * @param consolationPointsPerEpisode - The league's consolation_points value
 * @param challengeSubmissions - The player's challenge submissions
 * @param upToEpisode          - Optional cap on episode number
 */
export function computePlayerScore(
  playerId: string | null,
  teamAssignments: TeamAssignment[],
  episodeEvents: EpisodeEvent[],
  eliminatedCastaways: EliminatedCastaway[],
  finalizedEpisodes: FinalizedEpisode[],
  consolationPointsPerEpisode: number,
  challengeSubmissions: ChallengeSubmission[],
  upToEpisode?: number
): PlayerScoreBreakdown {
  const eliminationMap = new Map<string, number>();
  for (const e of eliminatedCastaways) {
    eliminationMap.set(e.castaway_id, e.eliminated_episode);
  }

  const maxEpisode =
    upToEpisode !== undefined
      ? upToEpisode
      : Math.max(0, ...finalizedEpisodes.map((e) => e.number));

  const finalizedNumbers = finalizedEpisodes
    .map((e) => e.number)
    .filter((n) => n <= maxEpisode);

  // Collect all castaway IDs this player has/had
  const teamCastawayIds = new Set(teamAssignments.map((a) => a.castaway_id));

  // Also include castaways from events attributed to this player
  if (playerId) {
    for (const event of episodeEvents) {
      if (event.player_id === playerId) {
        teamCastawayIds.add(event.castaway_id);
      }
    }
  }

  const assignmentMap = new Map<string, TeamAssignment>();
  for (const a of teamAssignments) {
    assignmentMap.set(a.castaway_id, a);
  }

  // ---------------------------------------------------------------------------
  // Per-castaway breakdown
  // ---------------------------------------------------------------------------
  const castawayBreakdowns: CastawayBreakdown[] = [];

  for (const castawayId of Array.from(teamCastawayIds)) {
    const assignment = assignmentMap.get(castawayId);
    const pointsFromEpisode = assignment?.points_from_episode ?? 1;
    const episodePointsMap: CastawayEpisodeBreakdown = {};

    for (const event of episodeEvents) {
      if (event.castaway_id !== castawayId) continue;
      if (event.episode_number > maxEpisode) continue;

      if (event.player_id) {
        // Event has player attribution — only count if it belongs to this player
        if (event.player_id !== playerId) continue;
      } else {
        // Legacy/preview event — fall back to points_from_episode cutoff
        if (event.episode_number < pointsFromEpisode) continue;
      }

      episodePointsMap[event.episode_number] =
        (episodePointsMap[event.episode_number] ?? 0) + event.points;
    }

    // Consolation points for eliminated castaways (only if currently on team)
    let consolationPoints = 0;
    if (assignment) {
      const eliminatedEpisode = eliminationMap.get(castawayId);
      if (eliminatedEpisode !== undefined) {
        const eligibleEpisodes = finalizedNumbers.filter(
          (n) => n > eliminatedEpisode && n >= pointsFromEpisode
        );
        consolationPoints = consolationPointsPerEpisode * eligibleEpisodes.length;
      }
    }

    const episodeTotal = Object.values(episodePointsMap).reduce((s, p) => s + p, 0);

    if (episodeTotal !== 0 || consolationPoints !== 0 || assignment) {
      castawayBreakdowns.push({
        castaway_id: castawayId,
        episode_points: episodePointsMap,
        consolation_points: consolationPoints,
        total: episodeTotal + consolationPoints,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Challenge points
  // ---------------------------------------------------------------------------
  const challengePoints = challengeSubmissions
    .filter((s) => s.is_correct === true)
    .reduce((sum, s) => sum + s.points, 0);

  const total =
    castawayBreakdowns.reduce((s, c) => s + c.total, 0) + challengePoints;

  return {
    castaways: castawayBreakdowns,
    challenge_points: challengePoints,
    total,
  };
}
