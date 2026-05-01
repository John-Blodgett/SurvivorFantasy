"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLeagueAdmin } from "../helpers";

export async function assignCastawayAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/late-join`;

  const playerId = formData.get("player_id") as string;
  const castawayId = formData.get("castaway_id") as string;

  if (!playerId || !castawayId) {
    redirect(`${basePath}?error=Missing+player+or+castaway+selection`);
  }

  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .single();

  if (!membership) redirect(`${basePath}?error=Player+is+not+a+member+of+this+league`);

  const { data: existingAssignment } = await supabase
    .from("team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("castaway_id", castawayId)
    .limit(1)
    .single();

  if (existingAssignment) redirect(`${basePath}?error=This+castaway+is+already+on+a+team`);

  const { data: castaway } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("id", castawayId)
    .eq("league_id", leagueId)
    .single();

  if (!castaway) redirect(`${basePath}?error=Castaway+not+found`);
  if (castaway.is_eliminated) redirect(`${basePath}?error=Cannot+assign+an+eliminated+castaway`);

  // Get league roster size
  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size")
    .eq("id", leagueId)
    .single();

  const { count: currentRosterCount } = await supabase
    .from("team_assignments")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("player_id", playerId);

  if ((currentRosterCount ?? 0) >= (league?.roster_size ?? 1)) {
    redirect(`${basePath}?error=Player+has+already+reached+the+roster+size+limit`);
  }

  const { data: latestFinalizedEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestFinalizedEpisode?.number ?? 0) + 1;

  const { error } = await supabase.from("team_assignments").insert({
    league_id: leagueId,
    player_id: playerId,
    castaway_id: castawayId,
    points_from_episode: pointsFromEpisode,
    source: "admin_assign",
  });

  if (error) redirect(`${basePath}?error=Failed+to+assign+castaway`);

  revalidatePath(basePath);
  redirect(`${basePath}?success=assigned`);
}
