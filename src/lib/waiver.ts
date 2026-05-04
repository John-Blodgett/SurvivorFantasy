/**
 * Pure waiver wire logic — no Supabase calls, fully testable.
 * Requirements: 18.1, 18.3, 18.4, 18.5, 18.6, 18.8, 18.9, 18.10
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface WaiverCastaway {
  id: string;
  is_eliminated: boolean;
}

export interface WaiverTeamAssignment {
  castaway_id: string;
  player_id: string;
}

export interface WaiverClaimInput {
  league_id: string;
  player_id: string;
  castaway_id: string;
  drop_castaway_id: string;
  bid_amount: number;
}

export interface WaiverClaimValidationContext {
  playerBudgetRemaining: number;
  playerTeamCastawayIds: string[]; // castaways currently on the player's team
  allTeamAssignments: WaiverTeamAssignment[]; // all assignments in the league
  castaways: WaiverCastaway[]; // all castaways in the league
}

export interface WaiverClaimValidationResult {
  valid: boolean;
  error?: string;
}

export interface WaiverClaim {
  id: string;
  league_id: string;
  player_id: string;
  castaway_id: string;
  drop_castaway_id: string;
  bid_amount: number;
  priority: number;
  status: "pending" | "won" | "lost";
}

export interface ProcessedClaimResult {
  claim_id: string;
  status: "won" | "lost";
  budget_deducted: number;
}

export interface WaiverProcessingResult {
  results: ProcessedClaimResult[];
  newAssignments: {
    player_id: string;
    castaway_id: string;
    drop_castaway_id: string;
    points_from_episode: number;
  }[];
}

// ---------------------------------------------------------------------------
// Waiver wire pool query (pure logic)
// ---------------------------------------------------------------------------

/**
 * Returns all castaways that are on the waiver wire:
 * - Not assigned to any team
 * - Not eliminated
 *
 * Requirements: 18.1
 */
export function getWaiverWire(
  allCastaways: WaiverCastaway[],
  allTeamAssignments: WaiverTeamAssignment[]
): WaiverCastaway[] {
  const assignedCastawayIds = new Set(
    allTeamAssignments.map((a) => a.castaway_id)
  );

  return allCastaways.filter(
    (c) => !c.is_eliminated && !assignedCastawayIds.has(c.id)
  );
}

// ---------------------------------------------------------------------------
// Waiver claim validation
// ---------------------------------------------------------------------------

/**
 * Validates a waiver claim before submission.
 *
 * Requirements: 18.3, 18.10
 */
