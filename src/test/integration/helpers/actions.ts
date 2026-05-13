/**
 * Integration test action helpers — replicate server action patterns
 * (query → validate → mutate) using direct Supabase queries via the admin client.
 *
 * These helpers bypass RLS intentionally for test setup and orchestration.
 * They mirror the logic in src/app/.../actions.ts without Next.js-specific
 * imports (redirect, revalidatePath, createClient from server).
 */

import { getAdminClient } from "./supabase";
import { generateSnakeOrder, autoPickCastaway, type DraftPreference } from "@/lib/draft";
import { processWaiverClaims, type WaiverClaim } from "@/lib/waiver";
import { buildConsolationEvents } from "@/lib/episodes";

// ---------------------------------------------------------------------------
// Draft Actions
// ---------------------------------------------------------------------------

/**
 * Starts a live draft for the given league.
 * - Queries league_members ordered by joined_at ASC to determine player order
 * - Generates snake order based on roster_size
 * - Inserts a drafts row with status="active"
 */
export async function startLiveDraft(
  leagueId: string
): Promise<{ draftId: string }> {
  const supabase = getAdminClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) throw new Error("League not found");

  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) {
    throw new Error("No players found in league");
  }

  const now = new Date().toISOString();

  const { data: draft, error } = await supabase
    .from("drafts")
    .insert({
      league_id: leagueId,
      status: "active",
      current_pick_index: 0,
      started_at: now,
      pick_started_at: now,
    })
    .select("id")
    .single();

  if (error || !draft) {
    throw new Error(`Failed to start draft: ${error?.message}`);
  }

  return { draftId: draft.id };
}


/**
 * Makes a draft pick for a specific player.
 * Replicates the makeDraftPickAction server action logic:
 * - Validates draft is active
 * - Validates it's the player's turn (snake_order[current_pick_index] === playerId)
 * - Validates castaway hasn't been picked already
 * - Inserts draft_pick and team_assignment
 * - Advances current_pick_index; completes draft if all picks made
 */
export async function makeDraftPick(
  draftId: string,
  playerId: string,
  castawayId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  // Load draft
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index, league_id")
    .eq("id", draftId)
    .single();

  if (!draft) return { error: "Draft not found." };
  if (draft.status !== "active") return { error: "Draft is not active." };

  // Load league for roster_size
  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size")
    .eq("id", draft.league_id)
    .single();

  if (!league) return { error: "League not found." };

  // Compute snake order from league members (not stored in DB)
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", draft.league_id)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) return { error: "No players found." };
  const snakeOrder = generateSnakeOrder(
    members.map((m) => m.player_id),
    league.roster_size
  );

  const currentPickIndex = draft.current_pick_index;

  if (currentPickIndex >= snakeOrder.length) {
    return { error: "Draft is already complete." };
  }

  // Validate it's this player's turn
  if (snakeOrder[currentPickIndex] !== playerId) {
    return { error: "It is not your turn to pick." };
  }

  // Validate castaway not already picked
  const { data: existingPick } = await supabase
    .from("draft_picks")
    .select("id")
    .eq("draft_id", draftId)
    .eq("castaway_id", castawayId)
    .single();

  if (existingPick) {
    return { error: "This castaway has already been picked." };
  }

  // Insert draft pick
  const { error: pickError } = await supabase.from("draft_picks").insert({
    draft_id: draftId,
    player_id: playerId,
    castaway_id: castawayId,
    pick_number: currentPickIndex + 1,
  });

  if (pickError) return { error: `Failed to record pick: ${pickError.message}` };

  // Insert team assignment
  const { error: assignError } = await supabase.from("team_assignments").insert({
    league_id: draft.league_id,
    player_id: playerId,
    castaway_id: castawayId,
    points_from_episode: 1,
    source: "draft",
  });

  if (assignError) return { error: `Failed to assign castaway: ${assignError.message}` };

  // Advance pick index
  const nextIndex = currentPickIndex + 1;
  const isComplete = nextIndex >= snakeOrder.length;
  const now = new Date().toISOString();

  await supabase
    .from("drafts")
    .update({
      current_pick_index: nextIndex,
      pick_started_at: isComplete ? null : now,
      ...(isComplete ? { status: "complete", completed_at: now } : {}),
    })
    .eq("id", draftId);

  return {};
}

