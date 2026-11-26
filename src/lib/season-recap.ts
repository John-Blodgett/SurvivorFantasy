/**
 * Pure helpers for the Season Recap page: podium, chart series, and the
 * animation math for the replay chart. No Supabase, no DOM.
 */
import type { StandingsHistory } from "@/lib/awards";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Distinct, readable line colors. Repeats only past 12 players. */
export const PLAYER_COLORS = [
  "#2563eb", // blue
  "#ea580c", // orange
  "#16a34a", // green
  "#dc2626", // red
  "#9333ea", // purple
  "#0891b2", // cyan
  "#db2777", // pink
  "#ca8a04", // gold
  "#4f46e5", // indigo
  "#65a30d", // lime
  "#92400e", // brown
  "#475569", // slate
];

/** Stable color per player: sorted by player id, so a player keeps their color. */
export function assignPlayerColors(playerIds: string[]): Map<string, string> {
  const sorted = Array.from(new Set(playerIds)).sort();
  const colors = new Map<string, string>();
  sorted.forEach((id, i) => colors.set(id, PLAYER_COLORS[i % PLAYER_COLORS.length]));
  return colors;
}

/** Soft background tints for award pictures, cycled by award position. */
export const AWARD_TINTS = [
  "#fef3c7", // amber
  "#e0f2fe", // sky
  "#dcfce7", // green
  "#fce7f3", // pink
  "#ede9fe", // violet
  "#ffedd5", // orange
  "#ccfbf1", // teal
  "#fee2e2", // red
];

/** One or two letters for a player's avatar circle. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

export interface RecapSeries {
  player_id: string;
  display_name: string;
  color: string;
  /** Cumulative totals: index 0 is the start (0), index k is after the k-th episode. */
  totals: number[];
}

export interface RecapChartData {
  /** Finalized episode numbers, ascending. */
  episodes: number[];
  series: RecapSeries[];
}

/** Builds one series per player from the standings history, starting at 0. */
export function buildRecapSeries(
  history: StandingsHistory,
  players: { player_id: string; display_name: string }[]
): RecapChartData {
  const colors = assignPlayerColors(players.map((p) => p.player_id));
  const series = players.map((p) => {
    const weeks = history.standings.get(p.player_id) ?? [];
    return {
      player_id: p.player_id,
      display_name: p.display_name,
      color: colors.get(p.player_id) ?? PLAYER_COLORS[0],
      totals: [0, ...weeks.map((w) => w.total)],
    };
  });
  return { episodes: [...history.weeks], series };
}

// ---------------------------------------------------------------------------
// Podium
// ---------------------------------------------------------------------------

export interface PodiumStep {
  rank: number;
  total: number;
  players: { player_id: string; display_name: string }[];
}

/**
 * Groups the final standings into podium steps for ranks 1 to 3.
 * Ties share a step (competition ranking, so 1, 2, 2 leaves no 3rd step).
 */
export function computePodium(
  entries: { player_id: string; display_name: string; total: number; rank: number }[]
): PodiumStep[] {
  const byRank = new Map<number, PodiumStep>();
  for (const e of entries) {
    if (e.rank > 3) continue;
    const step = byRank.get(e.rank) ?? { rank: e.rank, total: e.total, players: [] };
    step.players.push({ player_id: e.player_id, display_name: e.display_name });
    byRank.set(e.rank, step);
  }
  const steps = Array.from(byRank.values()).sort((a, b) => a.rank - b.rank);
  for (const s of steps) s.players.sort((a, b) => a.display_name.localeCompare(b.display_name));
  return steps;
}

// ---------------------------------------------------------------------------
// Animation math
// ---------------------------------------------------------------------------

/** Smooth start and stop. Maps [0, 1] onto [0, 1]. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/**
 * The value of a series at a playback position. `progress` runs from 0 (start)
 * to the number of episodes (end). Between two episodes the value moves
 * smoothly from one total to the next.
 */
export function valueAt(totals: number[], progress: number): number {
  if (totals.length === 0) return 0;
  const last = totals.length - 1;
  const p = Math.min(last, Math.max(0, progress));
  const seg = Math.floor(p);
  if (seg >= last) return totals[last];
  const frac = easeInOut(p - seg);
  return totals[seg] + (totals[seg + 1] - totals[seg]) * frac;
}

/**
 * Points along a series up to the playback position, as [step, value] pairs.
 * Includes every reached episode plus the moving tip.
 */
export function pointsUpTo(totals: number[], progress: number): [number, number][] {
  if (totals.length === 0) return [];
  const last = totals.length - 1;
  const p = Math.min(last, Math.max(0, progress));
  const points: [number, number][] = [];
  for (let k = 0; k <= Math.floor(p); k++) points.push([k, totals[k]]);
  if (p > Math.floor(p)) points.push([p, valueAt(totals, p)]);
  return points;
}

/** Overall [min, max] across all series, always including 0. */
export function valueRange(series: { totals: number[] }[]): [number, number] {
  let min = 0;
  let max = 0;
  for (const s of series) {
    for (const v of s.totals) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max === min) max = min + 1;
  return [min, max];
}

/**
 * Spreads label positions so they are at least `gap` apart, keeping them
 * inside [top, bottom] and as close to their targets as possible.
 * Returns positions in the input order.
 */
export function spreadLabels(
  targets: number[],
  gap: number,
  top: number,
  bottom: number
): number[] {
  const order = targets.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const placed = order.map((o) => Math.min(bottom, Math.max(top, o.y)));
  for (let k = 1; k < placed.length; k++) {
    if (placed[k] < placed[k - 1] + gap) placed[k] = placed[k - 1] + gap;
  }
  if (placed.length > 0 && placed[placed.length - 1] > bottom) {
    placed[placed.length - 1] = bottom;
    for (let k = placed.length - 2; k >= 0; k--) {
      if (placed[k] > placed[k + 1] - gap) placed[k] = placed[k + 1] - gap;
    }
  }
  const result = new Array<number>(targets.length);
  order.forEach((o, k) => {
    result[o.i] = placed[k];
  });
  return result;
}

/** Nice round tick values for an axis covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}
