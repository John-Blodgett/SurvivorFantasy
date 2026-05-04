import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateCreateLeague, generateInviteCode } from "@/lib/leagues";

describe("league validation", () => {
  it("accepts valid league inputs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 20 }),
        (name, seasonNumber, rosterSize) => {
          const result = validateCreateLeague({ name, seasonNumber, rosterSize });
          return result.valid === true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejects roster size outside 1–20", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -100, max: 0 }),
          fc.integer({ min: 21, max: 200 })
        ),
        (rosterSize) => {
          const result = validateCreateLeague({
            name: "Test League",
            seasonNumber: 47,
            rosterSize,
          });
          return result.valid === false;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("rejects blank league name", () => {
    const result = validateCreateLeague({ name: "   ", seasonNumber: 47, rosterSize: 5 });
    expect(result.valid).toBe(false);
  });
});

describe("invite code generation", () => {
  // Feature: fantasy-survivor, Property: For any set of leagues created, all invite_code values must be unique
  // Validates: Requirements 2.1
  it("Property: generated invite codes are unique across many calls", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        (count) => {
          const codes = Array.from({ length: count }, () => generateInviteCode());
          const unique = new Set(codes);
          return unique.size === codes.length;
        }
      ),
      { numRuns: 20 }
    );
  });

  it("invite codes are non-empty strings of expected length", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const code = generateInviteCode();
        return typeof code === "string" && code.length === 12 && code === code.toUpperCase();
      }),
      { numRuns: 20 }
    );
  });
});
