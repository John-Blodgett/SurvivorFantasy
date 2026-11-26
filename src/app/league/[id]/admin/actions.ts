"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { computeLeagueLeaderboard } from "@/lib/league-standings";
import { loadAwardsInput } from "@/lib/league-awards";
import { computeAwards, flattenWinners } from "@/lib/awards";
import { requireLeagueAdmin } from "./helpers";

/**
 * Marks a league's season as complete. Captures the current leaderboard
 * leader as the winner (the rank-1 entry). Once complete, the league moves
 * out of the active dashboard list into "Past Seasons".
 */
export async function markSeasonCompleteAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin`;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, consolation_points, is_complete")
    .eq("id", leagueId)
    .single();

  if (!league) {
    redirect(`${basePath}?error=${encodeURIComponent("League not found.")}`);
  }

  if (league.is_complete) {
    redirect(`${basePath}?error=${encodeURIComponent("Season is already complete.")}`);
  }

  // Determine the winner from the final leaderboard (rank 1).
  const leaderboard = await computeLeagueLeaderboard(
    supabase,
    leagueId,
    league.consolation_points
  );
  const winnerId = leaderboard.find((e) => e.rank === 1)?.player_id ?? null;

  // Compute and save the season awards before marking the league complete,
  // so a failure leaves the league open.
  const awardsInput = await loadAwardsInput(supabase, leagueId);
  const awardRows = flattenWinners(computeAwards(awardsInput));
  const { data: saved, error: saveError } = await supabase.rpc("replace_league_awards", {
    p_league_id: leagueId,
    p_awards: awardRows,
  });
  if (saveError || saved?.error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to save season awards.")}`);
  }

  const { error } = await supabase
    .from("leagues")
    .update({
      is_complete: true,
      completed_at: new Date().toISOString(),
      winner_id: winnerId,
    })
    .eq("id", leagueId);

  if (error) {
    // Roll back the saved awards so the league stays consistent.
    await supabase.rpc("replace_league_awards", { p_league_id: leagueId, p_awards: [] });
    redirect(`${basePath}?error=${encodeURIComponent("Failed to mark season complete.")}`);
  }

  revalidatePath(basePath);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/awards`);
  revalidatePath("/dashboard");
  redirect(`${basePath}?success=completed`);
}

/**
 * Reopens a completed season (undo), clearing the completion flag and winner.
 */
export async function reopenSeasonAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin`;

  // Clear saved awards; they are recomputed the next time the season completes.
  const { data: cleared, error: clearError } = await supabase.rpc("replace_league_awards", {
    p_league_id: leagueId,
    p_awards: [],
  });
  if (clearError || cleared?.error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to clear season awards.")}`);
  }

  const { error } = await supabase
    .from("leagues")
    .update({ is_complete: false, completed_at: null, winner_id: null })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to reopen season.")}`);
  }

  revalidatePath(basePath);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/awards`);
  revalidatePath("/dashboard");
  redirect(`${basePath}?success=reopened`);
}
