import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  AWARD_CATALOGUE,
  AWARD_EMOJI,
  AWARD_THRESHOLDS,
  buildStandingsHistory,
  claimEpisode,
  computeAwards,
  flattenWinners,
  pickWinners,
  sortCandidates,
  type AwardsInput,
  type Candidate,
} from "@/lib/awards";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDS = ["p1", "p2", "p3", "p4", "p5", "p6"];

/** Noon UTC on Jan n, 2026: when episode n is finalized. */
function weekDate(n: number): string {
  return new Date(Date.UTC(2026, 0, n, 12)).toISOString();
}

/** Midnight UTC on Jan n, 2026: a claim processed here lands in week n. */
function weekStart(n: number): string {
  return new Date(Date.UTC(2026, 0, n, 0)).toISOString();
}

/**
 * Builds a league where player pN owns castaway cN all season and scores
 * `matrix[week][player]` points each week (events attributed to the player).
 */
function fromWeeklyScores(matrix: number[][]): AwardsInput {
  const count = matrix[0]?.length ?? IDS.length;
  const ids = Array.from({ length: count }, (_, j) => `p${j + 1}`);
  const players = ids.map((id) => ({ player_id: id, display_name: id.toUpperCase() }));
  const events: AwardsInput["events"] = [];
  matrix.forEach((row, w) => {
    row.forEach((pts, j) => {
      if (pts !== 0) {
        events.push({
          episode_number: w + 1,
          castaway_id: `c${j + 1}`,
          points: pts,
          player_id: ids[j],
          rule_name: null,
        });
      }
    });
  });
  return {
    league: { roster_size: 1, waiver_budget: 100, consolation_points: 0 },
    players,
    finalizedEpisodes: matrix.map((_, w) => ({ number: w + 1, finalized_at: weekDate(w + 1) })),
    castaways: ids.map((_, j) => ({ id: `c${j + 1}`, name: `Castaway ${j + 1}`, eliminated_episode: null })),
    events,
    assignments: ids.map((id, j) => ({
      player_id: id,
      castaway_id: `c${j + 1}`,
      points_from_episode: 1,
      source: "draft" as const,
    })),
    claims: [],
    allies: [],
    trades: [],
    challenges: [],
    submissions: [],
  };
}

function zeros(weeks: number): number[][] {
  return Array.from({ length: weeks }, () => [0, 0, 0, 0, 0, 0]);
}

function rep(row: number[], times: number): number[][] {
  return Array.from({ length: times }, () => [...row]);
}

function winnersOf(input: AwardsInput, key: string): string[] {
  const r = computeAwards(input).find((x) => x.key === key);
  if (!r) throw new Error(`No award ${key}`);
  return r.winners.map((w) => w.player_id).sort();
}

function claim(
  player: string,
  castaway: string,
  drop: string,
  bid: number,
  week: number,
  status: "won" | "lost" | "pending" = "won"
): AwardsInput["claims"][number] {
  return {
    player_id: player,
    castaway_id: castaway,
    drop_castaway_id: drop,
    bid_amount: bid,
    status,
    processed_at: weekStart(week),
  };
}

function ev(
  episode: number,
  castaway: string,
  points: number,
  player: string | null,
  rule: string | null = null
): AwardsInput["events"][number] {
  return { episode_number: episode, castaway_id: castaway, points, player_id: player, rule_name: rule };
}

function castaway(id: string, elim: number | null = null) {
  return { id, name: id.toUpperCase(), eliminated_episode: elim };
}

// ---------------------------------------------------------------------------
// pickWinners / sortCandidates / claimEpisode
// ---------------------------------------------------------------------------

describe("pickWinners", () => {
  const c = (player_id: string, value: number, qualifies: boolean): Candidate => ({
    player_id,
    value,
    detail: "",
    qualifies,
  });

  it("returns nothing when nobody qualifies", () => {
    expect(pickWinners([c("a", 5, false), c("b", 9, false)], "highest")).toEqual([]);
  });

  it("shares the award on a tie", () => {
    const w = pickWinners([c("a", 5, true), c("b", 5, true), c("c", 3, true)], "highest");
    expect(w.map((x) => x.player_id)).toEqual(["a", "b"]);
  });

  it("ignores non-qualifiers even with a better value", () => {
    const w = pickWinners([c("a", 99, false), c("b", 4, true)], "highest");
    expect(w.map((x) => x.player_id)).toEqual(["b"]);
  });

  it("picks the lowest value for lowest-direction awards", () => {
    const w = pickWinners([c("a", -3, true), c("b", -7, true)], "lowest");
    expect(w.map((x) => x.player_id)).toEqual(["b"]);
  });

  it("sortCandidates puts qualifiers first, then best value", () => {
    const sorted = sortCandidates([c("a", 9, false), c("b", 2, true), c("c", 5, true)], "highest");
    expect(sorted.map((x) => x.player_id)).toEqual(["c", "b", "a"]);
  });
});

