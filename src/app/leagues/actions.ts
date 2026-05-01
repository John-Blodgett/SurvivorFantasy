"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateCreateLeague, generateInviteCode } from "@/lib/leagues";

export async function createLeagueAction(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const name = (formData.get("name") as string | null) ?? "";
  const seasonNumber = parseInt((formData.get("season_number") as string) ?? "0", 10);
  const rosterSize = parseInt((formData.get("roster_size") as string) ?? "5", 10);

  const validation = validateCreateLeague({ name, seasonNumber, rosterSize });
  if (!validation.valid) {
    // Return error as a redirect with a query param so the client can display it
    redirect(`/leagues/new?error=${encodeURIComponent(validation.error!)}`);
  }

  const inviteCode = generateInviteCode();

  // Ensure the user has a profile row (FK target for leagues.admin_id)
  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name:
        user.user_metadata?.display_name ??
        user.email ??
        "Player",
    },
    { onConflict: "id", ignoreDuplicates: true }
  );

  if (profileError) {
    console.error("Profile upsert failed:", profileError);
    redirect(
      `/leagues/new?error=${encodeURIComponent(`Profile error: ${profileError.message}`)}`
    );
  }

  // Insert league — Requirements 2.1, 2.4, 2.5, 2.6
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .insert({
      name: name.trim(),
      season_number: seasonNumber,
      roster_size: rosterSize,
      invite_code: inviteCode,
      admin_id: user.id,
    })
    .select("id")
    .single();

  if (leagueError || !league) {
    console.error("League insert failed:", leagueError);
    redirect(
      `/leagues/new?error=${encodeURIComponent(
        leagueError?.message ?? "Failed to create league. Please try again."
      )}`
    );
  }

  // Add creator as a league member
  await supabase.from("league_members").insert({
    league_id: league.id,
    player_id: user.id,
  });

  // Seed default scoring rules — Requirement 5.3
  await supabase.rpc("seed_default_scoring_rules", { p_league_id: league.id });

  revalidatePath("/dashboard");
  redirect(`/dashboard?created=${league.id}`);
}
