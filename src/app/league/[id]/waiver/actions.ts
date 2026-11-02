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

  // Check for exact duplicate: same player already targeting the exact same castaway
  const { data: duplicateClaim } = await supabase
    .from("waiver_claims")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .eq("castaway_id", castawayId)
    .eq("status", "pending")
    .limit(1)
    .single();

  if (duplicateClaim) {
    redirect(
      `/league/${leagueId}/waiver?error=${encodeURIComponent("You already have a pending claim for this castaway.")}`
    );
  }

  // Note: multiple claims sharing the same drop_castaway_id are allowed — they act as
  // backup options. The processing engine ensures a player can only win one claim per
  // drop castaway (usedDropsByPlayer tracking), so submitting backups is safe.

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

// ---------------------------------------------------------------------------
// Alliance actions
// ---------------------------------------------------------------------------

/**
 * Create an alliance with an active castaway.
 * Requirements: player must have all castaways eliminated, castaway must
 * be active (not eliminated), no active alliance already exists for this player.
 */
export async function createAllyAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const castawayId = formData.get("castaway_id") as string;
  const basePath = `/league/${leagueId}/waiver`;

  if (!leagueId || !castawayId) {
    redirect(`${basePath}?error=${encodeURIComponent("Missing required fields.")}`);
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Player must have all castaways eliminated (or no castaways assigned — late joiner with all elim)
  const { data: playerAssignments } = await supabase
    .from("team_assignments")
    .select("castaway_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id);

  if ((playerAssignments ?? []).length === 0) {
    redirect(`${basePath}?error=${encodeURIComponent("You must have been drafted before creating an alliance.")}`);
  }

  const playerCastawayIds = (playerAssignments ?? []).map((a) => a.castaway_id);

  const { data: activeCastaways } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false)
    .in("id", playerCastawayIds);

  if ((activeCastaways ?? []).length > 0) {
    redirect(
      `${basePath}?error=${encodeURIComponent(
        "You can only ally with a castaway after all your own castaways are eliminated."
      )}`
    );
  }

  // Target castaway must be active (not eliminated)
  const { data: targetCastaway } = await supabase
    .from("castaways")
    .select("id, name, is_eliminated")
    .eq("id", castawayId)
    .eq("league_id", leagueId)
    .single();

  if (!targetCastaway) {
    redirect(`${basePath}?error=${encodeURIComponent("Castaway not found.")}`);
  }

  if (targetCastaway.is_eliminated) {
    redirect(
      `${basePath}?error=${encodeURIComponent(
        `${targetCastaway.name} has been eliminated and cannot be allied with.`
      )}`
    );
  }

  // Target castaway must be owned (can't ally with a free agent on the waiver wire)
  const { data: castawayOwnership } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", castawayId)
    .single();

  if (!castawayOwnership) {
    redirect(
      `${basePath}?error=${encodeURIComponent(
        "That castaway is not on any team. You can only ally with owned castaways."
      )}`
    );
  }

  // Player cannot ally with their own castaway (shouldn't happen due to elimination check, but be safe)
  if (castawayOwnership.player_id === user.id) {
    redirect(`${basePath}?error=${encodeURIComponent("You cannot ally with your own castaway.")}`);
  }

  // Check for existing active alliance (partial unique index handles DB enforcement,
  // but give a clean error message here)
  const { data: existingAlly } = await supabase
    .from("league_allies")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .is("ended_at", null)
    .single();

  if (existingAlly) {
    redirect(
      `${basePath}?error=${encodeURIComponent(
        "You already have an active alliance. It ends when your ally castaway is eliminated."
      )}`
    );
  }

  // Determine points_from_episode: latest finalized episode + 1 (or 1 if none yet)
  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestEpisode?.number ?? 0) + 1;

  // Insert the alliance
  const { error } = await supabase.from("league_allies").insert({
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    points_from_episode: pointsFromEpisode,
  });

  if (error) {
    redirect(
      `${basePath}?error=${encodeURIComponent("Failed to create alliance. Please try again.")}`
    );
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=ally_created&section=alliance`);
}
