"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLeagueAdmin } from "../helpers";

export async function approveTradeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/trades`;

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect(`${basePath}?error=Missing+trade+ID`);

  const { data: trade } = await supabase
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .single();

  if (!trade) redirect(`${basePath}?error=Trade+not+found`);
  if (trade.status !== "accepted") {
    redirect(`${basePath}?error=Trade+must+be+accepted+before+admin+approval`);
  }

  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestEpisode?.number ?? 0) + 1;

  const { error: tradeError } = await supabase
    .from("trades")
    .update({ status: "admin_approved", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (tradeError) redirect(`${basePath}?error=Failed+to+approve+trade`);

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

  revalidatePath(basePath);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/team`);
  redirect(`${basePath}?success=trade_approved`);
}

export async function adminRejectTradeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/trades`;

  const tradeId = formData.get("trade_id") as string;
  if (!tradeId) redirect(`${basePath}?error=Missing+trade+ID`);

  const { data: trade } = await supabase
    .from("trades")
    .select("id, status")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .single();

  if (!trade) redirect(`${basePath}?error=Trade+not+found`);
  if (trade.status !== "accepted") {
    redirect(`${basePath}?error=Trade+must+be+accepted+before+admin+action`);
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "admin_rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  if (error) redirect(`${basePath}?error=Failed+to+reject+trade`);

  revalidatePath(basePath);
  redirect(`${basePath}?success=trade_rejected`);
}
