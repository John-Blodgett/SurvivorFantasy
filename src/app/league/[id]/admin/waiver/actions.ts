"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processWaiverClaims, type WaiverClaim } from "@/lib/waiver";
import { requireLeagueAdmin } from "../helpers";

export async function updateWaiverScheduleAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/waiver`;

  const processDays = formData.getAll("waiver_process_days") as string[];
  const processHour = parseInt(formData.get("waiver_process_hour") as string, 10);
  const processMinute = parseInt(formData.get("waiver_process_minute") as string, 10);

  const { error } = await supabase
    .from("leagues")
    .update({
      waiver_process_days: processDays.length > 0 ? processDays.join(",") : null,
      waiver_process_hour: processHour,
      waiver_process_minute: processMinute,
    })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to update schedule.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=schedule_updated`);
}

export async function processWaiversAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/waiver`;

  const { data: rawClaims } = await supabase
    .from("waiver_claims")
    .select("id, league_id, player_id, castaway_id, drop_castaway_id, bid_amount, priority, status")
    .eq("league_id", leagueId)
    .eq("status", "pending");

  const pendingClaims: WaiverClaim[] = (rawClaims ?? []).map((c) => ({
    id: c.id, league_id: c.league_id, player_id: c.player_id,
    castaway_id: c.castaway_id, drop_castaway_id: c.drop_castaway_id,
    bid_amount: c.bid_amount, priority: c.priority, status: c.status as "pending",
  }));

  if (pendingClaims.length === 0) {
    redirect(`${basePath}?error=No pending claims to process.`);
  }

  const { data: episodes } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .order("number", { ascending: false })
    .limit(1);

  const nextEpisodeNumber = (episodes?.[0]?.number ?? 0) + 1;
  const result = processWaiverClaims(pendingClaims, nextEpisodeNumber);

  for (const claimResult of result.results) {
    await supabase.from("waiver_claims").update({
      status: claimResult.status,
      processed_at: new Date().toISOString(),
    }).eq("id", claimResult.claim_id);

    if (claimResult.status === "won" && claimResult.budget_deducted > 0) {
      const claim = pendingClaims.find((c) => c.id === claimResult.claim_id)!;
      const { data: member } = await supabase
        .from("league_members")
        .select("waiver_budget_remaining")
        .eq("league_id", leagueId)
        .eq("player_id", claim.player_id)
        .single();

      if (member) {
        await supabase.from("league_members").update({
          waiver_budget_remaining: member.waiver_budget_remaining - claimResult.budget_deducted,
        }).eq("league_id", leagueId).eq("player_id", claim.player_id);
      }
    }
  }

  for (const assignment of result.newAssignments) {
    await supabase.from("team_assignments").delete()
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

  revalidatePath(basePath);
  redirect(`${basePath}?success=claims_processed`);
}
