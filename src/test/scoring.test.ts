import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  computePlayerScore,
  type TeamAssignment,
  type EpisodeEvent,
  type EliminatedCastaway,
  type FinalizedEpisode,
  type ChallengeSubmission,
} from "@/lib/scoring";

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** Generates a small set of unique castaway IDs */
const _arbitraryCastawayIds = (count: number) =>
  fc
    .uniqueArray(fc.uuid(), { minLength: count, maxLength: count })
    .map((ids) => ids);

/** Generates team assignments for a given list of castaway IDs */
const _arbitraryAssignments = (castawayIds: string[]): fc.Arbitrary<TeamAssignment[]> =>
  fc.constant(
    castawayIds.map((id) => ({
      castaway_id: id,
      points_from_episode: 1,
      source: "draft" as const,
    }))
  );

// ---------------------------------------------------------------------------
// Property 1: Points computation equals sum of eligible episode events
// Feature: fantasy-survivor, Property 1: Points computation equals sum of eligible episode events
// Validates: Requirements 6.3, 8.1, 8.2
// ---------------------------------------------------------------------------

describe("Property 1: Points computation equals sum of eligible episode events", () => {
  it("total equals sum of all episode event points for castaways on the team", () => {
    fc.assert(
      fc.property(
        // Generate 1–5 castaway IDs
        fc.integer({ min: 1, max: 5 }).chain((n) =>
          fc.uniqueArray(fc.uuid(), { minLength: n, maxLength: n })
        ),
        // Generate 1–10 episode events for those castaways
        fc.array(
          fc.record({
            episode_number: fc.integer({ min: 1, max: 10 }),
            points: fc.integer({ min: -50, max: 50 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (castawayIds, rawEvents) => {
          // Assign all events to castaways on the team (round-robin)
          const events: EpisodeEvent[] = rawEvents.map((e, i) => ({
            ...e,
            castaway_id: castawayIds[i % castawayIds.length],
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
            assignments,
            events,
            [],
            finalizedEpisodes,
            0, // no consolation points
            []
          );

          const expectedTotal = events.reduce((s, e) => s + e.points, 0);
          expect(result.total).toBe(expectedTotal);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("events for castaways NOT on the team are excluded from the total", () => {
    fc.assert(
      fc.property(
        // Team castaway IDs
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
        // Non-team castaway IDs (disjoint)
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 10 }),
        (teamIds, nonTeamIds, pointValues) => {
          // Ensure no overlap
          const nonTeamFiltered = nonTeamIds.filter((id) => !teamIds.includes(id));
          if (nonTeamFiltered.length === 0) return true; // skip if overlap

          const teamEvents: EpisodeEvent[] = pointValues.map((p, i) => ({
            episode_number: 1,
            castaway_id: teamIds[i % teamIds.length],
            points: p,
          }));

          const nonTeamEvents: EpisodeEvent[] = pointValues.map((p, i) => ({
            episode_number: 1,
            castaway_id: nonTeamFiltered[i % nonTeamFiltered.length],
            points: p * 100, // large values that would skew the total if included
          }));

          const assignments: TeamAssignment[] = teamIds.map((id) => ({
            castaway_id: id,
            points_from_episode: 1,
            source: "draft" as const,
          }));

          const result = computePlayerScore(
            assignments,
            [...teamEvents, ...nonTeamEvents],
            [],
            [{ number: 1 }],
            0,
            []
          );

          const expectedTotal = teamEvents.reduce((s, e) => s + e.points, 0);
          expect(result.total).toBe(expectedTotal);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Consolation points accrue correctly for eliminated castaways
// Feature: fantasy-survivor, Property 2: Consolation points accrue correctly for eliminated castaways
// Validates: Requirements 14.1, 14.3
// ---------------------------------------------------------------------------

describe("Property 2: Consolation points accrue correctly for eliminated castaways", () => {
  it("consolation = consolation_rate × episodes_after_elimination", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // castaway ID
        fc.integer({ min: 1, max: 8 }), // eliminated at episode N
        fc.integer({ min: 0, max: 5 }), // consolation points per episode
        fc.integer({ min: 0, max: 5 }), // number of episodes after elimination
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

          // Finalized episodes: the elimination episode + episodesAfter more
          const finalizedEpisodes: FinalizedEpisode[] = Array.from(
            { length: eliminatedEpisode + episodesAfter },
            (_, i) => ({ number: i + 1 })
          );

          const result = computePlayerScore(
            [assignment],
            [], // no episode events
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
      { numRuns: 100 }
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
            [assignment],
            [],
            [], // not eliminated
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
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Late-join point cutoff is respected
// Feature: fantasy-survivor, Property 6: Late-join point cutoff is respected
// Validates: Requirements 12.3
// ---------------------------------------------------------------------------

describe("Property 6: Late-join point cutoff is respected", () => {
  it("episode events before points_from_episode are excluded from the score", () => {
    fc.assert(
      fc.property(
        fc.uuid(), // castaway ID
        fc.integer({ min: 2, max: 8 }), // points_from_episode (late join)
        fc.integer({ min: 1, max: 10 }), // total episodes
        fc.integer({ min: 1, max: 50 }), // points per event
        (castawayId, pointsFromEpisode, totalEpisodes, pointsPerEvent) => {
          if (totalEpisodes < pointsFromEpisode) return true; // skip trivial case

          const assignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: pointsFromEpisode,
            source: "admin_assign" as const,
          };

          // One event per episode across all episodes
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

          const result = computePlayerScore(
            [assignment],
            events,
            [],
            finalizedEpisodes,
            0,
            []
          );

          // Only episodes >= pointsFromEpisode should count
          const eligibleEpisodes = totalEpisodes - pointsFromEpisode + 1;
          const expectedTotal = eligibleEpisodes * pointsPerEvent;

          expect(result.total).toBe(expectedTotal);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("events exactly at points_from_episode ARE included", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: -50, max: 50 }),
        (castawayId, pointsFromEpisode, points) => {
          const assignment: TeamAssignment = {
            castaway_id: castawayId,
            points_from_episode: pointsFromEpisode,
            source: "admin_assign" as const,
          };

          // Single event exactly at the cutoff episode
          const events: EpisodeEvent[] = [
            {
              episode_number: pointsFromEpisode,
              castaway_id: castawayId,
              points,
            },
          ];

          const result = computePlayerScore(
            [assignment],
            events,
            [],
            [{ number: pointsFromEpisode }],
            0,
            []
          );

          expect(result.total).toBe(points);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Challenge points — only correct submissions count (Property 7 coverage)
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
          const result = computePlayerScore([], [], [], [], 0, submissions);

          const expected = submissions
            .filter((s) => s.is_correct === true)
            .reduce((sum, s) => sum + s.points, 0);

          expect(result.challenge_points).toBe(expected);
          expect(result.total).toBe(expected);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
