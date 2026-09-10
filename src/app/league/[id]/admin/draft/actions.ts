"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAutoDraft, orderPlayersForDraft, type DraftPreference } from "@/lib/draft";
import { requireLeagueAdmin } from "../helpers";

export async function configureDraftAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const basePath = `/league/${leagueId}/admin/draft`;

  const draftMode = formData.get("draft_mode") as "auto" | "live";
  const pickTimerSeconds = parseInt((formData.get("pick_timer_seconds") as string) ?? "90", 10);

  const { error } = await supabase
    .from("leagues")
    .update({ draft_mode: draftMode, pick_timer_seconds: pickTimerSeconds })
    .eq("id", leagueId);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to save draft settings.")}`);
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=configured`);
}

export async function startDraftAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  await requireLeagueAdmin(leagueId);
  const supabase = createClient();
  const basePath = `/league/${leagueId}/admin/draft`;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, draft_mode, roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const { data: existing } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("league_id", leagueId)
    .single();

  if (existing?.status === "complete") {
    redirect(`${basePath}?error=${encodeURIComponent("Draft is already complete.")}`);
  }

  if (existing?.status === "active") {
    redirect(`/league/${leagueId}/draft`);
  }

  if (!existing) {
    const now = new Date().toISOString();
    const { error } = await supabase.from("drafts").insert({
      league_id: leagueId,
      status: "active",
      current_pick_index: 0,
      started_at: now,
      pick_started_at: now,
    });
    if (error) {
      redirect(`${basePath}?error=${encodeURIComponent("Failed to start draft.")}`);
    }
  } else {
    const now = new Date().toISOString();
    await supabase
      .from("drafts")
      .update({ status: "active", started_at: now, pick_started_at: now })
      .eq("id", existing.id);
  }

  if (league.draft_mode === "auto") {
    const result = await runAutoDraftAction(leagueId);
    if (result.error) {
      redirect(`${basePath}?error=${encodeURIComponent(result.error)}`);
    }
    revalidatePath(basePath);
    redirect(`${basePath}?success=auto_complete`);
  }

  redirect(`/league/${leagueId}/draft`);
}

export async function runAutoDraftAction(leagueId: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, admin_id, roster_size")
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) return { error: "League not found." };
  if (league.admin_id !== user.id) return { error: "Only the league admin can run the draft." };

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
    if (createError || !newDraft) return { error: "Failed to create draft record." };
    draft = newDraft;
  }

  if (draft.status === "complete") return { error: "Draft is already complete." };

  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at, draft_position")
    .eq("league_id", leagueId);

  if (!members || members.length === 0) return { error: "No players found in this league." };

  const playerIds = orderPlayersForDraft(members);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false);

  if (!castaways || castaways.length === 0) return { error: "No available castaways found." };

  const { data: prefsData } = await supabase
    .from("draft_preferences")
    .select("player_id, castaway_id, rank")
    .eq("league_id", leagueId);

  const preferences: DraftPreference[] = (prefsData ?? []).map((p) => ({
    player_id: p.player_id,
    castaway_id: p.castaway_id,
    rank: p.rank,
  }));

  await supabase
    .from("drafts")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", draft.id);

  const picks = runAutoDraft(
    playerIds,
    league.roster_size,
    castaways.map((c) => c.id),
    preferences
  );

  if (picks.length === 0) return { error: "Draft produced no picks." };

  const { error: picksError } = await supabase
    .from("draft_picks")
    .insert(picks.map((pick) => ({
      draft_id: draft!.id,
      player_id: pick.player_id,
      castaway_id: pick.castaway_id,
      pick_number: pick.pick_number,
    })));

  if (picksError) return { error: "Failed to save draft picks." };

  const { error: assignmentsError } = await supabase
    .from("team_assignments")
    .insert(picks.map((pick) => ({
      league_id: leagueId,
      player_id: pick.player_id,
      castaway_id: pick.castaway_id,
      points_from_episode: 1,
      source: "draft" as const,
    })));

  if (assignmentsError) return { error: "Failed to save team assignments." };

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

/**
 * Randomizes the draft order for a league by assigning each member a
 * random `draft_position`. Only allowed before the draft has started.
 */
export async function randomizeDraftOrderAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  await requireLeagueAdmin(leagueId);
  const supabase = createClient();
  const basePath = `/league/${leagueId}/admin/draft`;

  // Block randomizing once the draft is active or complete.
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .single();

  if (draft && draft.status !== "pending") {
    redirect(
      `${basePath}?error=${encodeURIComponent(
        "You can only change the draft order before the draft starts."
      )}`
    );
  }

  const { data: members } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId);

  if (!members || members.length === 0) {
    redirect(`${basePath}?error=${encodeURIComponent("No players to randomize.")}`);
  }

  // Fisher–Yates shuffle of the player IDs.
  const playerIds = members!.map((m) => m.player_id);
  for (let i = playerIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
  }

  // Persist positions (1-based) one row at a time.
  for (let i = 0; i < playerIds.length; i++) {
    const { error } = await supabase
      .from("league_members")
      .update({ draft_position: i + 1 })
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[i]);

    if (error) {
      redirect(
        `${basePath}?error=${encodeURIComponent("Failed to save draft order.")}`
      );
    }
  }

  revalidatePath(basePath);
  redirect(`${basePath}?success=order_randomized`);
}
