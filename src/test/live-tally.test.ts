import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  MAX_TALLY_COUNT,
  countOf,
  decrement,
  emptyTally,
  expandTallyToEvents,
  increment,
  lastTap,
  moreRules,
  parseStoredTally,
  quickRules,
  tallyEntries,
  tallyTotals,
  toggleRuleHidden,
  undoLast,
  validateTallySubmission,
  type TallyState,
} from "@/lib/live-tally";

const rules = [
  { id: "r-jeff", name: "Jeff Says Your Name", points: 1, is_default: false },
  { id: "r-yell", name: "Jeff Yells Your Name", points: 2, is_default: false },
  { id: "r-vote", name: "Voted Out", points: -2, is_default: true },
  { id: "r-imm", name: "Team Immunity Challenge Win", points: 2, is_default: true },
];

describe("tapping", () => {
  it("increments, decrements, and removes zero counts", () => {
    let s = emptyTally();
    s = increment(s, "c1", "r-jeff");
    s = increment(s, "c1", "r-jeff");
    expect(countOf(s, "c1", "r-jeff")).toBe(2);
    s = decrement(s, "c1", "r-jeff");
    s = decrement(s, "c1", "r-jeff");
    expect(countOf(s, "c1", "r-jeff")).toBe(0);
    expect(s.counts).toEqual({});
    expect(decrement(s, "c1", "r-jeff")).toBe(s);
  });

  it("stops at the maximum count", () => {
    let s = emptyTally();
    for (let i = 0; i < MAX_TALLY_COUNT + 5; i++) s = increment(s, "c1", "r-jeff");
    expect(countOf(s, "c1", "r-jeff")).toBe(MAX_TALLY_COUNT);
  });

  it("undo reverses the most recent tap across castaways", () => {
    let s = emptyTally();
    s = increment(s, "c1", "r-jeff");
    s = increment(s, "c2", "r-yell");
    expect(lastTap(s)).toEqual({ castaway_id: "c2", rule_id: "r-yell" });
    s = undoLast(s);
    expect(countOf(s, "c2", "r-yell")).toBe(0);
    expect(countOf(s, "c1", "r-jeff")).toBe(1);
    s = undoLast(s);
    expect(s.counts).toEqual({});
    expect(undoLast(s)).toBe(s);
  });

  it("history length always equals the total tap count", () => {
    const op = fc.record({
      kind: fc.constantFrom("inc", "dec", "undo"),
      castaway: fc.constantFrom("c1", "c2", "c3"),
      rule: fc.constantFrom("r-jeff", "r-yell", "r-vote"),
    });
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        let s: TallyState = emptyTally();
        for (const o of ops) {
          if (o.kind === "inc") s = increment(s, o.castaway, o.rule);
          else if (o.kind === "dec") s = decrement(s, o.castaway, o.rule);
          else s = undoLast(s);
        }
        const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
        expect(s.history.length).toBe(total);
        for (const n of Object.values(s.counts)) expect(n).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe("quick and more rules", () => {
  it("quick buttons are added rules that are switched on; the rest go under More", () => {
    let s = emptyTally();
    expect(quickRules(rules, s).map((r) => r.id)).toEqual(["r-jeff", "r-yell"]);
    expect(moreRules(rules, s).map((r) => r.id)).toEqual(["r-vote", "r-imm"]);
    s = toggleRuleHidden(s, "r-yell");
    expect(quickRules(rules, s).map((r) => r.id)).toEqual(["r-jeff"]);
    expect(moreRules(rules, s).map((r) => r.id)).toEqual(["r-yell", "r-vote", "r-imm"]);
    s = toggleRuleHidden(s, "r-yell");
    expect(quickRules(rules, s).map((r) => r.id)).toEqual(["r-jeff", "r-yell"]);
  });
});

describe("totals and entries", () => {
  it("lists non-zero counts and totals points from rule values", () => {
    let s = emptyTally();
    s = increment(s, "c2", "r-jeff");
    s = increment(s, "c1", "r-vote");
    s = increment(s, "c2", "r-jeff");
    expect(tallyEntries(s)).toEqual([
      { castaway_id: "c1", rule_id: "r-vote", count: 1 },
      { castaway_id: "c2", rule_id: "r-jeff", count: 2 },
    ]);
    const points = new Map(rules.map((r) => [r.id, r.points]));
    expect(tallyTotals(s, points)).toEqual({ taps: 3, points: 0 });
  });
});

describe("parseStoredTally", () => {
  it("round-trips a saved tally", () => {
    let s = increment(emptyTally(), "c1", "r-jeff");
    s = toggleRuleHidden(s, "r-yell");
    expect(parseStoredTally(JSON.stringify(s))).toEqual(s);
  });

  it("returns an empty tally for missing or malformed data", () => {
    expect(parseStoredTally(null)).toEqual(emptyTally());
    expect(parseStoredTally("not json")).toEqual(emptyTally());
    expect(parseStoredTally(JSON.stringify({ version: 2, counts: {} }))).toEqual(emptyTally());
  });

  it("drops bad counts and history entries", () => {
    const raw = JSON.stringify({
      version: 1,
      counts: { "c1|r-jeff": 3, "c2|r-jeff": -1, nokey: 2, "c3|r-yell": 1.5 },
      history: ["c1|r-jeff", "c2|r-jeff", 7],
      hiddenRuleIds: ["r-yell", 3],
    });
    expect(parseStoredTally(raw)).toEqual({
      version: 1,
      counts: { "c1|r-jeff": 3 },
      history: ["c1|r-jeff"],
      hiddenRuleIds: ["r-yell"],
    });
  });
});

describe("validateTallySubmission", () => {
  const castaways = new Set(["c1", "c2"]);
  const points = new Map(rules.map((r) => [r.id, r.points]));

  it("accepts a valid tally and uses server-side points", () => {
    const result = validateTallySubmission(
      [{ castaway_id: "c1", rule_id: "r-jeff", count: 3, points: 999 }],
      castaways,
      points
    );
    expect(result).toEqual({
      valid: true,
      rows: [{ castaway_id: "c1", rule_id: "r-jeff", points: 1, count: 3 }],
    });
  });

  it("merges duplicate entries", () => {
    const result = validateTallySubmission(
      [
        { castaway_id: "c1", rule_id: "r-jeff", count: 2 },
        { castaway_id: "c1", rule_id: "r-jeff", count: 3 },
      ],
      castaways,
      points
    );
    expect(result.valid && result.rows[0].count).toBe(5);
  });

  it("rejects empty, unknown, or bad entries", () => {
    expect(validateTallySubmission([], castaways, points).valid).toBe(false);
    expect(validateTallySubmission("x", castaways, points).valid).toBe(false);
    expect(validateTallySubmission([{ castaway_id: "zz", rule_id: "r-jeff", count: 1 }], castaways, points).valid).toBe(false);
    expect(validateTallySubmission([{ castaway_id: "c1", rule_id: "gone", count: 1 }], castaways, points).valid).toBe(false);
    expect(validateTallySubmission([{ castaway_id: "c1", rule_id: "r-jeff", count: 0 }], castaways, points).valid).toBe(false);
    expect(validateTallySubmission([{ castaway_id: "c1", rule_id: "r-jeff", count: 1.5 }], castaways, points).valid).toBe(false);
    expect(
      validateTallySubmission([{ castaway_id: "c1", rule_id: "r-jeff", count: MAX_TALLY_COUNT + 1 }], castaways, points).valid
    ).toBe(false);
  });
});

describe("expandTallyToEvents", () => {
  it("creates one event per tap", () => {
    const events = expandTallyToEvents("ep1", [
      { castaway_id: "c1", rule_id: "r-jeff", points: 1, count: 3 },
      { castaway_id: "c2", rule_id: "r-vote", points: -2, count: 1 },
    ]);
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({ episode_id: "ep1", castaway_id: "c2", scoring_rule_id: "r-vote", points: -2 });
  });
});
