"use client";

import { useState } from "react";
import { proposeTradeAction } from "@/app/league/[id]/team/[userId]/actions";

interface Castaway {
  id: string;
  name: string;
  tribe: string | null;
  is_eliminated: boolean;
}

interface TradeProposalFormProps {
  leagueId: string;
  receiverId: string;
  myActiveCastaways: Castaway[];
  theirActiveCastaways: Castaway[];
}

export default function TradeProposalForm({
  leagueId,
  receiverId,
  myActiveCastaways,
  theirActiveCastaways,
}: TradeProposalFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [myCastawayId, setMyCastawayId] = useState("");
  const [theirCastawayId, setTheirCastawayId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (myActiveCastaways.length === 0 || theirActiveCastaways.length === 0) {
    return null;
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

      <form
        action={async (formData) => {
          setSubmitting(true);
          await proposeTradeAction(formData);
        }}
        className="space-y-4"
      >
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="receiver_id" value={receiverId} />
        <input type="hidden" name="proposer_castaway_id" value={myCastawayId} />
        <input type="hidden" name="receiver_castaway_id" value={theirCastawayId} />

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
            {myActiveCastaways.map((c) => (
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
          >
            <option value="">Select their castaway...</option>
            {theirActiveCastaways.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.tribe ? `(${c.tribe})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!myCastawayId || !theirCastawayId || submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Send Proposal"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