/**
 * Starts and completes an auto draft for the given league.
 * - Creates draft record
 * - For each pick in snake order: uses player preferences (rank ASC) or
 *   alphabetical fallback to select a castaway
 * - Returns total number of picks made
 */
export async function startAutoDraft(
  leagueId: string
): Promise<{ totalPicks: number }> {
  const supabase = getAdminClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size")
    .eq("id", leagueId)
    .single();

  if (!league) throw new Error("League not found");

  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (!members || members.length === 0) {
    throw new Error("No players found in league");
  }

  const playerIds = members.map((m) => m.player_id);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("is_eliminated", false);

  if (!castaways || castaways.length === 0) {
    throw new Error("No available castaways");
  }

  const { data: prefsData } = await supabase
    .from("draft_preferences")
    .select("player_id, castaway_id, rank")
    .eq("league_id", leagueId);

  const preferences: DraftPreference[] = (prefsData ?? []).map((p) => ({
    player_id: p.player_id,
    castaway_id: p.castaway_id,
    rank: p.rank,
  }));

  const snakeOrder = generateSnakeOrder(playerIds, league.roster_size);
  const availableIds = castaways.map((c) => c.id);
  const draftedIds = new Set<string>();
  const now = new Date().toISOString();

  // Create draft record
  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .insert({
      league_id: leagueId,
      status: "active",
      current_pick_index: 0,
      started_at: now,
      pick_started_at: now,
    })
    .select("id")
    .single();

  if (draftError || !draft) {
    throw new Error(`Failed to create draft: ${draftError?.message}`);
  }

  // Auto-pick for each slot in snake order
  let pickCount = 0;
  for (let i = 0; i < snakeOrder.length; i++) {
    const currentPlayerId = snakeOrder[i];
    const playerPrefs = preferences.filter((p) => p.player_id === currentPlayerId);

    const pickedId = autoPickCastaway(playerPrefs, draftedIds, availableIds);
    if (!pickedId) break; // no castaways left

    draftedIds.add(pickedId);
    pickCount++;

    await supabase.from("draft_picks").insert({
      draft_id: draft.id,
      player_id: currentPlayerId,
      castaway_id: pickedId,
      pick_number: i + 1,
    });

    await supabase.from("team_assignments").insert({
      league_id: leagueId,
      player_id: currentPlayerId,
      castaway_id: pickedId,
      points_from_episode: 1,
      source: "draft",
    });
  }

  // Mark draft complete
  await supabase
    .from("drafts")
    .update({
      status: "complete",
      current_pick_index: pickCount,
      completed_at: new Date().toISOString(),
      pick_started_at: null,
    })
    .eq("id", draft.id);

  return { totalPicks: pickCount };
}


// ---------------------------------------------------------------------------
// Episode Actions
// ---------------------------------------------------------------------------

/**
 * Adds an episode event. Creates the episode if it doesn't exist.
 * Validates the episode is not finalized before inserting.
 */
export async function addEpisodeEvent(
  leagueId: string,
  episodeNum: number,
  castawayId: string,
  scoringRuleId: string
): Promise<{ eventId?: string; error?: string }> {
  const supabase = getAdminClient();

  // Ensure episode exists
  const { data: existing } = await supabase
    .from("episodes")
    .select("id, is_finalized")
    .eq("league_id", leagueId)
    .eq("number", episodeNum)
    .single();

  let episodeId: string;

  if (existing) {
    episodeId = existing.id;
    if (existing.is_finalized) {
      return { error: "Cannot add events to a finalized episode." };
    }
  } else {
    const { data: created, error: createError } = await supabase
      .from("episodes")
      .insert({ league_id: leagueId, number: episodeNum })
      .select("id")
      .single();

    if (createError || !created) {
      return { error: `Failed to create episode: ${createError?.message}` };
    }
    episodeId = created.id;
  }

  // Get scoring rule points
  const { data: rule } = await supabase
    .from("scoring_rules")
    .select("points")
    .eq("id", scoringRuleId)
    .single();

  const points = rule?.points ?? 0;

  // Insert episode event
  const { data: event, error: insertError } = await supabase
    .from("episode_events")
    .insert({
      episode_id: episodeId,
      castaway_id: castawayId,
      scoring_rule_id: scoringRuleId,
      points,
    })
    .select("id")
    .single();

  if (insertError || !event) {
    return { error: `Failed to record event: ${insertError?.message}` };
  }

  return { eventId: event.id };
}

