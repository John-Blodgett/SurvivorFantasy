import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { condenseLogEvents, formatRuleLabel, type LogEventBase } from "@/lib/scoring-log";

function ev(overrides: Partial<LogEventBase>): LogEventBase {
  return {
    id: Math.random().toString(36),
    episode_number: 1,
    castaway_id: "c1",
    rule_name: "Idol clue",
    player_id: "p1",
    points: 5,
    is_alliance: false,
    ...overrides,
  };
}

describe("condenseLogEvents", () => {
  it("merges duplicates in the same episode, castaway, rule and player", () => {
    const events = Array.from({ length: 20 }, () => ev({}));
    const out = condenseLogEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(20);
    expect(out[0].points).toBe(100);
  });

  it("keeps different episodes, castaways, rules and players separate", () => {
    const out = condenseLogEvents([
      ev({}),
      ev({ episode_number: 2 }),
      ev({ castaway_id: "c2" }),
      ev({ rule_name: "Win immunity" }),
      ev({ player_id: "p2" }),
      ev({ player_id: null }),
    ]);
    expect(out).toHaveLength(6);
    expect(out.every((e) => e.count === 1)).toBe(true);
  });

  it("merges non-adjacent duplicates at the first occurrence's position", () => {
    const out = condenseLogEvents([
      ev({ id: "a" }),
      ev({ id: "b", rule_name: "Other" }),
      ev({ id: "c" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
    expect(out[0].count).toBe(2);
  });

  it("never merges challenge or alliance rows", () => {
    const out = condenseLogEvents([
      ev({ castaway_id: "", rule_name: "Challenge: X" }),
      ev({ castaway_id: "", rule_name: "Challenge: X" }),
      ev({ is_alliance: true }),
      ev({ is_alliance: true }),
    ]);
    expect(out).toHaveLength(4);
  });

  it("does not mutate the input events", () => {
    const events = [ev({}), ev({})];
    condenseLogEvents(events);
    expect(events.map((e) => e.points)).toEqual([5, 5]);
  });

  it("preserves the total points and event count", () => {
    const arbEvent = fc.record({
      id: fc.uuid(),
      episode_number: fc.integer({ min: 1, max: 3 }),
      castaway_id: fc.constantFrom("", "c1", "c2"),
      rule_name: fc.constantFrom("A", "B"),
      player_id: fc.constantFrom(null, "p1", "p2"),
      points: fc.integer({ min: -10, max: 10 }),
      is_alliance: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 50 }), (events) => {
        const out = condenseLogEvents(events);
        const sum = (xs: { points: number }[]) => xs.reduce((s, e) => s + e.points, 0);
        expect(sum(out)).toBe(sum(events));
        expect(out.reduce((s, e) => s + e.count, 0)).toBe(events.length);
      })
    );
  });
});

describe("formatRuleLabel", () => {
  it("adds ×N only when count > 1", () => {
    expect(formatRuleLabel("Idol clue", 1)).toBe("Idol clue");
    expect(formatRuleLabel("Idol clue", 20)).toBe("Idol clue ×20");
  });
});
