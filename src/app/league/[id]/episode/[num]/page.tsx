import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import { groupEventsByCastaway, type RecapEvent } from "@/lib/episode-recap";

interface PageProps {
  params: { id: string; num: string };
}

export default async function EpisodeRecapPage({ params }: PageProps) {
  const episodeNumber = parseInt(params.num, 10);
  if (isNaN(episodeNumber) || episodeNumber < 1) redirect("/dashboard");

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
    .select("id, name, season_number, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Fetch the episode
  const { data: episode } = await supabase
    .from("episodes")
    .select("id, number, title, is_finalized, finalized_at")
    .eq("league_id", leagueId)
    .eq("number", episodeNumber)
    .single();

  if (!episode) {
    return (
      <AppShell
        title={`Episode ${episodeNumber}`}
        backHref={`/league/${leagueId}/leaderboard`}
        backLabel="Leaderboard"
        navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
      >
        <div className="p-4 sm:p-6 max-w-3xl mx-auto">
          <p className="text-muted-foreground text-sm">
            This episode has not been scored yet.
          </p>
        </div>
      </AppShell>
    );
  }

  // Fetch all episode events with castaway names and scoring rule names
  const { data: rawEvents } = await supabase
    .from("episode_events")
    .select(
      "id, episode_id, castaway_id, scoring_rule_id, points, created_at, castaways(id, name), scoring_rules(name)"
    )
    .eq("episode_id", episode.id)
    .order("created_at", { ascending: true });

  // Fetch team assignments to determine which player benefits from each event
  const { data: teamAssignments } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id, profiles(display_name)")
    .eq("league_id", leagueId);

  // Build a map of castaway_id -> player display name
  const castawayOwnerMap = new Map<string, string>();
  for (const assignment of teamAssignments ?? []) {
    const profileData = assignment.profiles as unknown as { display_name: string } | null;
    castawayOwnerMap.set(
      assignment.castaway_id,
      profileData?.display_name ?? "Unknown"
    );
  }

  // Transform raw events into RecapEvent format
  const recapEvents: RecapEvent[] = (rawEvents ?? []).map((e: Record<string, unknown>) => ({
    id: e.id as string,
    castaway_id: e.castaway_id as string,
    castaway_name:
      (e.castaways as Record<string, unknown> | null)?.name as string ?? "Unknown",
    scoring_rule_name:
      (e.scoring_rules as Record<string, unknown> | null)?.name as string ?? null,
    points: e.points as number,
    benefiting_player_name: castawayOwnerMap.get(e.castaway_id as string) ?? null,
  }));

  const groups = groupEventsByCastaway(recapEvents);

  return (
    <AppShell
      title={`Episode ${episodeNumber}${episode.title ? ` — ${episode.title}` : ""}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="Leaderboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
      badge={episode.is_finalized ? "Finalized" : undefined}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          {league.name} — Season {league.season_number}
        </p>

        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No events recorded for this episode.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div
                key={group.castaway_id}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="px-4 py-3 bg-muted/50 border-b border-border flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{group.castaway_name}</h2>
                  <span className="text-sm font-semibold tabular-nums">
                    {group.total_points > 0 ? "+" : ""}
                    {group.total_points} pts
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {group.events.map((event) => (
                    <li
                      key={event.id}
                      className="px-4 py-2.5 flex items-center justify-between gap-2 min-h-[44px]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {event.rule_name ?? "Consolation"}
                        </p>
                        {event.benefiting_player_name && (
                          <p className="text-xs text-muted-foreground">
                            → {event.benefiting_player_name}
                          </p>
                        )}
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums shrink-0 ${
                          event.points < 0 ? "text-destructive" : "text-green-700"
                        }`}
                      >
                        {event.points > 0 ? `+${event.points}` : event.points}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <Link
            href={`/league/${leagueId}/episodes`}
            className="text-sm text-primary hover:underline min-h-[44px] inline-flex items-center"
          >
            ← All Episodes
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
