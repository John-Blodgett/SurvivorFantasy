import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { buildLeagueNav } from "@/components/league-nav";
import ConfirmSubmitButton from "@/components/confirm-submit-button";
import { markSeasonCompleteAction, reopenSeasonAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminHubPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, admin_id, is_complete, completed_at, winner_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  // If the season is complete, resolve the winner's display name.
  let winnerName: string | null = null;
  if (league.is_complete && league.winner_id) {
    const { data: winner } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", league.winner_id)
      .single();
    winnerName = winner?.display_name ?? null;
  }

  const successMessage =
    searchParams.success === "completed"
      ? "Season marked complete."
      : searchParams.success === "reopened"
      ? "Season reopened."
      : null;
  const errorMessage = searchParams.error ?? null;

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
    { href: `/league/${leagueId}/admin/castaways`, label: "Castaways & Tribes", description: "Manage castaways, tribes, and alliances" },
    { href: `/league/${leagueId}/admin/rules`, label: "Scoring Rules", description: "Create and manage point values for events" },
    { href: `/league/${leagueId}/admin/draft`, label: "Draft", description: "Configure the draft and assign late-joiners" },
    { href: `/league/${leagueId}/admin/episode/${scoreEpisodeNum}`, label: "Score Episode", description: `Score episode ${scoreEpisodeNum}` },
    { href: `/league/${leagueId}/admin/waiver`, label: "Waiver Wire", description: "Configure schedule and process claims" },
  ];

  return (
    <AppShell
      title={`Admin Tools — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={await buildLeagueNav(supabase, leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        {successMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {successMessage}
          </p>
        )}
        {errorMessage && (
          <p
            role="alert"
            className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2"
          >
            {errorMessage}
          </p>
        )}

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

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Season Status</p>
            <p className="text-xs text-muted-foreground">
              {league.is_complete
                ? "This season is complete. It appears under Past Seasons on the dashboard."
                : "Mark the season complete once a winner has been decided. Completed seasons move to Past Seasons on the dashboard."}
            </p>
          </div>

          {league.is_complete ? (
            <>
              <p className="text-sm">
                🏆 Winner:{" "}
                <span className="font-semibold">
                  {winnerName ?? "Not determined"}
                </span>
              </p>
              <form action={reopenSeasonAction}>
                <input type="hidden" name="league_id" value={leagueId} />
                <ConfirmSubmitButton
                  confirmMessage="Reopen this season? It will return to the active leagues list."
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
                >
                  Reopen Season
                </ConfirmSubmitButton>
              </form>
            </>
          ) : (
            <form action={markSeasonCompleteAction}>
              <input type="hidden" name="league_id" value={leagueId} />
              <ConfirmSubmitButton
                confirmMessage="Mark this season complete? The current leaderboard leader will be recorded as the winner."
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors min-h-[44px]"
              >
                Mark Season Complete
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
