"use client";

import { useState } from "react";
import { proposeTradeFromTradesPageAction } from "@/app/league/[id]/trades/actions";
import SubmitButton from "./submit-button";

interface Castaway {
  id: string;
  name: string;
  tribe: string | null;
}

interface Player {
  id: string;
  display_name: string;
  castaways: Castaway[];
}

interface Props {
  leagueId: string;
  myCastaways: Castaway[];
  otherPlayers: Player[];
}

export default function TradeProposalWithPlayer({
  leagueId,
  myCastaways,
  otherPlayers,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [receiverId, setReceiverId] = useState("");
  const [myCastawayId, setMyCastawayId] = useState("");
  const [theirCastawayId, setTheirCastawayId] = useState("");

  const selectedPlayer = otherPlayers.find((p) => p.id === receiverId);
  const theirCastaways = selectedPlayer?.castaways ?? [];

  if (myCastaways.length === 0 || otherPlayers.length === 0) {
    return null;
  }

  // Reset their castaway selection when player changes
  function handlePlayerChange(playerId: string) {
    setReceiverId(playerId);
    setTheirCastawayId("");
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Propose Trade
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Propose a 1-for-1 Trade</h3>

      <form action={proposeTradeFromTradesPageAction} className="space-y-4">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="receiver_id" value={receiverId} />
        <input type="hidden" name="proposer_castaway_id" value={myCastawayId} />
        <input type="hidden" name="receiver_castaway_id" value={theirCastawayId} />

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Trade with:
          </label>
          <select
            value={receiverId}
            onChange={(e) => handlePlayerChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          >
            <option value="">Select a player...</option>
            {otherPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
                {p.castaways.length === 0 ? " (no castaways)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            You offer:
          </label>
          <select
            value={myCastawayId}
            onChange={(e) => setMyCastawayId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          >
            <option value="">Select your castaway...</option>
            {myCastaways.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.tribe ? `(${c.tribe})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            You receive:
          </label>
          <select
            value={theirCastawayId}
            onChange={(e) => setTheirCastawayId(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
            disabled={!receiverId || theirCastaways.length === 0}
          >
            <option value="">
              {!receiverId
                ? "Select a player first..."
                : theirCastaways.length === 0
                ? "No active castaways"
                : "Select their castaway..."}
            </option>
            {theirCastaways.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.tribe ? `(${c.tribe})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <SubmitButton
            pendingText="Sending…"
            disabled={!receiverId || !myCastawayId || !theirCastawayId}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Send Proposal
          </SubmitButton>
          <button
            type="button"
            onClick={() => {
              setShowForm(false);
              setReceiverId("");
              setMyCastawayId("");
              setTheirCastawayId("");
            }}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
