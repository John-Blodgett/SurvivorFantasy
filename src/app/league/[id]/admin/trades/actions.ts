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
    .select("id, status")
    .eq("id", tradeId)
    .eq("league_id", leagueId)
    .single();

  if (!trade) redirect(`${basePath}?error=Trade+not+found`);
  if (trade.status !== "accepted") {
    redirect(`${basePath}?error=Trade+must+be+accepted+before+admin+approval`);
  }

  // Execute the assignment swap via SECURITY DEFINER RPC.
  // This handles the status update to 'admin_approved', deletes old
  // assignments, and inserts the swapped ones — bypassing the RLS chain
  // on team_assignments that can silently block admin DELETE operations.
  const { data: swapResult, error: swapError } = await supabase
    .rpc("execute_trade_swap", { p_trade_id: tradeId });

  if (swapError || swapResult?.error) {
    const msg = swapError?.message ?? swapResult?.error ?? "Failed to approve trade";
    redirect(`${basePath}?error=${encodeURIComponent(msg)}`);
  }

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