export function validateWaiverClaim(
  input: WaiverClaimInput,
  context: WaiverClaimValidationContext
): WaiverClaimValidationResult {
  // Check bid amount is a non-negative integer within budget
  if (!Number.isInteger(input.bid_amount) || input.bid_amount < 0) {
    return { valid: false, error: "Bid amount must be a non-negative whole number." };
  }

  if (input.bid_amount > context.playerBudgetRemaining) {
    return { valid: false, error: "Bid amount exceeds your remaining waiver budget." };
  }

  // Check player has at least one castaway to drop
  if (context.playerTeamCastawayIds.length === 0) {
    return {
      valid: false,
      error: "You must have at least one castaway on your team to submit a waiver claim.",
    };
  }

  // Check the drop castaway is on the player's team
  if (!context.playerTeamCastawayIds.includes(input.drop_castaway_id)) {
    return { valid: false, error: "You do not own the castaway you are trying to drop." };
  }

  // Check the target castaway exists and is not eliminated
  const targetCastaway = context.castaways.find((c) => c.id === input.castaway_id);
  if (!targetCastaway) {
    return { valid: false, error: "Target castaway not found." };
  }

  if (targetCastaway.is_eliminated) {
    return { valid: false, error: "Eliminated castaways are not available on the waiver wire." };
  }

  // Check the target castaway is not already on a team
  const assignedCastawayIds = new Set(
    context.allTeamAssignments.map((a) => a.castaway_id)
  );
  if (assignedCastawayIds.has(input.castaway_id)) {
    return { valid: false, error: "This castaway is not available on the waiver wire." };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Waiver claim processing
// ---------------------------------------------------------------------------

/**
 * Processes all pending waiver claims for a league.
 *
 * Processing order:
 * 1. Group claims by target castaway
 * 2. For each target, pick the winner by highest bid (priority as tiebreak, then random)
 * 3. When a player wins a claim, invalidate their lower-priority claims that
 *    share the same drop castaway (since that castaway is no longer available to drop)
 *
 * Requirements: 18.4, 18.5, 18.6, 18.8, 18.9
 *
 * @param claims - All pending claims to process (should include priority field)
 * @param nextEpisodeNumber - The episode number to set as points_from_episode for new assignments
 * @param randomTiebreak - Function to pick a winner index from tied claims (for testability)
 */
export function processWaiverClaims(
  claims: WaiverClaim[],
  nextEpisodeNumber: number,
  randomTiebreak: (count: number) => number = (count) =>
    Math.floor(Math.random() * count)
): WaiverProcessingResult {
  if (claims.length === 0) {
    return { results: [], newAssignments: [] };
  }

  const results: ProcessedClaimResult[] = [];
  const newAssignments: WaiverProcessingResult["newAssignments"] = [];

  // Track which castaways have been won (no longer available)
  const wonCastawayIds = new Set<string>();
  // Track which drop castaways have been used by each player
  const usedDropsByPlayer = new Map<string, Set<string>>();

  // Sort all claims: highest bid first, then lowest priority number (highest priority), then random
  const sortedClaims = [...claims].sort((a, b) => {
    if (b.bid_amount !== a.bid_amount) return b.bid_amount - a.bid_amount;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return 0;
  });

  // Group by target castaway, preserving sort order within groups
  const claimsByTarget = new Map<string, WaiverClaim[]>();
  for (const claim of sortedClaims) {
    const group = claimsByTarget.get(claim.castaway_id) ?? [];
    group.push(claim);
    claimsByTarget.set(claim.castaway_id, group);
  }

  // Process each target castaway group
  for (const [castawayId, groupClaims] of Array.from(claimsByTarget.entries())) {
    // Filter out claims from players whose drop castaway is already used
    const eligibleClaims = groupClaims.filter((c) => {
      const usedDrops = usedDropsByPlayer.get(c.player_id);
      return !usedDrops?.has(c.drop_castaway_id);
    });

    if (eligibleClaims.length === 0) {
      // All claims for this castaway are invalid — mark them lost
      for (const claim of groupClaims) {
        if (!results.some((r) => r.claim_id === claim.id)) {
          results.push({ claim_id: claim.id, status: "lost", budget_deducted: 0 });
        }
      }
      continue;
    }

    // Find the highest bid among eligible claims
    const maxBid = Math.max(...eligibleClaims.map((c) => c.bid_amount));
    const tiedClaims = eligibleClaims.filter((c) => c.bid_amount === maxBid);

    // Among tied bids, pick by priority (lowest number = highest priority)
    const bestPriority = Math.min(...tiedClaims.map((c) => c.priority));
    const priorityTied = tiedClaims.filter((c) => c.priority === bestPriority);

    // Random tiebreak if still tied
    const winnerIndex = priorityTied.length === 1 ? 0 : randomTiebreak(priorityTied.length);
    const winner = priorityTied[winnerIndex];

    // Mark winner
    results.push({
      claim_id: winner.id,
      status: "won",
      budget_deducted: winner.bid_amount,
    });

    newAssignments.push({
      player_id: winner.player_id,
      castaway_id: castawayId,
      drop_castaway_id: winner.drop_castaway_id,
      points_from_episode: nextEpisodeNumber,
    });

    wonCastawayIds.add(castawayId);

    // Track that this player used this drop castaway
    if (!usedDropsByPlayer.has(winner.player_id)) {
      usedDropsByPlayer.set(winner.player_id, new Set());
    }
    usedDropsByPlayer.get(winner.player_id)!.add(winner.drop_castaway_id);

    // Mark all other claims for this castaway as lost
    for (const claim of groupClaims) {
      if (claim.id !== winner.id && !results.some((r) => r.claim_id === claim.id)) {
        results.push({ claim_id: claim.id, status: "lost", budget_deducted: 0 });
      }
    }
  }

  // Mark any remaining unprocessed claims as lost
  for (const claim of claims) {
    if (!results.some((r) => r.claim_id === claim.id)) {
      results.push({ claim_id: claim.id, status: "lost", budget_deducted: 0 });
    }
  }

  return { results, newAssignments };
}