describe("Property: pickWinners", () => {
  const candidateArb = fc.record({
    player_id: fc.uuid(),
    value: fc.integer({ min: -20, max: 20 }),
    detail: fc.constant(""),
    qualifies: fc.boolean(),
  });
  const uniqueCandidates = fc.uniqueArray(candidateArb, {
    selector: (c) => c.player_id,
    maxLength: 15,
  });

  // Feature: season-awards, Property 1: Winners are the best qualifiers
  it("every winner is a qualifier with the best value and no qualifier beats them", () => {
    fc.assert(
      fc.property(uniqueCandidates, fc.constantFrom("highest" as const, "lowest" as const), (cs, dir) => {
        const winners = pickWinners(cs, dir);
        const qualifiers = cs.filter((c) => c.qualifies);
        for (const w of winners) {
          expect(w.qualifies).toBe(true);
          for (const q of qualifiers) {
            if (dir === "highest") expect(q.value).toBeLessThanOrEqual(w.value);
            else expect(q.value).toBeGreaterThanOrEqual(w.value);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: season-awards, Property 2: Ties share
  it("every qualifier tied on the best value is a winner", () => {
    fc.assert(
      fc.property(uniqueCandidates, (cs) => {
        const winners = pickWinners(cs, "highest");
        if (winners.length === 0) return;
        const best = winners[0].value;
        const tied = cs.filter((c) => c.qualifies && c.value === best);
        expect(winners.length).toBe(tied.length);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: season-awards, Property 3: Unclaimed when no qualifiers
  it("returns no winners when nobody qualifies", () => {
    fc.assert(
      fc.property(uniqueCandidates, (cs) => {
        const none = cs.map((c) => ({ ...c, qualifies: false }));
        expect(pickWinners(none, "highest")).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});

describe("claimEpisode", () => {
  const eps = [1, 2, 3].map((n) => ({ number: n, finalized_at: weekDate(n) }));

  it("returns the first week finalized after the claim", () => {
    expect(claimEpisode(weekStart(2), eps)).toBe(2);
    expect(claimEpisode(weekDate(2), eps)).toBe(3);
  });

  it("returns null when the claim is after the last week or has no timestamp", () => {
    expect(claimEpisode(weekDate(3), eps)).toBeNull();
    expect(claimEpisode(null, eps)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Standings history
// ---------------------------------------------------------------------------

describe("buildStandingsHistory", () => {
  it("returns empty series when no episodes are finalized", () => {
    const input = fromWeeklyScores([]);
    const h = buildStandingsHistory(input);
    expect(h.weeks).toEqual([]);
    expect(h.standings.get("p1")).toEqual([]);
  });

  it("tracks totals, ranks (ties share), and weekly scores", () => {
    const h = buildStandingsHistory(fromWeeklyScores([[5, 5, 1, 0, 0, 0], [0, 2, 1, 0, 0, 0]]));
    const p1 = h.standings.get("p1")!;
    const p2 = h.standings.get("p2")!;
    expect(p1.map((w) => w.total)).toEqual([5, 5]);
    expect(p1.map((w) => w.rank)).toEqual([1, 2]);
    expect(p2.map((w) => w.weeklyScore)).toEqual([5, 2]);
    expect(p2.map((w) => w.rank)).toEqual([1, 1]);
  });

  it("counts correct challenge points only from the week they belong to", () => {
    const input = fromWeeklyScores(zeros(3));
    input.challenges = [{ id: "ch1", episode_number: 2, points: 5 }];
    input.submissions = [{ challenge_id: "ch1", player_id: "p1", is_correct: true }];
    const totals = buildStandingsHistory(input).standings.get("p1")!.map((w) => w.total);
    expect(totals).toEqual([0, 5, 5]);
  });

  it("adds alliance points and respects the end cutoff", () => {
    const input = fromWeeklyScores([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0], [0, 4, 0, 0, 0, 0]]);
    input.allies = [{ player_id: "p1", castaway_id: "c2", points_from_episode: 3, ended_at: null }];
    const h = buildStandingsHistory(input);
    expect(h.standings.get("p1")!.map((w) => w.total)).toEqual([0, 0, 5, 7]);
    expect(h.finalAllyPoints.get("p1")).toBe(7);
  });
});

describe("Property: history consistency", () => {
  // Feature: season-awards, Property 5: Final totals equal direct sums
  it("each week's total is the running sum of that player's weekly points", () => {
    const matrixArb = fc.array(
      fc.array(fc.integer({ min: -10, max: 30 }), { minLength: 6, maxLength: 6 }),
      { minLength: 1, maxLength: 8 }
    );
    fc.assert(
      fc.property(matrixArb, (matrix) => {
        const h = buildStandingsHistory(fromWeeklyScores(matrix));
        IDS.forEach((id, j) => {
          let running = 0;
          const totals = h.standings.get(id)!.map((w) => w.total);
          matrix.forEach((row, w) => {
            running += row[j];
            expect(totals[w]).toBe(running);
          });
        });
      }),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Standings & momentum awards
// ---------------------------------------------------------------------------

describe("King of the Hill", () => {
  it("is given for 3+ weeks at #1", () => {
    expect(winnersOf(fromWeeklyScores(rep([10, 1, 1, 1, 1, 1], 3)), "king_of_the_hill")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold", () => {
    expect(winnersOf(fromWeeklyScores(rep([10, 1, 1, 1, 1, 1], 2)), "king_of_the_hill")).toEqual([]);
  });
  it("is shared on a tie", () => {
    expect(winnersOf(fromWeeklyScores(rep([10, 10, 1, 1, 1, 1], 3)), "king_of_the_hill")).toEqual(["p1", "p2"]);
  });
});

describe("Peaked Too Early", () => {
  const fall = [...rep([10, 0, 0, 0, 0, 0], 3), ...rep([-15, 5, 5, 5, 5, 5], 3)];
  it("is given to a long-time leader who fell out of the top 3", () => {
    expect(winnersOf(fromWeeklyScores(fall), "peaked_too_early")).toEqual(["p1"]);
  });
  it("is unclaimed when the leader stays on top", () => {
    expect(winnersOf(fromWeeklyScores(rep([10, 0, 0, 0, 0, 0], 4)), "peaked_too_early")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const tied = [...rep([10, 10, 0, 0, 0, 0], 3), ...rep([-15, -15, 5, 5, 5, 5], 3)];
    expect(winnersOf(fromWeeklyScores(tied), "peaked_too_early")).toEqual(["p1", "p2"]);
  });
});

describe("Comeback Kid", () => {
  it("is given for a bottom-3 to top-3 climb", () => {
    const m = [[-5, 10, 10, 10, 10, 10], [40, 0, 0, 0, 0, 0]];
    expect(winnersOf(fromWeeklyScores(m), "comeback_kid")).toEqual(["p1"]);
  });
  it("is unclaimed when nobody was ever near the bottom", () => {
    expect(winnersOf(fromWeeklyScores(rep([1, 1, 1, 1, 1, 1], 2)), "comeback_kid")).toEqual([]);
  });
  it("is shared on an equal jump", () => {
    const m = [[-5, -5, 10, 10, 10, 10], [40, 40, 0, 0, 0, 0]];
    expect(winnersOf(fromWeeklyScores(m), "comeback_kid")).toEqual(["p1", "p2"]);
  });
});

describe("Cellar Dweller", () => {
  it("is given for 5+ weeks in a row in last place", () => {
    expect(winnersOf(fromWeeklyScores(rep([0, 0, 0, 0, 0, -1], 5)), "cellar_dweller")).toEqual(["p6"]);
  });
  it("is unclaimed below the threshold", () => {
    expect(winnersOf(fromWeeklyScores(rep([0, 0, 0, 0, 0, -1], 4)), "cellar_dweller")).toEqual([]);
  });
  it("is shared when two players tie for last", () => {
    expect(winnersOf(fromWeeklyScores(rep([0, 0, 0, 0, -1, -1], 5)), "cellar_dweller")).toEqual(["p5", "p6"]);
  });
  it("is not given when everyone is tied", () => {
    expect(winnersOf(fromWeeklyScores(zeros(4)), "cellar_dweller")).toEqual([]);
  });
});

describe("Cliff Diver", () => {
  it("is given for a drop of 6+ places in a week", () => {
    const m = [[10, 0, 0, 0, 0, 0, 0, 0], [-20, 0, 0, 0, 0, 0, 0, 0]];
    expect(winnersOf(fromWeeklyScores(m), "cliff_diver")).toEqual(["p1"]);
  });
  it("is unclaimed when the drop is under 6 places", () => {
    const m = [[10, 0, 0, 0, 0, 0], [-20, 0, 0, 0, 0, 0]];
    expect(winnersOf(fromWeeklyScores(m), "cliff_diver")).toEqual([]);
  });
  it("is shared on an equal drop", () => {
    const m = [[10, 10, 0, 0, 0, 0, 0, 0], [-20, -20, 0, 0, 0, 0, 0, 0]];
    expect(winnersOf(fromWeeklyScores(m), "cliff_diver")).toEqual(["p1", "p2"]);
  });
});

describe("Rock Bottom", () => {
  it("is given for a week of -8 or worse", () => {
    expect(winnersOf(fromWeeklyScores([[5, 5, -9, 5, 5, 5]]), "rock_bottom")).toEqual(["p3"]);
  });
  it("is unclaimed when the worst week is above -8", () => {
    expect(winnersOf(fromWeeklyScores([[5, 5, -7, 5, 5, 5]]), "rock_bottom")).toEqual([]);
  });
  it("is shared on a tie", () => {
    expect(winnersOf(fromWeeklyScores([[5, 5, -9, -9, 5, 5]]), "rock_bottom")).toEqual(["p3", "p4"]);
  });
});

describe("Photo Finish", () => {
  it("is given to the two players on either side of a tiny podium gap", () => {
    expect(winnersOf(fromWeeklyScores([[50, 49, 40, 30, 20, 10]]), "photo_finish")).toEqual(["p1", "p2"]);
  });
  it("is unclaimed when podium gaps are big", () => {
    expect(winnersOf(fromWeeklyScores([[50, 40, 30, 20, 10, 5]]), "photo_finish")).toEqual([]);
  });
  it("is shared when two gaps are equally small", () => {
    expect(winnersOf(fromWeeklyScores([[50, 48, 46, 30, 20, 10]]), "photo_finish")).toEqual(["p1", "p2", "p3"]);
  });
  it("treats a tie as a zero gap", () => {
    expect(winnersOf(fromWeeklyScores([[50, 45, 45, 30, 20, 10]]), "photo_finish")).toEqual(["p2", "p3"]);
  });
});

describe("Rollercoaster", () => {
  const swing = (first: number[]) => [first, ...zeros(4)];
  it("is given for a huge best-to-worst gap", () => {
    expect(winnersOf(fromWeeklyScores(swing([35, 0, 0, 0, 0, 0])), "rollercoaster")).toEqual(["p1"]);
  });
  it("is unclaimed below the range threshold", () => {
    expect(winnersOf(fromWeeklyScores(swing([29, 0, 0, 0, 0, 0])), "rollercoaster")).toEqual([]);
  });
  it("is unclaimed with too few weeks", () => {
    expect(winnersOf(fromWeeklyScores([[35, 0, 0, 0, 0, 0], ...zeros(3)]), "rollercoaster")).toEqual([]);
  });
  it("is shared on a tie", () => {
    expect(winnersOf(fromWeeklyScores(swing([35, 35, 0, 0, 0, 0])), "rollercoaster")).toEqual(["p1", "p2"]);
  });
});

describe("On Fire", () => {
  it("is given for the best week at or above the threshold", () => {
    expect(winnersOf(fromWeeklyScores([[0, 30, 0, 0, 0, 0]]), "on_fire")).toEqual(["p2"]);
  });
  it("is unclaimed below the threshold", () => {
    expect(winnersOf(fromWeeklyScores([[0, 24, 0, 0, 0, 0]]), "on_fire")).toEqual([]);
  });
  it("is shared on a tie", () => {
    expect(winnersOf(fromWeeklyScores([[0, 30, 30, 0, 0, 0]]), "on_fire")).toEqual(["p2", "p3"]);
  });
});

// ---------------------------------------------------------------------------
// Waiver wire awards
// ---------------------------------------------------------------------------

describe("Big Spender", () => {
  it("is given for spending the whole budget", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "c1", 60, 2), claim("p1", "x2", "x1", 40, 3)];
    expect(winnersOf(i, "big_spender")).toEqual(["p1"]);
  });
  it("is unclaimed with any budget left", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "c1", 50, 2), claim("p1", "x2", "x1", 49, 3)];
    expect(winnersOf(i, "big_spender")).toEqual([]);
  });
  it("is shared on a tie and ignores lost claims", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [
      claim("p1", "x1", "c1", 100, 2),
      claim("p2", "x2", "c2", 100, 2),
      claim("p3", "x3", "c3", 100, 2, "lost"),
    ];
    expect(winnersOf(i, "big_spender")).toEqual(["p1", "p2"]);
  });
});

describe("Sucker Bid", () => {
  it("is given for a big bid on a castaway eliminated right away", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 3));
    i.claims = [claim("p1", "x1", "c1", 30, 3)];
    expect(winnersOf(i, "sucker_bid")).toEqual(["p1"]);
  });
  it("is unclaimed when the bid is small", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 3));
    i.claims = [claim("p1", "x1", "c1", 20, 3)];
    expect(winnersOf(i, "sucker_bid")).toEqual([]);
  });
  it("is unclaimed when the castaway lasted", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 5));
    i.claims = [claim("p1", "x1", "c1", 40, 2)];
    expect(winnersOf(i, "sucker_bid")).toEqual([]);
  });
  it("is shared on equal bids", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 3), castaway("x2", 4));
    i.claims = [claim("p1", "x1", "c1", 30, 3), claim("p2", "x2", "c2", 30, 3)];
    expect(winnersOf(i, "sucker_bid")).toEqual(["p1", "p2"]);
  });
});

describe("The One That Got Away", () => {
  it("is given when the dropped castaway scores big for others", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "d1", 5, 3)];
    i.events.push(ev(3, "d1", 10, "p2"), ev(4, "d1", 8, null));
    expect(winnersOf(i, "one_that_got_away")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "d1", 5, 3)];
    i.events.push(ev(3, "d1", 10, "p2"), ev(4, "d1", 4, null));
    expect(winnersOf(i, "one_that_got_away")).toEqual([]);
  });
  it("does not count points the claimant earned themselves", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "d1", 5, 3)];
    i.events.push(ev(3, "d1", 30, "p1"));
    expect(winnersOf(i, "one_that_got_away")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "d1", 5, 3), claim("p2", "x2", "d2", 5, 3)];
    i.events.push(ev(3, "d1", 18, "p3"), ev(3, "d2", 18, "p3"));
    expect(winnersOf(i, "one_that_got_away")).toEqual(["p1", "p2"]);
  });
});

describe("Going Down With the Ship", () => {
  it("is given for holding an eliminated castaway 3+ weeks", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways[0].eliminated_episode = 2;
    expect(winnersOf(i, "going_down_with_the_ship")).toEqual(["p1"]);
  });
  it("is unclaimed when the holding period is short", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways[0].eliminated_episode = 4;
    expect(winnersOf(i, "going_down_with_the_ship")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways[0].eliminated_episode = 2;
    i.castaways[1].eliminated_episode = 2;
    expect(winnersOf(i, "going_down_with_the_ship")).toEqual(["p1", "p2"]);
  });
});

