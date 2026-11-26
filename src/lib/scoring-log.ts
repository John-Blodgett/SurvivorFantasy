/**
 * Display helpers for the Scoring Log page. Pure functions, no Supabase.
 */

export interface LogEventBase {
  id: string;
  episode_number: number;
  castaway_id: string;
  rule_name: string;
  player_id: string | null;
  points: number;
  is_alliance: boolean;
}

export type CondensedLogEvent<T extends LogEventBase> = T & { count: number };

/**
 * Merges duplicate castaway events into one row per
 * (episode, castaway, rule, player). The merged row keeps the first event's
 * fields and position, sums the points, and records how many events it covers.
 *
 * Challenge rows (no castaway) and alliance rows are never merged.
 * Input order is preserved based on each group's first occurrence.
 */
export function condenseLogEvents<T extends LogEventBase>(
  events: T[]
): CondensedLogEvent<T>[] {
  const result: CondensedLogEvent<T>[] = [];
  const groups = new Map<string, CondensedLogEvent<T>>();

  for (const event of events) {
    if (!event.castaway_id || event.is_alliance) {
      result.push({ ...event, count: 1 });
      continue;
    }

    const key = [
      event.episode_number,
      event.castaway_id,
      event.rule_name,
      event.player_id ?? "",
    ].join("|");

    const existing = groups.get(key);
    if (existing) {
      existing.points += event.points;
      existing.count += 1;
    } else {
      const row = { ...event, count: 1 };
      groups.set(key, row);
      result.push(row);
    }
  }

  return result;
}

/** Rule label with a "×N" suffix when the row covers more than one event. */
export function formatRuleLabel(ruleName: string, count: number): string {
  return count > 1 ? `${ruleName} ×${count}` : ruleName;
}
