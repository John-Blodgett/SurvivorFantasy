/**
 * Integration Tests: Trade Lifecycle
 *
 * Exercises the full trade lifecycle against a live Supabase database:
 * - Propose trade (creates pending trades row)
 * - Accept trade (status → admin_approved, assignments swapped, points_from_episode set)
 * - Reject trade (status → rejected, resolved_at set, no assignment changes)
 * - Cancel trade (status → rejected, resolved_at set, no assignment changes)
 * - Validation: cannot trade castaway you don't own
 * - Validation: cannot trade eliminated castaway
 * - Validation: cannot accept non-pending trade
 * - Points boundary: original owner retains pre-trade points, new owner earns post-trade
 * - Concurrent trades: second trade fails when first accepted
 *
 * Server action references:
 * - src/app/league/[id]/trades/actions.ts (proposeTradeAction, acceptTradeAction)
 * - src/app/dashboard/trade-actions.ts (cancelTradeAction, rejectTradeAction)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  proposeTrade,
  acceptTrade,
  rejectTrade,
  cancelTrade,
  addEpisodeEvent,
  finalizeEpisode,
  eliminateCastaway,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";

describe("Integration: Trade Lifecycle", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];
  let scoringRuleIds: string[] = [];

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;

    // Run auto draft so players have team_assignments
    await startAutoDraft(leagueId);

    // Fetch scoring rule IDs for episode event tests
    const admin = getAdminClient();
    const { data: rules } = await admin
      .from("scoring_rules")
      .select("id, points")
      .eq("league_id", leagueId)
      .order("points", { ascending: false });

    scoringRuleIds = (rules ?? []).map((r) => r.id);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Helper: get team assignments for a player
  // ---------------------------------------------------------------------------

  async function getPlayerAssignments(playerId: string) {
    const admin = getAdminClient();
    const { data } = await admin
      .from("team_assignments")
      .select("castaway_id, player_id, points_from_episode, source")
      .eq("league_id", leagueId)
      .eq("player_id", playerId);
    return data ?? [];
  }

  async function getCastawayOwner(castawayId: string) {
    const admin = getAdminClient();
    const { data } = await admin
      .from("team_assignments")
      .select("player_id, points_from_episode, source")
      .eq("league_id", leagueId)
      .eq("castaway_id", castawayId)
      .single();
    return data;
  }

  // ---------------------------------------------------------------------------
  // Requirement 7.1: Propose trade creates correct trades row
  // ---------------------------------------------------------------------------

  it("should create a trades row with status 'pending' when proposing a trade", async () => {
    const admin = getAdminClient();

    // Get Player 1's castaways and Player 2's castaways
    const player1Assignments = await getPlayerAssignments(playerIds[0]);
    const player2Assignments = await getPlayerAssignments(playerIds[1]);

    expect(player1Assignments.length).toBeGreaterThan(0);
    expect(player2Assignments.length).toBeGreaterThan(0);

    const proposerCastaway = player1Assignments[0].castaway_id;
    const receiverCastaway = player2Assignments[0].castaway_id;

    const result = await proposeTrade(
      leagueId,
      playerIds[0],
      playerIds[1],
      proposerCastaway,
      receiverCastaway
    );

    expect(result.error).toBeUndefined();
    expect(result.tradeId).toBeDefined();

    // Verify the trades row
    const { data: trade } = await admin
      .from("trades")
      .select("id, league_id, proposer_id, receiver_id, proposer_castaway, receiver_castaway, status")
      .eq("id", result.tradeId!)
      .single();

    expect(trade).not.toBeNull();
    expect(trade!.league_id).toBe(leagueId);
    expect(trade!.proposer_id).toBe(playerIds[0]);
    expect(trade!.receiver_id).toBe(playerIds[1]);
    expect(trade!.proposer_castaway).toBe(proposerCastaway);
    expect(trade!.receiver_castaway).toBe(receiverCastaway);
    expect(trade!.status).toBe("pending");
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.2: Accept trade — status, assignments swapped, points_from_episode
  // ---------------------------------------------------------------------------

  it("should set status to 'admin_approved', swap team_assignments, and set points_from_episode on accept", async () => {
    const admin = getAdminClient();

    // Get Player 3's and Player 4's castaways
    const player3Assignments = await getPlayerAssignments(playerIds[2]);
    const player4Assignments = await getPlayerAssignments(playerIds[3]);

    const proposerCastaway = player3Assignments[0].castaway_id;
    const receiverCastaway = player4Assignments[0].castaway_id;

    // Finalize episode 1 so points_from_episode = 2
    await addEpisodeEvent(leagueId, 1, castawayIds[0], scoringRuleIds[0]);
    await finalizeEpisode(leagueId, 1);

    // Propose and accept trade
    const proposeResult = await proposeTrade(
      leagueId,
      playerIds[2],
      playerIds[3],
      proposerCastaway,
      receiverCastaway
    );
    expect(proposeResult.error).toBeUndefined();

    const acceptResult = await acceptTrade(proposeResult.tradeId!, playerIds[3]);
    expect(acceptResult.error).toBeUndefined();

    // Verify trade status
    const { data: trade } = await admin
      .from("trades")
      .select("status, resolved_at")
      .eq("id", proposeResult.tradeId!)
      .single();

    expect(trade!.status).toBe("admin_approved");
    expect(trade!.resolved_at).not.toBeNull();

    // Verify assignments are swapped
    const proposerCastawayOwner = await getCastawayOwner(proposerCastaway);
    expect(proposerCastawayOwner!.player_id).toBe(playerIds[3]); // receiver now owns proposer's castaway
    expect(proposerCastawayOwner!.source).toBe("trade");

    const receiverCastawayOwner = await getCastawayOwner(receiverCastaway);
    expect(receiverCastawayOwner!.player_id).toBe(playerIds[2]); // proposer now owns receiver's castaway
    expect(receiverCastawayOwner!.source).toBe("trade");

    // Verify points_from_episode = latest finalized (1) + 1 = 2
    expect(proposerCastawayOwner!.points_from_episode).toBe(2);
    expect(receiverCastawayOwner!.points_from_episode).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.3: Reject trade — status rejected, resolved_at set, no changes
  // ---------------------------------------------------------------------------

  it("should set status to 'rejected' with resolved_at and no assignment changes on reject", async () => {
    const admin = getAdminClient();

    // Get Player 5's and Player 6's castaways
    const player5Assignments = await getPlayerAssignments(playerIds[4]);
    const player6Assignments = await getPlayerAssignments(playerIds[5]);

    const proposerCastaway = player5Assignments[0].castaway_id;
    const receiverCastaway = player6Assignments[0].castaway_id;

    // Propose trade
    const proposeResult = await proposeTrade(
      leagueId,
      playerIds[4],
      playerIds[5],
      proposerCastaway,
      receiverCastaway
    );
    expect(proposeResult.error).toBeUndefined();

    // Reject trade
    const rejectResult = await rejectTrade(proposeResult.tradeId!, playerIds[5]);
    expect(rejectResult.error).toBeUndefined();

    // Verify trade status
    const { data: trade } = await admin
      .from("trades")
      .select("status, resolved_at")
      .eq("id", proposeResult.tradeId!)
      .single();

    expect(trade!.status).toBe("rejected");
    expect(trade!.resolved_at).not.toBeNull();

    // Verify assignments unchanged
    const proposerCastawayOwner = await getCastawayOwner(proposerCastaway);
    expect(proposerCastawayOwner!.player_id).toBe(playerIds[4]);

    const receiverCastawayOwner = await getCastawayOwner(receiverCastaway);
    expect(receiverCastawayOwner!.player_id).toBe(playerIds[5]);
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.4: Cancel trade — status rejected, resolved_at set, no changes
  // ---------------------------------------------------------------------------

  it("should set status to 'rejected' with resolved_at and no assignment changes on cancel", async () => {
    const admin = getAdminClient();

    // Get Player 7's and Player 8's castaways
    const player7Assignments = await getPlayerAssignments(playerIds[6]);
    const player8Assignments = await getPlayerAssignments(playerIds[7]);

    const proposerCastaway = player7Assignments[0].castaway_id;
    const receiverCastaway = player8Assignments[0].castaway_id;

    // Propose trade
    const proposeResult = await proposeTrade(
      leagueId,
      playerIds[6],
      playerIds[7],
      proposerCastaway,
      receiverCastaway
    );
    expect(proposeResult.error).toBeUndefined();

    // Cancel trade
    const cancelResult = await cancelTrade(proposeResult.tradeId!, playerIds[6]);
    expect(cancelResult.error).toBeUndefined();

    // Verify trade status
    const { data: trade } = await admin
      .from("trades")
      .select("status, resolved_at")
      .eq("id", proposeResult.tradeId!)
      .single();

    expect(trade!.status).toBe("rejected");
    expect(trade!.resolved_at).not.toBeNull();

    // Verify assignments unchanged
    const proposerCastawayOwner = await getCastawayOwner(proposerCastaway);
    expect(proposerCastawayOwner!.player_id).toBe(playerIds[6]);

    const receiverCastawayOwner = await getCastawayOwner(receiverCastaway);
    expect(receiverCastawayOwner!.player_id).toBe(playerIds[7]);
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.5: Cannot trade castaway you don't own
  // ---------------------------------------------------------------------------

  it("should return error 'You do not own the castaway you are offering' when proposing with unowned castaway", async () => {
    // Player 1 tries to trade Player 2's castaway as their own
    const player2Assignments = await getPlayerAssignments(playerIds[1]);
    const player1Assignments = await getPlayerAssignments(playerIds[0]);

    const unownedCastaway = player2Assignments[0].castaway_id;
    const receiverCastaway = player1Assignments[0].castaway_id;

    const result = await proposeTrade(
      leagueId,
      playerIds[0], // proposer
      playerIds[1], // receiver
      unownedCastaway, // Player 1 doesn't own this
      receiverCastaway
    );

    expect(result.error).toBeDefined();
    expect(result.error).toContain("You do not own the castaway you are offering");
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.6: Cannot trade eliminated castaway
  // ---------------------------------------------------------------------------

  it("should return error 'Eliminated castaways cannot be traded' when proposing with eliminated castaway", async () => {
    // Get Player 9's castaway and eliminate it
    const player9Assignments = await getPlayerAssignments(playerIds[8]);
    const player10Assignments = await getPlayerAssignments(playerIds[9]);

    const eliminatedCastawayId = player9Assignments[0].castaway_id;
    await eliminateCastaway(eliminatedCastawayId, 1);

    const result = await proposeTrade(
      leagueId,
      playerIds[8],
      playerIds[9],
      eliminatedCastawayId,
      player10Assignments[0].castaway_id
    );

    expect(result.error).toBeDefined();
    expect(result.error).toContain("Eliminated castaways cannot be traded");
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.7: Cannot accept non-pending trade
  // ---------------------------------------------------------------------------

  it("should return error 'no longer pending' when accepting a non-pending trade", async () => {
    // Use the rejected trade from the reject test — propose a new one and reject it
    const player5Assignments = await getPlayerAssignments(playerIds[4]);
    const player6Assignments = await getPlayerAssignments(playerIds[5]);

    const proposeResult = await proposeTrade(
      leagueId,
      playerIds[4],
      playerIds[5],
      player5Assignments[0].castaway_id,
      player6Assignments[0].castaway_id
    );
    expect(proposeResult.error).toBeUndefined();

    // Reject it first
    await rejectTrade(proposeResult.tradeId!, playerIds[5]);

    // Now try to accept the rejected trade
    const acceptResult = await acceptTrade(proposeResult.tradeId!, playerIds[5]);
    expect(acceptResult.error).toBeDefined();
    expect(acceptResult.error!.toLowerCase()).toContain("no longer pending");
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.8: Points boundary — original owner retains pre-trade points,
  //                   new owner earns from points_from_episode onward
  // ---------------------------------------------------------------------------

  it("should attribute pre-trade points to original owner and post-trade points to new owner", async () => {
    const admin = getAdminClient();

    // Use Player 5 and Player 6 for this test (they still own their original castaways)
    const player5Assignments = await getPlayerAssignments(playerIds[4]);
    const player6Assignments = await getPlayerAssignments(playerIds[5]);

    const castawayA = player5Assignments[0].castaway_id; // owned by Player 5
    const castawayB = player6Assignments[0].castaway_id; // owned by Player 6

    // Add event for castawayA in episode 1 (already finalized above)
    // Episode 1 is already finalized, so Player 5 should have points from it
    // Let's use episode 2: add event, finalize, then trade, then episode 3

    // Add event for castawayA in episode 2 (Player 5 owns it)
    const addResult2 = await addEpisodeEvent(leagueId, 2, castawayA, scoringRuleIds[0]);
    expect(addResult2.error).toBeUndefined();

    // Finalize episode 2 — Player 5 gets points for castawayA
    const finalize2 = await finalizeEpisode(leagueId, 2);
    expect(finalize2.error).toBeUndefined();

    // Now trade castawayA from Player 5 to Player 6
    // points_from_episode should be 3 (latest finalized = 2, so 2 + 1 = 3)
    const proposeResult = await proposeTrade(
      leagueId,
      playerIds[4],
      playerIds[5],
      castawayA,
      castawayB
    );
    expect(proposeResult.error).toBeUndefined();

    const acceptResult = await acceptTrade(proposeResult.tradeId!, playerIds[5]);
    expect(acceptResult.error).toBeUndefined();

    // Verify points_from_episode = 3 for the new assignment
    const castawayAOwner = await getCastawayOwner(castawayA);
    expect(castawayAOwner!.player_id).toBe(playerIds[5]); // Player 6 now owns castawayA
    expect(castawayAOwner!.points_from_episode).toBe(3);

    // Add event for castawayA in episode 3 and finalize
    const addResult3 = await addEpisodeEvent(leagueId, 3, castawayA, scoringRuleIds[0]);
    expect(addResult3.error).toBeUndefined();

    const finalize3 = await finalizeEpisode(leagueId, 3);
    expect(finalize3.error).toBeUndefined();

    // Verify episode 2 event for castawayA is attributed to Player 5 (original owner)
    const { data: ep2 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .single();

    const { data: ep2Events } = await admin
      .from("episode_events")
      .select("player_id, castaway_id")
      .eq("episode_id", ep2!.id)
      .eq("castaway_id", castawayA)
      .not("scoring_rule_id", "is", null);

    // Episode 2 was finalized when Player 5 owned castawayA
    expect(ep2Events!.length).toBeGreaterThan(0);
    expect(ep2Events![0].player_id).toBe(playerIds[4]); // Player 5

    // Verify episode 3 event for castawayA is attributed to Player 6 (new owner)
    const { data: ep3 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 3)
      .single();

    const { data: ep3Events } = await admin
      .from("episode_events")
      .select("player_id, castaway_id")
      .eq("episode_id", ep3!.id)
      .eq("castaway_id", castawayA)
      .not("scoring_rule_id", "is", null);

    // Episode 3 was finalized when Player 6 owned castawayA
    expect(ep3Events!.length).toBeGreaterThan(0);
    expect(ep3Events![0].player_id).toBe(playerIds[5]); // Player 6
  });

  // ---------------------------------------------------------------------------
  // Requirement 7.9: Concurrent trades — second trade fails when first accepted
  // ---------------------------------------------------------------------------

  it("should fail the second trade when the first is accepted (proposer no longer owns castaway)", async () => {
    // Use Player 7 and Player 8 (still own their original castaways after cancel test)
    const player7Assignments = await getPlayerAssignments(playerIds[6]);
    const player8Assignments = await getPlayerAssignments(playerIds[7]);

    // Player 10's assignments for the second trade receiver
    const player10Assignments = await getPlayerAssignments(playerIds[9]);

    const castawayToTrade = player7Assignments[0].castaway_id;
    const receiverCastaway1 = player8Assignments[0].castaway_id;
    const receiverCastaway2 = player10Assignments[0].castaway_id;

    // Propose two trades for the same castaway from Player 7
    const trade1 = await proposeTrade(
      leagueId,
      playerIds[6],
      playerIds[7],
      castawayToTrade,
      receiverCastaway1
    );
    expect(trade1.error).toBeUndefined();

    const trade2 = await proposeTrade(
      leagueId,
      playerIds[6],
      playerIds[9],
      castawayToTrade,
      receiverCastaway2
    );
    expect(trade2.error).toBeUndefined();

    // Accept the first trade — Player 7 no longer owns castawayToTrade
    const accept1 = await acceptTrade(trade1.tradeId!, playerIds[7]);
    expect(accept1.error).toBeUndefined();

    // Try to accept the second trade — should fail because Player 7 no longer owns it
    const accept2 = await acceptTrade(trade2.tradeId!, playerIds[9]);
    expect(accept2.error).toBeDefined();
    // The error should indicate the proposer no longer owns the castaway
    expect(accept2.error!.toLowerCase()).toContain("no longer owns");
  });
});
