/**
 * Pure logic for the Live Tally scoring mode. No Supabase, no DOM.
 *
 * During an episode the admin taps to count events per castaway and rule.
 * Counts live on the device (localStorage) until the admin reviews and
 * submits them, at which point they become ordinary episode events.
 */

/** Highest count allowed for one castaway and rule in a single submission. */
export const MAX_TALLY_COUNT = 200;

export interface TallyState {
  version: 1;
  /** Count per `${castawayId}|${ruleId}`. */
  counts: Record<string, number>;
  /** Keys in tap order, for "Undo last". */
  history: string[];
  /** Added (non-default) rules the admin switched off for this episode. */
  hiddenRuleIds: string[];
}

export interface TallyEntry {
  castaway_id: string;
  rule_id: string;
  count: number;
}

export interface TallyRule {
  id: string;
  name: string;
  points: number;
  is_default: boolean;
}

export function emptyTally(): TallyState {
  return { version: 1, counts: {}, history: [], hiddenRuleIds: [] };
}

export function tallyKey(castawayId: string, ruleId: string): string {
  return `${castawayId}|${ruleId}`;
}

function splitKey(key: string): { castaway_id: string; rule_id: string } {
  const i = key.indexOf("|");
  return { castaway_id: key.slice(0, i), rule_id: key.slice(i + 1) };
}

export function countOf(state: TallyState, castawayId: string, ruleId: string): number {
  return state.counts[tallyKey(castawayId, ruleId)] ?? 0;
}

/** Adds one tap. Ignored once the count reaches MAX_TALLY_COUNT. */
export function increment(state: TallyState, castawayId: string, ruleId: string): TallyState {
  const key = tallyKey(castawayId, ruleId);
  const current = state.counts[key] ?? 0;
  if (current >= MAX_TALLY_COUNT) return state;
  return {
    ...state,
    counts: { ...state.counts, [key]: current + 1 },
    history: [...state.history, key],
  };
}

/** Removes one tap for this castaway and rule (no-op at zero). */
export function decrement(state: TallyState, castawayId: string, ruleId: string): TallyState {
  const key = tallyKey(castawayId, ruleId);
  const current = state.counts[key] ?? 0;
  if (current <= 0) return state;
  const counts = { ...state.counts };
  if (current === 1) delete counts[key];
  else counts[key] = current - 1;
  const idx = state.history.lastIndexOf(key);
  const history = idx >= 0 ? [...state.history.slice(0, idx), ...state.history.slice(idx + 1)] : state.history;
  return { ...state, counts, history };
}

/** Reverses the most recent tap, whichever castaway it was. */
export function undoLast(state: TallyState): TallyState {
  const key = state.history[state.history.length - 1];
  if (!key) return state;
  const { castaway_id, rule_id } = splitKey(key);
  return decrement(state, castaway_id, rule_id);
}

/** What the last tap was, for the Undo button label. */
export function lastTap(state: TallyState): { castaway_id: string; rule_id: string } | null {
  const key = state.history[state.history.length - 1];
  return key ? splitKey(key) : null;
}

export function toggleRuleHidden(state: TallyState, ruleId: string): TallyState {
  const hidden = state.hiddenRuleIds.includes(ruleId)
    ? state.hiddenRuleIds.filter((id) => id !== ruleId)
    : [...state.hiddenRuleIds, ruleId];
  return { ...state, hiddenRuleIds: hidden };
}

/** Rules shown as quick buttons: the admin's added rules that are switched on. */
export function quickRules<T extends TallyRule>(rules: T[], state: TallyState): T[] {
  return rules.filter((r) => !r.is_default && !state.hiddenRuleIds.includes(r.id));
}

/** Rules under "More": everything that isn't a quick button. */
export function moreRules<T extends TallyRule>(rules: T[], state: TallyState): T[] {
  const quick = new Set(quickRules(rules, state).map((r) => r.id));
  return rules.filter((r) => !quick.has(r.id));
}

