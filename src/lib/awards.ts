/**
 * Pure season-award logic: no Supabase calls, fully testable.
 *
 * Awards are fun, non-scoring recognitions computed from data the app already
 * stores. Every award has a qualifying threshold. Tied players share an award,
 * and an award nobody qualifies for is Unclaimed.
 *
 * Weekly standings are built with the same scoring functions the leaderboard
 * uses (computePlayerScore, computeAllyPoints, computeLeaderboard), so award
 * statistics always agree with the leaderboard.
 */
import {
  computePlayerScore,
  computeAllyPoints,
  resolveAllyEndEpisode,
  type TeamAssignment,
  type EpisodeEvent,
  type EliminatedCastaway,
  type FinalizedEpisode,
  type ChallengeSubmission,
  type CastawayBreakdown,
} from "@/lib/scoring";
import { computeLeaderboard } from "@/lib/leaderboard";

// ---------------------------------------------------------------------------
// Thresholds (tune here after reviewing the admin preview)
// ---------------------------------------------------------------------------

export const AWARD_THRESHOLDS = {
  /** Leagues with fewer players get no awards. */
  minPlayers: 4,
  kingOfTheHillWeeks: 3,
  peakedTooEarlyWeeks: 3,
  peakedTooEarlyFinalRankAbove: 3,
  comebackMinPlayers: 6,
  comebackFinalRankAtMost: 3,
  cellarDwellerWeeks: 5,
  cliffDiverPlaces: 6,
  /** Rock Bottom needs a single-week score at or below this. */
  rockBottomScore: -8,
  photoFinishGap: 2,
  photoFinishTopPlaces: 3,
  rollercoasterMinWeeks: 5,
  rollercoasterRange: 30,
  onFireScore: 25,
  /** 1 = the whole budget. */
  bigSpenderBudgetShare: 1,
  suckerBidMinBid: 25,
  oneThatGotAwayPoints: 15,
  goingDownWeeks: 3,
  hoarderClaims: 3,
  dumpsterDiverPoints: 20,
  waiverMvpPoints: 25,
  commitmentIssuesTrades: 2,
  kissOfDeathAlliances: 2,
  coattailShare: 0.25,
  oracleMinAnswers: 8,
  loneWolfMinGraded: 4,
  blackSheepMinGraded: 5,
  participationMinChallenges: 5,
  immunityMagnetWins: 8,
  blindsideVictimCastaways: 3,
  jinxClaims: 2,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AwardCategory =
  | "standings"
  | "waiver"
  | "alliance"
  | "challenges"
  | "scoring";

export const AWARD_CATEGORY_ORDER: AwardCategory[] = [
  "standings",
  "waiver",
  "alliance",
  "challenges",
  "scoring",
];

export const AWARD_CATEGORY_LABELS: Record<AwardCategory, string> = {
  standings: "Standings & Momentum",
  waiver: "Waiver Wire",
  alliance: "Alliances",
  challenges: "Challenges",
  scoring: "On the Island",
};

export interface AwardsInput {
  league: { roster_size: number; waiver_budget: number; consolation_points: number };
  players: { player_id: string; display_name: string }[];
  finalizedEpisodes: { number: number; finalized_at: string | null }[];
  castaways: { id: string; name: string; eliminated_episode: number | null }[];
  events: {
    episode_number: number;
    castaway_id: string;
    points: number;
    player_id: string | null;
    rule_name: string | null;
  }[];
  assignments: {
    player_id: string;
    castaway_id: string;
    points_from_episode: number;
    source: "draft" | "admin_assign" | "trade" | "waiver";
  }[];
  claims: {
    player_id: string;
    castaway_id: string;
    drop_castaway_id: string;
    bid_amount: number;
    status: "pending" | "won" | "lost";
    processed_at: string | null;
  }[];
  allies: {
    player_id: string;
    castaway_id: string;
    points_from_episode: number;
    ended_at: string | null;
  }[];
  trades: { proposer_id: string; receiver_id: string; status: string }[];
  challenges: { id: string; episode_number: number; points: number }[];
  submissions: { challenge_id: string; player_id: string; is_correct: boolean | null }[];
}

export interface Candidate {
  player_id: string;
  value: number;
  detail: string;
  qualifies: boolean;
}

export type AwardDirection = "highest" | "lowest";

export interface AwardContext {
  input: AwardsInput;
  history: StandingsHistory;
}

export interface AwardDefinition {
  key: string;
  name: string;
  description: string;
  category: AwardCategory;
  thresholdText: string;
  direction: AwardDirection;
  evaluate(ctx: AwardContext): Candidate[];
}

export interface AwardResult {
  key: string;
  candidates: Candidate[];
  winners: Candidate[];
  unclaimed: boolean;
}

export interface AwardRow {
  award_key: string;
  player_id: string;
  stat_value: number;
  stat_detail: string;
}

// ---------------------------------------------------------------------------
// Winner selection
// ---------------------------------------------------------------------------

/**
 * Returns every qualifier tied on the best value (highest or lowest).
 * Returns [] when nobody qualifies. This is the only place ties are handled.
 */
export function pickWinners(
  candidates: Candidate[],
  direction: AwardDirection
): Candidate[] {
  const qualifiers = candidates.filter((c) => c.qualifies);
  if (qualifiers.length === 0) return [];
  const values = qualifiers.map((c) => c.value);
  const best = direction === "highest" ? Math.max(...values) : Math.min(...values);
  return qualifiers
    .filter((c) => c.value === best)
    .sort((a, b) => a.player_id.localeCompare(b.player_id));
}

/** Qualifiers first, then best value first, then player id for stability. */
export function sortCandidates(
  candidates: Candidate[],
  direction: AwardDirection
): Candidate[] {
  return [...candidates].sort((a, b) => {
    if (a.qualifies !== b.qualifies) return a.qualifies ? -1 : 1;
    if (a.value !== b.value) {
      return direction === "highest" ? b.value - a.value : a.value - b.value;
    }
    return a.player_id.localeCompare(b.player_id);
  });
}

// ---------------------------------------------------------------------------
// Claim timing
// ---------------------------------------------------------------------------

/**
 * The first finalized episode whose finalized_at is later than the claim's
 * processed_at. Returns null when the claim was processed after the last
 * finalized episode (or has no timestamp).
 */
export function claimEpisode(
  processedAt: string | null,
  finalizedEpisodes: { number: number; finalized_at: string | null }[]
): number | null {
  if (!processedAt) return null;
  const t = new Date(processedAt).getTime();
  if (Number.isNaN(t)) return null;
  let result: number | null = null;
  for (const ep of finalizedEpisodes) {
    if (!ep.finalized_at) continue;
    if (new Date(ep.finalized_at).getTime() > t) {
      if (result === null || ep.number < result) result = ep.number;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Standings history
// ---------------------------------------------------------------------------

export interface WeekStanding {
  total: number;
  rank: number;
  weeklyScore: number;
}

export interface StandingsHistory {
  /** Finalized episode numbers, ascending. */
  weeks: number[];
  /** Per player, one entry per week (aligned with `weeks`). */
  standings: Map<string, WeekStanding[]>;
  /** Alliance points per player as of the final week. */
  finalAllyPoints: Map<string, number>;
}

/**
 * Builds each player's cumulative total, competition rank, and weekly score
 * for every finalized episode, using the leaderboard's scoring functions.
 * On the final week the result equals the leaderboard.
 */
export function buildStandingsHistory(input: AwardsInput): StandingsHistory {
  const weeks = input.finalizedEpisodes.map((e) => e.number).sort((a, b) => a - b);
  const standings = new Map<string, WeekStanding[]>();
  const finalAllyPoints = new Map<string, number>();
  for (const p of input.players) {
    standings.set(p.player_id, []);
    finalAllyPoints.set(p.player_id, 0);
  }
  if (weeks.length === 0) return { weeks, standings, finalAllyPoints };

  const lastWeek = weeks[weeks.length - 1];
  const finalized: FinalizedEpisode[] = weeks.map((number) => ({ number }));
  const scoringEvents: EpisodeEvent[] = input.events.map((e) => ({
    episode_number: e.episode_number,
    castaway_id: e.castaway_id,
    points: e.points,
    player_id: e.player_id ?? undefined,
  }));
  const eliminated: EliminatedCastaway[] = input.castaways
    .filter((c) => c.eliminated_episode !== null)
    .map((c) => ({ castaway_id: c.id, eliminated_episode: c.eliminated_episode as number }));
  const challengeById = new Map(input.challenges.map((c) => [c.id, c]));
  const allyEndEpisodes = input.allies.map((a) =>
    resolveAllyEndEpisode(a.ended_at, input.finalizedEpisodes)
  );

  const previousTotals = new Map<string, number>();

  for (const n of weeks) {
    const baseTotals = new Map<string, number>();
    const merged = new Map<string, CastawayBreakdown>();

    for (const p of input.players) {
      const assignments: TeamAssignment[] = input.assignments
        .filter((a) => a.player_id === p.player_id)
        .map((a) => ({
          castaway_id: a.castaway_id,
          points_from_episode: a.points_from_episode,
          source: a.source,
        }));
      const subs: ChallengeSubmission[] = [];
      for (const s of input.submissions) {
        if (s.player_id !== p.player_id || s.is_correct !== true) continue;
        const ch = challengeById.get(s.challenge_id);
        if (!ch || ch.episode_number > n) continue;
        subs.push({ points: ch.points, is_correct: true });
      }
      const score = computePlayerScore(
        p.player_id,
        assignments,
        scoringEvents,
        eliminated,
        finalized,
        input.league.consolation_points,
        subs,
        n
      );
      baseTotals.set(p.player_id, score.total);
      for (const cb of score.castaways) {
        const existing = merged.get(cb.castaway_id);
        if (!existing) {
          merged.set(cb.castaway_id, {
            castaway_id: cb.castaway_id,
            episode_points: { ...cb.episode_points },
            consolation_points: cb.consolation_points,
            total: cb.total,
          });
        } else {
          for (const [ep, pts] of Object.entries(cb.episode_points)) {
            const key = Number(ep);
            existing.episode_points[key] = (existing.episode_points[key] ?? 0) + pts;
          }
          existing.consolation_points += cb.consolation_points;
          existing.total += cb.total;
        }
      }
    }

    const allyTotals = new Map<string, number>();
    input.allies.forEach((ally, i) => {
      const breakdown = merged.get(ally.castaway_id);
      if (!breakdown) return;
      const endEp = allyEndEpisodes[i];
      // On the final week use exactly the leaderboard's cutoff.
      const through =
        n === lastWeek
          ? endEp
          : endEp === undefined
          ? n
          : Math.min(n, endEp);
      const pts = computeAllyPoints(breakdown, ally.points_from_episode, through);
      allyTotals.set(ally.player_id, (allyTotals.get(ally.player_id) ?? 0) + pts);
    });

    const scores = input.players.map((p) => ({
      player_id: p.player_id,
      display_name: p.display_name,
      total: (baseTotals.get(p.player_id) ?? 0) + (allyTotals.get(p.player_id) ?? 0),
    }));
    const board = computeLeaderboard(scores);
    for (const entry of board) {
      const prev = previousTotals.get(entry.player_id) ?? 0;
      standings.get(entry.player_id)?.push({
        total: entry.total,
        rank: entry.rank,
        weeklyScore: entry.total - prev,
      });
      previousTotals.set(entry.player_id, entry.total);
    }
    if (n === lastWeek) {
      for (const p of input.players) {
        finalAllyPoints.set(p.player_id, allyTotals.get(p.player_id) ?? 0);
      }
    }
  }

  return { weeks, standings, finalAllyPoints };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T = AWARD_THRESHOLDS;

function lc(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function longestRun(flags: boolean[]): number {
  let best = 0;
  let current = 0;
  for (const f of flags) {
    current = f ? current + 1 : 0;
    if (current > best) best = current;
  }
  return best;
}

function series(ctx: AwardContext, playerId: string): WeekStanding[] {
  return ctx.history.standings.get(playerId) ?? [];
}

function finalStanding(ctx: AwardContext, playerId: string): WeekStanding | undefined {
  const s = series(ctx, playerId);
  return s[s.length - 1];
}

function castawayName(input: AwardsInput, id: string): string {
  return input.castaways.find((c) => c.id === id)?.name ?? "a castaway";
}

function castawayEliminatedEpisode(input: AwardsInput, id: string): number | null {
  return input.castaways.find((c) => c.id === id)?.eliminated_episode ?? null;
}

function wonClaims(input: AwardsInput) {
  return input.claims.filter((c) => c.status === "won");
}

function cand(
  player_id: string,
  value: number,
  detail: string,
  qualifies: boolean
): Candidate {
  return { player_id, value, detail, qualifies };
}

/** Points the given player earned from the castaway while owning it. */
function ownedPoints(input: AwardsInput, playerId: string, castawayId: string): number {
  let sum = 0;
  for (const e of input.events) {
    if (e.player_id === playerId && e.castaway_id === castawayId) sum += e.points;
  }
  return sum;
}

/** True when the castaway was eliminated in the claim's week or the week after. */
function eliminatedAroundClaim(
  input: AwardsInput,
  castawayId: string,
  claimWeek: number | null
): boolean {
  if (claimWeek === null) return false;
  const elim = castawayEliminatedEpisode(input, castawayId);
  return elim !== null && elim >= claimWeek && elim <= claimWeek + 1;
}

// ---------------------------------------------------------------------------
// Standings & momentum
// ---------------------------------------------------------------------------

function weeksAtRankOne(ctx: AwardContext, playerId: string): number {
  return series(ctx, playerId).filter((w) => w.rank === 1).length;
}

const kingOfTheHill: AwardDefinition = {
  key: "king_of_the_hill",
  name: "King of the Hill",
  description: "Spent the most weeks sitting at #1 on the leaderboard.",
  category: "standings",
  thresholdText: `At least ${T.kingOfTheHillWeeks} weeks at #1`,
  direction: "highest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const v = weeksAtRankOne(ctx, p.player_id);
      return cand(p.player_id, v, `${plural(v, "week")} at #1`, v >= T.kingOfTheHillWeeks);
    });
  },
};

const peakedTooEarly: AwardDefinition = {
  key: "peaked_too_early",
  name: "Peaked Too Early",
  description: "Led the league for weeks, then fell out of the top 3.",
  category: "standings",
  thresholdText: `At least ${T.peakedTooEarlyWeeks} weeks at #1 and a final rank below ${ordinal(
    T.peakedTooEarlyFinalRankAbove
  )}`,
  direction: "highest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const v = weeksAtRankOne(ctx, p.player_id);
      const finalRank = finalStanding(ctx, p.player_id)?.rank ?? 0;
      return cand(
        p.player_id,
        v,
        `${plural(v, "week")} at #1, finished ${ordinal(finalRank)}`,
        v >= T.peakedTooEarlyWeeks && finalRank > T.peakedTooEarlyFinalRankAbove
      );
    });
  },
};

