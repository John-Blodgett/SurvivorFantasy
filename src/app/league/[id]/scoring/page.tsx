import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";

interface PageProps {
  params: { id: string };
  searchParams: { episode?: string };
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

  // Parse episode filter from search params
  const episodeFilter = searchParams.episode ? parseInt(searchParams.episode, 10) : null;

  // Fetch all finalized episodes for the sub-nav
  const { data: allEpisodes } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: true });

  const episodeNumbers = (allEpisodes ?? []).map((e) => e.number);

  // Fetch all episode events with joins for castaway name, scoring rule name,
  // player name, and episode number
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

  const { data: eventsRaw } = await query.order("created_at", { ascending: true });

  // Fetch all profiles for player name lookup
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name");

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name])
  );

  // Build the scoring log with running totals per player
  const playerTotals = new Map<string, number>();

  const events = (eventsRaw ?? []).map((e: Record<string, unknown>) => {
    const episode = e.episodes as Record<string, unknown>;
    const castaway = e.castaways as Record<string, unknown>;
    const rule = e.scoring_rules as Record<string, unknown> | null;
    const playerId = e.player_id as string | null;
    const points = e.points as number;

    // Update running total for this player
    if (playerId) {
      const current = playerTotals.get(playerId) ?? 0;
      playerTotals.set(playerId, current + points);
    }

    return {
      id: e.id as string,
      episode_number: episode.number as number,
      castaway_name: castaway.name as string,
      rule_name: rule?.name as string | null ?? (points > 0 ? "Consolation" : null),
      points,
      player_name: playerId ? (profileMap.get(playerId) ?? "Unknown") : "Unassigned",
      player_id: playerId,
      running_total: playerId ? playerTotals.get(playerId)! : null,
    };
  });

  return (
    <AppShell
      title={`${league.name} — Scoring Log`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          Every scoring event across all finalized episodes, showing which player&apos;s team received the points.
        </p>

        {/* Episode sub-navigation */}
        {episodeNumbers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/league/${leagueId}/scoring`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                !episodeFilter
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All Episodes
            </Link>
            {episodeNumbers.map((num) => (
              <Link
                key={num}
                href={`/league/${leagueId}/scoring?episode=${num}`}
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
        )}

        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No scoring events yet. Finalize an episode to see the log.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Ep</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Castaway</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Event</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Pts</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Team</th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Running Total</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {event.episode_number}
                      </td>
                      <td className="px-3 py-2.5 font-medium">
                        {event.castaway_name}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {event.rule_name ?? "—"}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        event.points > 0 ? "text-green-700" : event.points < 0 ? "text-destructive" : ""
                      }`}>
                        {event.points > 0 ? `+${event.points}` : event.points}
                      </td>
                      <td className="px-3 py-2.5">
                        {event.player_name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-muted-foreground">
                        {event.running_total !== null ? event.running_total : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
