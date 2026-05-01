import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  generateSnakeOrder,
  autoPickCastaway,
  runAutoDraft,
  type DraftPreference,
} from "@/lib/draft";

// ---------------------------------------------------------------------------
// Property 3: Draft snake order is correct and produces unique assignments
// Feature: fantasy-survivor, Property 3: Draft snake order is correct and produces unique assignments
// Validates: Requirements 4.2, 4.7, 4.8
// ---------------------------------------------------------------------------

describe("Property 3: Draft snake order is correct and produces unique assignments", () => {
  it("snake order has correct total length: players × rosterSize", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        fc.integer({ min: 1, max: 10 }),
        (playerIds, rosterSize) => {
          const order = generateSnakeOrder(playerIds, rosterSize);
          expect(order).toHaveLength(playerIds.length * rosterSize);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("each round alternates direction (snake pattern)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        fc.integer({ min: 2, max: 6 }),
        (playerIds, rosterSize) => {
          const order = generateSnakeOrder(playerIds, rosterSize);
          const n = playerIds.length;

          for (let round = 0; round < rosterSize; round++) {
            const slice = order.slice(round * n, (round + 1) * n);
            if (round % 2 === 0) {
              // Forward round: should match playerIds order
              expect(slice).toEqual(playerIds);
            } else {
              // Reverse round: should match reversed playerIds
              expect(slice).toEqual([...playerIds].reverse());
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("runAutoDraft produces unique castaway assignments across all picks", () => {
    fc.assert(
      fc.property(
        // 2–6 players
        fc.integer({ min: 2, max: 6 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        // roster size 1–4
        fc.integer({ min: 1, max: 4 }),
        (playerIds, rosterSize) => {
          // Generate enough castaways for the full draft
          const totalPicks = playerIds.length * rosterSize;
          const castawayIds = Array.from({ length: totalPicks + 2 }, (_, i) =>
            `castaway-${i}`
          );

          const picks = runAutoDraft(playerIds, rosterSize, castawayIds, []);

          // All picked castaway IDs must be unique
          const pickedIds = picks.map((p) => p.castaway_id);
          const uniqueIds = new Set(pickedIds);
          expect(uniqueIds.size).toBe(pickedIds.length);

          // Total picks should equal players × rosterSize
          expect(picks).toHaveLength(totalPicks);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("each player gets exactly rosterSize castaways in a full draft", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        fc.integer({ min: 1, max: 4 }),
        (playerIds, rosterSize) => {
          const totalPicks = playerIds.length * rosterSize;
          const castawayIds = Array.from({ length: totalPicks + 2 }, (_, i) =>
            `castaway-${i}`
          );

          const picks = runAutoDraft(playerIds, rosterSize, castawayIds, []);

          for (const playerId of playerIds) {
            const playerPicks = picks.filter((p) => p.player_id === playerId);
            expect(playerPicks).toHaveLength(rosterSize);
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Auto-pick selects highest-ranked available castaway
// Feature: fantasy-survivor, Property 4: Auto-pick selects highest-ranked available castaway
// Validates: Requirements 4.6
// ---------------------------------------------------------------------------

describe("Property 4: Auto-pick selects highest-ranked available castaway", () => {
  it("selects the lowest-rank-number available castaway from preferences", () => {
    fc.assert(
      fc.property(
        // Generate 3–8 unique castaway IDs
        fc.integer({ min: 3, max: 8 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        // How many of the top-ranked are already drafted (0 to n-1)
        fc.integer({ min: 0, max: 2 }),
        (castawayIds, numDrafted) => {
          const playerId = "player-1";

          // Assign ranks 1..n in order
          const preferences: DraftPreference[] = castawayIds.map((id, i) => ({
            player_id: playerId,
            castaway_id: id,
            rank: i + 1,
          }));

          // Mark the first numDrafted as already drafted
          const draftedIds = new Set(castawayIds.slice(0, numDrafted));

          const result = autoPickCastaway(
            preferences,
            draftedIds,
            castawayIds
          );

          // Should pick the first non-drafted castaway (rank = numDrafted + 1)
          const expectedPick = castawayIds[numDrafted];
          expect(result).toBe(expectedPick);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("falls back to alphabetical order when player has no preferences", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        (castawayIds) => {
          const result = autoPickCastaway([], new Set(), castawayIds);

          // Should pick the alphabetically first ID
          const expected = [...castawayIds].sort()[0];
          expect(result).toBe(expected);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null when all castaways are drafted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        (castawayIds) => {
          const draftedIds = new Set(castawayIds);
          const result = autoPickCastaway([], draftedIds, castawayIds);
          expect(result).toBeNull();
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never picks a castaway that is already drafted", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        fc.integer({ min: 1, max: 2 }),
        (castawayIds, numDrafted) => {
          const playerId = "player-1";
          const preferences: DraftPreference[] = castawayIds.map((id, i) => ({
            player_id: playerId,
            castaway_id: id,
            rank: i + 1,
          }));

          const draftedIds = new Set(castawayIds.slice(0, numDrafted));
          const result = autoPickCastaway(preferences, draftedIds, castawayIds);

          if (result !== null) {
            expect(draftedIds.has(result)).toBe(false);
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
