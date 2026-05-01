import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { approveTradeAction, adminRejectTradeAction } from "./actions";

export default async function AdminTradesPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch accepted trades (awaiting admin approval)
  const { data: tradesRaw } = await supabase
    .from("trades")
    .select(
      "id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status, proposed_at"
    )
    .eq("league_id", league.id)
    .eq("status", "accepted")
    .order("proposed_at", { ascending: true });

  const trades = tradesRaw ?? [];

  // Fetch names for display
  const playerIds = Array.from(new Set(trades.flatMap((t) => [t.proposer_id, t.receiver_id])));
  const castawayIds = Array.from(new Set(trades.flatMap((t) => [t.proposer_castaway, t.receiver_castaway])));

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

  const toastMessage = searchParams.success === "trade_approved"
    ? "Trade approved and team assignments updated."
    : searchParams.success === "trade_rejected"
    ? "Trade rejected."
    : null;

  return (
    <AppShell title={`Trade Approval — ${league.name}`} backHref="/dashboard" backLabel="Dashboard">
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

        {trades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No trades awaiting approval.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {trades.map((trade) => (
              <div
                key={trade.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="text-sm space-y-1">
                  <p>
                    <span className="font-medium">
                      {profileMap.get(trade.proposer_id) ?? "Unknown"}
                    </span>{" "}
                    offers{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.proposer_castaway) ?? "Unknown"}
                    </span>
                  </p>
                  <p>
                    <span className="font-medium">
                      {profileMap.get(trade.receiver_id) ?? "Unknown"}
                    </span>{" "}
                    offers{" "}
                    <span className="font-medium">
                      {castawayMap.get(trade.receiver_castaway) ?? "Unknown"}
                    </span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proposed {new Date(trade.proposed_at).toLocaleDateString()}
                </p>
                <div className="flex gap-2">
                  <form action={approveTradeAction}>
                    <input type="hidden" name="trade_id" value={trade.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={adminRejectTradeAction}>
                    <input type="hidden" name="trade_id" value={trade.id} />
                    <button
                      type="submit"
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
