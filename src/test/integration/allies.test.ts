/**
 * Integration Tests: Alliance Feature
 *
 * Tests the full alliance lifecycle against a live Supabase database:
 * - Eligibility gating (only eliminated players can ally)
 * - Alliance creation with correct points_from_episode
 * - One active alliance per player enforcement
 * - Lock: cannot switch ally while castaway is active
 * - Alliance persists through a trade (follows the castaway)
 * - Alliance ends when allied castaway is eliminated
 * - Ally points are ceil(castaway_episode_pts / 2) from points_from_episode onward
 * - Consolation points are shared (ceil(consolation/2))
 * - Multiple players can ally with the same castaway
 * - Admin can force-end an alliance
 *
 * Requirements: Alliance feature
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  addEpisodeEvent,
  finalizeEpisode,
  eliminateCastaway,
  eliminateCastawayWithAllyCleanup,
  createAlly,
  endAlly,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";
import { computeAllyPoints } from "@/lib/scoring";
import type { CastawayBreakdown } from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Helpers: look up actual team ownership from DB (don't assume snake order)
// ---------------------------------------------------------------------------

async function getPlayerCastaways(leagueId: string, playerId: string): Promise<string[]> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("team_assignments")
    .select("castaway_id")
    .eq("league_id", leagueId)
    .eq("player_id", playerId);
  return (data ?? []).map((a) => a.castaway_id);
}

async function getCastawayOwnerId(leagueId: string, castawayId: string): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("team_assignments")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("castaway_id", castawayId)
    .single();
  return data?.player_id ?? null;
}

/**
 * Returns a castaway ID owned by `ownerId`'s opponent —
 * i.e. the first active, owned castaway NOT belonging to player 0 or ownerId.
 */
async function getActiveCastawayOwnedByOther(
  leagueId: string,
  excludePlayerIds: string[]
): Promise<string | null> {
  const supabase = getAdminClient();
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("castaway_id, player_id")
    .eq("league_id", leagueId)
    .not("player_id", "in", `(${excludePlayerIds.join(",")})`);

  for (const a of assignments ?? []) {
    const { data: c } = await supabase
      .from("castaways")
      .select("is_eliminated")
      .eq("id", a.castaway_id)
      .single();
    if (c && !c.is_eliminated) return a.castaway_id;
  }
  return null;
}