/** Non-zero counts as a list, sorted for stable display and submission. */
export function tallyEntries(state: TallyState): TallyEntry[] {
  return Object.entries(state.counts)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => ({ ...splitKey(key), count }))
    .sort((a, b) => a.castaway_id.localeCompare(b.castaway_id) || a.rule_id.localeCompare(b.rule_id));
}

/** Total taps and points for a tally, using the given rule points. */
export function tallyTotals(
  state: TallyState,
  rulePoints: Map<string, number>
): { taps: number; points: number } {
  let taps = 0;
  let points = 0;
  for (const e of tallyEntries(state)) {
    taps += e.count;
    points += e.count * (rulePoints.get(e.rule_id) ?? 0);
  }
  return { taps, points };
}

export function storageKey(leagueId: string, episodeNumber: number): string {
  return `live-tally:${leagueId}:${episodeNumber}`;
}

/** Reads a stored tally defensively. Anything malformed becomes an empty tally. */
export function parseStoredTally(raw: string | null): TallyState {
  if (!raw) return emptyTally();
  try {
    const data = JSON.parse(raw) as Partial<TallyState>;
    if (!data || data.version !== 1 || typeof data.counts !== "object" || data.counts === null) {
      return emptyTally();
    }
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(data.counts)) {
      if (
        key.includes("|") &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        value > 0 &&
        value <= MAX_TALLY_COUNT
      ) {
        counts[key] = value;
      }
    }
    const history = Array.isArray(data.history)
      ? data.history.filter((k): k is string => typeof k === "string" && k in counts)
      : [];
    const hiddenRuleIds = Array.isArray(data.hiddenRuleIds)
      ? data.hiddenRuleIds.filter((k): k is string => typeof k === "string")
      : [];
    return { version: 1, counts, history, hiddenRuleIds };
  } catch {
    return emptyTally();
  }
}

export interface ValidatedTallyRow {
  castaway_id: string;
  rule_id: string;
  points: number;
  count: number;
}

/**
 * Validates a submitted tally against the league's castaways and rules.
 * Points always come from the server's rule list, never from the client.
 */
export function validateTallySubmission(
  entries: unknown,
  validCastawayIds: Set<string>,
  rulePoints: Map<string, number>
): { valid: true; rows: ValidatedTallyRow[] } | { valid: false; error: string } {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { valid: false, error: "The tally is empty." };
  }
  const merged = new Map<string, ValidatedTallyRow>();
  for (const raw of entries) {
    const e = raw as Partial<TallyEntry> | null;
    if (!e || typeof e.castaway_id !== "string" || typeof e.rule_id !== "string") {
      return { valid: false, error: "The tally has an invalid entry." };
    }
    if (!validCastawayIds.has(e.castaway_id)) {
      return { valid: false, error: "The tally includes a castaway that isn't in this league." };
    }
    const points = rulePoints.get(e.rule_id);
    if (points === undefined) {
      return { valid: false, error: "The tally includes a rule that no longer exists." };
    }
    if (typeof e.count !== "number" || !Number.isInteger(e.count) || e.count < 1) {
      return { valid: false, error: "Tally counts must be whole numbers of 1 or more." };
    }
    const key = tallyKey(e.castaway_id, e.rule_id);
    const existing = merged.get(key);
    const count = (existing?.count ?? 0) + e.count;
    if (count > MAX_TALLY_COUNT) {
      return { valid: false, error: `A single count can't be more than ${MAX_TALLY_COUNT}.` };
    }
    merged.set(key, { castaway_id: e.castaway_id, rule_id: e.rule_id, points, count });
  }
  return { valid: true, rows: Array.from(merged.values()) };
}

/** One episode event per tap, ready to insert. */
export function expandTallyToEvents(
  episodeId: string,
  rows: ValidatedTallyRow[]
): { episode_id: string; castaway_id: string; scoring_rule_id: string; points: number }[] {
  const events: { episode_id: string; castaway_id: string; scoring_rule_id: string; points: number }[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.count; i++) {
      events.push({
        episode_id: episodeId,
        castaway_id: r.castaway_id,
        scoring_rule_id: r.rule_id,
        points: r.points,
      });
    }
  }
  return events;
}
