"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { computeLeagueLeaderboard } from "@/lib/league-standings";
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

  const { error } = await supabase
    .from("leagues")
    .update({
      is_complete: true,
      completed_at: new Date().toISOString(),
      winner_id: winnerId,
    })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to mark season complete.")}`);
  }

  revalidatePath(basePath);
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

  const { error } = await supabase
    .from("leagues")
    .update({ is_complete: false, completed_at: null, winner_id: null })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to reopen season.")}`);
  }

  revalidatePath(basePath);
  revalidatePath("/dashboard");
  redirect(`${basePath}?success=reopened`);
}