const comebackKid: AwardDefinition = {
  key: "comeback_kid",
  name: "Comeback Kid",
  description: "Climbed from the bottom 3 into the top 3.",
  category: "standings",
  thresholdText: `Bottom 3 at some point, finished top ${T.comebackFinalRankAtMost} (leagues of ${T.comebackMinPlayers}+)`,
  direction: "highest",
  evaluate(ctx) {
    const n = ctx.input.players.length;
    return ctx.input.players.map((p) => {
      const s = series(ctx, p.player_id);
      const worst = s.reduce((m, w) => Math.max(m, w.rank), 0);
      const final = s[s.length - 1]?.rank ?? 0;
      const qualifies =
        n >= T.comebackMinPlayers &&
        worst >= n - 2 &&
        final > 0 &&
        final <= T.comebackFinalRankAtMost;
      return cand(
        p.player_id,
        worst - final,
        `From ${ordinal(worst)} to ${ordinal(final)}`,
        qualifies
      );
    });
  },
};

const cellarDweller: AwardDefinition = {
  key: "cellar_dweller",
  name: "Cellar Dweller",
  description: "Stuck in last place for the longest unbroken stretch.",
  category: "standings",
  thresholdText: `At least ${T.cellarDwellerWeeks} weeks in a row in last place`,
  direction: "highest",
  evaluate(ctx) {
    const weekCount = ctx.history.weeks.length;
    const lastFlags = new Map<string, boolean[]>();
    for (const p of ctx.input.players) lastFlags.set(p.player_id, []);
    for (let i = 0; i < weekCount; i++) {
      const totals = ctx.input.players.map((p) => series(ctx, p.player_id)[i]?.total ?? 0);
      const min = Math.min(...totals);
      const max = Math.max(...totals);
      ctx.input.players.forEach((p, idx) => {
        lastFlags.get(p.player_id)?.push(min < max && totals[idx] === min);
      });
    }
    return ctx.input.players.map((p) => {
      const v = longestRun(lastFlags.get(p.player_id) ?? []);
      return cand(
        p.player_id,
        v,
        `${plural(v, "week")} in a row in last place`,
        v >= T.cellarDwellerWeeks
      );
    });
  },
};