describe("Hoarder", () => {
  it("is given for 3+ won claims", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 3), claim("p1", "x3", "x2", 1, 4)];
    expect(winnersOf(i, "hoarder")).toEqual(["p1"]);
  });
  it("ignores lost and pending claims", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [
      claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 3),
      claim("p1", "x3", "x2", 1, 4, "lost"), claim("p1", "x4", "x2", 1, 4, "pending"),
    ];
    expect(winnersOf(i, "hoarder")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [
      claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 3), claim("p1", "x5", "x2", 1, 4),
      claim("p2", "x3", "c2", 1, 2), claim("p2", "x4", "x3", 1, 3), claim("p2", "x6", "x4", 1, 4),
    ];
    expect(winnersOf(i, "hoarder")).toEqual(["p1", "p2"]);
  });
});

describe("Dumpster Diver", () => {
  it("is given for points from a castaway another player dropped", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p2", "x1", "cd", 5, 2), claim("p1", "cd", "y1", 5, 4)];
    i.events.push(ev(5, "cd", 22, "p1"));
    expect(winnersOf(i, "dumpster_diver")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p2", "x1", "cd", 5, 2), claim("p1", "cd", "y1", 5, 4)];
    i.events.push(ev(5, "cd", 19, "p1"));
    expect(winnersOf(i, "dumpster_diver")).toEqual([]);
  });
  it("is not given when nobody dropped the castaway first", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "cd", "y1", 5, 4)];
    i.events.push(ev(5, "cd", 20, "p1"));
    expect(winnersOf(i, "dumpster_diver")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [
      claim("p2", "x1", "cd", 5, 2), claim("p1", "cd", "y1", 5, 4),
      claim("p4", "x2", "cg", 5, 2), claim("p3", "cg", "y2", 5, 4),
    ];
    i.events.push(ev(5, "cd", 22, "p1"), ev(5, "cg", 22, "p3"));
    expect(winnersOf(i, "dumpster_diver")).toEqual(["p1", "p3"]);
  });
});

