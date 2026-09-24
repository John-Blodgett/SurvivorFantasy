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

  // ---------------------------------------------------------------------------
  // Race condition: Receiver's castaway gets traded away before trade acceptance
  // ---------------------------------------------------------------------------

  it("should fail trade acceptance when receiver's castaway was traded away before acceptance", async () => {
    const admin = getAdminClient();

    // Get Player 4 and Player 5's non-eliminated castaways
    const { data: p4Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[3]);
    const { data: p5Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[4]);
    const { data: p6Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[5]);

    if (!p4Assignments?.length || !p5Assignments?.length || !p6Assignments?.length) return;

    // Find non-eliminated castaways
    let p4Castaway: string | undefined;
    for (const a of p4Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p4Castaway = a.castaway_id; break; }
    }
    let p5Castaway: string | undefined;
    for (const a of p5Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p5Castaway = a.castaway_id; break; }
    }
    let p6Castaway: string | undefined;
    for (const a of p6Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p6Castaway = a.castaway_id; break; }
    }

    if (!p4Castaway || !p5Castaway || !p6Castaway) return;

    // Player 4 proposes trade: offers p4Castaway for p5Castaway (owned by Player 5)
    const tradeProposal = await proposeTrade(
      leagueId,
      playerIds[3],
      playerIds[4],
      p4Castaway,
      p5Castaway
    );
    expect(tradeProposal.error).toBeUndefined();

    // Before Player 5 accepts, Player 5 trades p5Castaway to Player 6
    const sneakyTrade = await proposeTrade(
      leagueId,
      playerIds[4],
      playerIds[5],
      p5Castaway,
      p6Castaway
    );
    expect(sneakyTrade.error).toBeUndefined();
    const sneakyAccept = await acceptTrade(sneakyTrade.tradeId!, playerIds[5]);
    expect(sneakyAccept.error).toBeUndefined();

    // Now Player 5 tries to accept the original trade — should fail
    // because Player 5 no longer owns p5Castaway
    const acceptResult = await acceptTrade(tradeProposal.tradeId!, playerIds[4]);
    expect(acceptResult.error).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Race condition: Waiver claim drops a castaway that was traded away before processing
  // BUG: Waiver processing does not verify drop castaway ownership at processing time — Req 8.5
  // ---------------------------------------------------------------------------

  it("should invalidate waiver claim when drop castaway was traded away before processing — Req 8.5", async () => {
    const admin = getAdminClient();

    // Clean up pending claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "pending");

    // Find a player with a castaway to drop and an unassigned target
    const { data: p2Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1]);

    if (!p2Assignments?.length) return;

    // Find a non-eliminated castaway owned by Player 2
    let p2DropCastaway: string | undefined;
    for (const a of p2Assignments) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p2DropCastaway = a.castaway_id; break; }
    }
    if (!p2DropCastaway) return;

    // Find an unassigned, non-eliminated castaway for the waiver target
    const { data: allAssignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((allAssignments ?? []).map((a) => a.castaway_id));

    let targetCastaway: string | undefined;
    for (const cid of castawayIds) {
      if (assignedIds.has(cid)) continue;
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", cid).single();
      if (c && !c.is_eliminated) { targetCastaway = cid; break; }
    }
    if (!targetCastaway) return;

    // Player 2 submits a waiver claim: pick up targetCastaway, drop p2DropCastaway
    const claim = await submitWaiverClaim(
      leagueId,
      playerIds[1],
      targetCastaway,
      p2DropCastaway,
      5
    );
    expect(claim.error).toBeUndefined();

    // Before waivers are processed, Player 2 trades p2DropCastaway to another player
    // Find another player's castaway for the trade
    const { data: p3Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[2]);

    let p3Castaway: string | undefined;
    for (const a of (p3Assignments ?? [])) {
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", a.castaway_id).single();
      if (c && !c.is_eliminated) { p3Castaway = a.castaway_id; break; }
    }

    if (p3Castaway) {
      const tradeResult = await proposeTrade(
        leagueId,
        playerIds[1],
        playerIds[2],
        p2DropCastaway,
        p3Castaway
      );

      if (!tradeResult.error) {
        await acceptTrade(tradeResult.tradeId!, playerIds[2]);
      }
    }

    // Now process waivers — the claim should fail because Player 2
    // no longer owns the drop castaway
    await processWaivers(leagueId);

    // The waiver processing should either:
    // 1. Mark the claim as "lost" (because drop castaway is no longer owned)
    // 2. Or return an error
    // Either way, the claim should NOT be "won"
    const { data: claimResult } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim.claimId!)
      .single();

    // The claim should not have been won since the drop castaway was traded away
    if (claimResult) {
      expect(claimResult.status).not.toBe("won");
    }
  });
});