const cliffDiver: AwardDefinition = {
  key: "cliff_diver",
  name: "Cliff Diver",
  description: "Suffered the biggest one-week drop in the rankings.",
  category: "standings",
  thresholdText: `A one-week drop of at least ${T.cliffDiverPlaces} places`,
  direction: "highest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const s = series(ctx, p.player_id);
      let best = 0;
      let bestWeek = 0;
      for (let i = 1; i < s.length; i++) {
        const drop = s[i].rank - s[i - 1].rank;
        if (drop > best) {
          best = drop;
          bestWeek = ctx.history.weeks[i];
        }
      }
      return cand(
        p.player_id,
        best,
        best > 0 ? `Dropped ${plural(best, "place")} in episode ${bestWeek}` : "No drops",
        best >= T.cliffDiverPlaces
      );
    });
  },
};

const rockBottom: AwardDefinition = {
  key: "rock_bottom",
  name: "Rock Bottom",
  description: "Had the worst single week of the season.",
  category: "standings",
  thresholdText: `A week score of ${T.rockBottomScore} or worse`,
  direction: "lowest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const s = series(ctx, p.player_id);
      let worst = Infinity;
      let worstWeek = 0;
      s.forEach((w, i) => {
        if (w.weeklyScore < worst) {
          worst = w.weeklyScore;
          worstWeek = ctx.history.weeks[i];
        }
      });
      if (!Number.isFinite(worst)) return cand(p.player_id, 0, "No weeks", false);
      return cand(
        p.player_id,
        worst,
        `${worst} points in episode ${worstWeek}`,
        worst <= T.rockBottomScore
      );
    });
  },
};

