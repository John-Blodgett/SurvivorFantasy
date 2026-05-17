/**
 * Shared waiver processing logic used by both the manual admin action
 * and the automated cron route.
 */

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { processWaiverClaims, type WaiverClaim } from "./waiver";

const PACIFIC_TZ = "America/Los_Angeles";

/**
 * Determines if a league's waiver schedule includes today (Pacific time).
 * Since Vercel Hobby only supports daily crons, we check the day only.
 */
export function shouldProcessLeague(
  processDays: string | null,
  processHour: number | null,
  processMinute: number | null,
  now: Date = new Date()
): boolean {
  if (!processDays) {
    return false;
  }

  const days = processDays.split(",").map((d) => parseInt(d, 10));

  // Get current day in Pacific time
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    weekday: "short",
  });
  const dayStr = dayFormatter.format(now);
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const currentDay = dayMap[dayStr] ?? -1;

  return days.includes(currentDay);
}

/**
 * Creates a Supabase admin client using the service role key.
 * Bypasses RLS for automated processing.
 */
function createAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Processes all pending waiver claims for a given league.
 * Returns the number of claims processed.
 */
export async function processLeagueWaivers(leagueId: string): Promise<number> {
  const supabase = createAdminClient();

  const { data: rawClaims } = await supabase
    .from("waiver_claims")
    .select("id, league_id, player_id, castaway_id, drop_castaway_id, bid_amount, priority, status")
    .eq("league_id", leagueId)
    .eq("status", "pending");

  const pendingClaims: WaiverClaim[] = (rawClaims ?? []).map((c) => ({
    id: c.id,
    league_id: c.league_id,
    player_id: c.player_id,
    castaway_id: c.castaway_id,
    drop_castaway_id: c.drop_castaway_id,
    bid_amount: c.bid_amount,
    priority: c.priority,
    status: c.status as "pending",
  }));

  if (pendingClaims.length === 0) {
    return 0;
  }

  // Fetch player budgets for budget enforcement during processing
  const playerIds = Array.from(new Set(pendingClaims.map((c) => c.player_id)));
  const { data: memberBudgets } = await supabase
    .from("league_members")
    .select("player_id, waiver_budget_remaining")
    .eq("league_id", leagueId)
    .in("player_id", playerIds);

  const playerBudgets = new Map<string, number>(
    (memberBudgets ?? []).map((m) => [m.player_id, m.waiver_budget_remaining])
  );

  const { data: episodes } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .order("number", { ascending: false })
    .limit(1);

  const nextEpisodeNumber = (episodes?.[0]?.number ?? 0) + 1;
  const result = processWaiverClaims(pendingClaims, nextEpisodeNumber, playerBudgets);

  for (const claimResult of result.results) {
    await supabase
      .from("waiver_claims")
      .update({ status: claimResult.status, processed_at: new Date().toISOString() })
      .eq("id", claimResult.claim_id);

    if (claimResult.status === "won" && claimResult.budget_deducted > 0) {
      const claim = pendingClaims.find((c) => c.id === claimResult.claim_id)!;
      const { data: member } = await supabase
        .from("league_members")
        .select("waiver_budget_remaining")
        .eq("league_id", leagueId)
        .eq("player_id", claim.player_id)
        .single();

      if (member) {
        await supabase
          .from("league_members")
          .update({
            waiver_budget_remaining: member.waiver_budget_remaining - claimResult.budget_deducted,
          })
          .eq("league_id", leagueId)
          .eq("player_id", claim.player_id);
      }
    }
  }

  for (const assignment of result.newAssignments) {
    await supabase
      .from("team_assignments")
      .delete()
      .eq("league_id", leagueId)
      .eq("player_id", assignment.player_id)
      .eq("castaway_id", assignment.drop_castaway_id);

    await supabase.from("team_assignments").insert({
      league_id: leagueId,
      player_id: assignment.player_id,
      castaway_id: assignment.castaway_id,
      points_from_episode: assignment.points_from_episode,
      source: "waiver",
    });
  }

  return pendingClaims.length;
}
