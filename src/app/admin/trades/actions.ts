"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/** Returns the league where the current user is admin, or redirects. */
async function getAdminLeague() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  return { supabase, user, leagueId: league.id };
}

/**
 * Admin approves a trade. Updates team_assignments with new points_from_episode cutoff.
 * Requirements: 13.3, 13.7
 */
export async function approveTradeAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/admin/trades?error=Missing+trade+ID");

  // Fetch the trade
  const { data: trade } = await supabase
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .single();

  if (!trade) redirect("/admin/trades?error=Trade+not+found");
  if (trade.status !== "accepted") {
    redirect("/admin/trades?error=Trade+must+be+accepted+before+admin+approval");
  }

  // Determine the next episode number for points_from_episode cutoff
  // Find the highest finalized episode number, then the cutoff is the next one
  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestEpisode?.number ?? 0) + 1;

  // Update trade status
  const { error: tradeError } = await supabase
    .from("trades")
    .update({ status: "admin_approved", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (tradeError) {
    redirect("/admin/trades?error=Failed+to+approve+trade");
  }

  // Swap team assignments:
  // 1. Delete old assignments for both castaways
  await supabase
    .from("team_assignments")
    .delete()
    .eq("league_id", leagueId)
    .eq("castaway_id", trade.proposer_castaway);

  await supabase
    .from("team_assignments")
    .delete()
    .eq("league_id", leagueId)
    .eq("castaway_id", trade.receiver_castaway);

  // 2. Create new assignments with the new points_from_episode cutoff
  await supabase.from("team_assignments").insert([
    {
      league_id: leagueId,
      player_id: trade.receiver_id,
      castaway_id: trade.proposer_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade",
    },
    {
      league_id: leagueId,
      player_id: trade.proposer_id,
      castaway_id: trade.receiver_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade",
    },
  ]);

  revalidatePath("/admin/trades");
  redirect("/admin/trades?success=trade_approved");
}

/**
 * Admin rejects a trade.
 * Requirements: 13.7
 */
export async function adminRejectTradeAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect("/admin/trades?error=Missing+trade+ID");

  const { data: trade } = await supabase
    .from("trades")
    .select("id, status")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .single();

  if (!trade) redirect("/admin/trades?error=Trade+not+found");
  if (trade.status !== "accepted") {
    redirect("/admin/trades?error=Trade+must+be+accepted+before+admin+action");
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "admin_rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) {
    redirect("/admin/trades?error=Failed+to+reject+trade");
  }

  revalidatePath("/admin/trades");
  redirect("/admin/trades?success=trade_rejected");
}
