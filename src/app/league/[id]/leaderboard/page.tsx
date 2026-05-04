import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computePlayerScore } from "@/lib/scoring";
import { computeLeaderboard } from "@/lib/leaderboard";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
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
    .select("id, name, season_number, consolation_points, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

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
    .select("castaway_id, points, player_id, episodes!inner(league_id, number, is_finalized)")
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

  // Fetch all castaways for name lookup
  const { data: allCastawaysRaw } = await supabase
    .from("castaways")
    .select("id, name, is_eliminated, photo_url")
    .eq("league_id", leagueId);

  const castawayMap = new Map(
    (allCastawaysRaw ?? []).map((c) => [c.id, c])
  );

  // Build player → castaway details map
  const playerCastaways = new Map<string, { name: string; is_eliminated: boolean; photo_url: string | null }[]>();
  for (const a of allAssignmentsRaw ?? []) {
    const c = castawayMap.get(a.castaway_id);
    if (!c) continue;
    const list = playerCastaways.get(a.player_id) ?? [];
    list.push({ name: c.name, is_eliminated: c.is_eliminated, photo_url: c.photo_url });
    playerCastaways.set(a.player_id, list);
  }

  // Compute score for each member
  const playerScores = (members ?? []).map((member) => {
    const playerId = member.player_id;
    const profileData = member.profiles as unknown as { display_name: string } | null;
    const displayName: string = profileData?.display_name ?? "Unknown Player";

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
      playerId,
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
    <AppShell
      title={`${league.name} — Leaderboard`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
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
                  <th className="px-3 sm:px-4 py-3 text-left font-medium text-muted-foreground w-12">
                    Rank
                  </th>
                  <th className="px-3 sm:px-4 py-3 text-left font-medium text-muted-foreground">
                    Player
                  </th>
                  <th className="hidden lg:table-cell px-3 sm:px-4 py-3 text-left font-medium text-muted-foreground">
                    Castaways
                  </th>
                  <th className="px-3 sm:px-4 py-3 text-right font-medium text-muted-foreground w-24">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const isCurrentUser = entry.player_id === user.id;
                  const castawayList = playerCastaways.get(entry.player_id) ?? [];
                  return (
                    <tr
                      key={entry.player_id}
                      className={`border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${
                        isCurrentUser ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-3 sm:px-4 py-3 tabular-nums font-semibold text-muted-foreground">
                        {entry.rank}
                      </td>
                      <td className="px-3 sm:px-4 py-3">
                        <Link
                          href={`/league/${leagueId}/team/${entry.player_id}`}
                          className="font-medium hover:underline min-h-[44px] flex flex-col justify-center"
                        >
                          <span>
                            {entry.display_name}
                            {isCurrentUser && (
                              <span className="ml-2 text-xs text-muted-foreground font-normal">
                                (you)
                              </span>
                            )}
                          </span>
                          {/* Show castaways inline on small screens only */}
                          {castawayList.length > 0 && (
                            <span className="flex flex-wrap gap-2 mt-1 lg:hidden">
                              {castawayList.map((c) => (
                                <span
                                  key={c.name}
                                  className={`inline-flex items-center gap-1 text-xs text-muted-foreground font-normal ${
                                    c.is_eliminated ? "opacity-50" : ""
                                  }`}
                                >
                                  {c.photo_url ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                      src={c.photo_url}
                                      alt={c.name}
                                      className="rounded-full object-cover w-5 h-5 shrink-0"
                                    />
                                  ) : (
                                    <span className="w-5 h-5 rounded-full bg-muted shrink-0" />
                                  )}
                                  <span className={c.is_eliminated ? "line-through" : ""}>
                                    {c.name}
                                  </span>
                                </span>
                              ))}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="hidden lg:table-cell px-3 sm:px-4 py-3">
                        {castawayList.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {castawayList.map((c) => (
                              <span
                                key={c.name}
                                className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${
                                  c.is_eliminated ? "opacity-50" : ""
                                }`}
                              >
                                {c.photo_url ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img
                                    src={c.photo_url}
                                    alt={c.name}
                                    className="rounded-full object-cover w-5 h-5 shrink-0"
                                  />
                                ) : (
                                  <span className="w-5 h-5 rounded-full bg-muted shrink-0" />
                                )}
                                <span className={c.is_eliminated ? "line-through" : ""}>
                                  {c.name}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-right tabular-nums font-semibold">
                        {entry.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
