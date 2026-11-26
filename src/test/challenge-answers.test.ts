import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildRevealedAnswers, type AnswerSubmission } from "@/lib/challenge-answers";

const names = new Map([
  ["p1", "zoe"],
  ["p2", "Adam"],
  ["p3", "mia"],
]);
const identity = (_: string, r: string) => r;

function sub(o: Partial<AnswerSubmission>): AnswerSubmission {
  return { challenge_id: "c1", player_id: "p1", response: "A", is_correct: null, ...o };
}

describe("buildRevealedAnswers", () => {
  it("never includes submissions for open challenges", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            challenge_id: fc.constantFrom("c1", "c2", "c3"),
            player_id: fc.constantFrom("p1", "p2", "p3"),
            response: fc.string(),
            is_correct: fc.constantFrom(null, true, false),
          })
        ),
        fc.subarray(["c1", "c2", "c3"]),
        (subs, closed) => {
          const out = buildRevealedAnswers(subs, new Set(closed), names, identity);
          for (const id of Array.from(out.keys())) expect(closed).toContain(id);
          const total = Array.from(out.values()).reduce((s, l) => s + l.length, 0);
          expect(total).toBe(subs.filter((s) => closed.includes(s.challenge_id)).length);
        }
      )
    );
  });

  it("sorts by player name, case-insensitive", () => {
    const out = buildRevealedAnswers(
      [sub({ player_id: "p1" }), sub({ player_id: "p2" }), sub({ player_id: "p3" })],
      new Set(["c1"]),
      names,
      identity
    );
    expect(out.get("c1")!.map((a) => a.player_name)).toEqual(["Adam", "mia", "zoe"]);
  });

  it("resolves display text and falls back to Unknown for missing names", () => {
    const out = buildRevealedAnswers(
      [sub({ player_id: "gone", response: "cast-1", is_correct: true })],
      new Set(["c1"]),
      names,
      (_, r) => (r === "cast-1" ? "Jeff" : r)
    );
    expect(out.get("c1")).toEqual([
      { player_id: "gone", player_name: "Unknown", response: "Jeff", is_correct: true },
    ]);
  });
});
