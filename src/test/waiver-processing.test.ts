import { describe, it, expect } from "vitest";
import { shouldProcessLeague } from "@/lib/waiver-processing";

describe("shouldProcessLeague", () => {
  // Helper: create a Date that represents a specific Pacific day
  // 2026-01-04 is a Sunday (day=0) in UTC, and PST is UTC-8
  function pacificDate(day: number): Date {
    const baseDate = new Date("2026-01-04T08:00:00Z"); // Sunday 00:00 Pacific
    return new Date(baseDate.getTime() + day * 24 * 60 * 60 * 1000);
  }

  it("returns false when processDays is null", () => {
    expect(shouldProcessLeague(null, 12, 0)).toBe(false);
  });

  it("returns true when current Pacific day is in the schedule", () => {
    // Wednesday (day=3)
    const now = pacificDate(3);
    expect(shouldProcessLeague("1,3,5", null, null, now)).toBe(true);
  });

  it("returns false when current Pacific day is not in the schedule", () => {
    // Tuesday (day=2) — schedule is Mon/Wed/Fri
    const now = pacificDate(2);
    expect(shouldProcessLeague("1,3,5", null, null, now)).toBe(false);
  });

  it("handles single day schedule", () => {
    // Sunday (day=0)
    const now = pacificDate(0);
    expect(shouldProcessLeague("0", 9, 0, now)).toBe(true);
  });

  it("handles all days selected", () => {
    // Friday (day=5)
    const now = pacificDate(5);
    expect(shouldProcessLeague("0,1,2,3,4,5,6", 12, 30, now)).toBe(true);
  });

  it("returns true regardless of hour/minute (daily cron)", () => {
    // Monday (day=1) — hour/minute don't matter for daily cron
    const now = pacificDate(1);
    expect(shouldProcessLeague("1", 18, 45, now)).toBe(true);
  });

  it("returns false for Saturday when only weekdays selected", () => {
    // Saturday (day=6)
    const now = pacificDate(6);
    expect(shouldProcessLeague("1,2,3,4,5", 12, 0, now)).toBe(false);
  });
});
