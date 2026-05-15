import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";

interface PageProps {
  params: { id: string };
}

export default async function AdminHubPage({ params }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  // Link to the next unscored episode, or episode 1 if none exist yet
  const nextEpisodeNum = latestEpisode
    ? latestEpisode.number + 1
    : 1;

  // Check if the latest episode is still unfinalized — if so, go there instead
  let scoreEpisodeNum = nextEpisodeNum;
  if (latestEpisode) {
    const { data: latestEp } = await supabase
      .from("episodes")
      .select("is_finalized")
      .eq("league_id", leagueId)
      .eq("number", latestEpisode.number)
      .single();
    if (latestEp && !latestEp.is_finalized) {
      scoreEpisodeNum = latestEpisode.number;
    }
  }

  const tools = [
    { href: `/league/${leagueId}/admin/castaways`, label: "Castaways", description: "Add, eliminate, or restore castaways" },
    { href: `/league/${leagueId}/admin/tribes`, label: "Tribes", description: "Create and manage tribes for castaways" },
    { href: `/league/${leagueId}/admin/rules`, label: "Scoring Rules", description: "Create and manage point values for events" },
    { href: `/league/${leagueId}/admin/draft`, label: "Draft Setup", description: "Configure draft mode and start the draft" },
    { href: `/league/${leagueId}/admin/episode/${scoreEpisodeNum}`, label: "Score Episode", description: `Score episode ${scoreEpisodeNum}` },
    { href: `/league/${leagueId}/admin/trades`, label: "Trade Approval", description: "Approve or reject player-accepted trades" },
    { href: `/league/${leagueId}/admin/waiver`, label: "Waiver Wire", description: "Configure schedule and process claims" },
    { href: `/league/${leagueId}/admin/late-join`, label: "Late-Join", description: "Assign castaways to late-joining players" },
  ];

  return (
    <AppShell
      title={`Admin Tools — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={getAllLeagueNavLinks(leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-lg border border-border bg-card p-4 hover:bg-muted/50 transition-colors space-y-1"
            >
              <p className="text-sm font-semibold">{tool.label}</p>
              <p className="text-xs text-muted-foreground">{tool.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
