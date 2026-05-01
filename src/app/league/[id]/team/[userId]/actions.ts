"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateTradeProposal } from "@/lib/trades";
import type { CastawayForTrade } from "@/lib/trades";

/**
 * Propose a trade: current user offers one of their castaways for one of the target player's castaways.
 * Requirements: 13.1, 13.2, 13.6
 */
export async function proposeTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const receiverId = formData.get("receiver_id") as string;
  const proposerCastawayId = formData.get("proposer_castaway_id") as string;
  const receiverCastawayId = formData.get("receiver_castaway_id") as string;

  if (!leagueId || !receiverId || !proposerCastawayId || !receiverCastawayId) {
    redirect(`/league/${leagueId}/team/${receiverId}?error=Missing+fields`);
  }

  // Verify both players are members of this league
  const { data: proposerMembership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!proposerMembership) redirect("/dashboard");

  const { data: receiverMembership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", receiverId)
    .single();

  if (!receiverMembership) {
    redirect(`/league/${leagueId}/team/${receiverId}?error=Player+not+in+league`);
  }

  // Fetch castaway info for validation
  const { data: proposerCastawayRow } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("id", proposerCastawayId)
    .eq("league_id", leagueId)
    .single();

  const { data: receiverCastawayRow } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("id", receiverCastawayId)
    .eq("league_id", leagueId)
    .single();

  // Fetch ownership via team_assignments
  const { data: proposerAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", proposerCastawayId)
    .single();

  const { data: receiverAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", receiverCastawayId)
    .single();

  const proposerCastaway: CastawayForTrade | null = proposerCastawayRow
    ? {
        id: proposerCastawayRow.id,
        is_eliminated: proposerCastawayRow.is_eliminated,
        owner_id: proposerAssignment?.player_id ?? "",
      }
    : null;

  const receiverCastaway: CastawayForTrade | null = receiverCastawayRow
    ? {
        id: receiverCastawayRow.id,
        is_eliminated: receiverCastawayRow.is_eliminated,
        owner_id: receiverAssignment?.player_id ?? "",
      }
    : null;

  const validation = validateTradeProposal(
    {
      proposer_id: user.id,
      receiver_id: receiverId,
      proposer_castaway_id: proposerCastawayId,
      receiver_castaway_id: receiverCastawayId,
    },
    proposerCastaway,
    receiverCastaway
  );

  if (!validation.valid) {
    redirect(
      `/league/${leagueId}/team/${receiverId}?error=${encodeURIComponent(validation.error!)}`
    );
  }

  // Insert the trade
  const { error } = await supabase.from("trades").insert({
    league_id: leagueId,
    proposer_id: user.id,
    receiver_id: receiverId,
    proposer_castaway: proposerCastawayId,
    receiver_castaway: receiverCastawayId,
    status: "pending",
  });

  if (error) {
    redirect(
      `/league/${leagueId}/team/${receiverId}?error=${encodeURIComponent("Failed to propose trade.")}`
    );
  }

  revalidatePath(`/league/${leagueId}/team/${receiverId}`);
  redirect(`/league/${leagueId}/team/${receiverId}?success=trade_proposed`);
}
