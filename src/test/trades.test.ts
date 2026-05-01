import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateTradeProposal,
  type TradeProposalInput,
  type CastawayForTrade,
} from "@/lib/trades";

// ---------------------------------------------------------------------------
// Property 9: Eliminated castaways cannot be traded
// Feature: fantasy-survivor, Property 9: Eliminated castaways cannot be traded
// Validates: Requirements 13.6
// ---------------------------------------------------------------------------

describe("Property 9: Eliminated castaways cannot be traded", () => {
  it("trade is rejected when the proposer's castaway is eliminated", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // proposer_id
        fc.uuid(), // receiver_id
        fc.uuid(), // proposer_castaway_id
        fc.uuid(), // receiver_castaway_id
        (proposerId, receiverId, proposerCastawayId, receiverCastawayId) => {
          // Ensure different players and different castaways
          fc.pre(proposerId !== receiverId);
          fc.pre(proposerCastawayId !== receiverCastawayId);

          const input: TradeProposalInput = {
            proposer_id: proposerId,
            receiver_id: receiverId,
            proposer_castaway_id: proposerCastawayId,
            receiver_castaway_id: receiverCastawayId,
          };

          const proposerCastaway: CastawayForTrade = {
            id: proposerCastawayId,
            is_eliminated: true, // eliminated!
            owner_id: proposerId,
          };

          const receiverCastaway: CastawayForTrade = {
            id: receiverCastawayId,
            is_eliminated: false,
            owner_id: receiverId,
          };

          const result = validateTradeProposal(input, proposerCastaway, receiverCastaway);

          expect(result.valid).toBe(false);
          expect(result.error).toContain("Eliminated castaways cannot be traded");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("trade is rejected when the receiver's castaway is eliminated", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // proposer_id
        fc.uuid(), // receiver_id
        fc.uuid(), // proposer_castaway_id
        fc.uuid(), // receiver_castaway_id
        (proposerId, receiverId, proposerCastawayId, receiverCastawayId) => {
          fc.pre(proposerId !== receiverId);
          fc.pre(proposerCastawayId !== receiverCastawayId);

          const input: TradeProposalInput = {
            proposer_id: proposerId,
            receiver_id: receiverId,
            proposer_castaway_id: proposerCastawayId,
            receiver_castaway_id: receiverCastawayId,
          };

          const proposerCastaway: CastawayForTrade = {
            id: proposerCastawayId,
            is_eliminated: false,
            owner_id: proposerId,
          };

          const receiverCastaway: CastawayForTrade = {
            id: receiverCastawayId,
            is_eliminated: true, // eliminated!
            owner_id: receiverId,
          };

          const result = validateTradeProposal(input, proposerCastaway, receiverCastaway);

          expect(result.valid).toBe(false);
          expect(result.error).toContain("Eliminated castaways cannot be traded");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("trade is rejected when both castaways are eliminated", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        (proposerId, receiverId, proposerCastawayId, receiverCastawayId) => {
          fc.pre(proposerId !== receiverId);
          fc.pre(proposerCastawayId !== receiverCastawayId);

          const input: TradeProposalInput = {
            proposer_id: proposerId,
            receiver_id: receiverId,
            proposer_castaway_id: proposerCastawayId,
            receiver_castaway_id: receiverCastawayId,
          };

          const proposerCastaway: CastawayForTrade = {
            id: proposerCastawayId,
            is_eliminated: true,
            owner_id: proposerId,
          };

          const receiverCastaway: CastawayForTrade = {
            id: receiverCastawayId,
            is_eliminated: true,
            owner_id: receiverId,
          };

          const result = validateTradeProposal(input, proposerCastaway, receiverCastaway);

          expect(result.valid).toBe(false);
          expect(result.error).toContain("Eliminated castaways cannot be traded");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("trade is accepted when both castaways are active and ownership is valid", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        (proposerId, receiverId, proposerCastawayId, receiverCastawayId) => {
          fc.pre(proposerId !== receiverId);
          fc.pre(proposerCastawayId !== receiverCastawayId);

          const input: TradeProposalInput = {
            proposer_id: proposerId,
            receiver_id: receiverId,
            proposer_castaway_id: proposerCastawayId,
            receiver_castaway_id: receiverCastawayId,
          };

          const proposerCastaway: CastawayForTrade = {
            id: proposerCastawayId,
            is_eliminated: false,
            owner_id: proposerId,
          };

          const receiverCastaway: CastawayForTrade = {
            id: receiverCastawayId,
            is_eliminated: false,
            owner_id: receiverId,
          };

          const result = validateTradeProposal(input, proposerCastaway, receiverCastaway);

          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Trade point cutoff is respected for both sides
// Feature: fantasy-survivor, Property 5: Trade point cutoff is respected for both sides
// Validates: Requirements 13.3, 13.4, 13.5
// ---------------------------------------------------------------------------

import {
  computePlayerScore,
  type TeamAssignment,
  type EpisodeEvent,
  type FinalizedEpisode,
} from "@/lib/scoring";

describe("Property 5: Trade point cutoff is respected for both sides", () => {
  it("new owner only gets points from episodes >= points_from_episode after trade", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // castaway ID (the traded castaway)
        fc.integer({ min: 2, max: 8 }), // trade cutoff episode (points_from_episode for new owner)
        fc.integer({ min: 1, max: 10 }), // total episodes
        fc.integer({ min: 1, max: 20 }), // points per event
        (castawayId, tradeCutoff, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < tradeCutoff) return true; // skip trivial

          // New owner's assignment: only counts from tradeCutoff onward
          const newOwnerAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: tradeCutoff,
            source: "trade" as const,
          };

          // One event per episode
          const events: EpisodeEvent[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({
              episode_number: i + 1,
              castaway_id: castawayId,
              points: pointsPerEvent,
            })
          );

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({ number: i + 1 })
          );

          const newOwnerResult = computePlayerScore(
            [newOwnerAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          // New owner should only get points from episodes >= tradeCutoff
          const expectedNewOwnerPoints = (totalEpisodes - tradeCutoff + 1) * pointsPerEvent;
          expect(newOwnerResult.total).toBe(expectedNewOwnerPoints);

          // Verify pre-trade events are NOT included
          const castawayBreakdown = newOwnerResult.castaways[0];
          for (let ep = 1; ep < tradeCutoff; ep++) {
            expect(castawayBreakdown.episode_points[ep] ?? 0).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("original owner retains points from episodes before the trade", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // castaway ID
        fc.integer({ min: 2, max: 8 }), // trade cutoff episode
        fc.integer({ min: 1, max: 10 }), // total episodes
        fc.integer({ min: 1, max: 20 }), // points per event
        (castawayId, tradeCutoff, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < tradeCutoff) return true;

          // Original owner had the castaway from episode 1 (draft)
          // After trade, they no longer have this castaway on their team,
          // but the historical record (points_from_episode=1, up to tradeCutoff-1)
          // should still count. We model this as the original owner's assignment
          // with points_from_episode=1 and computing up to tradeCutoff-1.
          const originalOwnerAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };

          // One event per episode
          const events: EpisodeEvent[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({
              episode_number: i + 1,
              castaway_id: castawayId,
              points: pointsPerEvent,
            })
          );

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({ number: i + 1 })
          );

          // Original owner's score computed up to the episode before the trade
          const originalOwnerResult = computePlayerScore(
            [originalOwnerAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            [],
            tradeCutoff - 1 // upToEpisode: only count up to the episode before trade
          );

          // Original owner should get points from episodes 1 to tradeCutoff-1
          const expectedOriginalPoints = (tradeCutoff - 1) * pointsPerEvent;
          expect(originalOwnerResult.total).toBe(expectedOriginalPoints);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("pre-trade and post-trade points are disjoint (no double counting)", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // castaway ID
        fc.integer({ min: 2, max: 8 }), // trade cutoff
        fc.integer({ min: 2, max: 10 }), // total episodes (must be >= tradeCutoff)
        fc.integer({ min: 1, max: 20 }), // points per event
        (castawayId, tradeCutoff, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < tradeCutoff) return true;

          const events: EpisodeEvent[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({
              episode_number: i + 1,
              castaway_id: castawayId,
              points: pointsPerEvent,
            })
          );

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: totalEpisodes },
            (_, i) => ({ number: i + 1 })
          );

          // Original owner: episodes 1 to tradeCutoff-1
          const originalAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };
          const originalResult = computePlayerScore(
            [originalAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            [],
            tradeCutoff - 1
          );

          // New owner: episodes tradeCutoff to totalEpisodes
          const newAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: tradeCutoff,
            source: "trade" as const,
          };
          const newResult = computePlayerScore(
            [newAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          // Sum of both should equal total events points (no overlap, no gap)
          const totalPoints = totalEpisodes * pointsPerEvent;
          expect(originalResult.total + newResult.total).toBe(totalPoints);
        }
      ),
      { numRuns: 100 }
    );
  });
});
