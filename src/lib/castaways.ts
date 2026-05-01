/**
 * Pure castaway logic — no Supabase calls, fully testable.
 * Requirements: 3.1, 3.2
 */

export interface Castaway {
  id: string;
  league_id: string;
  name: string;
  tribe: string | null;
  photo_url: string | null;
  is_eliminated: boolean;
  eliminated_episode: number | null;
  created_at: string;
}

export interface CreateCastawayInput {
  name: string;
  tribe: string;
  photo_url: string | null;
}

export interface CreateCastawayResult {
  valid: boolean;
  error?: string;
}

/** Validates castaway creation input. */
export function validateCreateCastaway(
  input: CreateCastawayInput
): CreateCastawayResult {
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: "Castaway name is required." };
  }
  return { valid: true };
}
