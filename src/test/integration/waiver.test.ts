/**
 * Integration Tests: Waiver Wire
 *
 * Exercises the full waiver wire lifecycle against a live Supabase database:
 * - Waiver pool composition (non-eliminated, unassigned castaways only)
 * - Claim submission validation (budget, eliminated, ownership)
 * - Waiver processing (bid resolution, budget deduction, team assignment)
 * - Edge cases ($0 bids, negative bids, duplicate drops, no pending claims)
 *
 * Server action references:
 * - src/app/league/[id]/admin/waiver/actions.ts
 *     (processWaiversAction, updateWaiverScheduleAction)
 * - src/app/league/[id]/waiver/actions.ts
 *     (submitWaiverClaimAction, reorderWaiverClaimsAction, cancelWaiverClaimAction, editWaiverClaimAction)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  submitWaiverClaim,
  processWaivers,
  eliminateCastaway,
  addEpisodeEvent,
  finalizeEpisode,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";
import { TEST_LEAGUE } from "./helpers/constants";

describe("Integration: Waiver Wire", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;

    // Run auto draft so players have team_assignments
    // With 10 players and roster_size=2, castaways 0-19 are drafted, 20-29 are unassigned
    await startAutoDraft(leagueId);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.1: Waiver pool contains only non-eliminated, unassigned castaways
  // ---------------------------------------------------------------------------

  it("should have waiver pool containing only non-eliminated, unassigned castaways", async () => {
    const admin = getAdminClient();

    // Get all castaways in the league
    const { data: allCastaways } = await admin
      .from("castaways")
      .select("id, is_eliminated")
      .eq("league_id", leagueId);

    // Get all team assignments
    const { data: assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);

    const assignedIds = new Set((assignments ?? []).map((a) => a.castaway_id));

    // Waiver pool = not eliminated AND not assigned
    const waiverPool = (allCastaways ?? []).filter(
      (c) => !c.is_eliminated && !assignedIds.has(c.id)
    );

    // After auto draft with 10 players × 2 roster = 20 drafted, 10 remain
    expect(waiverPool.length).toBe(10);

    // Verify all pool members are unassigned and not eliminated
    for (const castaway of waiverPool) {
      expect(castaway.is_eliminated).toBe(false);
      expect(assignedIds.has(castaway.id)).toBe(false);
    }
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.2: Submit claim creates correct waiver_claims row
  // ---------------------------------------------------------------------------

  it("should create waiver_claims row with status=pending and sequential priority", async () => {
    const admin = getAdminClient();

    // Get Player 1's actual owned castaways (assigned by auto-draft)
    const { data: p1Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0]);

    expect(p1Assignments).not.toBeNull();
    expect(p1Assignments!.length).toBeGreaterThan(0);

    const p1OwnedCastaway = p1Assignments![0].castaway_id;

    // Find an unassigned, non-eliminated castaway for the target
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
    expect(targetCastaway).toBeDefined();

    // Player 1 submits claim: pick up unassigned castaway, drop owned castaway
    const result1 = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      targetCastaway!,
      p1OwnedCastaway,
      10
    );

    expect(result1.error).toBeUndefined();
    expect(result1.claimId).toBeDefined();

    // Verify the row
    const { data: claim1 } = await admin
      .from("waiver_claims")
      .select("id, status, bid_amount, priority, player_id, castaway_id, drop_castaway_id")
      .eq("id", result1.claimId!)
      .single();

    expect(claim1).not.toBeNull();
    expect(claim1!.status).toBe("pending");
    expect(claim1!.bid_amount).toBe(10);
    expect(claim1!.priority).toBe(1);
    expect(claim1!.player_id).toBe(playerIds[0]);
    expect(claim1!.castaway_id).toBe(targetCastaway!);
    expect(claim1!.drop_castaway_id).toBe(p1OwnedCastaway);

    // Submit a second claim — priority should be 2
    // Find Player 1's second owned castaway
    const secondOwnedCastaway = p1Assignments!.length > 1
      ? p1Assignments![1].castaway_id
      : p1OwnedCastaway; // fallback

    // Find a second unassigned target
    let targetCastaway2: string | undefined;
    for (const cid of castawayIds) {
      if (assignedIds.has(cid) || cid === targetCastaway) continue;
      const { data: c } = await admin.from("castaways").select("is_eliminated").eq("id", cid).single();
      if (c && !c.is_eliminated) { targetCastaway2 = cid; break; }
    }

    if (targetCastaway2 && p1Assignments!.length > 1) {
      const result2 = await submitWaiverClaim(
        leagueId,
        playerIds[0],
        targetCastaway2,
        secondOwnedCastaway,
        5
      );

      expect(result2.error).toBeUndefined();

      const { data: claim2 } = await admin
        .from("waiver_claims")
        .select("priority")
        .eq("id", result2.claimId!)
        .single();

      expect(claim2!.priority).toBe(2);
    }

    // Clean up claims for subsequent tests
    await admin.from("waiver_claims").delete().eq("league_id", leagueId);
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.3: Bid exceeds budget rejected
  // ---------------------------------------------------------------------------

  it("should reject claim when bid exceeds remaining waiver budget", async () => {
    const admin = getAdminClient();

    // Get Player 2's actual owned castaway (may have changed from prior tests)
    const { data: p2Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1])
      .limit(1);

    // Find an unassigned, non-eliminated castaway
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

    if (!p2Assignments?.length || !targetCastaway) return;

    const result = await submitWaiverClaim(
      leagueId,
      playerIds[1],
      targetCastaway,
      p2Assignments[0].castaway_id,
      TEST_LEAGUE.waiver_budget + 1 // 101 > 100
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("exceeds");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.4: Claim for eliminated castaway rejected
  // ---------------------------------------------------------------------------

  it("should reject claim for an eliminated castaway", async () => {
    // Eliminate an unassigned castaway (castaway 20)
    await eliminateCastaway(castawayIds[20], 1);

    const result = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      castawayIds[20], // eliminated
      castawayIds[0],
      10
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("eliminated castaways");

    // Restore for subsequent tests
    const admin = getAdminClient();
    await admin
      .from("castaways")
      .update({ is_eliminated: false, eliminated_episode: null })
      .eq("id", castawayIds[20]);
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.5: Drop castaway not owned rejected
  // ---------------------------------------------------------------------------

  it("should reject claim when player does not own the drop castaway", async () => {
    // Player 1 tries to drop a castaway owned by Player 2
    const admin = getAdminClient();
    const { data: p2Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1])
      .limit(1);

    const p2Castaway = p2Assignments![0].castaway_id;

    const result = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      castawayIds[20],
      p2Castaway, // not owned by player 0
      10
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("do not own");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.6: Waiver processing — highest bidder wins, losers marked "lost"
  // ---------------------------------------------------------------------------

  it("should award castaway to highest bidder, mark losers as lost, deduct budget from winner only", async () => {
    const admin = getAdminClient();

    // Get player 1 and player 2's owned castaways
    const { data: p1Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0]);

    const { data: p2Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1]);

    expect(p1Assignments!.length).toBeGreaterThan(0);
    expect(p2Assignments!.length).toBeGreaterThan(0);

    const p1Drop = p1Assignments![0].castaway_id;
    const p2Drop = p2Assignments![0].castaway_id;

    // Find an unassigned, non-eliminated castaway for the target
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
    expect(targetCastaway).toBeDefined();

    // Player 1 bids 20
    const claim1 = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      targetCastaway!,
      p1Drop,
      20
    );
    expect(claim1.error).toBeUndefined();

    // Player 2 bids 30 (higher)
    const claim2 = await submitWaiverClaim(
      leagueId,
      playerIds[1],
      targetCastaway!,
      p2Drop,
      30
    );
    expect(claim2.error).toBeUndefined();

    // Record budgets before processing
    const { data: p1Before } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .single();

    const { data: p2Before } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1])
      .single();

    // Process waivers
    const processResult = await processWaivers(leagueId);
    expect(processResult.error).toBeUndefined();

    // Verify Player 2 won (higher bid)
    const { data: wonClaim } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim2.claimId!)
      .single();
    expect(wonClaim!.status).toBe("won");

    // Verify Player 1 lost
    const { data: lostClaim } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim1.claimId!)
      .single();
    expect(lostClaim!.status).toBe("lost");

    // Verify winner's budget deducted
    const { data: p2After } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[1])
      .single();
    expect(p2After!.waiver_budget_remaining).toBe(
      p2Before!.waiver_budget_remaining - 30
    );

    // Verify loser's budget unchanged
    const { data: p1After } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[0])
      .single();
    expect(p1After!.waiver_budget_remaining).toBe(
      p1Before!.waiver_budget_remaining
    );

    // Verify winner has team_assignment for the target castaway
    const { data: winnerAssignment } = await admin
      .from("team_assignments")
      .select("player_id, source")
      .eq("league_id", leagueId)
      .eq("castaway_id", targetCastaway!)
      .single();
    expect(winnerAssignment!.player_id).toBe(playerIds[1]);
    expect(winnerAssignment!.source).toBe("waiver");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.7: Duplicate drop castaway invalidation
  // ---------------------------------------------------------------------------

  it("should mark second claim as lost when both claims drop the same castaway", async () => {
    const admin = getAdminClient();

    // Clean up previous claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "won");
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "lost");

    // Get player 3's castaways
    const { data: p3Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[2]);

    const p3Drop = p3Assignments![0].castaway_id;

    // Player 3 submits two claims dropping the same castaway for different targets
    const claim1 = await submitWaiverClaim(
      leagueId,
      playerIds[2],
      castawayIds[23], // target 1
      p3Drop,
      15
    );
    expect(claim1.error).toBeUndefined();

    const claim2 = await submitWaiverClaim(
      leagueId,
      playerIds[2],
      castawayIds[24], // target 2
      p3Drop,
      10
    );
    expect(claim2.error).toBeUndefined();

    // Process waivers
    const processResult = await processWaivers(leagueId);
    expect(processResult.error).toBeUndefined();

    // The first claim (higher bid, priority 1) should win
    const { data: firstClaim } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim1.claimId!)
      .single();
    expect(firstClaim!.status).toBe("won");

    // The second claim should be lost (drop castaway already used)
    const { data: secondClaim } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim2.claimId!)
      .single();
    expect(secondClaim!.status).toBe("lost");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.8: points_from_episode set correctly on waiver assignments
  // ---------------------------------------------------------------------------

  it("should set points_from_episode to latest finalized episode + 1 on waiver assignments", async () => {
    const admin = getAdminClient();

    // Clean up previous claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId);

    // Fetch scoring rules for adding events
    const { data: rules } = await admin
      .from("scoring_rules")
      .select("id")
      .eq("league_id", leagueId)
      .limit(1);

    const scoringRuleId = rules![0].id;

    // Create and finalize episode 1 (if not already finalized)
    const { data: ep1Existing } = await admin
      .from("episodes")
      .select("id, is_finalized")
      .eq("league_id", leagueId)
      .eq("number", 1)
      .maybeSingle();

    if (!ep1Existing) {
      await addEpisodeEvent(leagueId, 1, castawayIds[0], scoringRuleId);
      await finalizeEpisode(leagueId, 1);
    } else if (!ep1Existing.is_finalized) {
      await finalizeEpisode(leagueId, 1);
    }

    // Create and finalize episode 2 (if not already finalized)
    const { data: ep2Existing } = await admin
      .from("episodes")
      .select("id, is_finalized")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .maybeSingle();

    if (!ep2Existing) {
      await addEpisodeEvent(leagueId, 2, castawayIds[0], scoringRuleId);
      await finalizeEpisode(leagueId, 2);
    } else if (!ep2Existing.is_finalized) {
      await finalizeEpisode(leagueId, 2);
    }

    // Verify latest finalized episode is 2
    const { data: latestFinalized } = await admin
      .from("episodes")
      .select("number")
      .eq("league_id", leagueId)
      .eq("is_finalized", true)
      .order("number", { ascending: false })
      .limit(1);

    const latestEpNum = latestFinalized?.[0]?.number ?? 0;
    const expectedPointsFrom = latestEpNum + 1;

    // Get player 4's castaway to drop
    const { data: p4Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[3]);

    if (!p4Assignments || p4Assignments.length === 0) return;
    const p4Drop = p4Assignments[0].castaway_id;

    // Find an unassigned, non-eliminated castaway
    const { data: allAssignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId);
    const assignedIds = new Set((allAssignments ?? []).map((a) => a.castaway_id));

    let targetCastaway: string | undefined;
    for (const cid of castawayIds) {
      if (assignedIds.has(cid)) continue;
      const { data: c } = await admin
        .from("castaways")
        .select("is_eliminated")
        .eq("id", cid)
        .single();
      if (c && !c.is_eliminated) {
        targetCastaway = cid;
        break;
      }
    }

    if (!targetCastaway) return; // Skip if no valid target

    // Submit and process a waiver claim
    const claim = await submitWaiverClaim(
      leagueId,
      playerIds[3],
      targetCastaway,
      p4Drop,
      5
    );
    expect(claim.error).toBeUndefined();

    await processWaivers(leagueId);

    // Verify the new assignment has correct points_from_episode
    const { data: assignment } = await admin
      .from("team_assignments")
      .select("points_from_episode, source")
      .eq("league_id", leagueId)
      .eq("castaway_id", targetCastaway)
      .single();

    expect(assignment).not.toBeNull();
    expect(assignment!.points_from_episode).toBe(expectedPointsFrom);
    expect(assignment!.source).toBe("waiver");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.9: $0 bid accepted and budget unchanged if won
  // ---------------------------------------------------------------------------

  it("should accept $0 bid and leave budget unchanged when won", async () => {
    const admin = getAdminClient();

    // Clean up previous claims
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "pending");

    // Get player 5's castaway
    const { data: p5Assignments } = await admin
      .from("team_assignments")
      .select("castaway_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[4]);

    const p5Drop = p5Assignments![0].castaway_id;

    // Record budget before
    const { data: budgetBefore } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[4])
      .single();

    // Submit $0 bid
    const claim = await submitWaiverClaim(
      leagueId,
      playerIds[4],
      castawayIds[26], // unassigned
      p5Drop,
      0
    );
    expect(claim.error).toBeUndefined();
    expect(claim.claimId).toBeDefined();

    // Process
    await processWaivers(leagueId);

    // Verify claim won
    const { data: claimRow } = await admin
      .from("waiver_claims")
      .select("status")
      .eq("id", claim.claimId!)
      .single();
    expect(claimRow!.status).toBe("won");

    // Verify budget unchanged
    const { data: budgetAfter } = await admin
      .from("league_members")
      .select("waiver_budget_remaining")
      .eq("league_id", leagueId)
      .eq("player_id", playerIds[4])
      .single();
    expect(budgetAfter!.waiver_budget_remaining).toBe(
      budgetBefore!.waiver_budget_remaining
    );
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.10: Negative bid rejected
  // ---------------------------------------------------------------------------

  it("should reject negative bid amount", async () => {
    const result = await submitWaiverClaim(
      leagueId,
      playerIds[0],
      castawayIds[27],
      castawayIds[0],
      -5
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("non-negative");
  });

  // ---------------------------------------------------------------------------
  // Requirement 8.11: Process with no pending claims returns error
  // ---------------------------------------------------------------------------

  it("should return error when processing waivers with no pending claims", async () => {
    const admin = getAdminClient();

    // Ensure no pending claims exist
    await admin.from("waiver_claims").delete().eq("league_id", leagueId).eq("status", "pending");

    const result = await processWaivers(leagueId);

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("no pending claims");
  });
});
