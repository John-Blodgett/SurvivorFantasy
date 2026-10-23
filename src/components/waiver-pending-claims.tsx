"use client";

import { cancelWaiverClaimAction, reorderWaiverClaimsAction } from "@/app/league/[id]/waiver/actions";
import SubmitButton from "./submit-button";

interface PendingClaim {
  id: string;
  castaway_name: string;
  drop_castaway_name: string;
  bid_amount: number;
  priority: number;
}

interface WaiverPendingClaimsProps {
  leagueId: string;
  claims: PendingClaim[];
}

export default function WaiverPendingClaims({
  leagueId,
  claims,
}: WaiverPendingClaimsProps) {
  if (claims.length === 0) return null;

  // Track which drop castaways are shared across multiple claims.
  // If you win a higher-priority claim using the same drop, backup claims
  // for that same drop are automatically skipped during processing.
  const dropCounts = new Map<string, number>();
  for (const c of claims) {
    dropCounts.set(c.drop_castaway_name, (dropCounts.get(c.drop_castaway_name) ?? 0) + 1);
  }

  // Check whether two adjacent claims have the same bid (reordering is
  // only meaningful in that case, but we allow it regardless).
  const claimIds = claims.map((c) => c.id);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Your Pending Claims</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Claims are processed by highest bid first. Ties are broken by the order below — use arrows to reorder tied bids.
          Multiple claims act as backups: if you win an earlier claim that drops the same castaway, later claims using that same drop are skipped.
        </p>
      </div>

      <div className="space-y-2">
        {claims.map((claim, index) => {
          // Build reordered ID arrays for move up/down
          const moveUpIds = [...claimIds];
          if (index > 0) {
            [moveUpIds[index - 1], moveUpIds[index]] = [moveUpIds[index], moveUpIds[index - 1]];
          }
          const moveDownIds = [...claimIds];
          if (index < claims.length - 1) {
            [moveDownIds[index], moveDownIds[index + 1]] = [moveDownIds[index + 1], moveDownIds[index]];
          }

          // Flag whether a higher-priority claim already uses the same drop castaway.
          // If so, this is a backup and might be skipped if that claim wins.
          const isBackupForDrop = claims
            .slice(0, index)
            .some((earlier) => earlier.drop_castaway_name === claim.drop_castaway_name);

          // Flag if adjacent claims have the same bid (makes reordering meaningful)
          const sameBidAsAbove = index > 0 && claims[index - 1].bid_amount === claim.bid_amount;
          const sameBidAsBelow =
            index < claims.length - 1 && claims[index + 1].bid_amount === claim.bid_amount;
          const inTieGroup = sameBidAsAbove || sameBidAsBelow;

          return (
            <div
              key={claim.id}
              className={`flex items-center gap-3 rounded-lg border bg-card px-4 py-3 ${
                isBackupForDrop
                  ? "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20"
                  : "border-border"
              }`}
            >
              {/* Priority badge */}
              <span className="text-xs font-mono text-muted-foreground w-5 text-center shrink-0">
                #{index + 1}
              </span>

              {/* Claim details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{claim.castaway_name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  Drop {claim.drop_castaway_name} · Bid ${claim.bid_amount}
                  {inTieGroup && (
                    <span className="ml-1.5 text-primary/70">(tied bid — order matters)</span>
                  )}
                </p>
                {isBackupForDrop && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Backup — skipped if an earlier claim drops {claim.drop_castaway_name}
                  </p>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1 shrink-0">
                {index > 0 && (
                  <form action={reorderWaiverClaimsAction}>
                    <input type="hidden" name="league_id" value={leagueId} />
                    <input type="hidden" name="claim_ids" value={moveUpIds.join(",")} />
                    <button
                      type="submit"
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                      aria-label={`Move ${claim.castaway_name} up`}
                    >
                      ↑
                    </button>
                  </form>
                )}
                {index < claims.length - 1 && (
                  <form action={reorderWaiverClaimsAction}>
                    <input type="hidden" name="league_id" value={leagueId} />
                    <input type="hidden" name="claim_ids" value={moveDownIds.join(",")} />
                    <button
                      type="submit"
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                      aria-label={`Move ${claim.castaway_name} down`}
                    >
                      ↓
                    </button>
                  </form>
                )}
                <form action={cancelWaiverClaimAction}>
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="claim_id" value={claim.id} />
                  <SubmitButton
                    pendingText="…"
                    className="rounded border border-destructive/30 text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
                  >
                    ✕
                  </SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {claims.length > 1 && (
        <p className="text-xs text-muted-foreground">
          {claims.length} claims queued. You will receive at most one castaway per unique drop.
        </p>
      )}
    </div>
  );
}
