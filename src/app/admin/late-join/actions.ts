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
    .select("id, name, roster_size")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  return { supabase, user, league };
}

/**
 * Assign a castaway to a late-joining player.
 * Sets points_from_episode to the next unfinalized episode number.
 * Requirements: 12.1, 12.2, 12.3
 */
export async function assignCastawayAction(formData: FormData) {
  const { supabase, league } = await getAdminLeague();

  const playerId = formData.get("player_id") as string;
  const castawayId = formData.get("castaway_id") as string;

  if (!playerId || !castawayId) {
    redirect("/admin/late-join?error=Missing+player+or+castaway+selection");
  }

  // Verify the player is a league member
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", league.id)
    .eq("player_id", playerId)
    .single();

  if (!membership) {
    redirect("/admin/late-join?error=Player+is+not+a+member+of+this+league");
  }

  // Verify the castaway is available (not on any team and not eliminated)
  const { data: existingAssignment } = await supabase
    .from("team_assignments")
    .select("id")
    .eq("league_id", league.id)
    .eq("castaway_id", castawayId)
    .limit(1)
    .single();

  if (existingAssignment) {
    redirect("/admin/late-join?error=This+castaway+is+already+on+a+team");
  }

  const { data: castaway } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("id", castawayId)
    .eq("league_id", league.id)
    .single();

  if (!castaway) {
    redirect("/admin/late-join?error=Castaway+not+found");
  }

  if (castaway.is_eliminated) {
    redirect("/admin/late-join?error=Cannot+assign+an+eliminated+castaway");
  }

  // Check the player hasn't already reached roster size
  const { count: currentRosterCount } = await supabase
    .from("team_assignments")
    .select("*", { count: "exact", head: true })
    .eq("league_id", league.id)
    .eq("player_id", playerId);

  if ((currentRosterCount ?? 0) >= league.roster_size) {
    redirect("/admin/late-join?error=Player+has+already+reached+the+roster+size+limit");
  }

  // Determine points_from_episode: next unfinalized episode number
  // Find the highest finalized episode, then cutoff is the next one
  const { data: latestFinalizedEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", league.id)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestFinalizedEpisode?.number ?? 0) + 1;

  // Create the team assignment
  const { error } = await supabase.from("team_assignments").insert({
    league_id: league.id,
    player_id: playerId,
    castaway_id: castawayId,
    points_from_episode: pointsFromEpisode,
    source: "admin_assign",
  });

  if (error) {
    redirect("/admin/late-join?error=Failed+to+assign+castaway");
  }

  revalidatePath("/admin/late-join");
  redirect("/admin/late-join?success=assigned");
}