const photoFinish: AwardDefinition = {
  key: "photo_finish",
  name: "Photo Finish",
  description: "Finished a podium spot separated from a neighbor by a hair.",
  category: "standings",
  thresholdText: `Top ${T.photoFinishTopPlaces} places within ${T.photoFinishGap} points of a neighbor`,
  direction: "lowest",
  evaluate(ctx) {
    const finals = ctx.input.players
      .map((p) => ({ player_id: p.player_id, standing: finalStanding(ctx, p.player_id) }))
      .filter((x): x is { player_id: string; standing: WeekStanding } => !!x.standing)
      .filter((x) => x.standing.rank <= T.photoFinishTopPlaces)
      .sort(
        (a, b) =>
          b.standing.total - a.standing.total || a.player_id.localeCompare(b.player_id)
      );
    if (finals.length < 2) return [];
    const minGap = new Map<string, number>();
    for (let i = 1; i < finals.length; i++) {
      const gap = finals[i - 1].standing.total - finals[i].standing.total;
      for (const id of [finals[i - 1].player_id, finals[i].player_id]) {
        minGap.set(id, Math.min(minGap.get(id) ?? Infinity, gap));
      }
    }
    return finals.map((f) => {
      const gap = minGap.get(f.player_id) ?? Infinity;
      return cand(
        f.player_id,
        gap,
        gap === 0 ? "Tied with a neighbor" : `Within ${plural(gap, "point")} of a neighbor`,
        gap <= T.photoFinishGap
      );
    });
  },
};

const rollercoaster: AwardDefinition = {
  key: "rollercoaster",
  name: "Rollercoaster",
  description: "Had the widest swing between best and worst week.",
  category: "standings",
  thresholdText: `A best-to-worst week gap of at least ${T.rollercoasterRange} (${T.rollercoasterMinWeeks}+ weeks played)`,
  direction: "highest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const scores = series(ctx, p.player_id).map((w) => w.weeklyScore);
      if (scores.length === 0) return cand(p.player_id, 0, "No weeks", false);
      const best = Math.max(...scores);
      const worst = Math.min(...scores);
      return cand(
        p.player_id,
        best - worst,
        `Best week ${best}, worst week ${worst}`,
        scores.length >= T.rollercoasterMinWeeks && best - worst >= T.rollercoasterRange
      );
    });
  },
};

