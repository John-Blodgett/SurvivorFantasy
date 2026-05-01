import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pure scoring rule logic — no Supabase calls, fully testable.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

export interface ScoringRule {
  id: string;
  league_id: string;
  name: string;
  points: number;
  is_default: boolean;
  created_at: string;
}

export interface CreateScoringRuleInput {
  name: string;
  points: number;
}

export interface ScoringRuleResult {
  valid: boolean;
  error?: string;
}

/** Validates scoring rule creation/update input. */
export function validateScoringRule(input: CreateScoringRuleInput): ScoringRuleResult {
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: "Rule name is required." };
  }
  if (!Number.isInteger(input.points)) {
    return { valid: false, error: "Points must be a whole number." };
  }
  return { valid: true };
}

/**
 * Seeds the default scoring rules for a newly created league by calling
 * the `seed_default_scoring_rules` Postgres function.
 *
 * Requirements: 5.3, 15.1
 */
export async function seedDefaultScoringRules(
  supabase: SupabaseClient,
  leagueId: string
): Promise<void> {
  const { error } = await supabase.rpc("seed_default_scoring_rules", {
    p_league_id: leagueId,
  });

  if (error) {
    throw new Error(`Failed to seed default scoring rules: ${error.message}`);
  }
}
