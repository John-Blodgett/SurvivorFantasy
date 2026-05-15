import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computePlayerScore,
  buildBatchEvents,
  type TeamAssignment,
  type EpisodeEvent,
  type EliminatedCastaway,
  type FinalizedEpisode,
  type ChallengeSubmission,
} from "@/lib/scoring";

const PLAYER_ID = "player-1";

// ---------------------------------------------------------------------------
// Property 1: Points computation equals sum of eligible episode events
// Validates: Requirements 6.3, 8.1, 8.2
// ---------------------------------------------------------------------------

describe("Property 1: Points computation equals sum of eligible episode events", () => {
  it("total equals sum of all episode event points attributed to this player", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        fc.array(
          fc.record({
            episode_number: fc.integer({ min: 1, max: 10 }),
            points: fc.integer({ min: -50, max: 50 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (castawayIds, rawEvents) => {
          const events: EpisodeEvent[] = rawEvents.map((e, i) => ({
            ...e,
            castaway_id: castawayIds[i % castawayIds.length],
            player_id: PLAYER_ID,
          }));

          const assignments: TeamAssignment[] = castawayIds.map((id) => ({
            castaway_id: id,
            points_from_episode: 1,
            source: "draft" as const,
          }));

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            new Set(events.map((e) => e.episode_number))
          ).map((n) => ({ number: n }));

          const result = computePlayerScore(
            PLAYER_ID,
            assignments,
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          const expectedTotal = events.reduce((s, e) => s + e.points, 0);
          expect(result.total).toBe(expectedTotal);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("events attributed to a different player are excluded from the total", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 10 }),
        (castawayIds, pointValues) => {
          const myEvents: EpisodeEvent[] = pointValues.map((p, i) => ({
            episode_number: 1,
            castaway_id: castawayIds[i % castawayIds.length],
            points: p,
            player_id: PLAYER_ID,
          }));

          const otherEvents: EpisodeEvent[] = pointValues.map((p, i) => ({
            episode_number: 1,
            castaway_id: castawayIds[i % castawayIds.length],
            points: p * 100,
            player_id: "other-player",
          }));

          const assignments: TeamAssignment[] = castawayIds.map((id) => ({
            castaway_id: id,
            points_from_episode: 1,
            source: "draft" as const,
          }));

          const result = computePlayerScore(
            PLAYER_ID,
            assignments,
            [...myEvents, ...otherEvents],
            [],
            [{ number: 1 }],
            0,
            []
          );

          const expectedTotal = myEvents.reduce((s, e) => s + e.points, 0);
          expect(result.total).toBe(expectedTotal);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: Consolation points accrue correctly for eliminated castaways
// Validates: Requirements 14.1, 14.3
// ---------------------------------------------------------------------------

describe("Property 2: Consolation points accrue correctly for eliminated castaways", () => {
  it("consolation = consolation_rate × episodes_after_elimination", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (castawayId, eliminatedEpisode, consolationRate, episodesAfter) => {
          const assignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };

          const eliminated: EliminatedCastaway = {
            castaway_id: castawayId,
            eliminated_episode: eliminatedEpisode,
          };

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: eliminatedEpisode + episodesAfter },
            (_, i) => ({ number: i + 1 })
          );

          const result = computePlayerScore(
            PLAYER_ID,
            [assignment],
            [],
            [eliminated],
            finalizedEpisodes,
            consolationRate,
            []
          );

          const castawayResult = result.castaways.find(
            (c) => c.castaway_id === castawayId
          )!;

          const expectedConsolation = consolationRate * episodesAfter;
          expect(castawayResult.consolation_points).toBe(expectedConsolation);
          expect(result.total).toBe(expectedConsolation);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("non-eliminated castaways earn zero consolation points", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 10 }),
        (castawayId, consolationRate, numEpisodes) => {
          const assignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: 1,
            source: "draft" as const,
          };

          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: numEpisodes },
            (_, i) => ({ number: i + 1 })
          );

          const result = computePlayerScore(
            PLAYER_ID,
            [assignment],
            [],
            [],
            finalizedEpisodes,
            consolationRate,
            []
          );

          const castawayResult = result.castaways.find(
            (c) => c.castaway_id === castawayId
          )!;

          expect(castawayResult.consolation_points).toBe(0);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Trade does not move historical points
// ---------------------------------------------------------------------------

describe("Property 3: Trade does not move historical points", () => {
  it("points attributed to player A stay with player A after trade", () => {
    const castawayId = "castaway-1";
    const playerA = "player-a";
    const playerB = "player-b";

    // Events from episode 1 attributed to player A
    const events: EpisodeEvent[] = [
      { episode_number: 1, castaway_id: castawayId, points: 10, player_id: playerA },
    ];

    // After trade, player B now owns the castaway
    const playerBAssignments: TeamAssignment[] = [
      { castaway_id: castawayId, points_from_episode: 2, source: "trade" },
    ];

    // Player A no longer has the castaway on their team
    const playerAAssignments: TeamAssignment[] = [];

    const finalized: FinalizedEpisode[] = [{ number: 1 }];

    const resultA = computePlayerScore(playerA, playerAAssignments, events, [], finalized, 0, []);
    const resultB = computePlayerScore(playerB, playerBAssignments, events, [], finalized, 0, []);

    // Player A keeps the 10 points from before the trade
    expect(resultA.total).toBe(10);
    // Player B gets 0 from episode 1 (those points belong to A)
    expect(resultB.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Challenge points
// ---------------------------------------------------------------------------

describe("Challenge points: only correct submissions are counted", () => {
  it("challenge points equal sum of points for is_correct=true submissions only", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            points: fc.integer({ min: 1, max: 100 }),
            is_correct: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (submissions: ChallengeSubmission[]) => {
          const result = computePlayerScore(PLAYER_ID, [], [], [], [], 0, submissions);

          const expected = submissions
            .filter((s) => s.is_correct === true)
            .reduce((sum, s) => sum + s.points, 0);

          expect(result.challenge_points).toBe(expected);
          expect(result.total).toBe(expected);
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// buildBatchEvents
// ---------------------------------------------------------------------------

describe("buildBatchEvents", () => {
  it("returns empty array when castawayIds is empty", () => {
    const rulePointsMap = new Map([["rule-1", 5]]);
    const result = buildBatchEvents("ep-1", [], ["rule-1"], rulePointsMap);
    expect(result).toEqual([]);
  });

  it("returns empty array when ruleIds is empty", () => {
    const rulePointsMap = new Map<string, number>();
    const result = buildBatchEvents("ep-1", ["c-1", "c-2"], [], rulePointsMap);
    expect(result).toEqual([]);
  });

  it("returns empty array when both arrays are empty", () => {
    const rulePointsMap = new Map<string, number>();
    const result = buildBatchEvents("ep-1", [], [], rulePointsMap);
    expect(result).toEqual([]);
  });

  it("creates one event for a single castaway and single rule", () => {
    const rulePointsMap = new Map([["rule-1", 3]]);
    const result = buildBatchEvents("ep-1", ["c-1"], ["rule-1"], rulePointsMap);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      episode_id: "ep-1",
      castaway_id: "c-1",
      scoring_rule_id: "rule-1",
      points: 3,
    });
  });

  it("creates N×M events for multiple castaways and rules", () => {
    const rulePointsMap = new Map([
      ["rule-1", 5],
      ["rule-2", -2],
      ["rule-3", 10],
    ]);
    const castawayIds = ["c-1", "c-2"];
    const ruleIds = ["rule-1", "rule-2", "rule-3"];

    const result = buildBatchEvents("ep-1", castawayIds, ruleIds, rulePointsMap);

    expect(result).toHaveLength(6); // 2 × 3

    // Verify all combinations exist
    for (const castawayId of castawayIds) {
      for (const ruleId of ruleIds) {
        const event = result.find(
          (e) => e.castaway_id === castawayId && e.scoring_rule_id === ruleId
        );
        expect(event).toBeDefined();
        expect(event!.episode_id).toBe("ep-1");
        expect(event!.points).toBe(rulePointsMap.get(ruleId));
      }
    }
  });

  it("uses 0 points when a rule is not in the points map", () => {
    const rulePointsMap = new Map([["rule-1", 5]]);
    const result = buildBatchEvents("ep-1", ["c-1"], ["rule-missing"], rulePointsMap);
    expect(result).toHaveLength(1);
    expect(result[0].points).toBe(0);
  });

  it("output length equals castawayIds.length × ruleIds.length (property)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 10 }),
        fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 10 }),
        (episodeId, castawayIds, ruleIds) => {
          const rulePointsMap = new Map(ruleIds.map((id, i) => [id, (i + 1) * 2]));
          const result = buildBatchEvents(episodeId, castawayIds, ruleIds, rulePointsMap);
          expect(result).toHaveLength(castawayIds.length * ruleIds.length);
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  it("every event has the correct episode_id and valid fields (property)", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
        (episodeId, castawayIds, ruleIds) => {
          const rulePointsMap = new Map(ruleIds.map((id, i) => [id, i * 3 - 5]));
          const result = buildBatchEvents(episodeId, castawayIds, ruleIds, rulePointsMap);

          for (const event of result) {
            expect(event.episode_id).toBe(episodeId);
            expect(castawayIds).toContain(event.castaway_id);
            expect(ruleIds).toContain(event.scoring_rule_id);
            expect(event.points).toBe(rulePointsMap.get(event.scoring_rule_id));
          }
          return true;
        }
      ),
      { numRuns: 30 }
    );
  });
});
