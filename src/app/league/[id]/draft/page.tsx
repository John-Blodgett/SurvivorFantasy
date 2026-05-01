import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
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
    .select("id, name, roster_size, pick_timer_seconds, draft_mode")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  // Load draft
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index, started_at")
    .eq("league_id", leagueId)
    .single();

  if (!draft) {
    redirect(`/dashboard`);
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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">Draft Room — {league.name}</h1>
      </header>

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
    </div>
  );
}
