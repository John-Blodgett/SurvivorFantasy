"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireLeagueAdmin } from "../helpers";

/** Admin: force-end an active alliance. */
export async function adminEndAllyAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const allyId = formData.get("ally_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);

  // Alliances are now managed under the merged "Castaways & Tribes" admin page.
  const pagePath = `/league/${leagueId}/admin/castaways`;
  const basePath = `${pagePath}?section=alliances`;

  if (!allyId) {
    redirect(`${basePath}&error=${encodeURIComponent("Missing alliance ID.")}`);
  }

  const { data: result } = await supabase.rpc("end_ally", {
    p_ally_id: allyId,
    p_reason: "admin_reset",
  });

  if (result?.error) {
    redirect(`${basePath}&error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(pagePath);
  revalidatePath(`/league/${leagueId}/leaderboard`);
  revalidatePath(`/league/${leagueId}/waiver`);
  redirect(`${basePath}&success=ally_ended`);
}
