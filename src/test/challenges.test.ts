import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateChallengeSubmission,
  computeChallengePoints,
  validateEditResponse,
} from "@/lib/challenges";

// ---------------------------------------------------------------------------
// Property: Challenge deadline enforcement
// Feature: fantasy-survivor, Property: For any submission with submitted_at > challenge.deadline, the system must reject it
// Validates: Requirements 9.3
// ---------------------------------------------------------------------------

describe("Property: Challenge deadline enforcement", () => {
  it("submissions after the deadline are always rejected", () => {
    fc.assert(
      fc.property(
        // Generate a deadline date
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") }),
        // Generate a positive offset in milliseconds (1ms to 30 days after deadline)
        fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }),
        (deadline, offsetMs) => {
          const submittedAt = new Date(deadline.getTime() + offsetMs);
          const result = validateChallengeSubmission(submittedAt, deadline);

          expect(result.valid).toBe(false);
          expect(result.error).toBe(
            "The submission deadline for this challenge has passed."
          );
        }
      ),
      { numRuns: 20 }
    );
  });

  it("submissions at or before the deadline are always accepted", () => {
    fc.assert(
      fc.property(
        // Generate a deadline date
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") }),
        // Generate a non-negative offset in milliseconds (0 to 30 days before deadline)
        fc.integer({ min: 0, max: 30 * 24 * 60 * 60 * 1000 }),
        (deadline, offsetMs) => {
          const submittedAt = new Date(deadline.getTime() - offsetMs);
          const result = validateChallengeSubmission(submittedAt, deadline);

          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Challenge points are only awarded for correct submissions
// Feature: fantasy-survivor, Property 7: Challenge points are only awarded for correct submissions
// Validates: Requirements 9.4
// ---------------------------------------------------------------------------

describe("Property 7: Challenge points are only awarded for correct submissions", () => {
  it("total challenge points equals sum of points for is_correct=true submissions only", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            points: fc.integer({ min: 1, max: 100 }),
            is_correct: fc.oneof(
              fc.constant(true),
              fc.constant(false),
              fc.constant(null)
            ),
          }),
          { minLength: 0, maxLength: 15 }
        ),
        (submissions) => {
          const result = computeChallengePoints(submissions);

          const expected = submissions
            .filter((s) => s.is_correct === true)
            .reduce((sum, s) => sum + s.points, 0);

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("submissions with is_correct=false or null contribute zero points", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            points: fc.integer({ min: 1, max: 100 }),
            is_correct: fc.oneof(fc.constant(false), fc.constant(null)),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (submissions) => {
          const result = computeChallengePoints(submissions);
          expect(result).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });
});


// ---------------------------------------------------------------------------
// Unit tests: validateEditResponse
// Feature: challenge edit/resubmit
// Validates: non-empty response, deadline not passed, not yet graded
// ---------------------------------------------------------------------------

describe("validateEditResponse", () => {
  it("valid edit: non-empty response, future deadline, not graded", () => {
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = validateEditResponse({
      response: "My updated answer",
      deadline: futureDeadline,
      isGraded: false,
    });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects empty response", () => {
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = validateEditResponse({
      response: "   ",
      deadline: futureDeadline,
      isGraded: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Response cannot be empty.");
  });

  it("rejects when deadline has passed", () => {
    const pastDeadline = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const result = validateEditResponse({
      response: "My answer",
      deadline: pastDeadline,
      isGraded: false,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("The submission deadline for this challenge has passed.");
  });

  it("rejects when submission is already graded", () => {
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = validateEditResponse({
      response: "My answer",
      deadline: futureDeadline,
      isGraded: true,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Cannot edit a response that has already been graded.");
  });
});
