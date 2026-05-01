import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getLeagueNavLinks } from "@/components/league-nav";
import { sortEpisodesDescending, type RecapEpisode } from "@/lib/episode-recap";

interface PageProps {
  params: { id: string };
}

export default async function SeasonSummaryPage({ params }: PageProps) {
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
    .select("id, name, season_number")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch all finalized episodes
  const { data: rawEpisodes } = await supabase
    .from("episodes")
    .select("id, number, title, is_finalized, finalized_at")
    .eq("league_id", leagueId)
    .eq("is_finalized", true);

  const episodes: RecapEpisode[] = (rawEpisodes ?? []).map((e) => ({
    episode_id: e.id,
    number: e.number,
    title: e.title,
    finalized_at: e.finalized_at,
  }));

  const sortedEpisodes = sortEpisodesDescending(episodes);

  return (
    <AppShell
      title={`${league.name} — Season ${league.season_number} Episodes`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="Leaderboard"
      navLinks={getLeagueNavLinks(leagueId)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        {sortedEpisodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No episodes have been finalized yet.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              {sortedEpisodes.map((episode) => (
                <li key={episode.episode_id}>
                  <Link
                    href={`/league/${leagueId}/episode/${episode.number}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors min-h-[44px]"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        Episode {episode.number}
                        {episode.title ? ` — ${episode.title}` : ""}
                      </p>
                      {episode.finalized_at && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Finalized{" "}
                          {new Date(episode.finalized_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className="text-muted-foreground text-sm">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
