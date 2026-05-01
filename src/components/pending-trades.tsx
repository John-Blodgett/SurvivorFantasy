"use client";

import { acceptTradeAction, rejectTradeAction } from "@/app/dashboard/trade-actions";

interface PendingTrade {
  id: string;
  proposer_name: string;
  proposer_castaway_name: string;
  receiver_castaway_name: string;
  league_name: string;
}

interface PendingTradesProps {
  trades: PendingTrade[];
}

export default function PendingTrades({ trades }: PendingTradesProps) {
  if (trades.length === 0) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Pending Trade Proposals
      </h3>
      <div className="space-y-3">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <div className="text-sm">
              <span className="font-medium">{trade.proposer_name}</span> wants to
              trade their{" "}
              <span className="font-medium">{trade.proposer_castaway_name}</span>{" "}
              for your{" "}
              <span className="font-medium">{trade.receiver_castaway_name}</span>
            </div>
            <p className="text-xs text-muted-foreground">{trade.league_name}</p>
            <div className="flex gap-2">
              <form action={acceptTradeAction}>
                <input type="hidden" name="trade_id" value={trade.id} />
                <button
                  type="submit"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                >
                  Accept
                </button>
              </form>
              <form action={rejectTradeAction}>
                <input type="hidden" name="trade_id" value={trade.id} />
                <button
                  type="submit"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Reject
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
