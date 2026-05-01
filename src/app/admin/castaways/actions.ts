"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { validateCreateCastaway } from "@/lib/castaways";
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

/** Add a new castaway. Photo upload is handled client-side; photo_url is passed as a form field. */
export async function addCastawayAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const name = (formData.get("name") as string | null) ?? "";
  const tribe = (formData.get("tribe") as string | null) ?? "";
  const photo_url = (formData.get("photo_url") as string | null) || null;

  const validation = validateCreateCastaway({ name, tribe, photo_url });
  if (!validation.valid) {
    redirect(
      `/admin/castaways?error=${encodeURIComponent(validation.error!)}`
    );
  }

  const { error } = await supabase.from("castaways").insert({
    league_id: leagueId,
    name: name.trim(),
    tribe: tribe.trim() || null,
    photo_url,
  });

  if (error) {
    redirect(
      `/admin/castaways?error=${encodeURIComponent("Failed to add castaway. Please try again.")}`
    );
  }

  revalidatePath("/admin/castaways");
  redirect("/admin/castaways?success=added");
}

/** Mark a castaway as eliminated. */
export async function eliminateCastawayAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const castawayId = formData.get("castaway_id") as string;
  const episodeNumber = parseInt(
    (formData.get("episode_number") as string) ?? "0",
    10
  );

  if (!castawayId) redirect("/admin/castaways?error=Missing+castaway+ID");

  const { error } = await supabase
    .from("castaways")
    .update({
      is_eliminated: true,
      eliminated_episode: episodeNumber > 0 ? episodeNumber : null,
    })
    .eq("id", castawayId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(
      `/admin/castaways?error=${encodeURIComponent("Failed to update castaway.")}`
    );
  }

  revalidatePath("/admin/castaways");
  redirect("/admin/castaways?success=eliminated");
}

/** Restore a castaway (un-eliminate). */
export async function restoreCastawayAction(formData: FormData) {
  const { supabase, leagueId } = await getAdminLeague();

  const castawayId = formData.get("castaway_id") as string;
  if (!castawayId) redirect("/admin/castaways?error=Missing+castaway+ID");

  const { error } = await supabase
    .from("castaways")
    .update({ is_eliminated: false, eliminated_episode: null })
    .eq("id", castawayId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(
      `/admin/castaways?error=${encodeURIComponent("Failed to restore castaway.")}`
    );
  }

  revalidatePath("/admin/castaways");
  redirect("/admin/castaways");
}
