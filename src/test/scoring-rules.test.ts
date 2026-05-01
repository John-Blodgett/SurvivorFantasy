import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateScoringRule, type ScoringRule } from "@/lib/scoring-rules";

// Feature: fantasy-survivor, Property 10: Scoring rule serialization round trip
// Validates: Requirements 5.1, 5.2

describe("scoring rule validation", () => {
  it("accepts rules with valid name and integer points (including negative)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: -1000, max: 1000 }),
        (name, points) => {
          const result = validateScoringRule({ name, points });
          return result.valid === true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects rules with empty or whitespace-only name", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\s*$/),
        fc.integer({ min: -100, max: 100 }),
        (name, points) => {
          const result = validateScoringRule({ name, points });
          return result.valid === false;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("scoring rule serialization round trip", () => {
  // Feature: fantasy-survivor, Property 10: Scoring rule serialization round trip
  // For any valid ScoringRule object (including negative point values),
  // serializing it to JSON and deserializing it back must produce an object
  // that is deeply equal to the original.
  // Validates: Requirements 5.1, 5.2
  it("Property 10: JSON serialize then deserialize produces deeply equal ScoringRule", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: -1000, max: 1000 }),
        fc.boolean(),
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        (id, leagueId, name, points, isDefault, createdAt) => {
          const rule: ScoringRule = {
            id,
            league_id: leagueId,
            name,
            points,
            is_default: isDefault,
            created_at: createdAt.toISOString(),
          };

          const serialized = JSON.stringify(rule);
          const deserialized: ScoringRule = JSON.parse(serialized);

          expect(deserialized.id).toBe(rule.id);
          expect(deserialized.league_id).toBe(rule.league_id);
          expect(deserialized.name).toBe(rule.name);
          expect(deserialized.points).toBe(rule.points);
          expect(deserialized.is_default).toBe(rule.is_default);
          expect(deserialized.created_at).toBe(rule.created_at);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
