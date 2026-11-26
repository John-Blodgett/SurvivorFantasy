import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  PLAYER_COLORS,
  assignPlayerColors,
  buildRecapSeries,
  computePodium,
  easeInOut,
  initials,
  niceTicks,
  pointsUpTo,
  spreadLabels,
  valueAt,
  valueRange,
} from "@/lib/season-recap";
import type { StandingsHistory } from "@/lib/awards";

describe("assignPlayerColors", () => {
  it("gives each player a distinct color regardless of input order", () => {
    const a = assignPlayerColors(["c", "a", "b"]);
    const b = assignPlayerColors(["b", "c", "a"]);
    expect(a.get("a")).toBe(b.get("a"));
    expect(new Set(a.values()).size).toBe(3);
  });

  it("cycles colors past the palette size", () => {
    const ids = Array.from({ length: PLAYER_COLORS.length + 1 }, (_, i) => `p${String(i).padStart(2, "0")}`);
    expect(assignPlayerColors(ids).size).toBe(ids.length);
  });
});

describe("initials", () => {
  it("uses first letters of two words, or the first two letters of one", () => {
    expect(initials("Kat")).toBe("KA");
    expect(initials("Mary Jane")).toBe("MJ");
    expect(initials("  ")).toBe("?");
  });
});

describe("buildRecapSeries", () => {
  it("starts every series at 0 and follows the history totals", () => {
    const history: StandingsHistory = {
      weeks: [1, 2],
      standings: new Map([
        ["p1", [{ total: 5, rank: 1, weeklyScore: 5 }, { total: 25, rank: 1, weeklyScore: 20 }]],
        ["p2", [{ total: 3, rank: 2, weeklyScore: 3 }, { total: 4, rank: 2, weeklyScore: 1 }]],
      ]),
      finalAllyPoints: new Map(),
    };
    const data = buildRecapSeries(history, [
      { player_id: "p1", display_name: "Justin" },
      { player_id: "p2", display_name: "Kat" },
    ]);
    expect(data.episodes).toEqual([1, 2]);
    expect(data.series[0].totals).toEqual([0, 5, 25]);
    expect(data.series[1].totals).toEqual([0, 3, 4]);
  });
});

describe("computePodium", () => {
  it("returns ranks 1 to 3 and shares a step on ties", () => {
    const steps = computePodium([
      { player_id: "a", display_name: "HDuhb", total: 61, rank: 1 },
      { player_id: "b", display_name: "John", total: 55, rank: 2 },
      { player_id: "c", display_name: "Hannah", total: 55, rank: 2 },
      { player_id: "d", display_name: "Kelsie", total: 50, rank: 4 },
    ]);
    expect(steps.map((s) => s.rank)).toEqual([1, 2]);
    expect(steps[1].players.map((p) => p.display_name)).toEqual(["Hannah", "John"]);
  });
});

describe("animation math", () => {
  it("easeInOut is 0 at the start, 1 at the end, and 0.5 halfway", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it("valueAt hits each episode total exactly and moves between them", () => {
    const totals = [0, 1, 21];
    expect(valueAt(totals, 0)).toBe(0);
    expect(valueAt(totals, 1)).toBe(1);
    expect(valueAt(totals, 2)).toBe(21);
    expect(valueAt(totals, 1.5)).toBeCloseTo(11);
    expect(valueAt(totals, 99)).toBe(21);
  });

  it("valueAt always stays between the two surrounding totals", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 100 }), { minLength: 2, maxLength: 15 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (totals, t) => {
          const p = t * (totals.length - 1);
          const seg = Math.min(Math.floor(p), totals.length - 2);
          const v = valueAt(totals, p);
          const lo = Math.min(totals[seg], totals[seg + 1]);
          const hi = Math.max(totals[seg], totals[seg + 1]);
          expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(v).toBeLessThanOrEqual(hi + 1e-9);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("pointsUpTo includes reached episodes plus the moving tip", () => {
    expect(pointsUpTo([0, 5, 25], 1)).toEqual([[0, 0], [1, 5]]);
    const mid = pointsUpTo([0, 5, 25], 1.5);
    expect(mid.length).toBe(3);
    expect(mid[2][0]).toBe(1.5);
    expect(mid[2][1]).toBeCloseTo(15);
  });

  it("valueRange always includes 0", () => {
    expect(valueRange([{ totals: [5, 10] }])).toEqual([0, 10]);
    expect(valueRange([{ totals: [0, -4, 3] }])).toEqual([-4, 3]);
    expect(valueRange([{ totals: [0, 0] }])).toEqual([0, 1]);
  });
});

describe("spreadLabels", () => {
  it("keeps labels at least the gap apart and inside the bounds", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 300, noNaN: true }), { maxLength: 12 }), (ys) => {
        const out = spreadLabels(ys, 14, 0, 300);
        const sorted = [...out].sort((a, b) => a - b);
        for (let k = 1; k < sorted.length; k++) {
          expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(14 - 1e-9);
        }
        if (ys.length * 14 <= 300) {
          for (const y of out) {
            expect(y).toBeGreaterThanOrEqual(-1e-9);
            expect(y).toBeLessThanOrEqual(300 + 1e-9);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("leaves well-separated labels where they are", () => {
    expect(spreadLabels([10, 100, 200], 14, 0, 300)).toEqual([10, 100, 200]);
  });
});

describe("niceTicks", () => {
  it("returns round values covering the range", () => {
    expect(niceTicks(0, 61)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(-10, 40)).toEqual([-10, 0, 10, 20, 30, 40]);
  });
});
