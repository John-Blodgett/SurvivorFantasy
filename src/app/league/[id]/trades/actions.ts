"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function acceptTradeInLeagueAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  const leagueId = formData.get("league_id") as string;
  if (!tradeId || !leagueId) redirect(`/league/${leagueId}/trades?error=Missing+data`);

  const { data: trade } = await supabase
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect(`/league/${leagueId}/trades?error=Trade+not+found`);
  }

  if (trade.status !== "pending") {
    redirect(`/league/${leagueId}/trades?error=Trade+is+no+longer+pending`);
  }

  // Determine points_from_episode for the new assignments
  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestEpisode?.number ?? 0) + 1;

  // Mark trade as completed
  const { error: updateError } = await supabase
    .from("trades")
    .update({ status: "admin_approved", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (updateError) {
    redirect(`/league/${leagueId}/trades?error=Failed+to+complete+trade`);
  }

  // Swap team assignments
  await supabase.from("team_assignments").delete()
    .eq("league_id", leagueId).eq("castaway_id", trade.proposer_castaway);
  await supabase.from("team_assignments").delete()
    .eq("league_id", leagueId).eq("castaway_id", trade.receiver_castaway);

  await supabase.from("team_assignments").insert([
    {
      league_id: leagueId,
      player_id: trade.receiver_id,
      castaway_id: trade.proposer_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade" as const,
    },
    {
      league_id: leagueId,
      player_id: trade.proposer_id,
      castaway_id: trade.receiver_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade" as const,
    },
  ]);

  revalidatePath(`/league/${leagueId}/trades`);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/team`);
  redirect(`/league/${leagueId}/trades?success=trade_accepted`);
}

export async function rejectTradeInLeagueAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  const leagueId = formData.get("league_id") as string;
  if (!tradeId || !leagueId) redirect(`/league/${leagueId}/trades?error=Missing+data`);

  const { data: trade } = await supabase
    .from("trades")
    .select("id, receiver_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect(`/league/${leagueId}/trades?error=Trade+not+found`);
  }

  if (trade.status !== "pending") {
    redirect(`/league/${leagueId}/trades?error=Trade+is+no+longer+pending`);
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) {
    redirect(`/league/${leagueId}/trades?error=Failed+to+reject+trade`);
  }

  revalidatePath(`/league/${leagueId}/trades`);
  redirect(`/league/${leagueId}/trades?success=trade_rejected`);
}

export async function cancelTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  const leagueId = formData.get("league_id") as string;
  if (!tradeId || !leagueId) redirect(`/league/${leagueId}/trades?error=Missing+data`);

  const { data: trade } = await supabase
    .from("trades")
    .select("id, proposer_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.proposer_id !== user.id) {
    redirect(`/league/${leagueId}/trades?error=Trade+not+found`);
  }

  if (trade.status !== "pending") {
    redirect(`/league/${leagueId}/trades?error=Trade+is+no+longer+pending`);
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) {
    redirect(`/league/${leagueId}/trades?error=Failed+to+cancel+trade`);
  }

  revalidatePath(`/league/${leagueId}/trades`);
  redirect(`/league/${leagueId}/trades?success=trade_cancelled`);
}


export async function proposeTradeFromTradesPageAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const receiverId = formData.get("receiver_id") as string;
  const proposerCastawayId = formData.get("proposer_castaway_id") as string;
  const receiverCastawayId = formData.get("receiver_castaway_id") as string;
  const basePath = `/league/${leagueId}/trades`;

  if (!leagueId || !receiverId || !proposerCastawayId || !receiverCastawayId) {
    redirect(`${basePath}?error=Missing+fields`);
  }

  // Verify both players are members
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
    redirect(`${basePath}?error=Player+not+in+league`);
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

  const { validateTradeProposal } = await import("@/lib/trades");

  const proposerCastaway = proposerCastawayRow
    ? { id: proposerCastawayRow.id, is_eliminated: proposerCastawayRow.is_eliminated, owner_id: proposerAssignment?.player_id ?? "" }
    : null;

  const receiverCastaway = receiverCastawayRow
    ? { id: receiverCastawayRow.id, is_eliminated: receiverCastawayRow.is_eliminated, owner_id: receiverAssignment?.player_id ?? "" }
    : null;

  const validation = validateTradeProposal(
    { proposer_id: user.id, receiver_id: receiverId, proposer_castaway_id: proposerCastawayId, receiver_castaway_id: receiverCastawayId },
    proposerCastaway,
    receiverCastaway
  );

  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase.from("trades").insert({
    league_id: leagueId,
    proposer_id: user.id,
    receiver_id: receiverId,
    proposer_castaway: proposerCastawayId,
    receiver_castaway: receiverCastawayId,
    status: "pending",
  });

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to propose trade.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=trade_proposed`);
}
