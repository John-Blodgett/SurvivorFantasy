"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Saves a player's castaway preference rankings for the draft.
 * Expects formData with entries: castaway_id_<rank> = castawayId
 * Requirements: 4.2, 4.3
 */
export async function savePreferencesAction(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  if (!leagueId) redirect("/dashboard");

  // Verify the user is a member of this league
  const { data: membership } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Parse ranked castaway IDs from form: ranked_castaways is a JSON array
  const rankedJson = formData.get("ranked_castaways") as string;
  let rankedIds: string[] = [];
  try {
    rankedIds = JSON.parse(rankedJson);
  } catch {
    redirect(
      `/league/${leagueId}/preferences?error=${encodeURIComponent("Invalid ranking data.")}`
    );
  }

  if (!Array.isArray(rankedIds) || rankedIds.length === 0) {
    redirect(
      `/league/${leagueId}/preferences?error=${encodeURIComponent("No rankings submitted.")}`
    );
  }

  // Delete existing preferences for this player in this league
  await supabase
    .from("draft_preferences")
    .delete()
    .eq("league_id", leagueId)
    .eq("player_id", user.id);

  // Insert new preferences
  const rows = rankedIds.map((castawayId, index) => ({
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    rank: index + 1,
  }));

  const { error } = await supabase.from("draft_preferences").insert(rows);

  if (error) {
    redirect(
      `/league/${leagueId}/preferences?error=${encodeURIComponent("Failed to save preferences.")}`
    );
  }

  redirect(`/league/${leagueId}/preferences?success=saved`);
}
