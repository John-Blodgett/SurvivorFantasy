"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { runAutoDraft, type DraftPreference } from "@/lib/draft";

/**
 * Configures draft mode and pick timer for a league.
 * Requirements: 4.1, 4.10
 */
export async function configureDraftAction(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const draftMode = formData.get("draft_mode") as "auto" | "live";
  const pickTimerSeconds = parseInt(
    (formData.get("pick_timer_seconds") as string) ?? "90",
    10
  );

  if (!leagueId) redirect("/dashboard");

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) {
    redirect("/dashboard");
  }

  // Update league draft settings
  const { error } = await supabase
    .from("leagues")
    .update({
      draft_mode: draftMode,
      pick_timer_seconds: pickTimerSeconds,
    })
    .eq("id", leagueId);

  if (error) {
    redirect(`/admin/draft?error=${encodeURIComponent("Failed to save draft settings.")}`);
  }

  redirect(`/admin/draft?success=configured`);
}

/**
 * Starts the draft (sets status to 'active').
 * For live drafts this opens the draft room; for auto drafts it runs immediately.
 * Requirements: 4.1, 4.10
 */
export async function startDraftAction(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  if (!leagueId) redirect("/dashboard");

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id, admin_id, draft_mode, roster_size")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) {
    redirect("/dashboard");
  }

  // Upsert draft record
  const { data: existing } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();

  if (existing?.status === "complete") {
    redirect(`/admin/draft?error=${encodeURIComponent("Draft is already complete.")}`);
  }

  if (existing?.status === "active") {
    // Already active — go to draft room
    redirect(`/league/${leagueId}/draft`);
  }

  // Create or activate draft record
  if (!existing) {
    const { error } = await supabase.from("drafts").insert({
      league_id: leagueId,
      status: "active",
      current_pick_index: 0,
      started_at: new Date().toISOString(),
    });
    if (error) {
      redirect(`/admin/draft?error=${encodeURIComponent("Failed to start draft.")}`);
    }
  } else {
    await supabase
      .from("drafts")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  // For auto draft, run it immediately
  if (league.draft_mode === "auto") {
    const result = await runAutoDraftAction(leagueId);
    if (result.error) {
      redirect(`/admin/draft?error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/admin/draft?success=auto_complete`);
  }

  // For live draft, redirect to the draft room
  redirect(`/league/${leagueId}/draft`);
}

/**
 * Executes the auto draft for a league.
 * Requirements: 4.2, 4.3, 4.9
 */
export async function runAutoDraftAction(leagueId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Verify the caller is the league admin
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, admin_id, roster_size")
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) {
    return { error: "League not found." };
  }

  if (league.admin_id !== user.id) {
    return { error: "Only the league admin can run the draft." };
  }

  // Load or create the draft record
  let { data: draft } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();

  if (!draft) {
    const { data: newDraft, error: createError } = await supabase
      .from("drafts")
      .insert({ league_id: leagueId, status: "pending", current_pick_index: 0 })
      .select("id, status")
      .single();

    if (createError || !newDraft) {
      return { error: "Failed to create draft record." };
    }
    draft = newDraft;
  }

  if (draft.status === "complete") {
    return { error: "Draft is already complete." };
  }

  // Load league members (players)
  const { data: members, error: membersError } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (membersError || !members || members.length === 0) {
    return { error: "No players found in this league." };
  }

  const playerIds = members.map((m) => m.player_id);

  // Load available (non-eliminated) castaways
  const { data: castaways, error: castawaysError } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false);

  if (castawaysError || !castaways || castaways.length === 0) {
    return { error: "No available castaways found for this league." };
  }

  const availableCastawayIds = castaways.map((c) => c.id);

  // Load player preferences
  const { data: prefsData } = await supabase
    .from("draft_preferences")
    .select("player_id, castaway_id, rank")
    .eq("league_id", leagueId);

  const preferences: DraftPreference[] = (prefsData ?? []).map((p) => ({
    player_id: p.player_id,
    castaway_id: p.castaway_id,
    rank: p.rank,
  }));

  // Mark draft as active
  await supabase
    .from("drafts")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", draft.id);

  // Run the pure auto draft logic
  const picks = runAutoDraft(
    playerIds,
    league.roster_size,
    availableCastawayIds,
    preferences
  );

  if (picks.length === 0) {
    return { error: "Draft produced no picks. Check castaway and player counts." };
  }

  // Insert draft_picks rows
  const draftPicksRows = picks.map((pick) => ({
    draft_id: draft!.id,
    player_id: pick.player_id,
    castaway_id: pick.castaway_id,
    pick_number: pick.pick_number,
  }));

  const { error: picksError } = await supabase
    .from("draft_picks")
    .insert(draftPicksRows);

  if (picksError) {
    return { error: "Failed to save draft picks." };
  }

  // Insert team_assignments rows
  const teamAssignmentRows = picks.map((pick) => ({
    league_id: leagueId,
    player_id: pick.player_id,
    castaway_id: pick.castaway_id,
    points_from_episode: 1,
    source: "draft" as const,
  }));

  const { error: assignmentsError } = await supabase
    .from("team_assignments")
    .insert(teamAssignmentRows);

  if (assignmentsError) {
    return { error: "Failed to save team assignments." };
  }

  // Mark draft as complete — Requirement 4.9
  await supabase
    .from("drafts")
    .update({
      status: "complete",
      current_pick_index: picks.length,
      completed_at: new Date().toISOString(),
    })
    .eq("id", draft.id);

  return { success: true, totalPicks: picks.length };
}
