"use client";

import { useState } from "react";
import { submitWaiverClaimAction } from "@/app/league/[id]/waiver/actions";
import SubmitButton from "./submit-button";

interface WaiverCastaway {
  id: string;
  name: string;
  photo_url: string | null;
  tribe_name: string | null;
  tribe_color: string | null;
}

interface PlayerCastaway {
  id: string;
  name: string;
}

interface WaiverPoolGridProps {
  leagueId: string;
  castaways: WaiverCastaway[];
  playerCastaways: PlayerCastaway[];
  budgetRemaining: number;
}

export default function WaiverPoolGrid({
  leagueId,
  castaways,
  playerCastaways,
  budgetRemaining,
}: WaiverPoolGridProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (castaways.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          No castaways are currently available on the waiver wire.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
      {castaways.map((castaway) => {
        const isSelected = selectedId === castaway.id;

        return (
          <div
            key={castaway.id}
            className={`rounded-lg border bg-card p-4 transition-colors ${
              isSelected
                ? "border-primary ring-1 ring-primary/20"
                : "border-border hover:border-primary/40 cursor-pointer"
            }`}
            onClick={() => {
              if (!isSelected) setSelectedId(castaway.id);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!isSelected) setSelectedId(castaway.id);
              }
            }}
            aria-label={`${castaway.name}${castaway.tribe_name ? ` — ${castaway.tribe_name}` : ""}`}
            aria-expanded={isSelected}
          >
            {/* Card header */}
            <div className="flex items-center gap-3">
              {castaway.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={castaway.photo_url}
                  alt={castaway.name}
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-medium text-muted-foreground">
                    {castaway.name.charAt(0)}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{castaway.name}</p>
                {castaway.tribe_name && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {castaway.tribe_color && (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: castaway.tribe_color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-xs text-muted-foreground truncate">
                      {castaway.tribe_name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Inline bid form */}
            {isSelected && playerCastaways.length > 0 && (
              <form
                action={submitWaiverClaimAction}
                className="mt-4 border-t border-border pt-3 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <input type="hidden" name="league_id" value={leagueId} />
                <input type="hidden" name="castaway_id" value={castaway.id} />

                <div className="space-y-1">
                  <label className="block text-xs font-medium">Drop</label>
                  <select
                    name="drop_castaway_id"
                    required
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Select...</option>
                    {playerCastaways.map((pc) => (
                      <option key={pc.id} value={pc.id}>
                        {pc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium">
                    Bid (0–{budgetRemaining})
                  </label>
                  <input
                    type="number"
                    name="bid_amount"
                    min={0}
                    max={budgetRemaining}
                    defaultValue={0}
                    required
                    className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
                  />
                </div>

                <div className="flex gap-2">
                  <SubmitButton
                    pendingText="Submitting…"
                    className="flex-1 rounded bg-primary text-primary-foreground px-3 py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Submit Claim
                  </SubmitButton>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(null);
                    }}
                    className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {isSelected && playerCastaways.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground border-t border-border pt-3">
                You need at least one castaway on your team to submit a claim.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