describe("Waiver MVP", () => {
  it("is given for a pickup that scored 25+ while owned", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "cw", "c1", 5, 2)];
    i.events.push(ev(3, "cw", 26, "p1"));
    expect(winnersOf(i, "waiver_mvp")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold and ignores another owner's points", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "cw", "c1", 5, 2)];
    i.events.push(ev(3, "cw", 24, "p1"), ev(4, "cw", 50, "p2"));
    expect(winnersOf(i, "waiver_mvp")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.claims = [claim("p1", "cw", "c1", 5, 2), claim("p2", "cv", "c2", 5, 2)];
    i.events.push(ev(3, "cw", 26, "p1"), ev(3, "cv", 26, "p2"));
    expect(winnersOf(i, "waiver_mvp")).toEqual(["p1", "p2"]);
  });
});

describe("Commitment Issues", () => {
  const trade = (a: string, b: string, status = "admin_approved") => ({
    proposer_id: a,
    receiver_id: b,
    status,
  });
  it("is given for 2+ approved trades", () => {
    const i = fromWeeklyScores(zeros(3));
    i.trades = [trade("p1", "p2"), trade("p3", "p1")];
    expect(winnersOf(i, "commitment_issues")).toEqual(["p1"]);
  });
  it("is unclaimed for one trade or unapproved trades", () => {
    const i = fromWeeklyScores(zeros(3));
    i.trades = [trade("p1", "p2"), trade("p1", "p3", "admin_rejected")];
    expect(winnersOf(i, "commitment_issues")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(3));
    i.trades = [trade("p1", "p2"), trade("p2", "p1")];
    expect(winnersOf(i, "commitment_issues")).toEqual(["p1", "p2"]);
  });
});

