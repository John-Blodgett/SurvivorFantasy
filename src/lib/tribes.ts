/**
 * Pure tribe logic — no Supabase calls, fully testable.
 */

export interface Tribe {
  id: string;
  league_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface CreateTribeInput {
  name: string;
  color: string;
}

export interface CreateTribeResult {
  valid: boolean;
  error?: string;
}

/** Validates tribe creation input. */
export function validateCreateTribe(input: CreateTribeInput): CreateTribeResult {
  const name = input.name?.trim() ?? "";

  if (name.length === 0) {
    return { valid: false, error: "Tribe name is required." };
  }

  if (name.length > 50) {
    return { valid: false, error: "Tribe name must be 50 characters or fewer." };
  }

  const color = input.color?.trim() ?? "";
  if (color.length > 0 && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return { valid: false, error: "Color must be a valid hex color (e.g., #FF5733)." };
  }

  return { valid: true };
}

/** Validates tribe update input (same rules as create). */
export function validateUpdateTribe(input: CreateTribeInput): CreateTribeResult {
  return validateCreateTribe(input);
}

/** Builds batch episode event records for all castaways in a tribe. */
export function buildTribeEvents(
  episodeId: string,
  castawayIds: string[],
  ruleId: string,
  points: number
): Array<{ episode_id: string; castaway_id: string; scoring_rule_id: string; points: number }> {
  return castawayIds.map((castawayId) => ({
    episode_id: episodeId,
    castaway_id: castawayId,
    scoring_rule_id: ruleId,
    points,
  }));
}
