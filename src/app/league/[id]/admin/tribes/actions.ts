"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateCreateTribe, validateUpdateTribe } from "@/lib/tribes";
import { requireLeagueAdmin } from "../helpers";

export async function createTribeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/tribes`;

  const name = (formData.get("name") as string | null) ?? "";
  const color = (formData.get("color") as string | null) ?? "";

  const validation = validateCreateTribe({ name, color });
  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase.from("tribes").insert({
    league_id: leagueId,
    name: name.trim(),
    color: color.trim() || null,
  });

  if (error) {
    if (error.code === "23505") {
      redirect(`${basePath}?error=${encodeURIComponent("A tribe with this name already exists.")}`);
    }
    redirect(`${basePath}?error=${encodeURIComponent("Failed to create tribe. Please try again.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=created`);
}

export async function updateTribeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/tribes`;

  const tribeId = formData.get("tribe_id") as string;
  const name = (formData.get("name") as string | null) ?? "";
  const color = (formData.get("color") as string | null) ?? "";

  if (!tribeId) {
    redirect(`${basePath}?error=${encodeURIComponent("Missing tribe ID.")}`);
  }

  const validation = validateUpdateTribe({ name, color });
  if (!validation.valid) {
    redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);
  }

  const { error } = await supabase
    .from("tribes")
    .update({ name: name.trim(), color: color.trim() || null })
    .eq("id", tribeId)
    .eq("league_id", leagueId);

  if (error) {
    if (error.code === "23505") {
      redirect(`${basePath}?error=${encodeURIComponent("A tribe with this name already exists.")}`);
    }
    redirect(`${basePath}?error=${encodeURIComponent("Failed to update tribe. Please try again.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=updated`);
}

export async function deleteTribeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/tribes`;

  const tribeId = formData.get("tribe_id") as string;
  if (!tribeId) {
    redirect(`${basePath}?error=${encodeURIComponent("Missing tribe ID.")}`);
  }

  // Check if any castaways are assigned to this tribe
  const { count } = await supabase
    .from("castaways")
    .select("id", { count: "exact", head: true })
    .eq("tribe_id", tribeId)
    .eq("league_id", leagueId);

  if (count && count > 0) {
    redirect(
      `${basePath}?error=${encodeURIComponent("Cannot delete a tribe that has castaways assigned. Reassign them first.")}`
    );
  }

  const { error } = await supabase
    .from("tribes")
    .delete()
    .eq("id", tribeId)
    .eq("league_id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to delete tribe. Please try again.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=deleted`);
}