const onFire: AwardDefinition = {
  key: "on_fire",
  name: "On Fire",
  description: "Posted the highest single-week score.",
  category: "standings",
  thresholdText: `A week score of at least ${T.onFireScore}`,
  direction: "highest",
  evaluate(ctx) {
    return ctx.input.players.map((p) => {
      const s = series(ctx, p.player_id);
      let best = -Infinity;
      let bestWeek = 0;
      s.forEach((w, i) => {
        if (w.weeklyScore > best) {
          best = w.weeklyScore;
          bestWeek = ctx.history.weeks[i];
        }
      });
      if (!Number.isFinite(best)) return cand(p.player_id, 0, "No weeks", false);
      return cand(
        p.player_id,
        best,
        `${best} points in episode ${bestWeek}`,
        best >= T.onFireScore
      );
    });
  },
};

// ---------------------------------------------------------------------------
// Waiver wire
// ---------------------------------------------------------------------------

const bigSpender: AwardDefinition = {
  key: "big_spender",
  name: "Big Spender",
  description: "Burned through the waiver budget.",
  category: "waiver",
  thresholdText:
    T.bigSpenderBudgetShare >= 1
      ? "Spent the entire waiver budget on winning bids"
      : `Winning bids totaling at least ${Math.round(T.bigSpenderBudgetShare * 100)}% of the budget`,
  direction: "highest",
  evaluate({ input }) {
    const budget = input.league.waiver_budget;
    return input.players.map((p) => {
      const total = wonClaims(input)
        .filter((c) => c.player_id === p.player_id)
        .reduce((s, c) => s + c.bid_amount, 0);
      return cand(
        p.player_id,
        total,
        `${total} of ${budget} budget spent`,
        budget > 0 && total >= budget * T.bigSpenderBudgetShare
      );
    });
  },
};

const suckerBid: AwardDefinition = {
  key: "sucker_bid",
  name: "Sucker Bid",
  description: "Paid a big bid for a castaway who was gone almost immediately.",
  category: "waiver",
  thresholdText: `A bid of at least ${T.suckerBidMinBid} on a castaway eliminated that week or the next`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      let best = 0;
      let bestName = "";
      for (const c of wonClaims(input)) {
        if (c.player_id !== p.player_id) continue;
        const week = claimEpisode(c.processed_at, input.finalizedEpisodes);
        if (!eliminatedAroundClaim(input, c.castaway_id, week)) continue;
        if (c.bid_amount > best) {
          best = c.bid_amount;
          bestName = castawayName(input, c.castaway_id);
        }
      }
      return cand(
        p.player_id,
        best,
        best > 0 ? `Bid ${best} on ${bestName}, who went out right away` : "No flops",
        best >= T.suckerBidMinBid
      );
    });
  },
};

const oneThatGotAway: AwardDefinition = {
  key: "one_that_got_away",
  name: "The One That Got Away",
  description: "Dropped a castaway who then went on to score big for someone else.",
  category: "waiver",
  thresholdText: `The dropped castaway scored at least ${T.oneThatGotAwayPoints} points afterward`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      let best = 0;
      let bestName = "";
      for (const c of wonClaims(input)) {
        if (c.player_id !== p.player_id) continue;
        const week = claimEpisode(c.processed_at, input.finalizedEpisodes);
        if (week === null) continue;
        let after = 0;
        for (const e of input.events) {
          if (
            e.castaway_id === c.drop_castaway_id &&
            e.episode_number >= week &&
            e.player_id !== p.player_id
          ) {
            after += e.points;
          }
        }
        if (after > best) {
          best = after;
          bestName = castawayName(input, c.drop_castaway_id);
        }
      }
      return cand(
        p.player_id,
        best,
        best > 0 ? `${bestName} scored ${best} after being dropped` : "No regrets",
        best >= T.oneThatGotAwayPoints
      );
    });
  },
};

const goingDownWithTheShip: AwardDefinition = {
  key: "going_down_with_the_ship",
  name: "Going Down With the Ship",
  description: "Kept an eliminated castaway on the roster the longest.",
  category: "waiver",
  thresholdText: `Held an eliminated castaway for at least ${T.goingDownWeeks} weeks`,
  direction: "highest",
  evaluate({ input, history }) {
    return input.players.map((p) => {
      let best = 0;
      let bestName = "";
      let bestElim = 0;
      for (const a of input.assignments) {
        if (a.player_id !== p.player_id) continue;
        const elim = castawayEliminatedEpisode(input, a.castaway_id);
        if (elim === null) continue;
        const held = history.weeks.filter(
          (n) => n > elim && n >= a.points_from_episode
        ).length;
        if (held > best) {
          best = held;
          bestName = castawayName(input, a.castaway_id);
          bestElim = elim;
        }
      }
      return cand(
        p.player_id,
        best,
        best > 0
          ? `Held ${bestName} for ${plural(best, "week")} after episode ${bestElim}`
          : "Roster is alive",
        best >= T.goingDownWeeks
      );
    });
  },
};

