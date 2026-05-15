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

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Your Pending Claims</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Higher priority claims are processed first. Use arrows to reorder.
        </p>
      </div>

      <div className="space-y-2">
        {claims.map((claim, index) => {
          // Build reordered ID arrays for move up/down
          const claimIds = claims.map((c) => c.id);
          const moveUpIds = [...claimIds];
          if (index > 0) {
            [moveUpIds[index - 1], moveUpIds[index]] = [moveUpIds[index], moveUpIds[index - 1]];
          }
          const moveDownIds = [...claimIds];
          if (index < claims.length - 1) {
            [moveDownIds[index], moveDownIds[index + 1]] = [moveDownIds[index + 1], moveDownIds[index]];
          }

          return (
            <div
              key={claim.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              {/* Priority badge */}
              <span className="text-xs font-mono text-muted-foreground w-5 text-center shrink-0">
                #{index + 1}
              </span>

              {/* Claim details */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {claim.castaway_name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  Drop {claim.drop_castaway_name} · Bid ${claim.bid_amount}
                </p>
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
    </div>
  );
}
