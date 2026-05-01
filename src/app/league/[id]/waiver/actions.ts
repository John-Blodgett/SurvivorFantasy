"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateWaiverClaim, type WaiverClaimInput, type WaiverClaimValidationContext } from "@/lib/waiver";

/** Submit a waiver wire claim. Requirements: 18.3, 18.10 */
export async function submitWaiverClaimAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const castawayId = formData.get("castaway_id") as string;
  const dropCastawayId = formData.get("drop_castaway_id") as string;
  const bidAmountStr = formData.get("bid_amount") as string;
  const bidAmount = parseInt(bidAmountStr, 10);

  if (!leagueId || !castawayId || !dropCastawayId || isNaN(bidAmount)) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent("All fields are required.")}`
    );
  }

  // Verify membership and get budget
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id, waiver_budget_remaining")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Get player's team
  const { data: teamAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id);

  // Get all team assignments in the league
  const { data: allAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId);

  // Get all castaways in the league
  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("league_id", leagueId);

  const input: WaiverClaimInput = {
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    drop_castaway_id: dropCastawayId,
    bid_amount: bidAmount,
  };

  const context: WaiverClaimValidationContext = {
    playerBudgetRemaining: membership.waiver_budget_remaining,
    playerTeamCastawayIds: (teamAssignments ?? []).map((a) => a.castaway_id),
    allTeamAssignments: (allAssignments ?? []).map((a) => ({
      castaway_id: a.castaway_id,
      player_id: a.player_id,
    })),
    castaways: (castaways ?? []).map((c) => ({
      id: c.id,
      is_eliminated: c.is_eliminated,
    })),
  };

  const validation = validateWaiverClaim(input, context);

  if (!validation.valid) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent(validation.error!)}`
    );
  }

  // Insert the claim
  const { error } = await supabase.from("waiver_claims").insert({
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    drop_castaway_id: dropCastawayId,
    bid_amount: bidAmount,
  });

  if (error) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent("Failed to submit claim. Please try again.")}`
    );
  }

  revalidatePath(`/league/${leagueId}/waiver`);
}