const hoarder: AwardDefinition = {
  key: "hoarder",
  name: "Hoarder",
  description: "Picked up the most castaways off the waiver wire.",
  category: "waiver",
  thresholdText: `At least ${T.hoarderClaims} won waiver claims`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      const v = wonClaims(input).filter((c) => c.player_id === p.player_id).length;
      return cand(p.player_id, v, `${plural(v, "waiver pickup")}`, v >= T.hoarderClaims);
    });
  },
};

const dumpsterDiver: AwardDefinition = {
  key: "dumpster_diver",
  name: "Dumpster Diver",
  description: "Scored the most from castaways other players had thrown away.",
  category: "waiver",
  thresholdText: `At least ${T.dumpsterDiverPoints} points from castaways another player dropped`,
  direction: "highest",
  evaluate({ input }) {
    const won = wonClaims(input);
    return input.players.map((p) => {
      let total = 0;
      const counted = new Set<string>();
      for (const c of won) {
        if (c.player_id !== p.player_id || counted.has(c.castaway_id)) continue;
        if (!c.processed_at) continue;
        const mine = new Date(c.processed_at).getTime();
        const droppedByOther = won.some(
          (q) =>
            q.player_id !== p.player_id &&
            q.drop_castaway_id === c.castaway_id &&
            q.processed_at !== null &&
            new Date(q.processed_at).getTime() < mine
        );
        if (!droppedByOther) continue;
        counted.add(c.castaway_id);
        total += ownedPoints(input, p.player_id, c.castaway_id);
      }
      return cand(
        p.player_id,
        total,
        `${total} points from other players' castoffs`,
        total >= T.dumpsterDiverPoints
      );
    });
  },
};

const waiverMvp: AwardDefinition = {
  key: "waiver_mvp",
  name: "Waiver MVP",
  description: "Landed the best pickup off the waiver wire.",
  category: "waiver",
  thresholdText: `A waiver pickup that earned at least ${T.waiverMvpPoints} points while owned`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      let best = 0;
      let bestName = "";
      for (const c of wonClaims(input)) {
        if (c.player_id !== p.player_id) continue;
        const pts = ownedPoints(input, p.player_id, c.castaway_id);
        if (pts > best) {
          best = pts;
          bestName = castawayName(input, c.castaway_id);
        }
      }
      return cand(
        p.player_id,
        best,
        best > 0 ? `${bestName} earned ${best} points` : "No big pickups",
        best >= T.waiverMvpPoints
      );
    });
  },
};

const commitmentIssues: AwardDefinition = {
  key: "commitment_issues",
  name: "Commitment Issues",
  description: "Couldn't stop trading castaways.",
  category: "waiver",
  thresholdText: `At least ${T.commitmentIssuesTrades} approved trades`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      const v = input.trades.filter(
        (t) =>
          t.status === "admin_approved" &&
          (t.proposer_id === p.player_id || t.receiver_id === p.player_id)
      ).length;
      return cand(p.player_id, v, plural(v, "trade"), v >= T.commitmentIssuesTrades);
    });
  },
};

// ---------------------------------------------------------------------------
// Alliances
// ---------------------------------------------------------------------------

const kissOfDeath: AwardDefinition = {
  key: "kiss_of_death",
  name: "Kiss of Death",
  description: "Allied with castaways who got voted out right away. More than once.",
  category: "alliance",
  thresholdText: `At least ${T.kissOfDeathAlliances} alliances with a castaway out by the time it started`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      let v = 0;
      for (const a of input.allies) {
        if (a.player_id !== p.player_id) continue;
        const elim = castawayEliminatedEpisode(input, a.castaway_id);
        if (elim !== null && elim <= a.points_from_episode) v++;
      }
      return cand(
        p.player_id,
        v,
        `${plural(v, "alliance")} ended by an immediate elimination`,
        v >= T.kissOfDeathAlliances
      );
    });
  },
};

const coattailRider: AwardDefinition = {
  key: "coattail_rider",
  name: "Coattail Rider",
  description: "Got the biggest share of their points from an ally.",
  category: "alliance",
  thresholdText: `Alliance points were at least ${Math.round(T.coattailShare * 100)}% of the total`,
  direction: "highest",
  evaluate({ input, history }) {
    return input.players.map((p) => {
      const ally = history.finalAllyPoints.get(p.player_id) ?? 0;
      const total = history.standings.get(p.player_id)?.slice(-1)[0]?.total ?? 0;
      const share = total > 0 ? Math.round((ally / total) * 10000) / 100 : 0;
      return cand(
        p.player_id,
        share,
        `${ally} of ${total} points from allies (${share}%)`,
        ally > 0 && total > 0 && ally / total >= T.coattailShare
      );
    });
  },
};

