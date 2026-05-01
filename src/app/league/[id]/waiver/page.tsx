import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import { submitWaiverClaimAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string };
}

export default async function WaiverWirePage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify membership and get budget
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id, waiver_budget_remaining")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Fetch league info
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, waiver_budget, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Get all team assignments in the league
  const { data: allAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId);

  const assignedCastawayIds = new Set(
    (allAssignments ?? []).map((a) => a.castaway_id)
  );

  // Get player's own team castaways
  const playerTeam = (allAssignments ?? []).filter(
    (a) => a.player_id === user.id
  );

  // Get all castaways in the league
  const { data: allCastaways } = await supabase
    .from("castaways")
    .select("id, name, tribe, photo_url, is_eliminated")
    .eq("league_id", leagueId)
    .order("name");

  // Waiver wire: not assigned, not eliminated
  const waiverCastaways = (allCastaways ?? []).filter(
    (c) => !c.is_eliminated && !assignedCastawayIds.has(c.id)
  );

  // Player's team castaways (for drop selection)
  const playerCastawayIds = new Set(playerTeam.map((a) => a.castaway_id));
  const playerCastaways = (allCastaways ?? []).filter((c) =>
    playerCastawayIds.has(c.id)
  );

  // Get player's pending claims
  const { data: pendingClaims } = await supabase
    .from("waiver_claims")
    .select("id, castaway_id, drop_castaway_id, bid_amount, status, submitted_at")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });

  // Build a name lookup map
  const castawayNameMap = new Map(
    (allCastaways ?? []).map((c) => [c.id, c.name])
  );

  return (
    <AppShell
      title={`${league.name} — Waiver Wire`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {/* Budget display */}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">
            Your Waiver Budget:{" "}
            <span className="text-primary font-bold">
              {membership.waiver_budget_remaining}
            </span>{" "}
            / {league.waiver_budget}
          </p>
        </div>

        {/* Pending claims */}
        {(pendingClaims ?? []).length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Your Pending Claims</h2>
            <div className="space-y-2">
              {(pendingClaims ?? []).map((claim) => (
                <div
                  key={claim.id}
                  className="rounded border border-border bg-card p-3 flex items-center justify-between text-sm"
                >
                  <span>
                    Claiming{" "}
                    <span className="font-medium">
                      {castawayNameMap.get(claim.castaway_id) ?? "Unknown"}
                    </span>{" "}
                    · Dropping{" "}
                    <span className="font-medium">
                      {castawayNameMap.get(claim.drop_castaway_id) ?? "Unknown"}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Bid: {claim.bid_amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available castaways */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            Available Castaways ({waiverCastaways.length})
          </h2>

          {waiverCastaways.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-muted-foreground text-sm">
                No castaways are currently available on the waiver wire.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {waiverCastaways.map((castaway) => (
                <div
                  key={castaway.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  <div className="flex items-center gap-3">
                    {castaway.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={castaway.photo_url}
                        alt={castaway.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    )}
                    <div>
                      <p className="text-sm font-semibold">{castaway.name}</p>
                      {castaway.tribe && (
                        <p className="text-xs text-muted-foreground">
                          {castaway.tribe}
                        </p>
                      )}
                    </div>
                  </div>

                  {playerCastaways.length > 0 && (
                    <form
                      action={submitWaiverClaimAction}
                      className="border-t border-border pt-3 space-y-2"
                    >
                      <input type="hidden" name="league_id" value={leagueId} />
                      <input
                        type="hidden"
                        name="castaway_id"
                        value={castaway.id}
                      />

                      <label className="block text-xs font-medium">
                        Drop castaway
                      </label>
                      <select
                        name="drop_castaway_id"
                        required
                        className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select...</option>
                        {playerCastaways.map((pc) => (
                          <option key={pc.id} value={pc.id}>
                            {pc.name}
                          </option>
                        ))}
                      </select>

                      <label className="block text-xs font-medium">
                        Bid amount (0–{membership.waiver_budget_remaining})
                      </label>
                      <input
                        type="number"
                        name="bid_amount"
                        min={0}
                        max={membership.waiver_budget_remaining}
                        defaultValue={0}
                        required
                        className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                      />

                      <SubmitButton
                        pendingText="Submitting…"
                        className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px] w-full disabled:opacity-50"
                      >
                        Submit Claim
                      </SubmitButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
