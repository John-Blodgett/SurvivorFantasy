import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSnakeOrder, autoPickCastaway, type DraftPreference } from "@/lib/draft";

/**
 * POST /api/draft/auto-pick
 *
 * Server-side endpoint that fires when the pick timer expires.
 * Performs an auto-pick for the current player using their preference list.
 *
 * Body: { leagueId: string, pickIndex: number }
 *
 * The pickIndex is used to guard against stale requests — if the draft has
 * already advanced past the given index (because the player picked manually),
 * the request is a no-op.
 *
 * Requirements: 4.6
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("[draft:auto-pick-api] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { leagueId?: string; pickIndex?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { leagueId, pickIndex } = body;

  console.log("[draft:auto-pick-api] Request received", { userId: user.id, leagueId, pickIndex });

  if (!leagueId || pickIndex === undefined) {
    return NextResponse.json(
      { error: "leagueId and pickIndex are required" },
      { status: 400 }
    );
  }

  // Load draft
  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index")
    .eq("league_id", leagueId)
    .single();

  console.log("[draft:auto-pick-api] Draft loaded", {
    draftId: draft?.id,
    status: draft?.status,
    currentPickIndex: draft?.current_pick_index,
    requestedPickIndex: pickIndex,
    draftError: draftError?.message,
  });

  if (!draft || draft.status !== "active") {
    return NextResponse.json({ skipped: true, reason: "draft not active" });
  }

  // Guard: if the draft has already moved past this pick, it's stale
  if (draft.current_pick_index !== pickIndex) {
    console.log("[draft:auto-pick-api] Stale request, pick already advanced", {
      draftIndex: draft.current_pick_index,
      requestedIndex: pickIndex,
    });
    return NextResponse.json({
      skipped: true,
      reason: "pick already made",
      currentIndex: draft.current_pick_index,
    });
  }

  // Load league
  const { data: league } = await supabase
    .from("leagues")
    .select("id, roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  // Load players in join order
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) {
    return NextResponse.json({ error: "No players found" }, { status: 400 });
  }

  const playerIds = members.map((m) => m.player_id);
  const snakeOrder = generateSnakeOrder(playerIds, league.roster_size);

  if (pickIndex >= snakeOrder.length) {
    return NextResponse.json({ skipped: true, reason: "draft complete" });
  }

  const currentPlayerId = snakeOrder[pickIndex];

  console.log("[draft:auto-pick-api] Picking for player", {
    currentPlayerId,
    pickIndex,
    totalPicks: snakeOrder.length,
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

  if (availableIds.length === 0) {
    console.warn("[draft:auto-pick-api] No castaways available", { draftedCount: draftedIds.size });
    return NextResponse.json({ error: "No castaways available" }, { status: 400 });
  }

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

  console.log("[draft:auto-pick-api] Preferences loaded", {
    preferencesCount: preferences.length,
    availableCount: availableIds.length,
  });

  const pickedId = autoPickCastaway(preferences, draftedIds, availableIds);
  if (!pickedId) {
    return NextResponse.json({ error: "No castaway to auto-pick" }, { status: 400 });
  }

  console.log("[draft:auto-pick-api] Auto-picked", { pickedId, currentPlayerId });

  // Insert pick
  const { data: insertedPick, error: pickError } = await supabase.from("draft_picks").insert({
    draft_id: draft.id,
    player_id: currentPlayerId,
    castaway_id: pickedId,
    pick_number: pickIndex + 1,
  }).select("id").single();

  if (pickError) {
    // Duplicate key means another client already made this pick (race condition) — that's fine
    if (pickError.code === "23505") {
      console.log("[draft:auto-pick-api] Pick already made by another client (duplicate key), skipping");
      return NextResponse.json({ skipped: true, reason: "pick already made" });
    }
    console.error("[draft:auto-pick-api] Failed to insert draft_pick", {
      pickError: pickError.message,
      code: pickError.code,
      details: pickError.details,
      hint: pickError.hint,
    });
    return NextResponse.json(
      { error: `Failed to record pick: ${pickError.message}` },
      { status: 500 }
    );
  }

  // Insert team assignment
  const { error: assignError } = await supabase.from("team_assignments").insert({
    league_id: leagueId,
    player_id: currentPlayerId,
    castaway_id: pickedId,
    points_from_episode: 1,
    source: "draft",
  });

  if (assignError) {
    console.error("[draft:auto-pick-api] Failed to insert team_assignment", {
      assignError: assignError.message,
      code: assignError.code,
    });
  }

  // Advance pick index
  const nextIndex = pickIndex + 1;
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

  console.log("[draft:auto-pick-api] Pick complete", { nextIndex, isComplete });

  return NextResponse.json({
    success: true,
    pickedCastawayId: pickedId,
    pickedForPlayerId: currentPlayerId,
    isComplete,
    pick: {
      id: insertedPick?.id ?? "",
      player_id: currentPlayerId,
      castaway_id: pickedId,
      pick_number: pickIndex + 1,
      picked_at: now,
    },
    draftStatus: isComplete ? "complete" : "active",
    currentPickIndex: nextIndex,
    pickStartedAt: isComplete ? null : now,
  });
}
