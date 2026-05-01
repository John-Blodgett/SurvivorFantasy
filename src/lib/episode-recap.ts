/**
 * Pure episode recap logic — no Supabase calls, fully testable.
 * Requirements: 10.1, 10.2, 10.3
 */

export interface RecapEvent {
  id: string;
  castaway_id: string;
  castaway_name: string;
  scoring_rule_name: string | null;
  points: number;
  benefiting_player_name: string | null;
}

export interface RecapEpisode {
  episode_id: string;
  number: number;
  title: string | null;
  finalized_at: string | null;
}

export interface CastawayEventGroup {
  castaway_id: string;
  castaway_name: string;
  events: Array<{
    id: string;
    rule_name: string | null;
    points: number;
    benefiting_player_name: string | null;
  }>;
  total_points: number;
}

/**
 * Groups episode events by castaway for the recap display.
 * Returns groups sorted by castaway name alphabetically.
 *
 * Requirements: 10.1, 10.2
 */
export function groupEventsByCastaway(events: RecapEvent[]): CastawayEventGroup[] {
  const groupMap = new Map<string, CastawayEventGroup>();

  for (const event of events) {
    let group = groupMap.get(event.castaway_id);
    if (!group) {
      group = {
        castaway_id: event.castaway_id,
        castaway_name: event.castaway_name,
        events: [],
        total_points: 0,
      };
      groupMap.set(event.castaway_id, group);
    }

    group.events.push({
      id: event.id,
      rule_name: event.scoring_rule_name,
      points: event.points,
      benefiting_player_name: event.benefiting_player_name,
    });
    group.total_points += event.points;
  }

  return Array.from(groupMap.values()).sort((a, b) =>
    a.castaway_name.localeCompare(b.castaway_name)
  );
}

/**
 * Filters episode events to only those belonging to a specific episode.
 * Returns all and only events for that episode.
 *
 * Requirements: 10.1, 10.2
 */
export function getEventsForEpisode(
  allEvents: Array<{ id: string; episode_id: string; [key: string]: unknown }>,
  episodeId: string
): Array<{ id: string; episode_id: string; [key: string]: unknown }> {
  return allEvents.filter((e) => e.episode_id === episodeId);
}

/**
 * Sorts episodes in reverse chronological order (highest episode number first).
 *
 * Requirements: 10.3
 */
export function sortEpisodesDescending(episodes: RecapEpisode[]): RecapEpisode[] {
  return [...episodes].sort((a, b) => b.number - a.number);
}
