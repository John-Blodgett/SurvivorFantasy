/**
 * Pure draft logic — no Supabase calls, fully testable.
 * Requirements: 4.2, 4.3, 4.6, 4.7, 4.8, 4.9
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftPreference {
  player_id: string;
  castaway_id: string;
  rank: number; // lower = higher preference
}

export interface DraftPick {
  player_id: string;
  castaway_id: string;
  pick_number: number; // 1-based
}

export interface DraftMember {
  player_id: string;
  joined_at: string;
  draft_position: number | null;
}

// ---------------------------------------------------------------------------
// orderPlayersForDraft
// ---------------------------------------------------------------------------

/**
 * Determines the base draft order (round-1 pick order) for a set of league
 * members.
 *
 * Ordering rules:
 *  - Members with an explicit `draft_position` come first, sorted ascending.
 *  - Members without a `draft_position` (null) are sorted last, ordered by
 *    `joined_at` ascending.
 *  - `joined_at` breaks ties between members sharing a draft_position.
 *
 * Returns an array of player IDs in draft order.
 */
export function orderPlayersForDraft(members: DraftMember[]): string[] {
  return [...members]
    .sort((a, b) => {
      const aHas = a.draft_position !== null && a.draft_position !== undefined;
      const bHas = b.draft_position !== null && b.draft_position !== undefined;

      if (aHas && bHas) {
        if (a.draft_position !== b.draft_position) {
          return (a.draft_position as number) - (b.draft_position as number);
        }
        return a.joined_at.localeCompare(b.joined_at);
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return a.joined_at.localeCompare(b.joined_at);
    })
    .map((m) => m.player_id);
}

// ---------------------------------------------------------------------------
// generateSnakeOrder
// ---------------------------------------------------------------------------

/**
 * Generates the full snake-order pick sequence for a draft.
 *
 * Snake order: round 1 goes 1→N, round 2 goes N→1, round 3 goes 1→N, etc.
 * Returns an array of player IDs of length (playerIds.length × rosterSize).
 *
 * Requirements: 4.2, 4.7
 */
export function generateSnakeOrder(
  playerIds: string[],
  rosterSize: number
): string[] {
  if (playerIds.length === 0 || rosterSize <= 0) return [];

  const order: string[] = [];
  for (let round = 0; round < rosterSize; round++) {
    const roundOrder = round % 2 === 0 ? playerIds : [...playerIds].reverse();
    order.push(...roundOrder);
  }
  return order;
}

// ---------------------------------------------------------------------------
// autoPickCastaway
// ---------------------------------------------------------------------------

/**
 * Selects the highest-ranked available castaway for a player.
 *
 * - Looks through the player's preferences (sorted by rank ascending) and
 *   returns the first castaway that is not already drafted and is in the
 *   available pool.
 * - If the player has no preferences or all preferred castaways are gone,
 *   falls back to the first available castaway sorted alphabetically by ID.
 *
 * Returns null if no castaways are available.
 *
 * Requirements: 4.3, 4.6
 */
export function autoPickCastaway(
  preferences: DraftPreference[],
  draftedIds: Set<string>,
  availableCastawayIds: string[]
): string | null {
  if (availableCastawayIds.length === 0) return null;

  const availableSet = new Set(availableCastawayIds);

  // Sort preferences by rank ascending (rank 1 = most preferred)
  const sorted = [...preferences].sort((a, b) => a.rank - b.rank);

  for (const pref of sorted) {
    if (!draftedIds.has(pref.castaway_id) && availableSet.has(pref.castaway_id)) {
      return pref.castaway_id;
    }
  }

  // Fallback: alphabetical by ID among available castaways
  const remaining = availableCastawayIds
    .filter((id) => !draftedIds.has(id))
    .sort();

  return remaining.length > 0 ? remaining[0] : null;
}

// ---------------------------------------------------------------------------
// runAutoDraft
// ---------------------------------------------------------------------------

/**
 * Executes a complete auto draft and returns the ordered list of picks.
 *
 * @param playerIds         - All player IDs in the league (in draft order)
 * @param rosterSize        - Number of castaways each player must draft
 * @param availableCastawayIds - All castaway IDs available for drafting
 * @param allPreferences    - All player preferences across all players
 *
 * Returns an array of DraftPick objects in pick order.
 *
 * Requirements: 4.2, 4.3, 4.9
 */
export function runAutoDraft(
  playerIds: string[],
  rosterSize: number,
  availableCastawayIds: string[],
  allPreferences: DraftPreference[]
): DraftPick[] {
  const snakeOrder = generateSnakeOrder(playerIds, rosterSize);
  const draftedIds = new Set<string>();
  const picks: DraftPick[] = [];

  for (let i = 0; i < snakeOrder.length; i++) {
    const playerId = snakeOrder[i];
    const playerPrefs = allPreferences.filter((p) => p.player_id === playerId);

    const picked = autoPickCastaway(
      playerPrefs,
      draftedIds,
      availableCastawayIds
    );

    if (picked === null) break; // no castaways left

    draftedIds.add(picked);
    picks.push({
      player_id: playerId,
      castaway_id: picked,
      pick_number: i + 1,
    });
  }

  return picks;
}