// ---------------------------------------------------------------------------
// Alliance awards
// ---------------------------------------------------------------------------

describe("Kiss of Death", () => {
  const ally = (player: string, castawayId: string, from: number) => ({
    player_id: player,
    castaway_id: castawayId,
    points_from_episode: from,
    ended_at: null,
  });
  it("is given for 2+ alliances with castaways out immediately", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("a1", 2), castaway("a2", 3));
    i.allies = [ally("p1", "a1", 2), ally("p1", "a2", 3)];
    expect(winnersOf(i, "kiss_of_death")).toEqual(["p1"]);
  });
  it("is unclaimed for a single unlucky alliance", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("a1", 2), castaway("a2", 5));
    i.allies = [ally("p1", "a1", 2), ally("p1", "a2", 3)];
    expect(winnersOf(i, "kiss_of_death")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("a1", 2), castaway("a2", 3));
    i.allies = [ally("p1", "a1", 2), ally("p1", "a2", 3), ally("p2", "a1", 2), ally("p2", "a2", 3)];
    expect(winnersOf(i, "kiss_of_death")).toEqual(["p1", "p2"]);
  });
});

describe("Coattail Rider", () => {
  const allyOfC2 = (player: string) => ({
    player_id: player,
    castaway_id: "c2",
    points_from_episode: 3,
    ended_at: null,
  });
  it("is given when 25%+ of points came from an ally", () => {
    const i = fromWeeklyScores([[10, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0]]);
    i.allies = [allyOfC2("p1")];
    expect(winnersOf(i, "coattail_rider")).toEqual(["p1"]);
  });
  it("is unclaimed when the ally share is small", () => {
    const i = fromWeeklyScores([[100, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0]]);
    i.allies = [allyOfC2("p1")];
    expect(winnersOf(i, "coattail_rider")).toEqual([]);
  });
  it("is shared on an equal share", () => {
    const i = fromWeeklyScores([[10, 0, 10, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 10, 0, 0, 0, 0]]);
    i.allies = [allyOfC2("p1"), allyOfC2("p3")];
    expect(winnersOf(i, "coattail_rider")).toEqual(["p1", "p3"]);
  });
});

