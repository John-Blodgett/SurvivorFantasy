/**
 * Pure trade logic — no Supabase calls, fully testable.
 * Requirements: 13.1, 13.2, 13.6
 */

export interface TradeProposalInput {
  proposer_id: string;
  receiver_id: string;
  proposer_castaway_id: string;
  receiver_castaway_id: string;
}

export interface CastawayForTrade {
  id: string;
  is_eliminated: boolean;
  owner_id: string; // the player who currently owns this castaway
}

export interface TradeValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a trade proposal.
 * - Both castaways must be active (not eliminated)
 * - Must be 1-for-1 (enforced by the interface)
 * - Proposer must own proposer_castaway, receiver must own receiver_castaway
 * - Proposer and receiver must be different players
 *
 * Requirements: 13.1, 13.6
 */
export function validateTradeProposal(
  input: TradeProposalInput,
  proposerCastaway: CastawayForTrade | null,
  receiverCastaway: CastawayForTrade | null
): TradeValidationResult {
  if (input.proposer_id === input.receiver_id) {
    return { valid: false, error: "Cannot trade with yourself." };
  }

  if (input.proposer_castaway_id === input.receiver_castaway_id) {
    return { valid: false, error: "Cannot trade the same castaway." };
  }

  if (!proposerCastaway) {
    return { valid: false, error: "Proposer's castaway not found." };
  }

  if (!receiverCastaway) {
    return { valid: false, error: "Receiver's castaway not found." };
  }

  if (proposerCastaway.is_eliminated) {
    return { valid: false, error: "Eliminated castaways cannot be traded." };
  }

  if (receiverCastaway.is_eliminated) {
    return { valid: false, error: "Eliminated castaways cannot be traded." };
  }

  if (proposerCastaway.owner_id !== input.proposer_id) {
    return { valid: false, error: "You do not own the castaway you are offering." };
  }

  if (receiverCastaway.owner_id !== input.receiver_id) {
    return { valid: false, error: "The other player does not own the castaway you are requesting." };
  }

  return { valid: true };
}
