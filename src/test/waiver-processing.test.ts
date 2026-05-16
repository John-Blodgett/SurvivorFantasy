import { describe, it, expect } from "vitest";
import { shouldProcessLeague } from "@/lib/waiver-processing";

describe("shouldProcessLeague", () => {
  // Helper: create a Date that represents a specific Pacific time
  // We use Intl to reverse-engineer the UTC time for a given Pacific time
  function pacificDate(day: number, hour: number, minute: number): Date {
    // Start with a known date: 2026-01-05 is a Monday (day=1)
    // Sunday=0, Monday=1, ..., Saturday=6
    // 2026-01-04 is Sunday
    const baseDate = new Date("2026-01-04T00:00:00Z"); // Sunday in UTC
    // Offset to desired day
    const targetDate = new Date(baseDate.getTime() + day * 24 * 60 * 60 * 1000);

    // January is PST (UTC-8), so Pacific hour H = UTC hour H+8
    const utcHour = hour + 8;
    targetDate.setUTCHours(utcHour, minute, 0, 0);
    return targetDate;
  }

  it("returns false when processDays is null", () => {
    expect(shouldProcessLeague(null, 12, 0)).toBe(false);
  });

  it("returns false when processHour is null", () => {
    expect(shouldProcessLeague("1,3,5", null, 0)).toBe(false);
  });

  it("returns false when processMinute is null", () => {
    expect(shouldProcessLeague("1,3,5", 12, null)).toBe(false);
  });

  it("returns true when current Pacific day/hour/minute matches", () => {
    // Wednesday (day=3) at 18:00 Pacific
    const now = pacificDate(3, 18, 0);
    expect(shouldProcessLeague("1,3,5", 18, 0, now)).toBe(true);
  });

  it("returns false when day does not match", () => {
    // Tuesday (day=2) at 18:00 Pacific — schedule is Mon/Wed/Fri
    const now = pacificDate(2, 18, 0);
    expect(shouldProcessLeague("1,3,5", 18, 0, now)).toBe(false);
  });

  it("returns false when hour does not match", () => {
    // Wednesday (day=3) at 17:00 Pacific — schedule is 18:00
    const now = pacificDate(3, 17, 0);
    expect(shouldProcessLeague("1,3,5", 18, 0, now)).toBe(false);
  });

  it("returns false when minute does not match", () => {
    // Wednesday (day=3) at 18:30 Pacific — schedule is 18:00
    const now = pacificDate(3, 18, 30);
    expect(shouldProcessLeague("1,3,5", 18, 0, now)).toBe(false);
  });

  it("handles single day schedule", () => {
    // Sunday (day=0) at 9:00 Pacific
    const now = pacificDate(0, 9, 0);
    expect(shouldProcessLeague("0", 9, 0, now)).toBe(true);
  });

  it("handles all days selected", () => {
    // Friday (day=5) at 12:30 Pacific
    const now = pacificDate(5, 12, 30);
    expect(shouldProcessLeague("0,1,2,3,4,5,6", 12, 30, now)).toBe(true);
  });

  it("handles non-zero minutes", () => {
    // Monday (day=1) at 8:45 Pacific
    const now = pacificDate(1, 8, 45);
    expect(shouldProcessLeague("1", 8, 45, now)).toBe(true);
  });
});