describe("Sole Survivor Whisperer", () => {
  it("is given to the owner and active allies of the Season Winner castaway", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(ev(3, "c2", 10, "p2", "Season Winner"));
    i.allies = [
      { player_id: "p1", castaway_id: "c2", points_from_episode: 2, ended_at: null },
      { player_id: "p3", castaway_id: "c2", points_from_episode: 1, ended_at: weekDate(2) },
    ];
    expect(winnersOf(i, "sole_survivor_whisperer")).toEqual(["p1", "p2"]);
  });
  it("is unclaimed when no Season Winner event exists", () => {
    expect(winnersOf(fromWeeklyScores(zeros(3)), "sole_survivor_whisperer")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Challenge awards
// ---------------------------------------------------------------------------

function withChallenges(count: number, weeks = 10): AwardsInput {
  const i = fromWeeklyScores(zeros(weeks));
  i.challenges = Array.from({ length: count }, (_, k) => ({
    id: `ch${k + 1}`,
    episode_number: k + 1,
    points: 5,
  }));
  return i;
}

function answer(i: AwardsInput, player: string, challenge: number, correct: boolean | null) {
  i.submissions.push({ challenge_id: `ch${challenge}`, player_id: player, is_correct: correct });
}

function answers(i: AwardsInput, player: string, results: boolean[]) {
  results.forEach((r, k) => answer(i, player, k + 1, r));
}

describe("The Oracle", () => {
  const six = [true, true, true, true, true, true, false, false];
  it("is given for the best accuracy with enough answers", () => {
    const i = withChallenges(10);
    answers(i, "p1", six);
    answers(i, "p2", [true, true, true, true, true, false, false, false]);
    expect(winnersOf(i, "the_oracle")).toEqual(["p1"]);
  });
  it("is unclaimed when nobody has enough graded answers", () => {
    const i = withChallenges(10);
    answers(i, "p1", [true, true, true, true, true, true, false]);
    expect(winnersOf(i, "the_oracle")).toEqual([]);
  });
  it("is shared on equal accuracy", () => {
    const i = withChallenges(10);
    answers(i, "p1", six);
    answers(i, "p2", six);
    expect(winnersOf(i, "the_oracle")).toEqual(["p1", "p2"]);
  });
  it("ignores ungraded answers", () => {
    const i = withChallenges(10);
    answers(i, "p1", six.slice(0, 7));
    answer(i, "p1", 8, null);
    expect(winnersOf(i, "the_oracle")).toEqual([]);
  });
});

describe("Lone Wolf", () => {
  const room = (i: AwardsInput, challenge: number, rightPlayer: string, others: string[]) => {
    answer(i, rightPlayer, challenge, true);
    others.forEach((p) => answer(i, p, challenge, false));
  };
  it("is given for being the only correct answer", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3", "p4"]);
    expect(winnersOf(i, "lone_wolf")).toEqual(["p1"]);
  });
  it("is unclaimed when too few people answered", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3"]);
    expect(winnersOf(i, "lone_wolf")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3", "p4"]);
    room(i, 2, "p2", ["p1", "p3", "p4"]);
    expect(winnersOf(i, "lone_wolf")).toEqual(["p1", "p2"]);
  });
});

describe("Black Sheep", () => {
  const room = (i: AwardsInput, challenge: number, wrongPlayer: string, others: string[]) => {
    answer(i, wrongPlayer, challenge, false);
    others.forEach((p) => answer(i, p, challenge, true));
  };
  it("is given for being the only wrong answer", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3", "p4", "p5"]);
    expect(winnersOf(i, "black_sheep")).toEqual(["p1"]);
  });
  it("is unclaimed when too few people answered", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3", "p4"]);
    expect(winnersOf(i, "black_sheep")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = withChallenges(3);
    room(i, 1, "p1", ["p2", "p3", "p4", "p5"]);
    room(i, 2, "p2", ["p1", "p3", "p4", "p5"]);
    expect(winnersOf(i, "black_sheep")).toEqual(["p1", "p2"]);
  });
});

describe("Participation Trophy", () => {
  const base = (challenges: number, row: number[]) => {
    const i = withChallenges(challenges, 5);
    i.events = [];
    const m = [row, ...zeros(4)];
    const scored = fromWeeklyScores(m);
    i.events = scored.events;
    return i;
  };
  it("is given for answering everything and finishing in the bottom half", () => {
    const i = base(5, [10, 10, 10, 10, 10, 0]);
    answers(i, "p6", [false, false, false, false, false]);
    expect(winnersOf(i, "participation_trophy")).toEqual(["p6"]);
  });
  it("is unclaimed when there are too few challenges", () => {
    const i = base(4, [10, 10, 10, 10, 10, 0]);
    answers(i, "p6", [false, false, false, false]);
    expect(winnersOf(i, "participation_trophy")).toEqual([]);
  });
  it("is unclaimed when the player skipped one", () => {
    const i = base(5, [10, 10, 10, 10, 10, 0]);
    answers(i, "p6", [false, false, false, false]);
    expect(winnersOf(i, "participation_trophy")).toEqual([]);
  });
  it("is unclaimed when the player finished in the top half", () => {
    const i = base(5, [10, 0, 0, 0, 0, 0]);
    answers(i, "p1", [false, false, false, false, false]);
    expect(winnersOf(i, "participation_trophy")).toEqual([]);
  });
  it("is shared on equal accuracy", () => {
    const i = base(5, [10, 10, 10, 10, 0, 0]);
    answers(i, "p5", [false, false, false, false, false]);
    answers(i, "p6", [false, false, false, false, false]);
    expect(winnersOf(i, "participation_trophy")).toEqual(["p5", "p6"]);
  });
});

// ---------------------------------------------------------------------------
// Scoring event awards
// ---------------------------------------------------------------------------

function immunityEvents(player: string, castawayId: string, team: number, indiv: number) {
  const out: AwardsInput["events"] = [];
  for (let k = 0; k < team; k++) out.push(ev(1, castawayId, 2, player, "Immunity Challenge WIn"));
  for (let k = 0; k < indiv; k++) out.push(ev(1, castawayId, 3, player, "Individual Immunity Win"));
  return out;
}

describe("Immunity Magnet", () => {
  it("counts team and individual wins together", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...immunityEvents("p1", "c1", 6, 2));
    expect(winnersOf(i, "immunity_magnet")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold and ignores idol finds", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...immunityEvents("p1", "c1", 6, 1), ev(1, "c1", 3, "p1", "Hidden Immunity Idol Found"));
    expect(winnersOf(i, "immunity_magnet")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...immunityEvents("p1", "c1", 6, 2), ...immunityEvents("p2", "c2", 8, 0));
    expect(winnersOf(i, "immunity_magnet")).toEqual(["p1", "p2"]);
  });
});

describe("Blindside Victim", () => {
  const votedOut = (player: string, castawayId: string, count: number) =>
    Array.from({ length: count }, () => ev(1, castawayId, -2, player, "Voted Out"));
  it("is given for 3+ voted-out castaways", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...votedOut("p1", "c1", 3));
    expect(winnersOf(i, "blindside_victim")).toEqual(["p1"]);
  });
  it("is unclaimed below the threshold", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...votedOut("p1", "c1", 2));
    expect(winnersOf(i, "blindside_victim")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(3));
    i.events.push(...votedOut("p1", "c1", 3), ...votedOut("p2", "c2", 3));
    expect(winnersOf(i, "blindside_victim")).toEqual(["p1", "p2"]);
  });
});

