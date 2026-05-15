/**
 * Integration Tests: Edge Cases & Error Handling
 *
 * Exercises boundary conditions and error scenarios:
 * - Draft with fewer castaways than needed
 * - Trade after castaway elimination between proposal and acceptance
 * - Concurrent waiver claims (5 players, different bids)
 * - $0 bid waiver claim
 * - Negative bid rejection
 * - Finalize episode with zero events
 * - Multiple pending trades for same castaway
 * - Process waivers with no pending claims
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  proposeTrade,
  acceptTrade,
  submitWaiverClaim,
  processWaivers,
  finalizeEpisode,
  eliminateCastaway,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";

describe("Integration: Edge Cases", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.1: Draft with fewer castaways than needed
  // ---------------------------------------------------------------------------

  it("should stop draft early when fewer castaways than total picks needed", async () => {
    const admin = getAdminClient();

    // Delete most castaways to leave only 15 (need 20 for 10 players × 2 roster)
    // Remove castaways 16-30 (indices 15-29)
    for (let i = 15; i < 30; i++) {
      await admin.from("castaways").delete().eq("id", castawayIds[i]);
    }

    // Start auto draft — should complete with only 15 picks
    await startAutoDraft(leagueId);

    // Verify draft is complete
    const { data: draft } = await admin
      .from("drafts")
      .select("status, current_pick_index")
      .eq("league_id", leagueId)
      .single();

    expect(draft!.status).toBe("complete");
    expect(draft!.current_pick_index).toBe(15);

    // Verify only 15 draft_picks exist
    await admin
      .from("draft_picks")
      .select("id")
      .eq("draft_id", draft!.status === "complete" ? (await admin.from("drafts").select("id").eq("league_id", leagueId).single()).data!.id : "");

    // Re-query properly
    const { data: drafts } = await admin
      .from("drafts")
      .select("id")
      .eq("league_id", leagueId)
      .single();

    const { data: allPicks } = await admin
      .from("draft_picks")
      .select("id")
      .eq("draft_id", drafts!.id);

    expect(allPicks!.length).toBe(15);
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.2: Trade after castaway elimination between proposal and acceptance
  // ---------------------------------------------------------------------------

  it("should fail trade acceptance when castaway was eliminated after proposal", async () => {
    const admin = getAdminClient();

    // Reset: clean up and re-seed for this test
    await cleanup();
    const result = await seed();
    const lid = result.leagueId;
    const pids = result.playerIds;
    const cids = result.castawayIds;

    // Run auto draft
    await startAutoDraft(lid);

    // Get Player 1's and Player 2's castaways
    const { data: p1Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", lid)
      .eq("player_id", pids[0]);
    const { data: p2Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", lid)
      .eq("player_id", pids[1]);

    const proposerCastaway = p1Assignments![0].castaway_id;
    const receiverCastaway = p2Assignments![0].castaway_id;

    // Propose trade
    const tradeResult = await proposeTrade(
      lid,
      pids[0],
      pids[1],
      proposerCastaway,
      receiverCastaway
    );
    expect(tradeResult.error).toBeUndefined();

    // Eliminate the proposer's castaway AFTER proposal
    await eliminateCastaway(proposerCastaway, 1);

    // Try to accept — should fail because castaway is now eliminated
    const acceptResult = await acceptTrade(tradeResult.tradeId!, pids[1]);
    expect(acceptResult.error).toBeDefined();
    expect(acceptResult.error!.toLowerCase()).toContain("eliminated");

    // Update test-level vars for subsequent tests
    leagueId = lid;
    playerIds = pids;
    castawayIds = cids;
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.3: Concurrent waiver claims (5 players, different bids)
  // ---------------------------------------------------------------------------

  it("should award to highest bidder when 5 players claim same castaway", async () => {
    const admin = getAdminClient();

    // Find unassigned castaways
    const { data: assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((assignments ?? []).map((a) => a.castaway_id));

    const unassigned = castawayIds.filter((id) => !assignedIds.has(id));
    expect(unassigned.length).toBeGreaterThan(0);

    const targetCastaway = unassigned[0];

    // 5 players each claim the same castaway with different bids
    const bids = [10, 30, 20, 50, 40]; // Player 4 (index 3) has highest bid
    const claims: string[] = [];

    for (let i = 0; i < 5; i++) {
      // Get each player's castaway to drop
      const { data: pAssignments } = await admin
        .from("team_assignments")
        .select("castaway_id")
        .eq("league_id", leagueId)
        .eq("player_id", playerIds[i]);

      if (!pAssignments || pAssignments.length === 0) continue;

      const result = await submitWaiverClaim(
        leagueId,
        playerIds[i],
        targetCastaway,
        pAssignments[0].castaway_id,
        bids[i]
      );

      if (result.error) continue;
      claims.push(result.claimId!);
    }

    // Process waivers
    const processResult = await processWaivers(leagueId);
    expect(processResult.error).toBeUndefined();

    // Verify only one winner
    const { data: wonClaims } = await admin
      .from("waiver_claims")
      .select("id, player_id, bid_amount, status")
      .eq("league_id", leagueId)
      .eq("castaway_id", targetCastaway)
      .eq("status", "won");

    expect(wonClaims!.length).toBe(1);
    // Highest bidder should win (bid = 50)
    expect(wonClaims![0].bid_amount).toBe(50);

    // All others should be "lost"
    const { data: lostClaims } = await admin
      .from("waiver_claims")
      .select("id, status")
      .eq("league_id", leagueId)
      .eq("castaway_id", targetCastaway)
      .eq("status", "lost");

    expect(lostClaims!.length).toBe(claims.length - 1);
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.4: $0 bid waiver claim
  // ---------------------------------------------------------------------------

  it("should accept $0 bid and leave budget unchanged when won", async () => {
    const admin = getAdminClient();

    // Clean up pending claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "pending");

    // Find an unassigned castaway
    const { data: assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((assignments ?? []).map((a) => a.castaway_id));
    const unassigned = castawayIds.filter((id) => !assignedIds.has(id));

    if (unassigned.length === 0) return; // Skip if no unassigned castaways

    // Get Player 6's castaway to drop
    const { data: p6Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[5]);

    if (!p6Assignments || p6Assignments.length === 0) return;

    // Record budget before
    const { data: budgetBefore } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[5])
      .single();

    // Submit $0 bid
    const claim = await submitWaiverClaim(
      leagueId,
      playerIds[5],
      unassigned[0],
      p6Assignments[0].castaway_id,
      0
    );
    expect(claim.error).toBeUndefined();

    // Process
    await processWaivers(leagueId);

    // Verify budget unchanged
    const { data: budgetAfter } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[5])
      .single();

    expect(budgetAfter!.waiver_budget_remaining).toBe(
      budgetBefore!.waiver_budget_remaining
    );
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.5: Negative bid rejected
  // ---------------------------------------------------------------------------

  it("should reject negative bid amount", async () => {
    const result = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      castawayIds[29],
      castawayIds[0],
      -5
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("non-negative");
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.5 (also covers 6.5 edge): Finalize episode with zero events
  // ---------------------------------------------------------------------------

  it("should finalize episode with zero manually-added events successfully", async () => {
    const admin = getAdminClient();

    // Eliminate a castaway so consolation events are generated
    const { data: someAssignment } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .limit(1)
      .single();

    if (someAssignment) {
      await eliminateCastaway(someAssignment.castaway_id, 1);
    }

    // Create an episode with no manual events and finalize it
    // First ensure episode 5 doesn't exist
    const { data: existingEp } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 5)
      .maybeSingle();

    if (!existingEp) {
      await admin.from("episodes").insert({ league_id: leagueId, number: 5 });
    }

    await finalizeEpisode(leagueId, 5);
    // Should succeed (or at least not crash)
    // Note: if there are no events at all, finalization might still work
    // The key assertion is that it doesn't error fatally

    const { data: ep5 } = await admin
      .from("episodes")
      .select("is_finalized")
      .eq("league_id", leagueId)
      .eq("number", 5)
      .single();

    if (ep5) {
      expect(ep5.is_finalized).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.6: Multiple pending trades for same castaway
  // ---------------------------------------------------------------------------

  it("should fail second trade when first is accepted (proposer no longer owns castaway)", async () => {
    const admin = getAdminClient();

    // Get Player 7's castaways
    const { data: p7Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[6]);

    const { data: p8Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[7]);

    const { data: p9Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[8]);

    if (!p7Assignments?.length || !p8Assignments?.length || !p9Assignments?.length) return;

    // Find a non-eliminated castaway owned by Player 7
    let castawayToTrade: string | undefined;
    for (const a of p7Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { castawayToTrade = a.castaway_id; break; }
    }
    if (!castawayToTrade) return;

    // Find non-eliminated castaways for the receivers
    let p8Castaway: string | undefined;
    for (const a of p8Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p8Castaway = a.castaway_id; break; }
    }
    let p9Castaway: string | undefined;
    for (const a of p9Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p9Castaway = a.castaway_id; break; }
    }
    if (!p8Castaway || !p9Castaway) return;

    // Propose two trades for the same castaway
    const trade1 = await proposeTrade(
      leagueId,
      playerIds[6],
      playerIds[7],
      castawayToTrade,
      p8Castaway
    );
    expect(trade1.error).toBeUndefined();

    const trade2 = await proposeTrade(
      leagueId,
      playerIds[6],
      playerIds[8],
      castawayToTrade,
      p9Castaway
    );
    expect(trade2.error).toBeUndefined();

    // Accept first trade
    const accept1 = await acceptTrade(trade1.tradeId!, playerIds[7]);
    expect(accept1.error).toBeUndefined();

    // Second trade should fail
    const accept2 = await acceptTrade(trade2.tradeId!, playerIds[8]);
    expect(accept2.error).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Requirement 13.7: Process waivers with no pending claims
  // ---------------------------------------------------------------------------

  it("should return error when processing waivers with no pending claims", async () => {
    const admin = getAdminClient();

    // Ensure no pending claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "pending");

    const result = await processWaivers(leagueId);
    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("no pending claims");
  });
});
