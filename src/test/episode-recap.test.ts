import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  groupEventsByCastaway,
  getEventsForEpisode,
  sortEpisodesDescending,
  type RecapEvent,
  type RecapEpisode,
} from "@/lib/episode-recap";

// ---------------------------------------------------------------------------
// Property 12: Episode recap contains all and only events for that episode
// Feature: fantasy-survivor, Property 12: Episode recap contains all and only events for that episode
// Validates: Requirements 10.1, 10.2
// ---------------------------------------------------------------------------

describe("Property 12: Episode recap contains all and only events for that episode", () => {
  it("getEventsForEpisode returns all events matching the episode and no others", () => {
    fc.assert(
      fc.property(
        // Generate a target episode ID and a mix of events for multiple episodes
        fc.uuid(),
        fc.array(
          fc.record({
            id: fc.uuid(),
            episode_id: fc.uuid(),
            castaway_id: fc.uuid(),
            points: fc.integer({ min: -10, max: 50 }),
          }),
          { minLength: 0, maxLength: 30 }
        ),
        (targetEpisodeId: string, allEvents) => {
          const result = getEventsForEpisode(allEvents, targetEpisodeId);

          // All returned events must belong to the target episode
          for (const event of result) {
            expect(event.episode_id).toBe(targetEpisodeId);
          }

          // All events in the input that belong to the target episode must be in the result
          const expectedIds = allEvents
            .filter((e) => e.episode_id === targetEpisodeId)
            .map((e) => e.id);
          const resultIds = result.map((e) => e.id);

          expect(resultIds.sort()).toEqual(expectedIds.sort());

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("groupEventsByCastaway includes every input event exactly once", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            castaway_id: fc.constantFrom("c1", "c2", "c3", "c4", "c5"),
            castaway_name: fc.constantFrom("Alice", "Bob", "Charlie", "Dana", "Eve"),
            scoring_rule_name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
            points: fc.integer({ min: -10, max: 50 }),
            benefiting_player_name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
          }),
          { minLength: 0, maxLength: 30 }
        ),
        (events: RecapEvent[]) => {
          const groups = groupEventsByCastaway(events);

          // Total events across all groups must equal input count
          const totalGroupedEvents = groups.reduce(
            (sum, g) => sum + g.events.length,
            0
          );
          expect(totalGroupedEvents).toBe(events.length);

          // Every input event ID must appear in exactly one group
          const allGroupedIds = groups.flatMap((g) => g.events.map((e) => e.id));
          const inputIds = events.map((e) => e.id);
          expect(allGroupedIds.sort()).toEqual(inputIds.sort());

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Episode recap is sorted in reverse chronological order
// Feature: fantasy-survivor, Property 13: Episode recap is sorted in reverse chronological order
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------

describe("Property 13: Episode recap is sorted in reverse chronological order", () => {
  it("sortEpisodesDescending produces episodes in non-increasing episode number order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            episode_id: fc.uuid(),
            number: fc.integer({ min: 1, max: 50 }),
            title: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
            finalized_at: fc.option(
              fc.date({ min: new Date("2024-01-01"), max: new Date("2026-12-31") }).map(
                (d) => d.toISOString()
              ),
              { nil: null }
            ),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (episodes: RecapEpisode[]) => {
          const sorted = sortEpisodesDescending(episodes);

          // Check non-increasing order of episode numbers
          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].number).toBeGreaterThanOrEqual(sorted[i].number);
          }

          // Same length as input
          expect(sorted.length).toBe(episodes.length);

          // Contains the same episodes (by episode_id)
          const inputIds = new Set(episodes.map((e) => e.episode_id));
          const outputIds = new Set(sorted.map((e) => e.episode_id));
          expect(outputIds).toEqual(inputIds);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
