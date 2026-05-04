import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";

interface PageProps {
  params: { id: string };
}

interface Transaction {
  type: "draft" | "trade" | "waiver";
  date: string;
  description: string;
  detail: string | null;
}

export default async function TransactionsPage({ params }: PageProps) {
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

  // Fetch draft picks
  const { data: draftRaw } = await supabase
    .from("draft_picks")
    .select("player_id, castaway_id, pick_number, picked_at, drafts!inner(league_id)")
    .eq("drafts.league_id", leagueId)
    .order("pick_number", { ascending: true });

  // Fetch completed trades (admin_approved)
  const { data: tradesRaw } = await supabase
    .from("trades")
    .select(
      "proposer_id, receiver_id, proposer_castaway, receiver_castaway, resolved_at"
    )
    .eq("league_id", leagueId)
    .eq("status", "admin_approved")
    .order("resolved_at", { ascending: true });

  // Fetch won waiver claims
  const { data: waiversRaw } = await supabase
    .from("waiver_claims")
    .select("player_id, castaway_id, drop_castaway_id, bid_amount, processed_at")
    .eq("league_id", leagueId)
    .eq("status", "won")
    .order("processed_at", { ascending: true });

  // Gather all player and castaway IDs for name lookups
  const playerIds = new Set<string>();
  const castawayIds = new Set<string>();

  for (const d of draftRaw ?? []) {
    playerIds.add(d.player_id);
    castawayIds.add(d.castaway_id);
  }
  for (const t of tradesRaw ?? []) {
    playerIds.add(t.proposer_id);
    playerIds.add(t.receiver_id);
    castawayIds.add(t.proposer_castaway);
    castawayIds.add(t.receiver_castaway);
  }
  for (const w of waiversRaw ?? []) {
    playerIds.add(w.player_id);
    castawayIds.add(w.castaway_id);
    castawayIds.add(w.drop_castaway_id);
  }

  const playerArr = Array.from(playerIds);
  const castawayArr = Array.from(castawayIds);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", playerArr.length > 0 ? playerArr : ["__none__"]);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name")
    .in("id", castawayArr.length > 0 ? castawayArr : ["__none__"]);

  const pName = (id: string) =>
    (profiles ?? []).find((p) => p.id === id)?.display_name ?? "Unknown";
  const cName = (id: string) =>
    (castaways ?? []).find((c) => c.id === id)?.name ?? "Unknown";

  // Build unified transaction list
  const transactions: Transaction[] = [];

  for (const d of draftRaw ?? []) {
    transactions.push({
      type: "draft",
      date: d.picked_at,
      description: `${pName(d.player_id)} drafted ${cName(d.castaway_id)}`,
      detail: `Pick #${d.pick_number}`,
    });
  }

  for (const t of tradesRaw ?? []) {
    transactions.push({
      type: "trade",
      date: t.resolved_at ?? "",
      description: `${pName(t.proposer_id)} traded ${cName(t.proposer_castaway)} to ${pName(t.receiver_id)} for ${cName(t.receiver_castaway)}`,
      detail: null,
    });
  }

  for (const w of waiversRaw ?? []) {
    transactions.push({
      type: "waiver",
      date: w.processed_at ?? "",
      description: `${pName(w.player_id)} claimed ${cName(w.castaway_id)}, dropped ${cName(w.drop_castaway_id)}`,
      detail: w.bid_amount > 0 ? `$${w.bid_amount} bid` : null,
    });
  }

  // Sort oldest first (most recent at the bottom)
  transactions.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const typeLabel: Record<Transaction["type"], string> = {
    draft: "Draft",
    trade: "Trade",
    waiver: "Waiver",
  };

  const typeBadgeClass: Record<Transaction["type"], string> = {
    draft: "bg-blue-100 text-blue-800",
    trade: "bg-purple-100 text-purple-800",
    waiver: "bg-amber-100 text-amber-800",
  };

  return (
    <AppShell
      title={`Transactions — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <p className="text-sm text-muted-foreground">
          All roster moves in chronological order.
        </p>

        {transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No transactions yet.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 sm:px-4 py-3 text-left font-medium text-muted-foreground w-20">
                    Type
                  </th>
                  <th className="px-3 sm:px-4 py-3 text-left font-medium text-muted-foreground">
                    Transaction
                  </th>
                  <th className="hidden sm:table-cell px-3 sm:px-4 py-3 text-right font-medium text-muted-foreground w-32">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-3 sm:px-4 py-3">
                      <span
                        className={`inline-block text-xs font-medium rounded px-2 py-0.5 ${typeBadgeClass[tx.type]}`}
                      >
                        {typeLabel[tx.type]}
                      </span>
                    </td>
                    <td className="px-3 sm:px-4 py-3">
                      <span>{tx.description}</span>
                      {tx.detail && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {tx.detail}
                        </span>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-4 py-3 text-right text-xs text-muted-foreground">
                      {tx.date
                        ? new Date(tx.date).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
