import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import WaiverPoolGrid from "@/components/waiver-pool-grid";
import WaiverPendingClaims from "@/components/waiver-pending-claims";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
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

  // Get tribes for name/color lookup
  const { data: tribes } = await supabase
    .from("tribes")
    .select("id, name, color")
    .eq("league_id", leagueId);

  const tribeMap = new Map<string, { name: string; color: string | null }>(
    (tribes ?? []).map((t) => [t.id, { name: t.name, color: t.color }])
  );

  // Get all team assignments in the league
  const { data: allAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId);

  const assignedCastawayIds = new Set(
    (allAssignments ?? []).map((a) => a.castaway_id)
  );

  // Get player's own team castaways
  const playerTeamIds = new Set(
    (allAssignments ?? [])
      .filter((a) => a.player_id === user.id)
      .map((a) => a.castaway_id)
  );

  // Get all castaways in the league (with tribe_id)
  const { data: allCastaways } = await supabase
    .from("castaways")
    .select("id, name, tribe_id, photo_url, is_eliminated")
    .eq("league_id", leagueId)
    .order("name");

  // Waiver pool: not eliminated, not assigned
  const waiverCastaways = (allCastaways ?? [])
    .filter((c) => !c.is_eliminated && !assignedCastawayIds.has(c.id))
    .map((c) => {
      const tribe = c.tribe_id ? tribeMap.get(c.tribe_id) : null;
      return {
        id: c.id,
        name: c.name,
        photo_url: c.photo_url,
        tribe_name: tribe?.name ?? null,
        tribe_color: tribe?.color ?? null,
      };
    });

  // Player's team castaways (for drop selector)
  const playerCastaways = (allCastaways ?? [])
    .filter((c) => playerTeamIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  // Get player's pending claims
  const { data: pendingClaims } = await supabase
    .from("waiver_claims")
    .select("id, castaway_id, drop_castaway_id, bid_amount, priority")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("status", "pending")
    .order("priority", { ascending: true });

  // Build name lookup for claims
  const castawayNameMap = new Map(
    (allCastaways ?? []).map((c) => [c.id, c.name])
  );

  const claimsForClient = (pendingClaims ?? []).map((claim) => ({
    id: claim.id,
    castaway_name: castawayNameMap.get(claim.castaway_id) ?? "Unknown",
    drop_castaway_name: castawayNameMap.get(claim.drop_castaway_id) ?? "Unknown",
    bid_amount: claim.bid_amount,
    priority: claim.priority,
  }));

  // Budget calculations
  const budgetRemaining = membership.waiver_budget_remaining;
  const budgetTotal = league.waiver_budget;
  const budgetPercent = budgetTotal > 0 ? (budgetRemaining / budgetTotal) * 100 : 0;

  return (
    <AppShell
      title={`${league.name} — Waiver Wire`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        {/* Feedback banners */}
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}
        {searchParams.success && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            Claim submitted successfully.
          </p>
        )}

        {/* Budget bar */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Waiver Budget</span>
            <span className="text-sm font-bold text-primary">
              ${budgetRemaining} / ${budgetTotal}
            </span>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${budgetPercent}%` }}
              role="progressbar"
              aria-valuenow={budgetRemaining}
              aria-valuemin={0}
              aria-valuemax={budgetTotal}
              aria-label={`${budgetRemaining} of ${budgetTotal} budget remaining`}
            />
          </div>
        </div>

        {/* Pending claims */}
        <WaiverPendingClaims leagueId={leagueId} claims={claimsForClient} />

        {/* Available players */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            Available Players ({waiverCastaways.length})
          </h2>
          <WaiverPoolGrid
            leagueId={leagueId}
            castaways={waiverCastaways}
            playerCastaways={playerCastaways}
            budgetRemaining={budgetRemaining}
          />
        </div>
      </div>
    </AppShell>
  );
}