describe("Jinx", () => {
  it("is given for 2+ pickups eliminated right away", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 2), castaway("x2", 4));
    i.claims = [claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 4)];
    expect(winnersOf(i, "jinx")).toEqual(["p1"]);
  });
  it("is unclaimed for a single unlucky pickup", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 2), castaway("x2", 5));
    i.claims = [claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 2)];
    expect(winnersOf(i, "jinx")).toEqual([]);
  });
  it("is shared on a tie", () => {
    const i = fromWeeklyScores(zeros(5));
    i.castaways.push(castaway("x1", 2), castaway("x2", 4), castaway("x3", 2), castaway("x4", 4));
    i.claims = [
      claim("p1", "x1", "c1", 1, 2), claim("p1", "x2", "x1", 1, 4),
      claim("p2", "x3", "c2", 1, 2), claim("p2", "x4", "x3", 1, 4),
    ];
    expect(winnersOf(i, "jinx")).toEqual(["p1", "p2"]);
  });
});

// ---------------------------------------------------------------------------
// computeAwards orchestration
// ---------------------------------------------------------------------------

describe("AWARD_EMOJI", () => {
  it("has a picture for every award and nothing extra", () => {
    const keys = AWARD_CATALOGUE.map((a) => a.key).sort();
    expect(Object.keys(AWARD_EMOJI).sort()).toEqual(keys);
    for (const k of keys) expect(AWARD_EMOJI[k].length).toBeGreaterThan(0);
  });
});

