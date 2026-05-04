import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { computePlayerScore } from "@/lib/scoring";
import type {
  TeamAssignment,
  EpisodeEvent,
  EliminatedCastaway,
  FinalizedEpisode,
  ChallengeSubmission,
} from "@/lib/scoring";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import TradeProposalForm from "@/components/trade-proposal-form";

interface PageProps {
  params: { id: string; userId: string };
  searchParams: { error?: string; success?: string };
}

export default async function TeamPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;
  const targetUserId = params.userId;

  // Verify the viewer is a member of this league
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

  // Fetch the target player's profile
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", targetUserId)
    .single();

  // Verify the target player is a member of this league
  const { data: targetMembership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", targetUserId)
    .single();

  if (!targetMembership) redirect(`/league/${leagueId}/leaderboard`);

  // Fetch team assignments for the target player
  const { data: assignmentsRaw } = await supabase
    .from("team_assignments")
    .select("castaway_id, points_from_episode, source, assigned_at")
    .eq("league_id", leagueId)
    .eq("player_id", targetUserId);

  const assignments = assignmentsRaw ?? [];

  // Fetch all castaways for this league (to get names, tribes, photos, elimination status)
  const { data: allCastawaysRaw } = await supabase
    .from("castaways")
    .select("id, name, tribe, photo_url, is_eliminated, eliminated_episode")
    .eq("league_id", leagueId);

  const allCastaways = allCastawaysRaw ?? [];

  // Build a map for quick lookup
  const castawayMap = new Map(allCastaways.map((c) => [c.id, c]));

  // Fetch all finalized episodes
  const { data: finalizedEpisodesRaw } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: true });

  const finalizedEpisodes: FinalizedEpisode[] = (finalizedEpisodesRaw ?? []).map(
    (e) => ({ number: e.number })
  );

  const episodeNumbers = (finalizedEpisodesRaw ?? []).map((e) => e.number);

  // Fetch all episode events for this league (finalized only)
  const { data: episodeEventsRaw } = await supabase
    .from("episode_events")
    .select(
      "castaway_id, points, player_id, scoring_rules(name), episodes!inner(league_id, number, is_finalized)"
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

  // Fetch eliminated castaways
  const eliminatedCastaways: EliminatedCastaway[] = allCastaways
    .filter((c) => c.is_eliminated && c.eliminated_episode !== null)
    .map((c) => ({
      castaway_id: c.id,
      eliminated_episode: c.eliminated_episode!,
    }));

  // Fetch challenge submissions for the target player
  const { data: challengeSubsRaw } = await supabase
    .from("challenge_submissions")
    .select("player_id, is_correct, challenges!inner(league_id, points)")
    .eq("challenges.league_id", leagueId)
    .eq("player_id", targetUserId);

  const challengeSubs: ChallengeSubmission[] = (challengeSubsRaw ?? []).map(
    (s: Record<string, unknown>) => ({
      points: (s.challenges as Record<string, unknown>).points as number,
      is_correct: s.is_correct as boolean,
    })
  );

  // Build TeamAssignment array for scoring
  const teamAssignments: TeamAssignment[] = assignments.map((a) => ({
    castaway_id: a.castaway_id,
    points_from_episode: a.points_from_episode,
    source: a.source as TeamAssignment["source"],
  }));

  // Compute the full score breakdown
  const scoreBreakdown = computePlayerScore(
    targetUserId,
    teamAssignments,
    allEpisodeEvents,
    eliminatedCastaways,
    finalizedEpisodes,
    league.consolation_points,
    challengeSubs
  );

  // Build a map from castaway_id to breakdown
  const breakdownMap = new Map(
    scoreBreakdown.castaways.map((c) => [c.castaway_id, c])
  );

  // Separate active and eliminated castaways on this team
  const teamCastawayIds = assignments.map((a) => a.castaway_id);
  const activeCastaways = teamCastawayIds.filter(
    (id) => !castawayMap.get(id)?.is_eliminated
  );
  const eliminatedOnTeam = teamCastawayIds.filter(
    (id) => castawayMap.get(id)?.is_eliminated
  );

  const isOwnTeam = user.id === targetUserId;
  const displayName = targetProfile?.display_name ?? "Unknown Player";

  // Fetch the current user's team assignments for trade proposal (only if viewing another player)
  let myActiveCastaways: { id: string; name: string; tribe: string | null; is_eliminated: boolean }[] = [];
  if (!isOwnTeam) {
    const { data: myAssignments } = await supabase
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", user.id);

    const myCastawayIds = (myAssignments ?? []).map((a) => a.castaway_id);
    myActiveCastaways = allCastaways
      .filter((c) => myCastawayIds.includes(c.id) && !c.is_eliminated)
      .map((c) => ({ id: c.id, name: c.name, tribe: c.tribe, is_eliminated: c.is_eliminated }));
  }

  // Active castaways on the target player's team (for trade form)
  const theirActiveCastaways = activeCastaways
    .map((id) => castawayMap.get(id))
    .filter((c): c is NonNullable<typeof c> => c != null && !c.is_eliminated)
    .map((c) => ({ id: c.id, name: c.name, tribe: c.tribe, is_eliminated: c.is_eliminated }));

  return (
    <AppShell
      title={isOwnTeam ? `My Team — ${league.name}` : `${displayName}'s Team — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="Leaderboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        {/* Summary header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">
              {displayName} &middot; Season {league.season_number}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {scoreBreakdown.total}{" "}
              <span className="text-base font-normal text-muted-foreground">
                pts
              </span>
            </p>
          </div>
          <div className="text-left sm:text-right text-sm text-muted-foreground space-y-0.5">
            <p>{teamCastawayIds.length} castaways</p>
            <p>{finalizedEpisodes.length} episodes scored</p>
          </div>
        </div>

        {/* Trade toast messages */}
        {searchParams.success === "trade_proposed" && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            Trade proposal sent!
          </p>
        )}
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {/* Trade proposal form (only when viewing another player's team) */}
        {!isOwnTeam && (
          <TradeProposalForm
            leagueId={leagueId}
            receiverId={targetUserId}
            myActiveCastaways={myActiveCastaways}
            theirActiveCastaways={theirActiveCastaways}
          />
        )}

        {teamCastawayIds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No castaways on this team yet.
            </p>
          </div>
        ) : (
          <>
            {/* Active castaways */}
            {activeCastaways.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Castaways
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {activeCastaways.map((castawayId) => {
                    const castaway = castawayMap.get(castawayId);
                    const assignment = assignments.find(
                      (a) => a.castaway_id === castawayId
                    );
                    const breakdown = breakdownMap.get(castawayId);
                    if (!castaway || !assignment) return null;
                    return (
                      <CastawayBreakdownCard
                        key={castawayId}
                        castaway={castaway}
                        assignment={assignment}
                        breakdown={breakdown}
                        episodeNumbers={episodeNumbers}
                        isEliminated={false}
                        consolationPointsPerEpisode={league.consolation_points}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Eliminated castaways */}
            {eliminatedOnTeam.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Eliminated Castaways
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {eliminatedOnTeam.map((castawayId) => {
                    const castaway = castawayMap.get(castawayId);
                    const assignment = assignments.find(
                      (a) => a.castaway_id === castawayId
                    );
                    const breakdown = breakdownMap.get(castawayId);
                    if (!castaway || !assignment) return null;
                    return (
                      <CastawayBreakdownCard
                        key={castawayId}
                        castaway={castaway}
                        assignment={assignment}
                        breakdown={breakdown}
                        episodeNumbers={episodeNumbers}
                        isEliminated={true}
                        consolationPointsPerEpisode={league.consolation_points}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Challenge points summary */}
            {scoreBreakdown.challenge_points > 0 && (
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Challenge Points</span>
                  <span className="tabular-nums font-semibold text-sm">
                    +{scoreBreakdown.challenge_points}
                  </span>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: per-castaway breakdown card
// ---------------------------------------------------------------------------

interface CastawayBreakdownCardProps {
  castaway: {
    id: string;
    name: string;
    tribe: string | null;
    photo_url: string | null;
    is_eliminated: boolean;
    eliminated_episode: number | null;
  };
  assignment: {
    castaway_id: string;
    points_from_episode: number;
    source: string;
    assigned_at: string;
  };
  breakdown:
    | {
        castaway_id: string;
        episode_points: Record<number, number>;
        consolation_points: number;
        total: number;
      }
    | undefined;
  episodeNumbers: number[];
  isEliminated: boolean;
  consolationPointsPerEpisode: number;
}

function CastawayBreakdownCard({
  castaway,
  assignment,
  breakdown,
  episodeNumbers,
  isEliminated,
  consolationPointsPerEpisode,
}: CastawayBreakdownCardProps) {
  const total = breakdown?.total ?? 0;
  const episodePoints = breakdown?.episode_points ?? {};
  const consolationPoints = breakdown?.consolation_points ?? 0;

  // Episodes where this castaway has any points (episode events or consolation)
  const relevantEpisodes = episodeNumbers.filter(
    (n) => n >= assignment.points_from_episode
  );

  // Format the assignment metadata label
  let metaLabel: string | null = null;
  if (assignment.source === "trade") {
    const tradeDate = new Date(assignment.assigned_at).toLocaleDateString(
      undefined,
      { month: "short", day: "numeric", year: "numeric" }
    );
    metaLabel = `Traded in on ${tradeDate}`;
  } else if (assignment.source === "admin_assign") {
    metaLabel = `Assigned from Episode ${assignment.points_from_episode}`;
  }

  return (
    <div
      className={`rounded-lg border bg-card overflow-hidden ${
        isEliminated ? "border-border opacity-75" : "border-border"
      }`}
    >
      {/* Castaway header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        {castaway.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={castaway.photo_url}
            alt={castaway.name}
            className={`w-12 h-12 rounded-full object-cover shrink-0 ${
              isEliminated ? "grayscale" : ""
            }`}
          />
        ) : (
          <div
            className={`w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0 text-lg font-semibold text-muted-foreground ${
              isEliminated ? "grayscale" : ""
            }`}
          >
            {castaway.name.charAt(0)}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{castaway.name}</span>
            {castaway.tribe && (
              <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                {castaway.tribe}
              </span>
            )}
            {isEliminated && (
              <span className="text-xs text-destructive bg-destructive/10 rounded px-1.5 py-0.5 font-medium">
                Eliminated Ep. {castaway.eliminated_episode}
              </span>
            )}
          </div>
          {metaLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">{metaLabel}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="tabular-nums font-bold text-sm">{total} pts</p>
        </div>
      </div>

      {/* Episode breakdown table */}
      {relevantEpisodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Episode
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Event Pts
                </th>
                {consolationPoints > 0 && (
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Consolation
                  </th>
                )}
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {relevantEpisodes.map((epNum) => {
                const evPts = episodePoints[epNum] ?? 0;
                // Consolation is awarded per episode after elimination
                const isAfterElimination =
                  isEliminated &&
                  castaway.eliminated_episode !== null &&
                  epNum > castaway.eliminated_episode;
                const conPts = isAfterElimination ? consolationPointsPerEpisode : 0;
                const rowTotal = evPts + conPts;

                if (evPts === 0 && conPts === 0) return null;

                return (
                  <tr
                    key={epNum}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      Ep. {epNum}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {evPts !== 0 ? (
                        <span className={evPts < 0 ? "text-destructive" : ""}>
                          {evPts > 0 ? "+" : ""}
                          {evPts}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    {consolationPoints > 0 && (
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {conPts > 0 ? `+${conPts}` : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {rowTotal > 0 ? `+${rowTotal}` : rowTotal}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td className="px-3 py-2 font-medium text-muted-foreground">
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {Object.values(episodePoints).reduce((s, p) => s + p, 0)}
                </td>
                {consolationPoints > 0 && (
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-muted-foreground">
                    +{consolationPoints}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums font-bold">
                  {total}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {relevantEpisodes.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          No scored episodes yet.
        </p>
      )}
    </div>
  );
}
