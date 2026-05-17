import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getWaiverWire,
  processWaiverClaims,
  type WaiverTeamAssignment,
  type WaiverClaim,
} from "@/lib/waiver";

// ---------------------------------------------------------------------------
// Property 17: Waiver wire contains only unowned, non-eliminated castaways
// Feature: fantasy-survivor, Property 17: Waiver wire contains only unowned, non-eliminated castaways
// Validates: Requirements 18.1
// ---------------------------------------------------------------------------

describe("Property 17: Waiver wire contains only unowned, non-eliminated castaways", () => {
  it("waiver wire excludes all assigned castaways and all eliminated castaways", () => {
    fc.assert(
      fc.property(
        // Generate 5-15 castaways with random elimination status
        fc.array(
          fc.record({
            id: fc.uuid(),
            is_eliminated: fc.boolean(),
          }),
          { minLength: 5, maxLength: 15 }
        ),
        // Generate team assignments (subset of castaway IDs assigned to players)
        fc.array(
          fc.record({
            castaway_id: fc.uuid(),
            player_id: fc.uuid(),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (castaways, extraAssignments) => {
          // Create some assignments that reference actual castaways
          const assignedCount = Math.min(3, castaways.length);
          const realAssignments: WaiverTeamAssignment[] = castaways
            .slice(0, assignedCount)
            .map((c) => ({
              castaway_id: c.id,
              player_id: "player-1",
            }));

          const allAssignments = [...realAssignments, ...extraAssignments];

          const result = getWaiverWire(castaways, allAssignments);

          // Verify: no result is eliminated
          for (const c of result) {
            expect(c.is_eliminated).toBe(false);
          }

          // Verify: no result is assigned to a team
          const assignedIds = new Set(allAssignments.map((a) => a.castaway_id));
          for (const c of result) {
            expect(assignedIds.has(c.id)).toBe(false);
          }

          // Verify: all unowned, non-eliminated castaways ARE in the result
          const resultIds = new Set(result.map((c) => c.id));
          for (const c of castaways) {
            if (!c.is_eliminated && !assignedIds.has(c.id)) {
              expect(resultIds.has(c.id)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 14: Waiver claim winner has highest bid
// Feature: fantasy-survivor, Property 14: Waiver claim winner has highest bid
// Validates: Requirements 18.4
// ---------------------------------------------------------------------------

describe("Property 14: Waiver claim winner has highest bid", () => {
  it("the winning claim always has the highest bid amount among all claims for the same castaway", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // target castaway ID
        fc.integer({ min: 1, max: 10 }), // next episode number
        // Generate 2-6 claims from different players for the same castaway
        fc.array(
          fc.record({
            id: fc.uuid(),
            player_id: fc.uuid(),
            drop_castaway_id: fc.uuid(),
            bid_amount: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 2, maxLength: 6 }
        ),
        (castawayId, nextEpisode, claimData) => {
          const claims: WaiverClaim[] = claimData.map((c) => ({
            id: c.id,
            league_id: "league-1",
            player_id: c.player_id,
            castaway_id: castawayId,
            drop_castaway_id: c.drop_castaway_id,
            bid_amount: c.bid_amount,
            priority: 1,
            status: "pending" as const,
          }));

          // Use deterministic tiebreak (always pick first)
          const result = processWaiverClaims(claims, nextEpisode, undefined, () => 0);

          // Find the winning claim
          const wonResult = result.results.find((r) => r.status === "won");
          expect(wonResult).toBeDefined();

          // The winner's bid must equal the max bid
          const maxBid = Math.max(...claims.map((c) => c.bid_amount));
          const winningClaim = claims.find((c) => c.id === wonResult!.claim_id)!;
          expect(winningClaim.bid_amount).toBe(maxBid);

          // All losers must have bid <= max bid
          const lostResults = result.results.filter((r) => r.status === "lost");
          for (const lost of lostResults) {
            const lostClaim = claims.find((c) => c.id === lost.claim_id)!;
            expect(lostClaim.bid_amount).toBeLessThanOrEqual(maxBid);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("when multiple claims tie for highest bid, exactly one wins", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // target castaway ID
        fc.integer({ min: 1, max: 10 }), // next episode number
        fc.integer({ min: 10, max: 100 }), // tied bid amount
        fc.integer({ min: 2, max: 5 }), // number of tied claimants
        (castawayId, nextEpisode, tiedBid, numTied) => {
          const claims: WaiverClaim[] = Array.from({ length: numTied }, (_, i) => ({
            id: `claim-${i}`,
            league_id: "league-1",
            player_id: `player-${i}`,
            castaway_id: castawayId,
            drop_castaway_id: `drop-${i}`,
            bid_amount: tiedBid,
            priority: i + 1,
            status: "pending" as const,
          }));

          const result = processWaiverClaims(claims, nextEpisode, undefined, () => 0);

          const winners = result.results.filter((r) => r.status === "won");
          const losers = result.results.filter((r) => r.status === "lost");

          // Exactly one winner
          expect(winners.length).toBe(1);
          // Rest are losers
          expect(losers.length).toBe(numTied - 1);
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 15: Waiver budget is never over-spent
// Feature: fantasy-survivor, Property 15: Waiver budget is never over-spent
// Validates: Requirements 18.2, 18.5
// ---------------------------------------------------------------------------

describe("Property 15: Waiver budget is never over-spent", () => {
  it("sum of all won bid deductions for a player never exceeds starting budget", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }), // starting budget
        fc.uuid(), // player ID
        // Generate multiple claims from the same player for different castaways
        fc.array(
          fc.record({
            id: fc.uuid(),
            castaway_id: fc.uuid(),
            drop_castaway_id: fc.uuid(),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (startingBudget, playerId, claimData) => {
          // Ensure unique castaway targets
          const uniqueTargets = new Map<string, typeof claimData[0]>();
          for (const c of claimData) {
            uniqueTargets.set(c.castaway_id, c);
          }
          const uniqueClaims = Array.from(uniqueTargets.values());
          if (uniqueClaims.length === 0) return true;

          // Distribute budget across claims so total bids <= startingBudget
          const bidPerClaim = Math.floor(startingBudget / uniqueClaims.length);

          const claims: WaiverClaim[] = uniqueClaims.map((c) => ({
            id: c.id,
            league_id: "league-1",
            player_id: playerId,
            castaway_id: c.castaway_id,
            drop_castaway_id: c.drop_castaway_id,
            bid_amount: bidPerClaim,
            priority: 1,
            status: "pending" as const,
          }));

          const result = processWaiverClaims(claims, 5, undefined, () => 0);

          // Sum all budget deductions for this player
          const totalDeducted = result.results
            .filter((r) => r.status === "won")
            .reduce((sum, r) => sum + r.budget_deducted, 0);

          expect(totalDeducted).toBeLessThanOrEqual(startingBudget);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Losing waiver claimants are not charged
// Feature: fantasy-survivor, Property 16: Losing waiver claimants are not charged
// Validates: Requirements 18.6
// ---------------------------------------------------------------------------

describe("Property 16: Losing waiver claimants are not charged", () => {
  it("all claims with status 'lost' have zero budget deducted", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // target castaway ID
        fc.integer({ min: 1, max: 10 }), // next episode number
        // Generate 2-8 claims from different players
        fc.array(
          fc.record({
            id: fc.uuid(),
            player_id: fc.uuid(),
            drop_castaway_id: fc.uuid(),
            bid_amount: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 2, maxLength: 8 }
        ),
        (castawayId, nextEpisode, claimData) => {
          const claims: WaiverClaim[] = claimData.map((c) => ({
            id: c.id,
            league_id: "league-1",
            player_id: c.player_id,
            castaway_id: castawayId,
            drop_castaway_id: c.drop_castaway_id,
            bid_amount: c.bid_amount,
            priority: 1,
            status: "pending" as const,
          }));

          const result = processWaiverClaims(claims, nextEpisode, undefined, () => 0);

          // All losing claims must have zero budget deducted
          const lostResults = result.results.filter((r) => r.status === "lost");
          for (const lost of lostResults) {
            expect(lost.budget_deducted).toBe(0);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Budget enforcement: player cannot win claims exceeding remaining budget
// ---------------------------------------------------------------------------

describe("Budget enforcement during processing", () => {
  it("skips a claim if the player can no longer afford it after winning a prior claim", () => {
    // Player has $70 budget, bids $30 on John (drop Car) and $70 on Time (drop Rock)
    const claims: WaiverClaim[] = [
      {
        id: "claim-1",
        league_id: "league-1",
        player_id: "player-1",
        castaway_id: "john-id",
        drop_castaway_id: "car-id",
        bid_amount: 30,
        priority: 1,
        status: "pending",
      },
      {
        id: "claim-2",
        league_id: "league-1",
        player_id: "player-1",
        castaway_id: "time-id",
        drop_castaway_id: "rock-id",
        bid_amount: 70,
        priority: 2,
        status: "pending",
      },
    ];

    const playerBudgets = new Map([["player-1", 70]]);
    const result = processWaiverClaims(claims, 5, playerBudgets, () => 0);

    // The $70 bid (highest) processes first due to sorting by bid amount
    // Player wins Time for $70, budget goes to $0
    // Then $30 bid for John can't be afforded — marked lost
    const timeResult = result.results.find((r) => r.claim_id === "claim-2");
    const johnResult = result.results.find((r) => r.claim_id === "claim-1");

    expect(timeResult!.status).toBe("won");
    expect(timeResult!.budget_deducted).toBe(70);
    expect(johnResult!.status).toBe("lost");
    expect(johnResult!.budget_deducted).toBe(0);
  });

  it("allows both claims to win if budget is sufficient", () => {
    const claims: WaiverClaim[] = [
      {
        id: "claim-1",
        league_id: "league-1",
        player_id: "player-1",
        castaway_id: "john-id",
        drop_castaway_id: "car-id",
        bid_amount: 30,
        priority: 1,
        status: "pending",
      },
      {
        id: "claim-2",
        league_id: "league-1",
        player_id: "player-1",
        castaway_id: "time-id",
        drop_castaway_id: "rock-id",
        bid_amount: 70,
        priority: 2,
        status: "pending",
      },
    ];

    const playerBudgets = new Map([["player-1", 100]]);
    const result = processWaiverClaims(claims, 5, playerBudgets, () => 0);

    const timeResult = result.results.find((r) => r.claim_id === "claim-2");
    const johnResult = result.results.find((r) => r.claim_id === "claim-1");

    expect(timeResult!.status).toBe("won");
    expect(johnResult!.status).toBe("won");
  });
});
