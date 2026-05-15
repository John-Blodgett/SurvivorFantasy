import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import DraftRoom from "@/components/draft-room";
import DraftPreferencesForm from "@/components/draft-preferences-form";
import { generateSnakeOrder } from "@/lib/draft";

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function DraftPage({
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

  // Load league
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, roster_size, pick_timer_seconds, draft_mode, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;
  const navLinks = getAllLeagueNavLinks(leagueId, isAdmin);

  // Load draft
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index, started_at, pick_started_at")
    .eq("league_id", leagueId)
    .single();

  // ── PRE-DRAFT: no draft record or draft is pending ──
  if (!draft || draft.status === "pending") {
    return (
      <AppShell
        title={`Draft — ${league.name}`}
        backHref="/dashboard"
        backLabel="Dashboard"
        navLinks={navLinks}
      >
        <PreDraftView
          leagueId={leagueId}
          userId={user.id}
          searchParams={searchParams}
        />
      </AppShell>
    );
  }

  // Load shared data for active + complete states
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at, profiles(display_name)")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  const players = (members ?? []).map((m) => {
    const profile = m.profiles as unknown as { display_name: string } | null;
    return {
      id: m.player_id,
      display_name: profile?.display_name ?? "Unknown",
    };
  });

  const playerIds = players.map((p) => p.id);
  const snakeOrder = generateSnakeOrder(playerIds, league.roster_size);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name, tribe, photo_url, is_eliminated")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  const { data: picks } = await supabase
    .from("draft_picks")
    .select("id, player_id, castaway_id, pick_number, picked_at")
    .eq("draft_id", draft.id)
    .order("pick_number", { ascending: true });

  // ── COMPLETE: show draft results ──
  if (draft.status === "complete") {
    return (
      <AppShell
        title={`Draft Results — ${league.name}`}
        backHref="/dashboard"
        backLabel="Dashboard"
        navLinks={navLinks}
      >
        <DraftResultsView
          players={players}
          picks={picks ?? []}
          castaways={castaways ?? []}
          rosterSize={league.roster_size}
          currentUserId={user.id}
        />
      </AppShell>
    );
  }

  // ── ACTIVE: show live draft room ──
  const pickedCastawayIds = new Set((picks ?? []).map((p) => p.castaway_id));
  const availableCastaways = (castaways ?? []).filter(
    (c) => !c.is_eliminated && !pickedCastawayIds.has(c.id)
  );

  return (
    <AppShell
      title={`Draft Room — ${league.name}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={navLinks}
    >
      <DraftRoom
        leagueId={leagueId}
        currentUserId={user.id}
        draft={{
          id: draft.id,
          status: draft.status,
          currentPickIndex: draft.current_pick_index,
          pickStartedAt: draft.pick_started_at,
        }}
        players={players}
        snakeOrder={snakeOrder}
        availableCastaways={availableCastaways}
        allCastaways={castaways ?? []}
        existingPicks={picks ?? []}
        pickTimerSeconds={league.pick_timer_seconds ?? 90}
        rosterSize={league.roster_size}
      />
    </AppShell>
  );
}

/* ── Pre-Draft View: preferences + waiting message ── */

async function PreDraftView({
  leagueId,
  userId,
  searchParams,
}: {
  leagueId: string;
  userId: string;
  searchParams: SearchParams;
}) {
  const supabase = createClient();

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name, tribe, photo_url")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false)
    .order("name", { ascending: true });

  const { data: existingPrefs } = await supabase
    .from("draft_preferences")
    .select("castaway_id, rank")
    .eq("league_id", leagueId)
    .eq("player_id", userId)
    .order("rank", { ascending: true });

  const allCastaways = castaways ?? [];
  const prefs = existingPrefs ?? [];

  const rankedIds = prefs.map((p) => p.castaway_id);
  const unrankedCastaways = allCastaways.filter(
    (c) => !rankedIds.includes(c.id)
  );
  const rankedCastaways = rankedIds
    .map((id) => allCastaways.find((c) => c.id === id))
    .filter(Boolean) as typeof allCastaways;

  const orderedCastaways = [...rankedCastaways, ...unrankedCastaways];

  return (
    <main className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
        <p className="text-sm font-medium">
          The draft hasn&apos;t started yet
        </p>
        <p className="text-xs text-muted-foreground">
          The league admin will start the draft when everyone is ready.
          Set your preferences below so auto-pick knows your priorities.
        </p>
      </div>

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
          Preferences saved!
        </p>
      )}

      <div className="space-y-1">
        <h2 className="text-base font-semibold">Draft Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Rank castaways in order of preference. Your #1 pick is at the top.
          Unranked castaways will be picked last in alphabetical order.
        </p>
        {prefs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            You have {prefs.length} castaway{prefs.length !== 1 ? "s" : ""}{" "}
            ranked.
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
    </main>
  );
}

/* ── Draft Results View: shows completed draft picks by team ── */

function DraftResultsView({
  players,
  picks,
  castaways,
  rosterSize,
  currentUserId,
}: {
  players: { id: string; display_name: string }[];
  picks: {
    id: string;
    player_id: string;
    castaway_id: string;
    pick_number: number;
    picked_at: string;
  }[];
  castaways: {
    id: string;
    name: string;
    tribe_id: string | null;
    photo_url: string | null;
    is_eliminated: boolean;
  }[];
  rosterSize: number;
  currentUserId: string;
}) {
  const castawayMap = Object.fromEntries(castaways.map((c) => [c.id, c]));
  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  // Group picks by player
  const teamByPlayer: Record<string, typeof picks> = {};
  for (const pick of picks) {
    if (!teamByPlayer[pick.player_id]) teamByPlayer[pick.player_id] = [];
    teamByPlayer[pick.player_id].push(pick);
  }

  return (
    <main className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold text-green-700">
          ✓ Draft complete! All teams have been assigned.
        </p>
      </div>

      {/* Teams */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Teams</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => {
            const playerPicks = teamByPlayer[player.id] ?? [];
            return (
              <div
                key={player.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {player.display_name}
                    {player.id === currentUserId && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {playerPicks.length}/{rosterSize}
                  </span>
                </div>
                {playerPicks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {playerPicks.map((pick) => {
                      const c = castawayMap[pick.castaway_id];
                      return (
                        <li
                          key={pick.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="text-muted-foreground w-4 text-right shrink-0">
                            {pick.pick_number}
                          </span>
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                            {c?.photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={c.photo_url}
                                alt={c?.name ?? ""}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-muted-foreground">
                                {c?.name?.charAt(0) ?? "?"}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="font-medium truncate block">
                              {c?.name ?? "Unknown"}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No picks</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Full pick order */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Pick Order</h2>
        <ol className="space-y-1">
          {picks.map((pick) => {
            const c = castawayMap[pick.castaway_id];
            const p = playerMap[pick.player_id];
            return (
              <li
                key={pick.id}
                className="flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground w-5 text-right shrink-0">
                  {pick.pick_number}
                </span>
                <div className="w-6 h-6 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                  {c?.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.photo_url}
                      alt={c?.name ?? ""}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {c?.name?.charAt(0) ?? "?"}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">
                    {c?.name ?? "Unknown"}
                  </span>
                </div>
                <span className="text-muted-foreground shrink-0">
                  {p?.display_name ?? "Unknown"}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
