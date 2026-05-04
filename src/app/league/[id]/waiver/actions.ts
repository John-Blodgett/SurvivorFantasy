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

  // Check for duplicate: same player already has a pending claim dropping the same castaway
  const { data: duplicateClaim } = await supabase
    .from("waiver_claims")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("drop_castaway_id", dropCastawayId)
    .eq("status", "pending")
    .limit(1)
    .single();

  if (duplicateClaim) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent("You already have a pending claim dropping this castaway.")}`
    );
  }

  // Determine priority: next available number for this player's pending claims
  const { data: existingClaims } = await supabase
    .from("waiver_claims")
    .select("priority")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .limit(1);

  const nextPriority = (existingClaims?.[0]?.priority ?? 0) + 1;

  // Insert the claim
  const { error } = await supabase.from("waiver_claims").insert({
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    drop_castaway_id: dropCastawayId,
    bid_amount: bidAmount,
    priority: nextPriority,
  });

  if (error) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent("Failed to submit claim. Please try again.")}`
    );
  }

  revalidatePath(`/league/${leagueId}/waiver`);
}


/** Reorder a player's pending waiver claims. Expects claim_ids in priority order. */
export async function reorderWaiverClaimsAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const claimIdsStr = formData.get("claim_ids") as string;

  if (!leagueId || !claimIdsStr) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Missing data.")}`);
  }

  const claimIds = claimIdsStr.split(",").filter(Boolean);

  // Update each claim's priority
  for (let i = 0; i < claimIds.length; i++) {
    await supabase
      .from("waiver_claims")
      .update({ priority: i + 1 })
      .eq("id", claimIds[i])
      .eq("player_id", user.id)
      .eq("status", "pending");
  }

  revalidatePath(`/league/${leagueId}/waiver`);
}

/** Cancel a pending waiver claim. */
export async function cancelWaiverClaimAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const claimId = formData.get("claim_id") as string;

  if (!leagueId || !claimId) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Missing data.")}`);
  }

  await supabase
    .from("waiver_claims")
    .delete()
    .eq("id", claimId)
    .eq("player_id", user.id)
    .eq("status", "pending");

  revalidatePath(`/league/${leagueId}/waiver`);
}


/** Edit a pending waiver claim's bid amount and/or drop castaway. */
export async function editWaiverClaimAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const claimId = formData.get("claim_id") as string;
  const dropCastawayId = formData.get("drop_castaway_id") as string;
  const bidAmountStr = formData.get("bid_amount") as string;
  const bidAmount = parseInt(bidAmountStr, 10);

  if (!leagueId || !claimId || !dropCastawayId || isNaN(bidAmount)) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("All fields are required.")}`);
  }

  if (bidAmount < 0) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Bid must be non-negative.")}`);
  }

  // Verify the claim belongs to this user and is still pending
  const { data: claim } = await supabase
    .from("waiver_claims")
    .select("id, player_id, status, bid_amount")
    .eq("id", claimId)
    .eq("player_id", user.id)
    .eq("status", "pending")
    .single();

  if (!claim) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Claim not found or already processed.")}`);
  }

  // Verify budget: remaining + old bid >= new bid
  const { data: membership } = await supabase
    .from("league_members")
    .select("waiver_budget_remaining")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  const effectiveBudget = membership.waiver_budget_remaining;
  if (bidAmount > effectiveBudget) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Bid exceeds your remaining budget.")}`);
  }

  // Verify drop castaway is on the player's team
  const { data: teamAssignment } = await supabase
    .from("team_assignments")
    .select("castaway_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("castaway_id", dropCastawayId)
    .single();

  if (!teamAssignment) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("You don't own that castaway.")}`);
  }

  const { error } = await supabase
    .from("waiver_claims")
    .update({ drop_castaway_id: dropCastawayId, bid_amount: bidAmount })
    .eq("id", claimId)
    .eq("player_id", user.id)
    .eq("status", "pending");

  if (error) {
    redirect(`/league/${leagueId}/waiver?error=${encodeURIComponent("Failed to update claim.")}`);
  }

  revalidatePath(`/league/${leagueId}/waiver`);
}