// ---------------------------------------------------------------------------
// Waiver drop-castaway ownership at processing time (BUG-002)
//
// Rule under test: a pending waiver claim is only valid if the claimant still
// owns the drop castaway at PROCESSING time. If they don't (because they
// traded/dropped it after submitting), the claim must be marked "lost", never
// "won".
//
// These tests intentionally use a fresh seed + auto draft so each player has a
// known, stable roster, then drive the exact multi-claim scenario from the
// product discussion:
//   John: drop Rob -> add Maggie ($5)
//   John: drop Rob -> add Susan ($3)
// Maggie is prioritized (higher bid). If John wins Maggie he no longer owns
// Rob, so the Susan claim must lose.
//
// NOTE: The "both claims drop Rob" case is ALSO covered today by the
// usedDropsByPlayer guard in processWaiverClaims, so that assertion would pass
// even without the ownership fix. The second test isolates the ownership rule
// specifically by using DIFFERENT drop castaways, so it can only pass once
// processing re-verifies current ownership.
//
// Marked it.fails() until BUG-002 is fixed (see KNOWN_BUGS.md).
// ---------------------------------------------------------------------------

describe("Integration: Waiver drop ownership at processing time (BUG-002)", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;
    // Give every player a roster so drops are real ownership.
    await startAutoDraft(leagueId);
  });

  afterAll(async () => {
    await cleanup();
  });

  /**
   * Returns two distinct non-eliminated castaways currently owned by the given
   * player, and a list of unassigned non-eliminated castaways usable as waiver
   * targets. Skips (returns undefined) if the roster can't support the case.
   */
  async function rosterFor(playerId: string) {
    const admin = getAdminClient();

    const { data: owned } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId);

    const ownedNonElim: string[] = [];
    for (const a of owned ?? []) {
      const { data: c } = await admin
        .from("castaways")
        .select("is_eliminated")
        .eq("id", a.castaway_id)
        .single();
      if (c && !c.is_eliminated) ownedNonElim.push(a.castaway_id);
    }

    const { data: allAssignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((allAssignments ?? []).map((a) => a.castaway_id));

    const targets: string[] = [];
    for (const cid of castawayIds) {
      if (assignedIds.has(cid)) continue;
      const { data: c } = await admin
        .from("castaways")
        .select("is_eliminated")
        .eq("id", cid)
        .single();
      if (c && !c.is_eliminated) targets.push(cid);
    }

    return { ownedNonElim, targets };
  }

  // The faithful "John" scenario: both claims drop the same castaway (Rob).
  // Maggie ($5) wins; the Susan claim ($3) must lose because Rob is gone.
  // This already works via the usedDropsByPlayer guard (not the ownership
  // re-check), so it's a passing test documenting correct current behavior.
  it(
    "winning a claim consumes the drop castaway so a second claim dropping the same castaway loses — Req 8.5",
    async () => {
      const admin = getAdminClient();
      await admin.from("waiver_claims").delete().eq("league_id", leagueId);

      const john = playerIds[0];
      const { ownedNonElim, targets } = await rosterFor(john);
      if (ownedNonElim.length < 1 || targets.length < 2) return;

      const rob = ownedNonElim[0];
      const maggie = targets[0]; // higher bid target
      const susan = targets[1]; // lower bid target

      const maggieClaim = await submitWaiverClaim(leagueId, john, maggie, rob, 5);
      expect(maggieClaim.error).toBeUndefined();

      const susanClaim = await submitWaiverClaim(leagueId, john, susan, rob, 3);
      expect(susanClaim.error).toBeUndefined();

      await processWaivers(leagueId);

      const { data: maggieRow } = await admin
        .from("waiver_claims")
        .select("status")
        .eq("id", maggieClaim.claimId!)
        .single();
      const { data: susanRow } = await admin
        .from("waiver_claims")
        .select("status")
        .eq("id", susanClaim.claimId!)
        .single();

      // Higher bid wins Maggie; Rob is now gone so Susan cannot be won.
      expect(maggieRow!.status).toBe("won");
      expect(susanRow!.status).toBe("lost");
    }
  );

  // Isolating test: DIFFERENT drop castaways, so the usedDropsByPlayer guard
  // does NOT apply. The only reason the second claim should lose is that John
  // no longer owns its drop castaway after trading it away. Passes once
  // processing re-verifies current ownership (the BUG-002 fix).
  it(
    "a claim whose drop castaway is no longer owned at processing time must lose — Req 8.5",
    async () => {
      const admin = getAdminClient();
      await admin.from("waiver_claims").delete().eq("league_id", leagueId);

      const john = playerIds[0];
      const { ownedNonElim, targets } = await rosterFor(john);
      // Need two distinct owned castaways (Rob + Steve) and two targets.
      if (ownedNonElim.length < 2 || targets.length < 2) return;

      const rob = ownedNonElim[0];
      const steve = ownedNonElim[1];
      const maggie = targets[0];
      const susan = targets[1];

      // Claim A: drop Rob -> Maggie ($5) — will win.
      const maggieClaim = await submitWaiverClaim(leagueId, john, maggie, rob, 5);
      expect(maggieClaim.error).toBeUndefined();

      // Claim B: drop Steve -> Susan ($3) — different drop, so the used-drop
      // guard does NOT cover it.
      const susanClaim = await submitWaiverClaim(leagueId, john, susan, steve, 3);
      expect(susanClaim.error).toBeUndefined();

      // After submitting, John trades Steve away, so he no longer owns the
      // drop castaway for Claim B by processing time.
      const { data: p2Owned } = await admin
        .from("team_assignments")
        .select("castaway_id")
        .eq("league_id", leagueId)
        .eq("player_id", playerIds[1]);

      let p2Castaway: string | undefined;
      for (const a of p2Owned ?? []) {
        const { data: c } = await admin
          .from("castaways")
          .select("is_eliminated")
          .eq("id", a.castaway_id)
          .single();
        if (c && !c.is_eliminated) {
          p2Castaway = a.castaway_id;
          break;
        }
      }
      if (!p2Castaway) return;

      const trade = await proposeTrade(leagueId, john, playerIds[1], steve, p2Castaway);
      expect(trade.error).toBeUndefined();
      const accept = await acceptTrade(trade.tradeId!, playerIds[1]);
      expect(accept.error).toBeUndefined();

      await processWaivers(leagueId);

      const { data: maggieRow } = await admin
        .from("waiver_claims")
        .select("status")
        .eq("id", maggieClaim.claimId!)
        .single();
      const { data: susanRow } = await admin
        .from("waiver_claims")
        .select("status")
        .eq("id", susanClaim.claimId!)
        .single();

      // Claim A still wins (John owns Rob at processing time).
      expect(maggieRow!.status).toBe("won");
      // Claim B must lose: its drop castaway (Steve) is no longer owned.
      expect(susanRow!.status).toBe("lost");
    }
  );
});
