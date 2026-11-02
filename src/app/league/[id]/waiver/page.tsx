import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import WaiverPoolGrid from "@/components/waiver-pool-grid";
import WaiverPendingClaims from "@/components/waiver-pending-claims";
import SubmitButton from "@/components/submit-button";
import { createAllyAction } from "./actions";
import { computeAllyPoints } from "@/lib/scoring";
import type { EpisodeEvent, TeamAssignment, EliminatedCastaway, FinalizedEpisode } from "@/lib/scoring";
import { computePlayerScore } from "@/lib/scoring";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string; ally?: string };
}

export default async function WaiverWirePage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify membership and get budget
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id, waiver_budget_remaining")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Fetch league info
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, waiver_budget, admin_id, consolation_points")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Get tribes for name/color lookup
  const { data: tribes } = await supabase
    .from("tribes")
    .select("id, name, color")
    .eq("league_id", leagueId);

  const tribeMap = new Map<string, { name: string; color: string | null }>(
    (tribes ?? []).map((t) => [t.id, { name: t.name, color: t.color }])
  );

  // Get all team assignments in the league
  const { data: allAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId);

  const assignedCastawayIds = new Set(
    (allAssignments ?? []).map((a) => a.castaway_id)
  );

  // Get player's own team castaways
  const playerTeamIds = new Set(
    (allAssignments ?? [])
      .filter((a) => a.player_id === user.id)
      .map((a) => a.castaway_id)
  );

  // Get all castaways in the league (with tribe_id)
  const { data: allCastaways } = await supabase
    .from("castaways")
    .select("id, name, tribe_id, photo_url, is_eliminated")
    .eq("league_id", leagueId)
    .order("name");

  // Waiver pool: not eliminated, not assigned
  const waiverCastaways = (allCastaways ?? [])
    .filter((c) => !c.is_eliminated && !assignedCastawayIds.has(c.id))
    .map((c) => {
      const tribe = c.tribe_id ? tribeMap.get(c.tribe_id) : null;
      return {
        id: c.id,
        name: c.name,
        photo_url: c.photo_url,
        tribe_name: tribe?.name ?? null,
        tribe_color: tribe?.color ?? null,
      };
    });

  // Player's team castaways (for drop selector)
  const playerCastaways = (allCastaways ?? [])
    .filter((c) => playerTeamIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  // Get player's pending claims
  const { data: pendingClaims } = await supabase
    .from("waiver_claims")
    .select("id, castaway_id, drop_castaway_id, bid_amount, priority")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("status", "pending")
    .order("priority", { ascending: true });

  // Build name lookup for claims
  const castawayNameMap = new Map(
    (allCastaways ?? []).map((c) => [c.id, c.name])
  );

  const claimsForClient = (pendingClaims ?? []).map((claim) => ({
    id: claim.id,
    castaway_name: castawayNameMap.get(claim.castaway_id) ?? "Unknown",
    drop_castaway_name: castawayNameMap.get(claim.drop_castaway_id) ?? "Unknown",
    bid_amount: claim.bid_amount,
    priority: claim.priority,
  }));

  // Budget calculations
  const budgetRemaining = membership.waiver_budget_remaining;
  const budgetTotal = league.waiver_budget;
  const budgetPercent = budgetTotal > 0 ? (budgetRemaining / budgetTotal) * 100 : 0;

  // ---------------------------------------------------------------------------
  // Alliance section data
  // ---------------------------------------------------------------------------

  // Determine if the player is eligible to ally (all their castaways eliminated)
  const playerCastawayIds = (allAssignments ?? [])
    .filter((a) => a.player_id === user.id)
    .map((a) => a.castaway_id);

  const playerHasActiveCastaways =
    playerCastawayIds.length > 0 &&
    (allCastaways ?? []).some(
      (c) => playerCastawayIds.includes(c.id) && !c.is_eliminated
    );

  const playerHasBeenDrafted = playerCastawayIds.length > 0;
  const isAllyEligible = playerHasBeenDrafted && !playerHasActiveCastaways;

  // Fetch this player's active alliance (if any)
  const { data: activeAlly } = await supabase
    .from("league_allies")
    .select("id, castaway_id, points_from_episode, created_at")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .is("ended_at", null)
    .single();

  // Castaway ally candidates: active, owned by another player, not the current user
  const allyEligibleCastaways = isAllyEligible && !activeAlly
    ? (allCastaways ?? [])
        .filter((c) => !c.is_eliminated && assignedCastawayIds.has(c.id))
        .map((c) => {
          const owner = (allAssignments ?? []).find((a) => a.castaway_id === c.id);
          return owner && owner.player_id !== user.id ? { ...c, owned_by: owner.player_id } : null;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
    : [];

  // Fetch owner display names for ally candidates
  const ownerIds = Array.from(new Set(allyEligibleCastaways.map((c) => c.owned_by)));
  const { data: ownerProfiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ownerIds.length > 0 ? ownerIds : ["__none__"]);
  const ownerProfileMap = new Map((ownerProfiles ?? []).map((p) => [p.id, p.display_name]));

  // Compute current points for each ally candidate castaway (for display)
  const allyPointsMap = new Map<string, number>();
  if (allyEligibleCastaways.length > 0) {
    // Fetch all finalized episodes
    const { data: finalizedEpisodesRaw } = await supabase
      .from("episodes")
      .select("number")
      .eq("league_id", leagueId)
      .eq("is_finalized", true);

    const finalizedEpisodes: FinalizedEpisode[] = (finalizedEpisodesRaw ?? []).map((e) => ({ number: e.number }));

    // Fetch episode events
    const { data: episodeEventsRaw } = await supabase
      .from("episode_events")
      .select("castaway_id, points, player_id, episodes!inner(league_id, number, is_finalized)")
      .eq("episodes.league_id", leagueId)
      .eq("episodes.is_finalized", true);

    const allEpisodeEvents: EpisodeEvent[] = (episodeEventsRaw ?? []).map((e: Record<string, unknown>) => ({
      episode_number: (e.episodes as Record<string, unknown>).number as number,
      castaway_id: e.castaway_id as string,
      points: e.points as number,
      player_id: (e.player_id as string | null) ?? undefined,
    }));

    const { data: eliminatedRaw } = await supabase
      .from("castaways")
      .select("id, eliminated_episode")
      .eq("league_id", leagueId)
      .eq("is_eliminated", true);

    const eliminatedCastaways: EliminatedCastaway[] = (eliminatedRaw ?? [])
      .filter((c) => c.eliminated_episode !== null)
      .map((c) => ({ castaway_id: c.id, eliminated_episode: c.eliminated_episode! }));

    // For each owner, compute their score and extract castaway breakdown
    const ownerAssignmentMap = new Map<string, TeamAssignment[]>();
    for (const c of allyEligibleCastaways) {
      const ownerAssignments = (allAssignments ?? [])
        .filter((a) => a.player_id === c.owned_by)
        .map((a): TeamAssignment => ({
          castaway_id: a.castaway_id,
          points_from_episode: 1,
          source: "draft",
        }));
      ownerAssignmentMap.set(c.owned_by, ownerAssignments);
    }

    for (const c of allyEligibleCastaways) {
      const ownerAssignments = ownerAssignmentMap.get(c.owned_by) ?? [];
      const ownerBreakdown = computePlayerScore(
        c.owned_by,
        ownerAssignments,
        allEpisodeEvents,
        eliminatedCastaways,
        finalizedEpisodes,
        league.consolation_points,
        []
      );
      const castawayBreakdown = ownerBreakdown.castaways.find(
        (cb) => cb.castaway_id === c.id
      );
      allyPointsMap.set(c.id, castawayBreakdown?.total ?? 0);
    }
  }

  // Compute current ally's earned points (for active ally status display)
  let activeAllyEarnedPoints = 0;
  let activeAllyCastawayName = "";
  let activeAllyOwnerName = "";
  if (activeAlly) {
    const allyCastaway = (allCastaways ?? []).find((c) => c.id === activeAlly.castaway_id);
    activeAllyCastawayName = allyCastaway?.name ?? "Unknown";

    const allyOwner = (allAssignments ?? []).find((a) => a.castaway_id === activeAlly.castaway_id);
    if (allyOwner) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", allyOwner.player_id)
        .single();
      activeAllyOwnerName = ownerProfile?.display_name ?? "Unknown";

      // Compute earned points from the ally castaway
      const { data: finalizedEpisodesRaw } = await supabase
        .from("episodes")
        .select("number")
        .eq("league_id", leagueId)
        .eq("is_finalized", true);
      const finalizedEpisodes: FinalizedEpisode[] = (finalizedEpisodesRaw ?? []).map((e) => ({ number: e.number }));

      const { data: episodeEventsRaw } = await supabase
        .from("episode_events")
        .select("castaway_id, points, player_id, episodes!inner(league_id, number, is_finalized)")
        .eq("episodes.league_id", leagueId)
        .eq("episodes.is_finalized", true);
      const allEpisodeEvents: EpisodeEvent[] = (episodeEventsRaw ?? []).map((e: Record<string, unknown>) => ({
        episode_number: (e.episodes as Record<string, unknown>).number as number,
        castaway_id: e.castaway_id as string,
        points: e.points as number,
        player_id: (e.player_id as string | null) ?? undefined,
      }));

      const { data: eliminatedRaw } = await supabase
        .from("castaways").select("id, eliminated_episode").eq("league_id", leagueId).eq("is_eliminated", true);
      const eliminatedCastaways: EliminatedCastaway[] = (eliminatedRaw ?? [])
        .filter((c) => c.eliminated_episode !== null)
        .map((c) => ({ castaway_id: c.id, eliminated_episode: c.eliminated_episode! }));

      const ownerAssignments: TeamAssignment[] = (allAssignments ?? [])
        .filter((a) => a.player_id === allyOwner.player_id)
        .map((a): TeamAssignment => ({ castaway_id: a.castaway_id, points_from_episode: 1, source: "draft" }));

      const ownerBreakdown = computePlayerScore(
        allyOwner.player_id,
        ownerAssignments,
        allEpisodeEvents,
        eliminatedCastaways,
        finalizedEpisodes,
        league.consolation_points,
        []
      );
      const cb = ownerBreakdown.castaways.find((c) => c.castaway_id === activeAlly.castaway_id);
      if (cb) {
        activeAllyEarnedPoints = computeAllyPoints(cb, activeAlly.points_from_episode);
      }
    }
  }

  // Sort ally candidates by points descending
  const sortedAllyCandidates = [...allyEligibleCastaways].sort(
    (a, b) => (allyPointsMap.get(b.id) ?? 0) - (allyPointsMap.get(a.id) ?? 0)
  );

  // Which castaway are we confirming? (from ?ally=castawayId)
  const confirmingAllyId = searchParams.ally ?? null;
  const confirmingCastaway = confirmingAllyId
    ? allyEligibleCastaways.find((c) => c.id === confirmingAllyId)
    : null;

  return (
    <AppShell
      title={`${league.name} — Moves`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        {/* Feedback banners */}
        {searchParams.error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {searchParams.error}
          </p>
        )}
        {searchParams.success === "ally_created" && (
          <p role="status" className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">
            Alliance created! You&apos;re now allied with {activeAllyCastawayName}.
          </p>
        )}
        {searchParams.success && searchParams.success !== "ally_created" && (
          <p role="status" className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">
            Claim submitted successfully.
          </p>
        )}

        {/* Budget bar */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Waiver Budget</span>
            <span className="text-sm font-bold text-primary">
              ${budgetRemaining} / ${budgetTotal}
            </span>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${budgetPercent}%` }}
              role="progressbar"
              aria-valuenow={budgetRemaining}
              aria-valuemin={0}
              aria-valuemax={budgetTotal}
              aria-label={`${budgetRemaining} of ${budgetTotal} budget remaining`}
            />
          </div>
        </div>

        {/* Pending claims */}
        <WaiverPendingClaims leagueId={leagueId} claims={claimsForClient} />

        {/* Available players */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            Available Players ({waiverCastaways.length})
          </h2>
          <WaiverPoolGrid
            leagueId={leagueId}
            castaways={waiverCastaways}
            playerCastaways={playerCastaways}
            budgetRemaining={budgetRemaining}
          />
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Alliance section — only shown if player has been drafted            */}
        {/* ------------------------------------------------------------------ */}
        {playerHasBeenDrafted && (
          <div className="border-t border-border pt-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Alliance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Players whose castaways are all eliminated can ally with an active castaway
                and earn half their episode points going forward.
              </p>
            </div>

            {/* Active alliance status */}
            {activeAlly && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base">🤝</span>
                  <span className="text-sm font-semibold text-amber-900">
                    Allied with {activeAllyCastawayName}
                  </span>
                </div>
                <p className="text-xs text-amber-800 pl-6">
                  Owned by {activeAllyOwnerName} &middot; Earning from Ep.{" "}
                  {activeAlly.points_from_episode}
                </p>
                {activeAllyEarnedPoints > 0 && (
                  <p className="text-xs font-semibold text-amber-900 pl-6">
                    +{activeAllyEarnedPoints} pts earned so far
                  </p>
                )}
                <p className="text-xs text-amber-700 pl-6 mt-1">
                  Locked in until {activeAllyCastawayName} is eliminated.
                  {" "}Trades won&apos;t break your alliance.
                </p>
              </div>
            )}

            {/* Eligibility message for players with active castaways */}
            {!isAllyEligible && !activeAlly && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  You can ally with an active castaway once all of your own castaways have been eliminated.
                </p>
              </div>
            )}

            {/* Ally selection + confirmation */}
            {isAllyEligible && !activeAlly && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Since all your castaways have been eliminated, you can ally with any active
                  castaway and earn half their episode points from Episode{" "}
                  {/* Show next episode number */}
                  {(allyEligibleCastaways.length > 0 || confirmingCastaway) && (
                    <span className="font-medium text-foreground">
                      {/* points_from_episode will be set server-side; show the latest+1 */}
                      {(sortedAllyCandidates[0] ? allyPointsMap : new Map()).size >= 0
                        ? "the next scored episode"
                        : "the next scored episode"}
                    </span>
                  )}
                  {" "}onward.
                </p>

                {/* Confirmation panel */}
                {confirmingCastaway && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {confirmingCastaway.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={confirmingCastaway.photo_url}
                          alt={confirmingCastaway.name}
                          className="w-12 h-12 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <span className="w-12 h-12 rounded-full bg-amber-200 flex items-center justify-center text-lg font-semibold text-amber-800 shrink-0">
                          {confirmingCastaway.name.charAt(0)}
                        </span>
                      )}
                      <div>
                        <p className="font-semibold text-sm">{confirmingCastaway.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Owned by {ownerProfileMap.get(confirmingCastaway.owned_by) ?? "Unknown"} &middot;{" "}
                          {allyPointsMap.get(confirmingCastaway.id) ?? 0} pts so far
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-amber-900">
                      You&apos;ll earn half of {confirmingCastaway.name}&apos;s episode points
                      (rounded up) starting from the next scored episode.
                    </p>
                    <div className="rounded border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">⚠</span>
                      <span>
                        You&apos;re locked in until {confirmingCastaway.name} is eliminated.
                        If {confirmingCastaway.name} is traded, your alliance follows the castaway to their new owner.
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <a
                        href={`/league/${leagueId}/waiver`}
                        className="flex-1 text-center rounded border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                      >
                        Cancel
                      </a>
                      <form action={createAllyAction} className="flex-1">
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="castaway_id" value={confirmingCastaway.id} />
                        <SubmitButton
                          pendingText="Confirming…"
                          className="w-full rounded bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 transition-colors min-h-[44px] disabled:opacity-50"
                        >
                          Confirm — Ally with {confirmingCastaway.name}
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                )}

                {/* Candidate list */}
                {sortedAllyCandidates.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      No active owned castaways available to ally with right now.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sortedAllyCandidates.map((castaway) => {
                      const isConfirming = confirmingAllyId === castaway.id;
                      const pts = allyPointsMap.get(castaway.id) ?? 0;
                      const ownerName = ownerProfileMap.get(castaway.owned_by) ?? "Unknown";
                      return (
                        <div
                          key={castaway.id}
                          className={`rounded-lg border bg-card p-4 flex items-center gap-4 transition-colors ${
                            isConfirming ? "border-amber-400 bg-amber-50" : "border-border"
                          }`}
                        >
                          {castaway.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={castaway.photo_url}
                              alt={castaway.name}
                              className="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium shrink-0">
                              {castaway.name.charAt(0)}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold">{castaway.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Owned by {ownerName} &middot; {pts} pts so far
                            </p>
                          </div>
                          <a
                            href={`/league/${leagueId}/waiver?ally=${castaway.id}`}
                            className="shrink-0 rounded border border-amber-400 text-amber-700 bg-amber-50 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 transition-colors min-h-[36px] flex items-center"
                            aria-label={`Ally with ${castaway.name}`}
                          >
                            Ally with {castaway.name}
                          </a>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
