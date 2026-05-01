"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processWaiverClaims, type WaiverClaim } from "@/lib/waiver";

/** Update waiver wire processing schedule. Requirements: 18.7 */
export async function updateWaiverScheduleAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const processDay = parseInt(formData.get("waiver_process_day") as string, 10);
  const processHour = parseInt(formData.get("waiver_process_hour") as string, 10);
  const processMinute = parseInt(formData.get("waiver_process_minute") as string, 10);

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  const { error } = await supabase
    .from("leagues")
    .update({
      waiver_process_day: processDay,
      waiver_process_hour: processHour,
      waiver_process_minute: processMinute,
    })
    .eq("id", league.id);

  if (error) {
    redirect(`/admin/waiver?error=${encodeURIComponent("Failed to update schedule.")}`);
  }

  revalidatePath("/admin/waiver");
  redirect("/admin/waiver?success=schedule_updated");
}

/** Manually trigger waiver wire processing. Requirements: 18.11 */
export async function processWaiversAction() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  // Get all pending claims
  const { data: rawClaims } = await supabase
    .from("waiver_claims")
    .select("id, league_id, player_id, castaway_id, drop_castaway_id, bid_amount, status")
    .eq("league_id", league.id)
    .eq("status", "pending");

  const pendingClaims: WaiverClaim[] = (rawClaims ?? []).map((c) => ({
    id: c.id,
    league_id: c.league_id,
    player_id: c.player_id,
    castaway_id: c.castaway_id,
    drop_castaway_id: c.drop_castaway_id,
    bid_amount: c.bid_amount,
    status: c.status as "pending",
  }));

  if (pendingClaims.length === 0) {
    redirect("/admin/waiver?error=No pending claims to process.");
  }

  // Determine next episode number
  const { data: episodes } = await supabase
    .from("episodes")
    .select("number, is_finalized")
    .eq("league_id", league.id)
    .order("number", { ascending: false })
    .limit(1);

  const lastEpisode = episodes?.[0];
  const nextEpisodeNumber = lastEpisode ? lastEpisode.number + 1 : 1;

  // Process claims
  const result = processWaiverClaims(pendingClaims, nextEpisodeNumber);

  // Apply results to database
  for (const claimResult of result.results) {
    await supabase
      .from("waiver_claims")
      .update({
        status: claimResult.status,
        processed_at: new Date().toISOString(),
      })
      .eq("id", claimResult.claim_id);

    // Deduct budget from winners
    if (claimResult.status === "won" && claimResult.budget_deducted > 0) {
      const claim = pendingClaims.find((c) => c.id === claimResult.claim_id)!;
      // Use RPC or manual decrement
      const { data: member } = await supabase
        .from("league_members")
        .select("waiver_budget_remaining")
        .eq("league_id", league.id)
        .eq("player_id", claim.player_id)
        .single();

      if (member) {
        await supabase
          .from("league_members")
          .update({
            waiver_budget_remaining:
              member.waiver_budget_remaining - claimResult.budget_deducted,
          })
          .eq("league_id", league.id)
          .eq("player_id", claim.player_id);
      }
    }
  }

  // Apply new assignments
  for (const assignment of result.newAssignments) {
    // Remove the dropped castaway from the player's team
    await supabase
      .from("team_assignments")
      .delete()
      .eq("league_id", league.id)
      .eq("player_id", assignment.player_id)
      .eq("castaway_id", assignment.drop_castaway_id);

    // Add the claimed castaway to the player's team
    await supabase.from("team_assignments").insert({
      league_id: league.id,
      player_id: assignment.player_id,
      castaway_id: assignment.castaway_id,
      points_from_episode: assignment.points_from_episode,
      source: "waiver",
    });
  }

  revalidatePath("/admin/waiver");
  redirect("/admin/waiver?success=claims_processed");
}
