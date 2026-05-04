"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateSnakeOrder, autoPickCastaway, type DraftPreference } from "@/lib/draft";

/**
 * Records a player's pick in the live draft.
 * Inserts into draft_picks and team_assignments, advances current_pick_index.
 * Requirements: 4.4, 4.5, 4.8
 */
export async function makeDraftPickAction(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const castawayId = formData.get("castaway_id") as string;

  console.log("[draft:pick] Starting pick", { userId: user.id, leagueId, castawayId });

  if (!leagueId || !castawayId) {
    console.warn("[draft:pick] Missing required fields", { leagueId, castawayId });
    return { error: "Missing required fields." };
  }

  // Load draft
  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index")
    .eq("league_id", leagueId)
    .single();

  console.log("[draft:pick] Draft loaded", { draft, draftError: draftError?.message });

  if (!draft || draft.status !== "active") {
    console.warn("[draft:pick] Draft not active", { status: draft?.status });
    return { error: "Draft is not active." };
  }

  // Load league
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) {
    console.warn("[draft:pick] League not found", { leagueId, leagueError: leagueError?.message });
    return { error: "League not found." };
  }

  // Load players in join order
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) {
    console.warn("[draft:pick] No players found for league", { leagueId });
    return { error: "No players found." };
  }

  const playerIds = members.map((m) => m.player_id);
  const snakeOrder = generateSnakeOrder(playerIds, league.roster_size);
  const currentPickIndex = draft.current_pick_index;

  console.log("[draft:pick] Snake order computed", {
    currentPickIndex,
    totalPicks: snakeOrder.length,
    expectedPlayer: snakeOrder[currentPickIndex],
    requestingPlayer: user.id,
  });

  if (currentPickIndex >= snakeOrder.length) {
    console.warn("[draft:pick] Draft already complete", { currentPickIndex, totalPicks: snakeOrder.length });
    return { error: "Draft is already complete." };
  }

  // Verify it's this player's turn
  const expectedPlayerId = snakeOrder[currentPickIndex];
  if (expectedPlayerId !== user.id) {
    console.warn("[draft:pick] Not this player's turn", {
      expectedPlayerId,
      requestingPlayerId: user.id,
      currentPickIndex,
    });
    return { error: "It is not your turn to pick." };
  }

  // Verify castaway is available (not already picked, not eliminated)
  const { data: castaway } = await supabase
    .from("castaways")
    .select("id, is_eliminated")
    .eq("id", castawayId)
    .eq("league_id", leagueId)
    .single();

  if (!castaway) {
    console.warn("[draft:pick] Castaway not found", { castawayId, leagueId });
    return { error: "Castaway not found." };
  }
  if (castaway.is_eliminated) {
    console.warn("[draft:pick] Castaway eliminated", { castawayId });
    return { error: "This castaway is no longer available." };
  }

  const { data: existingPick } = await supabase
    .from("draft_picks")
    .select("id")
    .eq("draft_id", draft.id)
    .eq("castaway_id", castawayId)
    .single();

  if (existingPick) {
    console.warn("[draft:pick] Castaway already picked", { castawayId, existingPickId: existingPick.id });
    return { error: "This castaway has already been picked." };
  }

  // Insert draft pick
  const { data: insertedPick, error: pickError } = await supabase.from("draft_picks").insert({
    draft_id: draft.id,
    player_id: user.id,
    castaway_id: castawayId,
    pick_number: currentPickIndex + 1,
  }).select("id").single();

  if (pickError) {
    console.error("[draft:pick] Failed to insert draft_pick", {
      pickError: pickError.message,
      code: pickError.code,
      details: pickError.details,
      hint: pickError.hint,
      draftId: draft.id,
      playerId: user.id,
      castawayId,
      pickNumber: currentPickIndex + 1,
    });
    return { error: `Failed to record pick: ${pickError.message}` };
  }

  console.log("[draft:pick] Draft pick inserted", { pickNumber: currentPickIndex + 1 });

  // Insert team assignment
  const { error: assignError } = await supabase.from("team_assignments").insert({
    league_id: leagueId,
    player_id: user.id,
    castaway_id: castawayId,
    points_from_episode: 1,
    source: "draft",
  });

  if (assignError) {
    console.error("[draft:pick] Failed to insert team_assignment", {
      assignError: assignError.message,
      code: assignError.code,
      details: assignError.details,
    });
    return { error: `Failed to assign castaway to team: ${assignError.message}` };
  }

  console.log("[draft:pick] Team assignment inserted");

  // Advance pick index and set pick_started_at for synchronized timer
  const nextIndex = currentPickIndex + 1;
  const isComplete = nextIndex >= snakeOrder.length;
  const now = new Date().toISOString();

  const { error: advanceError } = await supabase
    .from("drafts")
    .update({
      current_pick_index: nextIndex,
      pick_started_at: isComplete ? null : now,
      ...(isComplete
        ? { status: "complete", completed_at: now }
        : {}),
    })
    .eq("id", draft.id);

  if (advanceError) {
    console.error("[draft:pick] Failed to advance draft index", {
      advanceError: advanceError.message,
    });
  }

  console.log("[draft:pick] Pick complete", { nextIndex, isComplete });

  return {
    success: true,
    isComplete,
    pick: {
      id: insertedPick?.id ?? "",
      player_id: user.id,
      castaway_id: castawayId,
      pick_number: currentPickIndex + 1,
      picked_at: now,
    },
    draftStatus: isComplete ? "complete" : "active",
    currentPickIndex: nextIndex,
    pickStartedAt: isComplete ? null : now,
  };
}

