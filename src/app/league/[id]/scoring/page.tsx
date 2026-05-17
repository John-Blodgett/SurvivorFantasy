import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";

interface PageProps {
  params: { id: string };
  searchParams: { episode?: string; player?: string; castaway?: string; show?: string };
}

export default async function ScoringLogPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify membership
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
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Parse filters from search params
  const episodeFilter = searchParams.episode ? parseInt(searchParams.episode, 10) : null;
  const playerFilter = searchParams.player ?? null;
  const castawayFilter = searchParams.castaway ?? null;
  const showAll = searchParams.show === "all"; // default: only show events assigned to a player

  // Fetch all finalized episodes for the sub-nav
  const { data: allEpisodes } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: true });

  const episodeNumbers = (allEpisodes ?? []).map((e) => e.number);

  // Fetch all league members for player filter
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, profiles(display_name)")
    .eq("league_id", leagueId);

  const players = (members ?? []).map((m) => ({
    id: m.player_id,
    name: (m.profiles as unknown as { display_name: string } | null)?.display_name ?? "Unknown",
  }));

  // Fetch all castaways for photos and castaway filter
  const { data: allCastaways } = await supabase
    .from("castaways")
    .select("id, name, photo_url")
    .eq("league_id", leagueId)
    .order("name");

  const castawayMap = new Map(
    (allCastaways ?? []).map((c) => [c.id, { name: c.name, photo_url: c.photo_url }])
  );

  // Fetch episode events
  let query = supabase
    .from("episode_events")
    .select(`
      id,
      points,
      player_id,
      scoring_rule_id,
      castaway_id,
      created_at,
      episodes!inner(number, league_id, is_finalized),
      castaways!inner(name),
      scoring_rules(name)
    `)
    .eq("episodes.league_id", leagueId)
    .eq("episodes.is_finalized", true);

  if (episodeFilter) {
    query = query.eq("episodes.number", episodeFilter);
  }
  if (playerFilter) {
    query = query.eq("player_id", playerFilter);
  }
  if (!showAll && !playerFilter) {
    query = query.not("player_id", "is", null);
  }
  if (castawayFilter) {
    query = query.eq("castaway_id", castawayFilter);
  }

  const { data: eventsRaw } = await query.order("created_at", { ascending: true });

  // Fetch graded challenge submissions for the scoring log
  let challengeQuery = supabase
    .from("challenge_submissions")
    .select("id, player_id, is_correct, submitted_at, challenges!inner(league_id, title, points, episodes!inner(number))")
    .eq("challenges.league_id", leagueId)
    .eq("is_correct", true);

  if (playerFilter) {
    challengeQuery = challengeQuery.eq("player_id", playerFilter);
  }
  if (episodeFilter) {
    challengeQuery = challengeQuery.eq("challenges.episodes.number", episodeFilter);
  }

  const { data: challengeSubsRaw } = await challengeQuery.order("submitted_at", { ascending: true });

  // Fetch all profiles for player name lookup
  const profileMap = new Map(
    players.map((p) => [p.id, p.name])
  );

  // Build the scoring log with running totals per player
  const playerTotals = new Map<string, number>();

  const events = (eventsRaw ?? []).map((e: Record<string, unknown>) => {
    const episode = e.episodes as Record<string, unknown>;
    const castaway = e.castaways as Record<string, unknown>;
    const rule = e.scoring_rules as Record<string, unknown> | null;
    const playerId = e.player_id as string | null;
    const points = e.points as number;
    const castawayId = e.castaway_id as string;

    // Update running total for this player
    if (playerId) {
      const current = playerTotals.get(playerId) ?? 0;
      playerTotals.set(playerId, current + points);
    }

    return {
      id: e.id as string,
      episode_number: episode.number as number,
      castaway_id: castawayId,
      castaway_name: castaway.name as string,
      castaway_photo: castawayMap.get(castawayId)?.photo_url ?? null,
      rule_name: rule?.name as string | null ?? (points > 0 ? "Consolation" : null),
      points,
      player_name: playerId ? (profileMap.get(playerId) ?? "Unknown") : "Unassigned",
      player_id: playerId,
      running_total: playerId ? playerTotals.get(playerId)! : null,
    };
  });

  // Add challenge points to the log (no castaway associated)
  if (!castawayFilter) {
    for (const sub of challengeSubsRaw ?? []) {
      const s = sub as Record<string, unknown>;
      const challenge = s.challenges as Record<string, unknown>;
      const episode = challenge.episodes as Record<string, unknown>;
      const playerId = s.player_id as string;
      const points = challenge.points as number;
      const epNumber = episode.number as number;

      const current = playerTotals.get(playerId) ?? 0;
      playerTotals.set(playerId, current + points);

      events.push({
        id: `challenge-${s.id}`,
        episode_number: epNumber,
        castaway_id: "",
        castaway_name: "",
        castaway_photo: null,
        rule_name: `Challenge: ${challenge.title as string}`,
        points,
        player_name: profileMap.get(playerId) ?? "Unknown",
        player_id: playerId,
        running_total: playerTotals.get(playerId)!,
      });
    }
  }

  // Sort all events by episode number, then by creation order
  events.sort((a, b) => {
    if (a.episode_number !== b.episode_number) return a.episode_number - b.episode_number;
    return 0; // preserve insertion order within same episode
  });

  // Recompute running totals after sorting
  playerTotals.clear();
  for (const event of events) {
    if (event.player_id) {
      const current = playerTotals.get(event.player_id) ?? 0;
      playerTotals.set(event.player_id, current + event.points);
      event.running_total = playerTotals.get(event.player_id)!;
    }
  }

  // Build filter URL helper
  function filterUrl(overrides: { episode?: string | null; player?: string | null; castaway?: string | null; show?: string | null }) {
    const params = new URLSearchParams();
    const ep = overrides.episode !== undefined ? overrides.episode : searchParams.episode;
    const pl = overrides.player !== undefined ? overrides.player : searchParams.player;
    const ca = overrides.castaway !== undefined ? overrides.castaway : searchParams.castaway;
    const sh = overrides.show !== undefined ? overrides.show : searchParams.show;
    if (ep) params.set("episode", ep);
    if (pl) params.set("player", pl);
    if (ca) params.set("castaway", ca);
    if (sh) params.set("show", sh);
    const qs = params.toString();
    return `/league/${leagueId}/scoring${qs ? `?${qs}` : ""}`;
  }

  // Castaway breakdown (when a castaway is selected)
  let castawayBreakdown: { episode: number; points: number; rule: string | null }[] | null = null;
  if (castawayFilter) {
    castawayBreakdown = events.map((e) => ({
      episode: e.episode_number,
      points: e.points,
      rule: e.rule_name,
    }));
  }

  const selectedCastawayName = castawayFilter ? castawayMap.get(castawayFilter)?.name : null;

  return (
    <AppShell
      title={`${league.name} — Scoring Log`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          Every scoring event across finalized episodes. Filter by episode, player, or click a castaway for their breakdown.
        </p>

        {/* Episode filter pills */}
        {episodeNumbers.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Episode</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={filterUrl({ episode: null })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  !episodeFilter
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All
              </Link>
              {episodeNumbers.map((num) => (
                <Link
                  key={num}
                  href={filterUrl({ episode: String(num) })}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    episodeFilter === num
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  Ep {num}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Player filter pills */}
        {players.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Player</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={filterUrl({ player: null, show: null })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  !playerFilter && !showAll
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Assigned
              </Link>
              <Link
                href={filterUrl({ player: null, show: "all" })}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  !playerFilter && showAll
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                All
              </Link>
              {players.map((p) => (
                <Link
                  key={p.id}
                  href={filterUrl({ player: p.id })}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    playerFilter === p.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Castaway breakdown view */}
        {castawayFilter && castawayBreakdown && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {castawayMap.get(castawayFilter)?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={castawayMap.get(castawayFilter)!.photo_url!}
                    alt={selectedCastawayName ?? ""}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {selectedCastawayName?.charAt(0)}
                  </span>
                )}
                <h3 className="text-sm font-semibold">{selectedCastawayName} — Episode Breakdown</h3>
              </div>
              <Link
                href={filterUrl({ castaway: null })}
                className="text-xs text-primary hover:underline"
              >
                Clear
              </Link>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Episode</th>
                  <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Event</th>
                  <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Points</th>
                </tr>
              </thead>
              <tbody>
                {castawayBreakdown.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 tabular-nums">{row.episode}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{row.rule ?? "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                      row.points > 0 ? "text-green-700" : row.points < 0 ? "text-destructive" : ""
                    }`}>
                      {row.points > 0 ? `+${row.points}` : row.points}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30">
                  <td className="px-2 py-1.5 font-semibold" colSpan={2}>Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                    {castawayBreakdown.reduce((s, r) => s + r.points, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Events list */}
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No scoring events match the current filters.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: card layout */}
            <div className="space-y-2 lg:hidden">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-center gap-3"
                >
                  {/* Avatar / icon */}
                  {event.castaway_id ? (
                    <Link href={filterUrl({ castaway: event.castaway_id })} className="shrink-0">
                      {event.castaway_photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={event.castaway_photo} alt={event.castaway_name} className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                          {event.castaway_name.charAt(0)}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm shrink-0">🏆</span>
                  )}

                  {/* Details — single row with wrapping */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {event.castaway_id ? (
                        <Link href={filterUrl({ castaway: event.castaway_id })} className="hover:underline">
                          {event.castaway_name}
                        </Link>
                      ) : (
                        "Challenge"
                      )}
                      {event.episode_number > 0 && (
                        <span className="ml-1.5 text-[10px] font-normal text-muted-foreground bg-muted rounded px-1 py-0.5">
                          Ep {event.episode_number}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {event.rule_name ?? "—"} · <Link href={filterUrl({ player: event.player_id })} className="hover:underline">{event.player_name}</Link>
                    </p>
                  </div>

                  {/* Points */}
                  <div className="text-right shrink-0 pl-2">
                    <p className={`text-sm font-bold tabular-nums ${
                      event.points > 0 ? "text-green-700" : event.points < 0 ? "text-destructive" : ""
                    }`}>
                      {event.points > 0 ? `+${event.points}` : event.points}
                    </p>
                    {event.running_total !== null && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">{event.running_total}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table layout */}
            <div className="hidden lg:block rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Ep</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Castaway</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Event</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Pts</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Team</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {event.episode_number > 0 ? event.episode_number : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {event.castaway_id ? (
                          <Link
                            href={filterUrl({ castaway: event.castaway_id })}
                            className="flex items-center gap-2 hover:underline"
                          >
                            {event.castaway_photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={event.castaway_photo} alt={event.castaway_name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                            ) : (
                              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                                {event.castaway_name.charAt(0)}
                              </span>
                            )}
                            <span className="font-medium">{event.castaway_name}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground italic">🏆 Challenge</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{event.rule_name ?? "—"}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        event.points > 0 ? "text-green-700" : event.points < 0 ? "text-destructive" : ""
                      }`}>
                        {event.points > 0 ? `+${event.points}` : event.points}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={filterUrl({ player: event.player_id })} className="hover:underline">
                          {event.player_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-muted-foreground">
                        {event.running_total !== null ? event.running_total : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