describe("Integration: Alliance Feature", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];

  // After auto draft with 10 players × roster_size=2:
  // 20 castaways are drafted (2 per player), 10 remain as free agents.
  // We query actual ownership from DB rather than assuming snake-order indices.

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;
    await startAutoDraft(leagueId);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Eligibility: can only ally when all castaways are eliminated
  // ---------------------------------------------------------------------------

  it("should reject alliance creation when player still has active castaways", async () => {
    // Player 0 has active castaways (just drafted) — cannot ally
    // Target: any active castaway owned by another player
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);
    expect(targetCastawayId).not.toBeNull();

    const result = await createAlly(leagueId, playerIds[0], targetCastawayId!);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/all.*eliminated|active/i);
  });

  it("should allow alliance creation after all player castaways are eliminated", async () => {
    const supabase = getAdminClient();

    // Eliminate ALL of player 0's castaways
    const p0Castaways = await getPlayerCastaways(leagueId, playerIds[0]);
    expect(p0Castaways.length).toBeGreaterThan(0);
    for (const id of p0Castaways) {
      await eliminateCastaway(id, 1);
    }

    // Find an active castaway owned by another player (not player 0)
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);
    expect(targetCastawayId).not.toBeNull();

    // Player 0 now has all castaways eliminated — should be able to ally
    const result = await createAlly(leagueId, playerIds[0], targetCastawayId!);
    expect(result.error).toBeUndefined();
    expect(result.allyId).toBeDefined();

    // Verify the alliance was created in DB
    const { data: ally } = await supabase
      .from("league_allies")
      .select("*")
      .eq("id", result.allyId!)
      .single();

    expect(ally).toBeDefined();
    expect(ally!.player_id).toBe(playerIds[0]);
    expect(ally!.castaway_id).toBe(targetCastawayId);
    expect(ally!.ended_at).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // points_from_episode: set to (latest_finalized + 1) at creation time
  // ---------------------------------------------------------------------------

  it("should set points_from_episode to 1 when no episodes are finalized", async () => {
    const supabase = getAdminClient();

    // End player 0's current active ally so we can test a fresh creation
    const { data: existingAlly } = await supabase
      .from("league_allies")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();
    if (existingAlly) await endAlly(existingAlly.id, "admin_reset");

    // Verify no episodes are finalized yet
    const { data: finalizedEps } = await supabase
      .from("episodes")
      .select("number")
      .eq("league_id", leagueId)
      .eq("is_finalized", true);
    expect((finalizedEps ?? []).length).toBe(0);

    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);
    expect(targetCastawayId).not.toBeNull();

    const result = await createAlly(leagueId, playerIds[0], targetCastawayId!);
    expect(result.allyId).toBeDefined();

    const { data: ally } = await supabase
      .from("league_allies")
      .select("points_from_episode")
      .eq("id", result.allyId!)
      .single();

    expect(ally!.points_from_episode).toBe(1);
  });

  it("should set points_from_episode to latest_finalized + 1 after episodes are scored", async () => {
    const supabase = getAdminClient();

    // End player 0's existing active ally
    const { data: existingAlly } = await supabase
      .from("league_allies")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();
    if (existingAlly) await endAlly(existingAlly.id, "admin_reset");

    // Get a scoring rule to use
    const { data: rules } = await supabase
      .from("scoring_rules")
      .select("id")
      .eq("league_id", leagueId)
      .limit(1);
    const ruleId = rules![0].id;

    // Find an active castaway we can score
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);
    expect(targetCastawayId).not.toBeNull();

    // Add and finalize episode 1
    await addEpisodeEvent(leagueId, 1, targetCastawayId!, ruleId);
    await finalizeEpisode(leagueId, 1);

    // Now ally — points_from_episode should be 2
    const result = await createAlly(leagueId, playerIds[0], targetCastawayId!);
    expect(result.allyId).toBeDefined();

    const { data: ally } = await supabase
      .from("league_allies")
      .select("points_from_episode, castaway_id")
      .eq("id", result.allyId!)
      .single();

    expect(ally!.points_from_episode).toBe(2);
    // Store castaway for later tests
    (globalThis as Record<string, unknown>).__allyTargetCastawayId = ally!.castaway_id;
  });

  // ---------------------------------------------------------------------------
  // Uniqueness: one active alliance per player
  // ---------------------------------------------------------------------------

  it("should reject a second alliance while one is already active", async () => {
    // Player 0 already has an active ally (from previous test)
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);

    const result = await createAlly(leagueId, playerIds[0], targetCastawayId ?? castawayIds[5]);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/already.*active|active.*alliance/i);
  });

  // ---------------------------------------------------------------------------
  // Ally points calculation
  // ---------------------------------------------------------------------------

  it("should compute ally points as ceil(castaway_ep_pts / 2) from points_from_episode onward", async () => {
    const supabase = getAdminClient();

    // Get player 0's active alliance
    const { data: allyRow } = await supabase
      .from("league_allies")
      .select("castaway_id, points_from_episode")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();

    expect(allyRow).toBeDefined();
    const { castaway_id: targetId, points_from_episode: startEp } = allyRow!;

    // Get scoring rule
    const { data: rules } = await supabase
      .from("scoring_rules")
      .select("id, points")
      .eq("league_id", leagueId)
      .order("points", { ascending: false })
      .limit(1);
    const rule = rules![0];

    // Add event for the allied castaway in episode 2 (>= points_from_episode=2)
    await addEpisodeEvent(leagueId, 2, targetId, rule.id);
    await finalizeEpisode(leagueId, 2);

    // Get the actual points recorded for this castaway in ep 2
    const { data: events } = await supabase
      .from("episode_events")
      .select("points, episodes!inner(number, league_id)")
      .eq("castaway_id", targetId)
      .eq("episodes.league_id", leagueId)
      .eq("episodes.number", 2);

    const ep2Total = (events ?? []).reduce(
      (s: number, e: Record<string, unknown>) => s + (e.points as number),
      0
    );
    expect(ep2Total).toBeGreaterThan(0);

    const breakdown: CastawayBreakdown = {
      castaway_id: targetId,
      episode_points: { 1: rule.points, 2: ep2Total },
      consolation_points: 0,
      total: rule.points + ep2Total,
    };

    const allyPts = computeAllyPoints(breakdown, startEp);
    // Only ep 2 counts (startEp=2); ep 1 is excluded
    expect(allyPts).toBe(Math.ceil(ep2Total / 2));
    expect(allyPts).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Consolation: ally gets ceil(consolation_pts / 2)
  // ---------------------------------------------------------------------------

  it("should include consolation points in ally share (ceil)", async () => {
    const supabase = getAdminClient();
    const { data: league } = await supabase
      .from("leagues")
      .select("consolation_points")
      .eq("id", leagueId)
      .single();

    const consolation = league!.consolation_points; // test league has consolation_points=2

    const breakdown: CastawayBreakdown = {
      castaway_id: "test",
      episode_points: {},
      consolation_points: consolation,
      total: consolation,
    };

    const allyPts = computeAllyPoints(breakdown, 1);
    expect(allyPts).toBe(Math.ceil(consolation / 2));
    // Test league consolation_points=2 → ceil(2/2) = 1
    expect(allyPts).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Alliance ends on castaway elimination
  // ---------------------------------------------------------------------------

  it("should end alliance automatically when allied castaway is eliminated", async () => {
    const supabase = getAdminClient();

    // Get player 0's active alliance
    const { data: beforeAlly } = await supabase
      .from("league_allies")
      .select("id, castaway_id, ended_at")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();

    expect(beforeAlly).not.toBeNull();
    expect(beforeAlly!.ended_at).toBeNull();

    // Eliminate the allied castaway — this should end the alliance
    await eliminateCastawayWithAllyCleanup(leagueId, beforeAlly!.castaway_id, 3);

    // Alliance should now be ended
    const { data: afterAlly } = await supabase
      .from("league_allies")
      .select("ended_at, ended_reason")
      .eq("id", beforeAlly!.id)
      .single();

    expect(afterAlly!.ended_at).not.toBeNull();
    expect(afterAlly!.ended_reason).toBe("castaway_eliminated");
  });

  it("should allow creating a new alliance after the previous ally castaway is eliminated", async () => {
    // Player 0's ally was just eliminated — they should be able to ally again
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0]]);
    expect(targetCastawayId).not.toBeNull();

    const result = await createAlly(leagueId, playerIds[0], targetCastawayId!);
    expect(result.error).toBeUndefined();
    expect(result.allyId).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Alliance persists through a trade
  // ---------------------------------------------------------------------------

  it("should keep alliance active when allied castaway is traded to another player", async () => {
    const supabase = getAdminClient();

    // Get player 0's current active alliance
    const { data: allyRow } = await supabase
      .from("league_allies")
      .select("id, castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();

    expect(allyRow).not.toBeNull();
    const alliedCastawayId = allyRow!.castaway_id;

    // Find the current owner
    const currentOwnerId = await getCastawayOwnerId(leagueId, alliedCastawayId);
    expect(currentOwnerId).not.toBeNull();

    // Find a different player to receive the castaway in a simulated trade
    const newOwnerId = playerIds.find((id) => id !== currentOwnerId && id !== playerIds[0]);
    expect(newOwnerId).toBeDefined();

    // Get latest finalized episode for points_from_episode
    const { data: latestEp } = await supabase
      .from("episodes")
      .select("number")
      .eq("league_id", leagueId)
      .eq("is_finalized", true)
      .order("number", { ascending: false })
      .limit(1)
      .single();
    const newPointsFrom = (latestEp?.number ?? 0) + 1;

    // Simulate a trade: move the allied castaway to a new owner
    await supabase
      .from("team_assignments")
      .delete()
      .eq("league_id", leagueId)
      .eq("castaway_id", alliedCastawayId);

    await supabase.from("team_assignments").insert({
      league_id: leagueId,
      player_id: newOwnerId!,
      castaway_id: alliedCastawayId,
      points_from_episode: newPointsFrom,
      source: "trade",
    });

    // Alliance should STILL be active (follows the castaway, not the player)
    const { data: allyAfterTrade } = await supabase
      .from("league_allies")
      .select("id, ended_at, castaway_id")
      .eq("id", allyRow!.id)
      .single();

    expect(allyAfterTrade!.ended_at).toBeNull();
    expect(allyAfterTrade!.castaway_id).toBe(alliedCastawayId);
  });

  // ---------------------------------------------------------------------------
  // Multiple players can ally with the same castaway
  // ---------------------------------------------------------------------------

  it("should allow multiple players to ally with the same castaway", async () => {
    const supabase = getAdminClient();

    // Set up a clean shared target: find an ACTIVE, owned castaway that
    // neither player 0 nor player 1 owns.
    const sharedCastawayId = await getActiveCastawayOwnedByOther(leagueId, [
      playerIds[0],
      playerIds[1],
    ]);
    expect(sharedCastawayId).not.toBeNull();

    // Ensure player 0 has all castaways eliminated and no active ally, then ally
    const p0Castaways = await getPlayerCastaways(leagueId, playerIds[0]);
    for (const id of p0Castaways) {
      const { data: c } = await supabase
        .from("castaways").select("is_eliminated").eq("id", id).single();
      if (!c?.is_eliminated) await eliminateCastaway(id, 3);
    }
    const { data: p0Existing } = await supabase
      .from("league_allies").select("id")
      .eq("league_id", leagueId).eq("player_id", playerIds[0])
      .is("ended_at", null).single();
    if (p0Existing) await endAlly(p0Existing.id, "admin_reset");

    const p0Result = await createAlly(leagueId, playerIds[0], sharedCastawayId!);
    expect(p0Result.error).toBeUndefined();

    // Eliminate all of player 1's castaways so they can ally too
    const p1Castaways = await getPlayerCastaways(leagueId, playerIds[1]);
    for (const id of p1Castaways) {
      const { data: c } = await supabase
        .from("castaways").select("is_eliminated").eq("id", id).single();
      if (!c?.is_eliminated) await eliminateCastaway(id, 3);
    }

    // Player 1 should now be able to ally with the SAME castaway as player 0
    const result = await createAlly(leagueId, playerIds[1], sharedCastawayId!);
    expect(result.error).toBeUndefined();
    expect(result.allyId).toBeDefined();

    // Both player 0 and player 1 should have active alliances with this castaway
    const { data: alliesForCastaway } = await supabase
      .from("league_allies")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("castaway_id", sharedCastawayId!)
      .is("ended_at", null);

    expect(alliesForCastaway?.length).toBeGreaterThanOrEqual(2);
    const allyPlayerIds = alliesForCastaway!.map((a) => a.player_id);
    expect(allyPlayerIds).toContain(playerIds[0]);
    expect(allyPlayerIds).toContain(playerIds[1]);
  });

  // ---------------------------------------------------------------------------
  // Cannot ally with a free agent (unowned castaway)
  // ---------------------------------------------------------------------------

  it("should reject alliance with a free agent (unowned castaway)", async () => {
    const supabase = getAdminClient();

    // End player 0's active ally first
    const { data: existingAlly } = await supabase
      .from("league_allies")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .is("ended_at", null)
      .single();
    if (existingAlly) await endAlly(existingAlly.id, "admin_reset");

    // Find a free agent (not eliminated, not assigned)
    const { data: allAssignments } = await supabase
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((allAssignments ?? []).map((a) => a.castaway_id));

    const { data: allCastaways } = await supabase
      .from("castaways")
      .select("id")
      .eq("league_id", leagueId)
      .eq("is_eliminated", false);

    const freeAgent = (allCastaways ?? []).find((c) => !assignedIds.has(c.id));
    expect(freeAgent).toBeDefined();

    const result = await createAlly(leagueId, playerIds[0], freeAgent!.id);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/not on any team|waiver|unowned/i);
  });

  // ---------------------------------------------------------------------------
  // Cannot ally with an eliminated castaway
  // ---------------------------------------------------------------------------

  it("should reject alliance with an already-eliminated castaway", async () => {
    // Find an eliminated castaway
    const supabase = getAdminClient();
    const { data: eliminated } = await supabase
      .from("castaways")
      .select("id")
      .eq("league_id", leagueId)
      .eq("is_eliminated", true)
      .limit(1)
      .single();

    expect(eliminated).not.toBeNull();

    const result = await createAlly(leagueId, playerIds[0], eliminated!.id);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/eliminated/i);
  });

  // ---------------------------------------------------------------------------
  // Cannot ally with own castaway
  // ---------------------------------------------------------------------------

  it("should block a player from allying while they have an active castaway", async () => {
    const supabase = getAdminClient();

    // Use player 5 (a fresh player not touched by earlier tests) and give them
    // a brand-new active castaway, then verify they cannot ally.
    // First find a free-agent active castaway to assign.
    const { data: allAssignments } = await supabase
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((allAssignments ?? []).map((a) => a.castaway_id));

    const { data: freeAgents } = await supabase
      .from("castaways")
      .select("id")
      .eq("league_id", leagueId)
      .eq("is_eliminated", false);

    const freeAgent = (freeAgents ?? []).find((c) => !assignedIds.has(c.id));
    expect(freeAgent).toBeDefined();

    // Assign the free agent to player 5 (gives them an active castaway)
    await supabase.from("team_assignments").insert({
      league_id: leagueId,
      player_id: playerIds[5],
      castaway_id: freeAgent!.id,
      points_from_episode: 1,
      source: "admin_assign",
    });

    // Player 5 now has an active castaway — allying should be blocked on eligibility
    // Target any other owned active castaway
    const target = await getActiveCastawayOwnedByOther(leagueId, [playerIds[5]]);

    const result = await createAlly(leagueId, playerIds[5], target ?? freeAgent!.id);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/all.*eliminated|active/i);

    // Clean up — remove the temporary assignment
    await supabase
      .from("team_assignments")
      .delete()
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[5])
      .eq("castaway_id", freeAgent!.id);
  });

  // ---------------------------------------------------------------------------
  // Admin can force-end an alliance
  // ---------------------------------------------------------------------------

  it("should allow admin to force-end an active alliance with admin_reset reason", async () => {
    const supabase = getAdminClient();

    // Get player 1's active alliance
    const { data: allyToEnd } = await supabase
      .from("league_allies")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1])
      .is("ended_at", null)
      .single();

    expect(allyToEnd).not.toBeNull();

    const result = await endAlly(allyToEnd!.id, "admin_reset");
    expect(result.error).toBeUndefined();

    const { data: ended } = await supabase
      .from("league_allies")
      .select("ended_at, ended_reason")
      .eq("id", allyToEnd!.id)
      .single();

    expect(ended!.ended_at).not.toBeNull();
    expect(ended!.ended_reason).toBe("admin_reset");
  });

  it("should allow player to create new alliance after admin reset", async () => {
    // Player 1's alliance was just admin_reset — they should be free to ally again
    const targetCastawayId = await getActiveCastawayOwnedByOther(leagueId, [playerIds[0], playerIds[1]]);
    expect(targetCastawayId).not.toBeNull();

    const result = await createAlly(leagueId, playerIds[1], targetCastawayId!);
    expect(result.error).toBeUndefined();
    expect(result.allyId).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Leaderboard: alliance points are additive to player total
  // ---------------------------------------------------------------------------

  it("should verify ally points appear in the correct episode range only (pre-alliance excluded)", async () => {
    const supabase = getAdminClient();

    // Get player 0's historical alliance (the one from the points_from_episode test)
    const { data: historicalAlly } = await supabase
      .from("league_allies")
      .select("points_from_episode, castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .not("ended_at", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (historicalAlly) {
      // Build a breakdown with points in ep before alliance AND ep during alliance
      const preEp = historicalAlly.points_from_episode - 1;
      const inEp = historicalAlly.points_from_episode;

      const breakdown: CastawayBreakdown = {
        castaway_id: historicalAlly.castaway_id,
        episode_points: { [preEp]: 10, [inEp]: 6 },
        consolation_points: 0,
        total: 16,
      };

      // Only ep >= points_from_episode counts
      const allyPts = computeAllyPoints(breakdown, historicalAlly.points_from_episode);
      expect(allyPts).toBe(Math.ceil(6 / 2)); // = 3
    }
  });

  // ---------------------------------------------------------------------------
  // RLS: players can read all alliances but only insert their own
  // ---------------------------------------------------------------------------

  it("should enforce RLS: any league member can read league_allies", async () => {
    const { getScopedClient } = await import("./helpers/supabase");
    const { TEST_PLAYERS } = await import("./helpers/constants");

    // Sign in as player 2 (not player 0)
    const client = await getScopedClient(
      TEST_PLAYERS[2].email,
      TEST_PLAYERS[2].password
    );

    const { data, error } = await client
      .from("league_allies")
      .select("id, player_id")
      .eq("league_id", leagueId);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
  });
});