describe("computeAwards", () => {
  it("returns every catalogue award once", () => {
    const results = computeAwards(fromWeeklyScores(zeros(2)));
    expect(results.map((r) => r.key)).toEqual(AWARD_CATALOGUE.map((a) => a.key));
    expect(AWARD_CATALOGUE.length).toBe(27);
  });

  it("returns everything unclaimed for leagues that are too small", () => {
    const i = fromWeeklyScores(rep([10, 1, 1, 1, 1, 1], 3));
    i.players = i.players.slice(0, AWARD_THRESHOLDS.minPlayers - 1);
    expect(computeAwards(i).every((r) => r.unclaimed && r.winners.length === 0)).toBe(true);
  });

  it("returns everything unclaimed when no episode is finalized", () => {
    expect(computeAwards(fromWeeklyScores([])).every((r) => r.unclaimed)).toBe(true);
  });

  it("flattens one row per winner per award", () => {
    const rows = flattenWinners(computeAwards(fromWeeklyScores(rep([10, 10, 1, 1, 1, 1], 3))));
    const koth = rows.filter((r) => r.award_key === "king_of_the_hill");
    expect(koth.map((r) => r.player_id).sort()).toEqual(["p1", "p2"]);
    expect(koth[0].stat_detail).toContain("at #1");
  });
});

function richFixture(matrix: number[][]): AwardsInput {
  const i = fromWeeklyScores(matrix);
  i.castaways.push(castaway("x1", 2), castaway("x2", 3));
  i.claims = [
    claim("p1", "x1", "c1", 30, 2),
    claim("p2", "x2", "c2", 90, 3),
    claim("p3", "c1", "c3", 5, 3, "lost"),
  ];
  i.allies = [{ player_id: "p4", castaway_id: "c1", points_from_episode: 2, ended_at: null }];
  i.trades = [
    { proposer_id: "p1", receiver_id: "p2", status: "admin_approved" },
    { proposer_id: "p2", receiver_id: "p1", status: "admin_approved" },
  ];
  i.challenges = Array.from({ length: 6 }, (_, k) => ({ id: `ch${k + 1}`, episode_number: 1, points: 5 }));
  IDS.forEach((p, j) => {
    for (let k = 1; k <= 6; k++) {
      i.submissions.push({ challenge_id: `ch${k}`, player_id: p, is_correct: (j + k) % 3 === 0 });
    }
  });
  i.events.push(ev(1, "c2", -2, "p2", "Voted Out"), ev(1, "c3", 3, "p3", "Individual Immunity Win"));
  return i;
}

describe("Property: computeAwards", () => {
  const matrixArb = fc.array(
    fc.array(fc.integer({ min: -10, max: 30 }), { minLength: 6, maxLength: 6 }),
    { minLength: 1, maxLength: 8 }
  );

  function summarize(input: AwardsInput) {
    return computeAwards(input).map((r) => [r.key, r.winners.map((w) => w.player_id).sort()]);
  }

  // Feature: season-awards, Property 4: Order independence
  it("does not depend on the order of players, events, claims, or submissions", () => {
    fc.assert(
      fc.property(
        matrixArb,
        fc.integer({ min: 0, max: 1000 }),
        (matrix, seed) => {
          const input = richFixture(matrix);
          const shuffled: AwardsInput = JSON.parse(JSON.stringify(input));
          const rot = <T,>(arr: T[]) => {
            if (arr.length === 0) return arr;
            const k = seed % arr.length;
            return [...arr.slice(k), ...arr.slice(0, k)].reverse();
          };
          shuffled.players = rot(shuffled.players);
          shuffled.events = rot(shuffled.events);
          shuffled.claims = rot(shuffled.claims);
          shuffled.submissions = rot(shuffled.submissions);
          shuffled.assignments = rot(shuffled.assignments);
          shuffled.trades = rot(shuffled.trades);
          expect(summarize(shuffled)).toEqual(summarize(input));
        }
      ),
      { numRuns: 30 }
    );
  });

  // Feature: season-awards, Property 6: Input immutability
  it("does not modify its input", () => {
    fc.assert(
      fc.property(matrixArb, (matrix) => {
        const input = richFixture(matrix);
        const before = JSON.stringify(input);
        computeAwards(input);
        expect(JSON.stringify(input)).toBe(before);
      }),
      { numRuns: 30 }
    );
  });
});
