import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computeLeaderboard, type PlayerScore } from "@/lib/leaderboard";

// ---------------------------------------------------------------------------
// Property 8: Leaderboard is sorted in non-increasing order of total points
// Feature: fantasy-survivor, Property 8: Leaderboard is sorted in non-increasing order of total points
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

describe("Property 8: Leaderboard is sorted in non-increasing order of total points", () => {
  it("every adjacent pair of entries has first.total >= second.total", () => {
    fc.assert(
      fc.property(
        // Generate 0–20 players with random scores
        fc.array(
          fc.record({
            player_id: fc.uuid(),
            display_name: fc.string({ minLength: 1, maxLength: 30 }),
            total: fc.integer({ min: -100, max: 1000 }),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (players: PlayerScore[]) => {
          const leaderboard = computeLeaderboard(players);

          // Check non-increasing order
          for (let i = 1; i < leaderboard.length; i++) {
            expect(leaderboard[i - 1].total).toBeGreaterThanOrEqual(
              leaderboard[i].total
            );
          }

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("tied players receive the same rank", () => {
    fc.assert(
      fc.property(
        // Generate 2–10 players where some share the same score
        fc.integer({ min: 2, max: 10 }).chain((n) =>
          fc.array(fc.integer({ min: 0, max: 5 }), {
            minLength: n,
            maxLength: n,
          }).map((scores) =>
            scores.map((total, i) => ({
              player_id: `player-${i}`,
              display_name: `Player ${i}`,
              total,
            }))
          )
        ),
        (players: PlayerScore[]) => {
          const leaderboard = computeLeaderboard(players);

          // Any two entries with the same total must have the same rank
          for (let i = 0; i < leaderboard.length; i++) {
            for (let j = i + 1; j < leaderboard.length; j++) {
              if (leaderboard[i].total === leaderboard[j].total) {
                expect(leaderboard[i].rank).toBe(leaderboard[j].rank);
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("leaderboard contains exactly the same players as the input", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            player_id: fc.uuid(),
            display_name: fc.string({ minLength: 1, maxLength: 30 }),
            total: fc.integer({ min: 0, max: 500 }),
          }),
          { minLength: 0, maxLength: 15 }
        ),
        (players: PlayerScore[]) => {
          const leaderboard = computeLeaderboard(players);

          expect(leaderboard.length).toBe(players.length);

          const inputIds = new Set(players.map((p) => p.player_id));
          const outputIds = new Set(leaderboard.map((e) => e.player_id));
          expect(outputIds).toEqual(inputIds);

          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});
