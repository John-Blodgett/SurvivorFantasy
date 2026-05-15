"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/**
 * Accept a pending trade (receiver action).
 * Requirements: 13.2
 */
export async function acceptTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/dashboard?error=Missing+trade+ID");

  const { data: trade } = await supabase
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect("/dashboard?error=Trade+not+found");
  }

  if (trade.status !== "pending") {
    redirect("/dashboard?error=Trade+is+no+longer+pending");
  }

  const leagueId = trade.league_id;

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
    redirect("/dashboard?error=Failed+to+complete+trade");
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

  revalidatePath("/dashboard");
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/team`);
  redirect("/dashboard?success=trade_accepted");
}

/**
 * Reject a pending trade (receiver action).
 * Requirements: 13.2
 */
export async function rejectTradeAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/dashboard?error=Missing+trade+ID");

  const { data: trade } = await supabase
    .from("trades")
    .select("id, receiver_id, status")
    .eq("id", tradeId)
    .single();

  if (!trade || trade.receiver_id !== user.id) {
    redirect("/dashboard?error=Trade+not+found");
  }

  if (trade.status !== "pending") {
    redirect("/dashboard?error=Trade+is+no+longer+pending");
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) {
    redirect("/dashboard?error=Failed+to+reject+trade");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?success=trade_rejected");
}