const soleSurvivorWhisperer: AwardDefinition = {
  key: "sole_survivor_whisperer",
  name: "Sole Survivor Whisperer",
  description: "Owned or was allied with the season's winner.",
  category: "alliance",
  thresholdText: 'The "Season Winner" rule was scored for a castaway you owned or were allied with',
  direction: "highest",
  evaluate({ input }) {
    const winnerEvents = input.events.filter((e) =>
      lc(e.rule_name).includes("season winner")
    );
    const winnerCastaways = new Set(winnerEvents.map((e) => e.castaway_id));
    const owners = new Set(
      winnerEvents.map((e) => e.player_id).filter((id): id is string => !!id)
    );
    const allies = new Set(
      input.allies
        .filter((a) => a.ended_at === null && winnerCastaways.has(a.castaway_id))
        .map((a) => a.player_id)
    );
    return input.players.map((p) => {
      const owned = owners.has(p.player_id);
      const allied = allies.has(p.player_id);
      const qualifies = owned || allied;
      const detail = owned && allied ? "Owned and allied with the winner" : owned ? "Owned the winner" : allied ? "Allied with the winner" : "Not with the winner";
      return cand(p.player_id, qualifies ? 1 : 0, detail, qualifies);
    });
  },
};

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

function gradedByChallenge(input: AwardsInput) {
  const map = new Map<string, { player_id: string; is_correct: boolean }[]>();
  for (const s of input.submissions) {
    if (s.is_correct === null) continue;
    const list = map.get(s.challenge_id) ?? [];
    list.push({ player_id: s.player_id, is_correct: s.is_correct });
    map.set(s.challenge_id, list);
  }
  return map;
}

function accuracyFor(input: AwardsInput, playerId: string) {
  let graded = 0;
  let correct = 0;
  for (const s of input.submissions) {
    if (s.player_id !== playerId || s.is_correct === null) continue;
    graded++;
    if (s.is_correct) correct++;
  }
  return { graded, correct, percent: graded > 0 ? (correct * 100) / graded : 0 };
}

const theOracle: AwardDefinition = {
  key: "the_oracle",
  name: "The Oracle",
  description: "Predicted the show better than anyone.",
  category: "challenges",
  thresholdText: `Best accuracy with at least ${T.oracleMinAnswers} graded answers`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      const a = accuracyFor(input, p.player_id);
      return cand(
        p.player_id,
        a.percent,
        `${a.correct} of ${a.graded} correct`,
        a.graded >= T.oracleMinAnswers
      );
    });
  },
};

const loneWolf: AwardDefinition = {
  key: "lone_wolf",
  name: "Lone Wolf",
  description: "Was the only player to get a challenge right.",
  category: "challenges",
  thresholdText: `The only correct answer on a challenge with ${T.loneWolfMinGraded}+ answers`,
  direction: "highest",
  evaluate({ input }) {
    const counts = new Map<string, number>();
    for (const subs of Array.from(gradedByChallenge(input).values())) {
      if (subs.length < T.loneWolfMinGraded) continue;
      const right = subs.filter((s) => s.is_correct);
      if (right.length === 1) {
        counts.set(right[0].player_id, (counts.get(right[0].player_id) ?? 0) + 1);
      }
    }
    return input.players.map((p) => {
      const v = counts.get(p.player_id) ?? 0;
      return cand(p.player_id, v, `Only correct answer on ${plural(v, "challenge")}`, v >= 1);
    });
  },
};

const blackSheep: AwardDefinition = {
  key: "black_sheep",
  name: "Black Sheep",
  description: "Was the only one to miss a challenge everyone else got right.",
  category: "challenges",
  thresholdText: `The only wrong answer on a challenge with ${T.blackSheepMinGraded}+ answers`,
  direction: "highest",
  evaluate({ input }) {
    const counts = new Map<string, number>();
    for (const subs of Array.from(gradedByChallenge(input).values())) {
      if (subs.length < T.blackSheepMinGraded) continue;
      const wrong = subs.filter((s) => !s.is_correct);
      if (wrong.length === 1) {
        counts.set(wrong[0].player_id, (counts.get(wrong[0].player_id) ?? 0) + 1);
      }
    }
    return input.players.map((p) => {
      const v = counts.get(p.player_id) ?? 0;
      return cand(p.player_id, v, `Only wrong answer on ${plural(v, "challenge")}`, v >= 1);
    });
  },
};

const participationTrophy: AwardDefinition = {
  key: "participation_trophy",
  name: "Participation Trophy",
  description: "Answered every challenge and still finished in the bottom half.",
  category: "challenges",
  thresholdText: `Answered every challenge (${T.participationMinChallenges}+ challenges), finished in the bottom half, lowest accuracy`,
  direction: "lowest",
  evaluate(ctx) {
    const { input } = ctx;
    const total = input.challenges.length;
    return input.players.map((p) => {
      const answered = new Set(
        input.submissions.filter((s) => s.player_id === p.player_id).map((s) => s.challenge_id)
      );
      const answeredAll = total > 0 && input.challenges.every((c) => answered.has(c.id));
      const rank = finalStanding(ctx, p.player_id)?.rank ?? 0;
      const a = accuracyFor(input, p.player_id);
      return cand(
        p.player_id,
        a.percent,
        `Answered all ${total}, ${a.correct} correct, finished ${ordinal(rank)}`,
        total >= T.participationMinChallenges &&
          answeredAll &&
          rank > input.players.length / 2
      );
    });
  },
};

// ---------------------------------------------------------------------------
// Scoring events
// ---------------------------------------------------------------------------

