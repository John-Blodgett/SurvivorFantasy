import {
  computePlayerScore,
  computeAllyPoints,
  type TeamAssignment,
  type EpisodeEvent,
  type EliminatedCastaway,
  type FinalizedEpisode,
  type ChallengeSubmission,
  type CastawayBreakdown,
} from "@/lib/scoring";
import { computeLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";

/**
 * A minimal structural type for the Supabase server client. We only rely on
 * the query-builder surface used below, which keeps this module decoupled from
 * the concrete client type while still being fully typed at the call sites.
 */
type SupabaseLike = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (query: string) => any;
  };
};

/**
 * Fetches all scoring inputs for a league and returns the computed leaderboard.
 *
 * This mirrors the computation used on the leaderboard page so that other
 * server code (e.g. marking a season complete and capturing the winner) can
 * reuse the exact same ranking without duplicating the query/aggregation
 * logic. The pure scoring/ranking math lives in src/lib/scoring.ts and
 * src/lib/leaderboard.ts; this function only orchestrates the data fetch.
 */
export async function computeLeagueLeaderboard(
  supabase: SupabaseLike,
  leagueId: string,
  consolationPoints: number
): Promise<LeaderboardEntry[]> {
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, profiles(display_name)")
    .eq("league_id", leagueId);

  const { data: finalizedEpisodesRaw } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true);

  const finalizedEpisodes: FinalizedEpisode[] = (finalizedEpisodesRaw ?? []).map(
    (e: { number: number }) => ({ number: e.number })
  );

  const { data: episodeEventsRaw } = await supabase
    .from("episode_events")
    .select(
      "castaway_id, points, player_id, episodes!inner(league_id, number, is_finalized)"
    )
    .eq("episodes.league_id", leagueId)
    .eq("episodes.is_finalized", true);

  const allEpisodeEvents: EpisodeEvent[] = (episodeEventsRaw ?? []).map(
    (e: Record<string, unknown>) => ({
      episode_number: (e.episodes as Record<string, unknown>).number as number,
      castaway_id: e.castaway_id as string,
      points: e.points as number,
      player_id: (e.player_id as string | null) ?? undefined,
    })
  );

  const { data: eliminatedRaw } = await supabase
    .from("castaways")
    .select("id, eliminated_episode")
    .eq("league_id", leagueId)
    .eq("is_eliminated", true);

  const eliminatedCastaways: EliminatedCastaway[] = (eliminatedRaw ?? [])
    .filter((c: { eliminated_episode: number | null }) => c.eliminated_episode !== null)
    .map((c: { id: string; eliminated_episode: number }) => ({
      castaway_id: c.id,
      eliminated_episode: c.eliminated_episode,
    }));

  const { data: allAssignmentsRaw } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id, points_from_episode, source")
    .eq("league_id", leagueId);

  const { data: challengeSubsRaw } = await supabase
    .from("challenge_submissions")
    .select("player_id, is_correct, challenges!inner(league_id, points)")
    .eq("challenges.league_id", leagueId)
    .eq("is_correct", true);

  const { data: allAlliesRaw } = await supabase
    .from("league_allies")
    .select("player_id, castaway_id, points_from_episode")
    .eq("league_id", leagueId)
    .is("ended_at", null);

  // Build castaway breakdowns across all owners so alliance points can be
  // looked up regardless of the current owner.
  const castawayBreakdownMap = new Map<string, CastawayBreakdown>();
  for (const member of members ?? []) {
    const playerId = member.player_id as string;
    const assignments: TeamAssignment[] = (allAssignmentsRaw ?? [])
      .filter((a: { player_id: string }) => a.player_id === playerId)
      .map((a: { castaway_id: string; points_from_episode: number; source: string }) => ({
        castaway_id: a.castaway_id,
        points_from_episode: a.points_from_episode,
        source: a.source as TeamAssignment["source"],
      }));
    const result = computePlayerScore(
      playerId,
      assignments,
      allEpisodeEvents,
      eliminatedCastaways,
      finalizedEpisodes,
      consolationPoints,
      []
    );
    for (const cb of result.castaways) {
      castawayBreakdownMap.set(cb.castaway_id, cb);
    }
  }

  const playerAllyPoints = new Map<string, number>();
  for (const ally of allAlliesRaw ?? []) {
    const breakdown = castawayBreakdownMap.get(ally.castaway_id as string);
    const allyPts = breakdown
      ? computeAllyPoints(breakdown, ally.points_from_episode as number)
      : 0;
    playerAllyPoints.set(ally.player_id as string, allyPts);
  }

  const playerScores = (members ?? []).map(
    (member: { player_id: string; profiles: unknown }) => {
      const playerId = member.player_id;
      const profileData = member.profiles as { display_name: string } | null;
      const displayName = profileData?.display_name ?? "Unknown Player";

      const assignments: TeamAssignment[] = (allAssignmentsRaw ?? [])
        .filter((a: { player_id: string }) => a.player_id === playerId)
        .map((a: { castaway_id: string; points_from_episode: number; source: string }) => ({
          castaway_id: a.castaway_id,
          points_from_episode: a.points_from_episode,
          source: a.source as TeamAssignment["source"],
        }));

      const challengeSubs: ChallengeSubmission[] = (challengeSubsRaw ?? [])
        .filter((s: Record<string, unknown>) => s.player_id === playerId)
        .map((s: Record<string, unknown>) => ({
          points: (s.challenges as Record<string, unknown>).points as number,
          is_correct: s.is_correct as boolean,
        }));

      const scoreResult = computePlayerScore(
        playerId,
        assignments,
        allEpisodeEvents,
        eliminatedCastaways,
        finalizedEpisodes,
        consolationPoints,
        challengeSubs
      );

      const allyPts = playerAllyPoints.get(playerId) ?? 0;

      return {
        player_id: playerId,
        display_name: displayName,
        total: scoreResult.total + allyPts,
      };
    }
  );

  return computeLeaderboard(playerScores);
}