/**
 * Finalizes an episode:
 * - Stamps player_id on all episode_events based on current team ownership
 * - Generates consolation events for eliminated castaways
 * - Sets is_finalized=true
 */
export async function finalizeEpisode(
  leagueId: string,
  episodeNum: number
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  // Get or create episode
  let { data: episode } = await supabase
    .from("episodes")
    .select("id, is_finalized")
    .eq("league_id", leagueId)
    .eq("number", episodeNum)
    .single();

  if (!episode) {
    const { data: created, error } = await supabase
      .from("episodes")
      .insert({ league_id: leagueId, number: episodeNum })
      .select("id, is_finalized")
      .single();
    if (error || !created) return { error: `Failed to create episode: ${error?.message}` };
    episode = created;
  }

  if (episode.is_finalized) {
    return { error: "Episode is already finalized." };
  }

  const episodeId = episode.id;

  // Get league consolation points
  const { data: league } = await supabase
    .from("leagues")
    .select("consolation_points")
    .eq("id", leagueId)
    .single();

  // Generate consolation events for eliminated castaways
  const { data: eliminatedCastaways } = await supabase
    .from("castaways")
    .select("id, eliminated_episode")
    .eq("league_id", leagueId)
    .eq("is_eliminated", true)
    .not("eliminated_episode", "is", null);

  const consolationEvents = buildConsolationEvents(
    episodeId,
    episodeNum,
    (eliminatedCastaways ?? []).map((c) => ({
      castaway_id: c.id,
      eliminated_episode: c.eliminated_episode!,
    })),
    league?.consolation_points ?? 0
  );

  if (consolationEvents.length > 0) {
    const { error: consolError } = await supabase
      .from("episode_events")
      .insert(consolationEvents);
    if (consolError) {
      return { error: `Failed to insert consolation events: ${consolError.message}` };
    }
  }

  // Finalize the episode
  const { error: finalizeError } = await supabase
    .from("episodes")
    .update({ is_finalized: true, finalized_at: new Date().toISOString() })
    .eq("id", episodeId);

  if (finalizeError) {
    return { error: `Failed to finalize episode: ${finalizeError.message}` };
  }

  // Stamp player_id on all episode events based on current team ownership
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id")
    .eq("league_id", leagueId);

  const ownerMap = new Map(
    (assignments ?? []).map((a) => [a.castaway_id, a.player_id])
  );

  const { data: events } = await supabase
    .from("episode_events")
    .select("id, castaway_id")
    .eq("episode_id", episodeId);

  for (const event of events ?? []) {
    const ownerId = ownerMap.get(event.castaway_id);
    if (ownerId) {
      await supabase
        .from("episode_events")
        .update({ player_id: ownerId })
        .eq("id", event.id);
    }
  }

  return {};
}

/**
 * Unfinalizes an episode:
 * - Sets is_finalized=false, finalized_at=null
 * - Deletes consolation events (scoring_rule_id IS NULL) for this episode
 */
export async function unfinalizeEpisode(
  leagueId: string,
  episodeNum: number
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  const { data: episode } = await supabase
    .from("episodes")
    .select("id, is_finalized")
    .eq("league_id", leagueId)
    .eq("number", episodeNum)
    .single();

  if (!episode) return { error: "Episode not found." };

  // Delete consolation events (those with no scoring_rule_id)
  await supabase
    .from("episode_events")
    .delete()
    .eq("episode_id", episode.id)
    .is("scoring_rule_id", null);

  // Unfinalize
  const { error } = await supabase
    .from("episodes")
    .update({ is_finalized: false, finalized_at: null })
    .eq("id", episode.id);

  if (error) return { error: `Failed to unfinalize episode: ${error.message}` };

  return {};
}

/**
 * Removes an episode event by ID.
 * Validates the event's episode is not finalized.
 */
export async function removeEpisodeEvent(
  eventId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  const { data: event } = await supabase
    .from("episode_events")
    .select("id, episode_id")
    .eq("id", eventId)
    .single();

  if (!event) return { error: "Event not found." };

  const { data: episode } = await supabase
    .from("episodes")
    .select("is_finalized")
    .eq("id", event.episode_id)
    .single();

  if (episode?.is_finalized) {
    return { error: "Cannot remove events from a finalized episode." };
  }

  await supabase.from("episode_events").delete().eq("id", eventId);
  return {};
}

/**
 * Marks a castaway as eliminated at the given episode number.
 */
