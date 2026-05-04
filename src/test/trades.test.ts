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
      { numRuns: 20 }
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
      { numRuns: 20 }
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
      { numRuns: 20 }
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
      { numRuns: 20 }
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
  const PROPOSER = "proposer-id";
  const RECEIVER = "receiver-id";

  it("new owner only gets points from episodes >= points_from_episode after trade", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (castawayId, tradeCutoff, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < tradeCutoff) return true;

          const newOwnerAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: tradeCutoff,
            source: "trade" as const,
          };

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
            RECEIVER,
            [newOwnerAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          const expectedNewOwnerPoints = (totalEpisodes - tradeCutoff + 1) * pointsPerEvent;
          expect(newOwnerResult.total).toBe(expectedNewOwnerPoints);

          const castawayBreakdown = newOwnerResult.castaways[0];
          for (let ep = 1; ep < tradeCutoff; ep++) {
            expect(castawayBreakdown.episode_points[ep] ?? 0).toBe(0);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("original owner retains points from episodes before the trade", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (castawayId, tradeCutoff, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < tradeCutoff) return true;

          const originalOwnerAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };

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

          const originalOwnerResult = computePlayerScore(
            PROPOSER,
            [originalOwnerAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            [],
            tradeCutoff - 1
          );

          const expectedOriginalPoints = (tradeCutoff - 1) * pointsPerEvent;
          expect(originalOwnerResult.total).toBe(expectedOriginalPoints);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("pre-trade and post-trade points are disjoint (no double counting)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 1, max: 20 }),
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

          const originalAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };
          const originalResult = computePlayerScore(
            PROPOSER,
            [originalAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            [],
            tradeCutoff - 1
          );

          const newAssignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: tradeCutoff,
            source: "trade" as const,
          };
          const newResult = computePlayerScore(
            RECEIVER,
            [newAssignment],
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          const totalPoints = totalEpisodes * pointsPerEvent;
          expect(originalResult.total + newResult.total).toBe(totalPoints);
        }
      ),
      { numRuns: 20 }
    );
  });
});
