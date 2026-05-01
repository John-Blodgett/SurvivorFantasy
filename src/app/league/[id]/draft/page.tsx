import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import DraftRoom from "@/components/draft-room";
import { generateSnakeOrder } from "@/lib/draft";

export default async function DraftRoomPage({
  params,
}: {
  params: { id: string };
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

  // Load draft
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index, started_at")
    .eq("league_id", leagueId)
    .single();

  if (!draft) {
    return (
      <AppShell
        title={`Draft Room — ${league.name}`}
        backHref={`/league/${leagueId}/leaderboard`}
        backLabel="League"
        navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
      >
        <div className="p-4 sm:p-6 max-w-3xl mx-auto">
          <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-2">
            <p className="text-muted-foreground text-sm">
              The draft hasn&apos;t started yet.
            </p>
            <p className="text-xs text-muted-foreground">
              The league admin will start the draft when everyone is ready.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Load players in join order with display names
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

  // Load all castaways
  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name, tribe, photo_url, is_eliminated")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  // Load existing picks
  const { data: picks } = await supabase
    .from("draft_picks")
    .select("id, player_id, castaway_id, pick_number, picked_at")
    .eq("draft_id", draft.id)
    .order("pick_number", { ascending: true });

  const pickedCastawayIds = new Set((picks ?? []).map((p) => p.castaway_id));

  const availableCastaways = (castaways ?? []).filter(
    (c) => !c.is_eliminated && !pickedCastawayIds.has(c.id)
  );

  return (
    <AppShell
      title={`Draft Room — ${league.name}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <DraftRoom
        leagueId={leagueId}
        currentUserId={user.id}
        draft={{
          id: draft.id,
          status: draft.status,
          currentPickIndex: draft.current_pick_index,
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
