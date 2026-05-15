"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateCreateCastaway } from "@/lib/castaways";
import { requireLeagueAdmin } from "../helpers";

export async function addCastawayAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/castaways`;

  const name = (formData.get("name") as string | null) ?? "";
  const tribe_id = (formData.get("tribe_id") as string | null) || null;
  const photo_url = (formData.get("photo_url") as string | null) || null;

  const validation = validateCreateCastaway({ name, tribe_id, photo_url });
  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase.from("castaways").insert({
    league_id: leagueId,
    name: name.trim(),
    tribe_id,
    photo_url,
  });

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to add castaway. Please try again.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=added`);
}

export async function eliminateCastawayAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/castaways`;

  const castawayId = formData.get("castaway_id") as string;
  const episodeNumber = parseInt((formData.get("episode_number") as string) ?? "0", 10);

  if (!castawayId) redirect(`${basePath}?error=Missing+castaway+ID`);

  const { error } = await supabase
    .from("castaways")
    .update({
      is_eliminated: true,
      eliminated_episode: episodeNumber > 0 ? episodeNumber : null,
    })
    .eq("id", castawayId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to update castaway.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=eliminated`);
}

export async function restoreCastawayAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/castaways`;

  const castawayId = formData.get("castaway_id") as string;
  if (!castawayId) redirect(`${basePath}?error=Missing+castaway+ID`);

  const { error } = await supabase
    .from("castaways")
    .update({ is_eliminated: false, eliminated_episode: null })
    .eq("id", castawayId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to restore castaway.")}`);
  }

  revalidatePath(basePath);
  redirect(basePath);
}
