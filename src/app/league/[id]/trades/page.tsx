import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import TradeProposalWithPlayer from "@/components/trade-proposal-with-player";
import {
  acceptTradeInLeagueAction,
  rejectTradeInLeagueAction,
  cancelTradeAction,
} from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { success?: string; error?: string };
}

export default async function LeagueTradesPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Fetch all league members with display names
  const { data: allMembers } = await supabase
    .from("league_members")
    .select("player_id, profiles(display_name)")
    .eq("league_id", leagueId);

  // Fetch all active castaways with their team assignments
  const { data: allCastaways } = await supabase
    .from("castaways")
    .select("id, name, tribe, is_eliminated")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false);

  const { data: allAssignments } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id")
    .eq("league_id", leagueId);

  // Build my active castaways and other players' active castaways
  const assignmentMap = new Map(
    (allAssignments ?? []).map((a) => [a.castaway_id, a.player_id])
  );

  const myCastaways = (allCastaways ?? [])
    .filter((c) => assignmentMap.get(c.id) === user.id)
    .map((c) => ({ id: c.id, name: c.name }));

  const otherPlayers = (allMembers ?? [])
    .filter((m) => m.player_id !== user.id)
    .map((m) => {
      const profileData = m.profiles as unknown as { display_name: string } | null;
      const playerCastaways = (allCastaways ?? [])
        .filter((c) => assignmentMap.get(c.id) === m.player_id)
        .map((c) => ({ id: c.id, name: c.name }));
      return {
        id: m.player_id,
        display_name: profileData?.display_name ?? "Unknown",
        castaways: playerCastaways,
      };
    });

  // Fetch trades where the current user is involved (pending)
  const { data: tradesRaw } = await supabase
    .from("trades")
    .select(
      "id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status, proposed_at"
    )
    .eq("league_id", leagueId)
    .or(`proposer_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .eq("status", "pending")
    .order("proposed_at", { ascending: false });

  const trades = tradesRaw ?? [];

  // Gather player and castaway IDs for name lookups
  const playerIds = Array.from(
    new Set(trades.flatMap((t) => [t.proposer_id, t.receiver_id]))
  );
  const castawayIds = Array.from(
    new Set(trades.flatMap((t) => [t.proposer_castaway, t.receiver_castaway]))
  );

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", playerIds.length > 0 ? playerIds : ["__none__"]);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name")
    .in("id", castawayIds.length > 0 ? castawayIds : ["__none__"]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const castawayMap = new Map((castaways ?? []).map((c) => [c.id, c.name]));

  const incoming = trades.filter(
    (t) => t.receiver_id === user.id && t.status === "pending"
  );
  const outgoing = trades.filter(
    (t) => t.proposer_id === user.id && t.status === "pending"
  );

  const toastMessage =
    searchParams.success === "trade_accepted"
      ? "Trade accepted! Rosters have been updated."
      : searchParams.success === "trade_rejected"
      ? "Trade rejected."
      : searchParams.success === "trade_cancelled"
      ? "Trade cancelled."
      : searchParams.success === "trade_proposed"
      ? "Trade proposal sent!"
      : null;

  return (
    <AppShell
      title={`Trades — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {toastMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {toastMessage}
          </p>
        )}
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {/* Propose a new trade */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            New Trade
          </h3>
          <TradeProposalWithPlayer
            leagueId={leagueId}
            myCastaways={myCastaways}
            otherPlayers={otherPlayers}
          />
        </section>

        {/* Incoming trades (you need to accept/reject) */}
        {incoming.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trades Received
            </h3>
            <div className="space-y-3">
              {incoming.map((trade) => (
                <div
                  key={trade.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  <div className="text-sm">
                    <span className="font-medium">
                      {profileMap.get(trade.proposer_id) ?? "Unknown"}
                    </span>{" "}
                    wants to trade their{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.proposer_castaway) ?? "Unknown"}
                    </span>{" "}
                    for your{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.receiver_castaway) ?? "Unknown"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Proposed {new Date(trade.proposed_at).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2">
                    <form action={acceptTradeInLeagueAction}>
                      <input type="hidden" name="trade_id" value={trade.id} />
                      <input type="hidden" name="league_id" value={leagueId} />
                      <SubmitButton
                        pendingText="Accepting…"
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                      >
                        Accept
                      </SubmitButton>
                    </form>
                    <form action={rejectTradeInLeagueAction}>
                      <input type="hidden" name="trade_id" value={trade.id} />
                      <input type="hidden" name="league_id" value={leagueId} />
                      <SubmitButton
                        pendingText="Rejecting…"
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        Reject
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Outgoing trades (you sent, waiting for response) */}
        {outgoing.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Trades Sent
            </h3>
            <div className="space-y-3">
              {outgoing.map((trade) => (
                <div
                  key={trade.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  <div className="text-sm">
                    You offered{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.proposer_castaway) ?? "Unknown"}
                    </span>{" "}
                    to{" "}
                    <span className="font-medium">
                      {profileMap.get(trade.receiver_id) ?? "Unknown"}
                    </span>{" "}
                    for their{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.receiver_castaway) ?? "Unknown"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Proposed {new Date(trade.proposed_at).toLocaleDateString()} · Waiting for response
                  </p>
                  <form action={cancelTradeAction}>
                    <input type="hidden" name="trade_id" value={trade.id} />
                    <input type="hidden" name="league_id" value={leagueId} />
                    <SubmitButton
                      pendingText="Cancelling…"
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Cancel Trade
                    </SubmitButton>
                  </form>
                </div>
              ))}
            </div>
          </section>
        )}

        {incoming.length === 0 && outgoing.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No active trades. Use the form above to propose one.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