const immunityMagnet: AwardDefinition = {
  key: "immunity_magnet",
  name: "Immunity Magnet",
  description: "Their castaways kept winning immunity, team and individual.",
  category: "scoring",
  thresholdText: `At least ${T.immunityMagnetWins} immunity wins (team + individual)`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      const v = input.events.filter((e) => {
        if (e.player_id !== p.player_id || e.points <= 0) return false;
        const r = lc(e.rule_name);
        return r.includes("immunity") && r.includes("win");
      }).length;
      return cand(p.player_id, v, plural(v, "immunity win"), v >= T.immunityMagnetWins);
    });
  },
};

const blindsideVictim: AwardDefinition = {
  key: "blindside_victim",
  name: "Blindside Victim",
  description: "Had the most castaways voted out from under them.",
  category: "scoring",
  thresholdText: `At least ${T.blindsideVictimCastaways} voted-out castaways`,
  direction: "highest",
  evaluate({ input }) {
    const min = T.blindsideVictimCastaways;
    return input.players.map((p) => {
      const v = input.events.filter(
        (e) => e.player_id === p.player_id && lc(e.rule_name).includes("voted out")
      ).length;
      return cand(p.player_id, v, `${plural(v, "castaway")} voted out`, v >= min);
    });
  },
};

const jinx: AwardDefinition = {
  key: "jinx",
  name: "Jinx",
  description: "Everyone they picked up was eliminated right after.",
  category: "scoring",
  thresholdText: `At least ${T.jinxClaims} pickups eliminated that week or the next`,
  direction: "highest",
  evaluate({ input }) {
    return input.players.map((p) => {
      let v = 0;
      for (const c of wonClaims(input)) {
        if (c.player_id !== p.player_id) continue;
        const week = claimEpisode(c.processed_at, input.finalizedEpisodes);
        if (eliminatedAroundClaim(input, c.castaway_id, week)) v++;
      }
      return cand(
        p.player_id,
        v,
        `${plural(v, "pickup")} eliminated right away`,
        v >= T.jinxClaims
      );
    });
  },
};

// ---------------------------------------------------------------------------
// Catalogue and orchestration
// ---------------------------------------------------------------------------

export const AWARD_CATALOGUE: AwardDefinition[] = [
  kingOfTheHill,
  peakedTooEarly,
  comebackKid,
  cellarDweller,
  cliffDiver,
  rockBottom,
  photoFinish,
  rollercoaster,
  onFire,
  bigSpender,
  suckerBid,
  oneThatGotAway,
  goingDownWithTheShip,
  hoarder,
  dumpsterDiver,
  waiverMvp,
  commitmentIssues,
  kissOfDeath,
  coattailRider,
  soleSurvivorWhisperer,
  theOracle,
  loneWolf,
  blackSheep,
  participationTrophy,
  immunityMagnet,
  blindsideVictim,
  jinx,
];

/** The picture shown on each award's card. Change freely. */
export const AWARD_EMOJI: Record<string, string> = {
  king_of_the_hill: "👑",
  peaked_too_early: "📉",
  comeback_kid: "🚀",
  cellar_dweller: "🕳️",
  cliff_diver: "🪂",
  rock_bottom: "🪨",
  photo_finish: "📸",
  rollercoaster: "🎢",
  on_fire: "🔥",
  big_spender: "💸",
  sucker_bid: "🍭",
  one_that_got_away: "🎣",
  going_down_with_the_ship: "🚢",
  hoarder: "🛒",
  dumpster_diver: "🗑️",
  waiver_mvp: "💎",
  commitment_issues: "💔",
  kiss_of_death: "💋",
  coattail_rider: "🧥",
  sole_survivor_whisperer: "🗣️",
  the_oracle: "🔮",
  lone_wolf: "🐺",
  black_sheep: "🐑",
  participation_trophy: "🎗️",
  immunity_magnet: "🧲",
  blindside_victim: "🔪",
  jinx: "🐈‍⬛",
};

export function getAwardDefinition(key: string): AwardDefinition | undefined {
  return AWARD_CATALOGUE.find((a) => a.key === key);
}

/**
 * Evaluates every award. Returns all awards Unclaimed when the league is too
 * small or has no finalized episodes. Does not modify the input.
 */
export function computeAwards(input: AwardsInput): AwardResult[] {
  const empty =
    input.players.length < T.minPlayers || input.finalizedEpisodes.length === 0;
  if (empty) {
    return AWARD_CATALOGUE.map((a) => ({
      key: a.key,
      candidates: [],
      winners: [],
      unclaimed: true,
    }));
  }
  const history = buildStandingsHistory(input);
  const ctx: AwardContext = { input, history };
  return AWARD_CATALOGUE.map((a) => {
    const candidates = sortCandidates(a.evaluate(ctx), a.direction);
    const winners = pickWinners(candidates, a.direction);
    return { key: a.key, candidates, winners, unclaimed: winners.length === 0 };
  });
}

/** Flattens Winners into one row per player per award, for saving. */
export function flattenWinners(results: AwardResult[]): AwardRow[] {
  const rows: AwardRow[] = [];
  for (const r of results) {
    for (const w of r.winners) {
      rows.push({
        award_key: r.key,
        player_id: w.player_id,
        stat_value: w.value,
        stat_detail: w.detail,
      });
    }
  }
  return rows;
}