/**
 * Auto-picks for the current player when the timer expires.
 * Requirements: 4.6
 */
export async function autoPickAction(leagueId: string) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Not authenticated." };

  console.log("[draft:auto-pick-action] Starting", { leagueId, userId: user.id });

  // Load draft
  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index")
    .eq("league_id", leagueId)
    .single();

  if (!draft || draft.status !== "active") {
    console.warn("[draft:auto-pick-action] Draft not active", { status: draft?.status, draftError: draftError?.message });
    return { error: "Draft not active." };
  }

  // Load league
  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) return { error: "League not found." };

  // Load players
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (!members) return { error: "No players found." };

  const playerIds = members.map((m) => m.player_id);
  const snakeOrder = generateSnakeOrder(playerIds, league.roster_size);
  const currentPickIndex = draft.current_pick_index;

  if (currentPickIndex >= snakeOrder.length) return { error: "Draft complete." };

  const currentPlayerId = snakeOrder[currentPickIndex];

  console.log("[draft:auto-pick-action] Picking for player", {
    currentPlayerId,
    currentPickIndex,
  });

  // Load already-drafted castaway IDs
  const { data: existingPicks } = await supabase
    .from("draft_picks")
    .select("castaway_id")
    .eq("draft_id", draft.id);

  const draftedIds = new Set((existingPicks ?? []).map((p) => p.castaway_id));

  // Load available castaways
  const { data: castaways } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false);

  const availableIds = (castaways ?? [])
    .map((c) => c.id)
    .filter((id) => !draftedIds.has(id));

  if (availableIds.length === 0) return { error: "No castaways available." };

  // Load preferences for current player
  const { data: prefsData } = await supabase
    .from("draft_preferences")
    .select("player_id, castaway_id, rank")
    .eq("league_id", leagueId)
    .eq("player_id", currentPlayerId);

  const preferences: DraftPreference[] = (prefsData ?? []).map((p) => ({
    player_id: p.player_id,
    castaway_id: p.castaway_id,
    rank: p.rank,
  }));

  const pickedId = autoPickCastaway(preferences, draftedIds, availableIds);
  if (!pickedId) return { error: "No castaway to auto-pick." };

  console.log("[draft:auto-pick-action] Auto-picked castaway", { pickedId, currentPlayerId });

  // Insert pick
  const { error: pickError } = await supabase.from("draft_picks").insert({
    draft_id: draft.id,
    player_id: currentPlayerId,
    castaway_id: pickedId,
    pick_number: currentPickIndex + 1,
  });

  if (pickError) {
    console.error("[draft:auto-pick-action] Failed to insert draft_pick", {
      pickError: pickError.message,
      code: pickError.code,
      details: pickError.details,
    });
    return { error: `Failed to auto-pick: ${pickError.message}` };
  }

  const { error: assignError } = await supabase.from("team_assignments").insert({
    league_id: leagueId,
    player_id: currentPlayerId,
    castaway_id: pickedId,
    points_from_episode: 1,
    source: "draft",
  });

  if (assignError) {
    console.error("[draft:auto-pick-action] Failed to insert team_assignment", {
      assignError: assignError.message,
      code: assignError.code,
    });
  }

  const nextIndex = currentPickIndex + 1;
  const isComplete = nextIndex >= snakeOrder.length;
  const now = new Date().toISOString();

  await supabase
    .from("drafts")
    .update({
      current_pick_index: nextIndex,
      pick_started_at: isComplete ? null : now,
      ...(isComplete
        ? { status: "complete", completed_at: now }
        : {}),
    })
    .eq("id", draft.id);

  console.log("[draft:auto-pick-action] Complete", { nextIndex, isComplete });

  return { success: true, pickedId, isComplete };
}
