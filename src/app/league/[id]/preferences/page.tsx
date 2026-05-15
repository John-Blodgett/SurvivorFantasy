import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DraftPreferencesForm from "@/components/draft-preferences-form";

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function DraftPreferencesPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: SearchParams;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify membership
  const { data: membership } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Get league info
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  // Get draft status
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .single();

  const draftStarted =
    draft?.status === "active" || draft?.status === "complete";

  // Get all active castaways
  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name, tribe_id, photo_url")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false)
    .order("name", { ascending: true });

  // Get existing preferences for this player
  const { data: existingPrefs } = await supabase
    .from("draft_preferences")
    .select("castaway_id, rank")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .order("rank", { ascending: true });

  const allCastaways = castaways ?? [];
  const prefs = existingPrefs ?? [];

  // Build ordered list: existing ranked first, then unranked alphabetically
  const rankedIds = prefs.map((p) => p.castaway_id);
  const unrankedCastaways = allCastaways.filter(
    (c) => !rankedIds.includes(c.id)
  );
  const rankedCastaways = rankedIds
    .map((id) => allCastaways.find((c) => c.id === id))
    .filter(Boolean) as typeof allCastaways;

  const orderedCastaways = [...rankedCastaways, ...unrankedCastaways];

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
          Draft Preferences — {league.name}
        </h1>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-6">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {searchParams.success === "saved" && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            Preferences saved! You&apos;re all set for the draft.
          </p>
        )}

        {draftStarted ? (
          <div className="rounded-lg border border-border bg-card p-5 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              The draft has already started. Preferences can no longer be
              changed.
            </p>
            <Link
              href={`/league/${leagueId}/draft`}
              className="inline-block rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Go to Draft Room →
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Drag castaways to rank them in order of preference. Your #1
                pick is at the top. If you don&apos;t rank a castaway, they
                will be picked last in alphabetical order.
              </p>
              {prefs.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  You have {prefs.length} castaway
                  {prefs.length !== 1 ? "s" : ""} ranked.
                </p>
              )}
            </div>

            {allCastaways.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No castaways have been added to this league yet.
              </p>
            ) : (
              <DraftPreferencesForm
                leagueId={leagueId}
                castaways={orderedCastaways}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