export async function eliminateCastaway(
  castawayId: string,
  episodeNum: number
): Promise<void> {
  const supabase = getAdminClient();

  await supabase
    .from("castaways")
    .update({ is_eliminated: true, eliminated_episode: episodeNum })
    .eq("id", castawayId);
}


// ---------------------------------------------------------------------------
// Trade Actions
// ---------------------------------------------------------------------------

/**
 * Proposes a trade between two players.
 * Validates proposer owns their castaway and castaway is not eliminated.
 */
export async function proposeTrade(
  leagueId: string,
  proposerId: string,
  receiverId: string,
  proposerCastaway: string,
  receiverCastaway: string
): Promise<{ tradeId?: string; error?: string }> {
  const supabase = getAdminClient();

  // Validate proposer owns their castaway
  const { data: proposerAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", proposerCastaway)
    .eq("player_id", proposerId)
    .single();

  if (!proposerAssignment) {
    return { error: "You do not own the castaway you are offering." };
  }

  // Validate proposer's castaway is not eliminated
  const { data: proposerCastawayRow } = await supabase
    .from("castaways")
    .select("is_eliminated")
    .eq("id", proposerCastaway)
    .single();

  if (proposerCastawayRow?.is_eliminated) {
    return { error: "Eliminated castaways cannot be traded." };
  }

  // Validate receiver's castaway is not eliminated
  const { data: receiverCastawayRow } = await supabase
    .from("castaways")
    .select("is_eliminated")
    .eq("id", receiverCastaway)
    .single();

  if (receiverCastawayRow?.is_eliminated) {
    return { error: "Eliminated castaways cannot be traded." };
  }

  // Insert trade
  const { data: trade, error } = await supabase
    .from("trades")
    .insert({
      league_id: leagueId,
      proposer_id: proposerId,
      receiver_id: receiverId,
      proposer_castaway: proposerCastaway,
      receiver_castaway: receiverCastaway,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !trade) {
    return { error: `Failed to propose trade: ${error?.message}` };
  }

  return { tradeId: trade.id };
}

/**
 * Accepts a pending trade.
 * - Validates trade is still pending
 * - Validates both players still own their respective castaways
 * - Validates neither castaway is eliminated
 * - Swaps team assignments with points_from_episode = latestFinalized + 1
 * - Sets trade status to "admin_approved"
 */
export async function acceptTrade(
  tradeId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _receiverId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  const { data: trade } = await supabase
    .from("trades")
    .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
    .eq("id", tradeId)
    .single();

  if (!trade) return { error: "Trade not found." };
  if (trade.status !== "pending") return { error: "Trade is no longer pending." };

  // Validate receiver still owns their castaway
  const { data: receiverAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", trade.league_id)
    .eq("castaway_id", trade.receiver_castaway)
    .eq("player_id", trade.receiver_id)
    .single();

  if (!receiverAssignment) {
    return { error: "Receiver no longer owns their castaway." };
  }

  // Validate proposer still owns their castaway
  const { data: proposerAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", trade.league_id)
    .eq("castaway_id", trade.proposer_castaway)
    .eq("player_id", trade.proposer_id)
    .single();

  if (!proposerAssignment) {
    return { error: "Proposer no longer owns their castaway." };
  }

  // Validate neither castaway is eliminated
  const { data: proposerCastaway } = await supabase
    .from("castaways")
    .select("is_eliminated")
    .eq("id", trade.proposer_castaway)
    .single();

  if (proposerCastaway?.is_eliminated) {
    return { error: "Eliminated castaways cannot be traded." };
  }

  const { data: receiverCastaway } = await supabase
    .from("castaways")
    .select("is_eliminated")
    .eq("id", trade.receiver_castaway)
    .single();

  if (receiverCastaway?.is_eliminated) {
    return { error: "Eliminated castaways cannot be traded." };
  }

  // Determine points_from_episode
  const { data: latestEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", trade.league_id)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestEpisode?.number ?? 0) + 1;

  // Delete old team assignments
  await supabase
    .from("team_assignments")
    .delete()
    .eq("league_id", trade.league_id)
    .eq("castaway_id", trade.proposer_castaway);

  await supabase
    .from("team_assignments")
    .delete()
    .eq("league_id", trade.league_id)
    .eq("castaway_id", trade.receiver_castaway);

  // Insert new team assignments (swapped)
  await supabase.from("team_assignments").insert([
    {
      league_id: trade.league_id,
      player_id: trade.receiver_id,
      castaway_id: trade.proposer_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade" as const,
    },
    {
      league_id: trade.league_id,
      player_id: trade.proposer_id,
      castaway_id: trade.receiver_castaway,
      points_from_episode: pointsFromEpisode,
      source: "trade" as const,
    },
  ]);

  // Update trade status
  await supabase
    .from("trades")
    .update({ status: "admin_approved", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  return {};
}

/**
 * Rejects a pending trade.
 */
export async function rejectTrade(
  tradeId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _receiverId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  const { data: trade } = await supabase
    .from("trades")
    .select("status")
    .eq("id", tradeId)
    .single();

  if (!trade) return { error: "Trade not found." };
  if (trade.status !== "pending") return { error: "Trade is no longer pending." };

  await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  return {};
}

/**
 * Cancels a pending trade (proposer action).
 */
export async function cancelTrade(
  tradeId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _proposerId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  const { data: trade } = await supabase
    .from("trades")
    .select("status")
    .eq("id", tradeId)
    .single();

  if (!trade) return { error: "Trade not found." };
  if (trade.status !== "pending") return { error: "Trade is no longer pending." };

  await supabase
    .from("trades")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", tradeId);

  return {};
}


// ---------------------------------------------------------------------------
// Waiver Actions
// ---------------------------------------------------------------------------

/**
 * Submits a waiver claim for a player.
 * Validates: bid >= 0, castaway not eliminated, player owns drop castaway,
 * bid within budget.
 */
export async function submitWaiverClaim(
  leagueId: string,
  playerId: string,
  castawayId: string,
  dropCastawayId: string,
  bidAmount: number
): Promise<{ claimId?: string; error?: string }> {
  const supabase = getAdminClient();

  // Validate bid is non-negative
  if (bidAmount < 0) {
    return { error: "Bid amount must be a non-negative whole number." };
  }

  // Validate target castaway is not eliminated
  const { data: castaway } = await supabase
    .from("castaways")
    .select("is_eliminated")
    .eq("id", castawayId)
    .single();

  if (castaway?.is_eliminated) {
    return { error: "Eliminated castaways are not available on the waiver wire." };
  }

  // Validate player owns the drop castaway
  const { data: dropAssignment } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", dropCastawayId)
    .eq("player_id", playerId)
    .single();

  if (!dropAssignment) {
    return { error: "You do not own the castaway you are trying to drop." };
  }

  // Validate bid within budget
  const { data: member } = await supabase
    .from("league_members")
    .select("waiver_budget_remaining")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .single();

  if (!member) return { error: "Player not found in league." };

  if (bidAmount > member.waiver_budget_remaining) {
    return { error: "Bid amount exceeds your remaining waiver budget." };
  }

  // Get next priority number
  const { data: existingClaims } = await supabase
    .from("waiver_claims")
    .select("id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId)
    .eq("status", "pending");

  const priority = (existingClaims?.length ?? 0) + 1;

  // Insert waiver claim
  const { data: claim, error } = await supabase
    .from("waiver_claims")
    .insert({
      league_id: leagueId,
      player_id: playerId,
      castaway_id: castawayId,
      drop_castaway_id: dropCastawayId,
      bid_amount: bidAmount,
      priority,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !claim) {
    return { error: `Failed to submit claim: ${error?.message}` };
  }

  return { claimId: claim.id };
}

/**
 * Processes all pending waiver claims for a league.
 * Uses the pure processWaiverClaims logic, then applies DB mutations.
 */
export async function processWaivers(
  leagueId: string
): Promise<{ error?: string }> {
  const supabase = getAdminClient();

  // Get all pending claims
  const { data: rawClaims } = await supabase
    .from("waiver_claims")
    .select("id, league_id, player_id, castaway_id, drop_castaway_id, bid_amount, priority, status")
    .eq("league_id", leagueId)
    .eq("status", "pending");

  const pendingClaims: WaiverClaim[] = (rawClaims ?? []).map((c) => ({
    id: c.id,
    league_id: c.league_id,
    player_id: c.player_id,
    castaway_id: c.castaway_id,
    drop_castaway_id: c.drop_castaway_id,
    bid_amount: c.bid_amount,
    priority: c.priority,
    status: c.status as "pending",
  }));

  if (pendingClaims.length === 0) {
    return { error: "No pending claims to process." };
  }

  // Determine next episode number for points_from_episode
  const { data: episodes } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1);

  const nextEpisodeNumber = (episodes?.[0]?.number ?? 0) + 1;

  // Process claims using pure logic
  const result = processWaiverClaims(pendingClaims, nextEpisodeNumber);

  // Apply results to database
  for (const claimResult of result.results) {
    await supabase
      .from("waiver_claims")
      .update({
        status: claimResult.status,
        processed_at: new Date().toISOString(),
      })
      .eq("id", claimResult.claim_id);

    // Deduct budget for winners
    if (claimResult.status === "won" && claimResult.budget_deducted > 0) {
      const claim = pendingClaims.find((c) => c.id === claimResult.claim_id)!;
      const { data: member } = await supabase
        .from("league_members")
        .select("waiver_budget_remaining")
        .eq("league_id", leagueId)
        .eq("player_id", claim.player_id)
        .single();

      if (member) {
        await supabase
          .from("league_members")
          .update({
            waiver_budget_remaining: member.waiver_budget_remaining - claimResult.budget_deducted,
          })
          .eq("league_id", leagueId)
          .eq("player_id", claim.player_id);
      }
    }
  }

  // Apply new team assignments
  for (const assignment of result.newAssignments) {
    // Remove old assignment for the drop castaway
    await supabase
      .from("team_assignments")
      .delete()
      .eq("league_id", leagueId)
      .eq("player_id", assignment.player_id)
      .eq("castaway_id", assignment.drop_castaway_id);

    // Insert new assignment for the won castaway
    await supabase.from("team_assignments").insert({
      league_id: leagueId,
      player_id: assignment.player_id,
      castaway_id: assignment.castaway_id,
      points_from_episode: assignment.points_from_episode,
      source: "waiver",
    });
  }

  return {};
}


// ---------------------------------------------------------------------------
// Challenge Actions
// ---------------------------------------------------------------------------

/**
 * Creates a challenge for a given episode.
 * Validates title, points, and deadline.
 */
export async function createChallenge(
  leagueId: string,
  episodeId: string,
  title: string,
  points: number,
  deadline: string
): Promise<{ challengeId?: string; error?: string }> {
  // Validate inputs
  if (!title || !title.trim()) {
    return { error: "Challenge title is required." };
  }

  if (!points || points <= 0) {
    return { error: "Points must be a positive number." };
  }

  if (!deadline) {
    return { error: "Deadline is required." };
  }

  const supabase = getAdminClient();

  const { data: challenge, error } = await supabase
    .from("challenges")
    .insert({
      league_id: leagueId,
      episode_id: episodeId,
      title: title.trim(),
      points,
      deadline,
    })
    .select("id")
    .single();

  if (error || !challenge) {
    return { error: `Failed to create challenge: ${error?.message}` };
  }

  return { challengeId: challenge.id };
}

/**
 * Submits a response to a challenge.
 * Validates deadline hasn't passed and player hasn't already submitted.
 */
export async function submitChallengeResponse(
  challengeId: string,
  playerId: string,
  response: string
): Promise<{ submissionId?: string; error?: string }> {
  const supabase = getAdminClient();

  // Get challenge and check deadline
  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, deadline")
    .eq("id", challengeId)
    .single();

  if (!challenge) return { error: "Challenge not found." };

  const now = new Date();
  const deadlineDate = new Date(challenge.deadline);

  if (now > deadlineDate) {
    return { error: "The submission deadline for this challenge has passed." };
  }

  // Check for existing submission
  const { data: existing } = await supabase
    .from("challenge_submissions")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("player_id", playerId)
    .single();

  if (existing) {
    return { error: "You have already submitted a response to this challenge." };
  }

  // Insert submission
  const { data: submission, error } = await supabase
    .from("challenge_submissions")
    .insert({
      challenge_id: challengeId,
      player_id: playerId,
      response: response.trim(),
    })
    .select("id")
    .single();

  if (error || !submission) {
    return { error: `Failed to submit response: ${error?.message}` };
  }

  return { submissionId: submission.id };
}

/**
 * Grades a challenge submission as correct or incorrect.
 */
export async function gradeSubmission(
  submissionId: string,
  isCorrect: boolean
): Promise<void> {
  const supabase = getAdminClient();

  await supabase
    .from("challenge_submissions")
    .update({ is_correct: isCorrect })
    .eq("id", submissionId);
}
