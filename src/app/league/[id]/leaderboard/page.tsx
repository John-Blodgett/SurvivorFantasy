import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computePlayerScore } from "@/lib/scoring";
import { computeLeaderboard } from "@/lib/leaderboard";
import type {
  TeamAssignment,
  EpisodeEvent,
  EliminatedCastaway,
  FinalizedEpisode,
  ChallengeSubmission,
} from "@/lib/scoring";

interface PageProps {
  params: { id: string };
}

export default async function LeaderboardPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify the user is a member of this league
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Fetch league info
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season_number, consolation_points")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch all league members with their display names
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, profiles(display_name)")
    .eq("league_id", leagueId);

  // Fetch all finalized episodes
  const { data: finalizedEpisodesRaw } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true);

  const finalizedEpisodes: FinalizedEpisode[] = (finalizedEpisodesRaw ?? []).map(
    (e) => ({ number: e.number })
  );

  // Fetch all episode events for this league (join through episodes)
  const { data: episodeEventsRaw } = await supabase
    .from("episode_events")
    .select("castaway_id, points, episodes!inner(league_id, number, is_finalized)")
    .eq("episodes.league_id", leagueId)
    .eq("episodes.is_finalized", true);

  const allEpisodeEvents: EpisodeEvent[] = (episodeEventsRaw ?? []).map(
    (e: Record<string, unknown>) => ({
      episode_number: (e.episodes as Record<string, unknown>).number as number,
      castaway_id: e.castaway_id as string,
      points: e.points as number,
    })
  );

  // Fetch all eliminated castaways
  const { data: eliminatedRaw } = await supabase
    .from("castaways")
    .select("id, eliminated_episode")
    .eq("league_id", leagueId)
    .eq("is_eliminated", true);

  const eliminatedCastaways: EliminatedCastaway[] = (eliminatedRaw ?? [])
    .filter((c) => c.eliminated_episode !== null)
    .map((c) => ({
      castaway_id: c.id,
      eliminated_episode: c.eliminated_episode!,
    }));

  // Fetch all team assignments for this league
  const { data: allAssignmentsRaw } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id, points_from_episode, source")
    .eq("league_id", leagueId);

  // Fetch all correct challenge submissions for this league
  const { data: challengeSubsRaw } = await supabase
    .from("challenge_submissions")
    .select("player_id, is_correct, challenges!inner(league_id, points)")
    .eq("challenges.league_id", leagueId)
    .eq("is_correct", true);

  // Compute score for each member
  const playerScores = (members ?? []).map((member) => {
    const playerId = member.player_id;
    const displayName =
      (member.profiles as Record<string, unknown>)?.display_name ?? "Unknown Player";

    const assignments: TeamAssignment[] = (allAssignmentsRaw ?? [])
      .filter((a) => a.player_id === playerId)
      .map((a) => ({
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
      assignments,
      allEpisodeEvents,
      eliminatedCastaways,
      finalizedEpisodes,
      league.consolation_points,
      challengeSubs
    );

    return {
      player_id: playerId,
      display_name: displayName,
      total: scoreResult.total,
    };
  });

  const leaderboard = computeLeaderboard(playerScores);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">
          {league.name} — Leaderboard
        </h1>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          Season {league.season_number} &middot;{" "}
          {finalizedEpisodes.length} episode
          {finalizedEpisodes.length !== 1 ? "s" : ""} scored
        </p>

        {leaderboard.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No players in this league yet.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground w-12">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Player
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground w-24">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const isCurrentUser = entry.player_id === user.id;
                  return (
                    <tr
                      key={entry.player_id}
                      className={`border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${
                        isCurrentUser ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3 tabular-nums font-semibold text-muted-foreground">
                        {entry.rank}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/league/${leagueId}/team/${entry.player_id}`}
                          className="font-medium hover:underline"
                        >
                          {entry.display_name}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs text-muted-foreground font-normal">
                              (you)
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {entry.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
