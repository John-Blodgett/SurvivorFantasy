/**
 * Pure league logic — no Supabase calls, fully testable.
 * Requirements: 2.1, 2.4, 2.5, 2.6
 */

export interface CreateLeagueInput {
  name: string;
  seasonNumber: number;
  rosterSize: number;
}

export interface CreateLeagueResult {
  valid: boolean;
  error?: string;
}

/** Validates league creation input before hitting the database. */
export function validateCreateLeague(input: CreateLeagueInput): CreateLeagueResult {
  if (!input.name || !input.name.trim()) {
    return { valid: false, error: "League name is required." };
  }
  if (!Number.isInteger(input.seasonNumber) || input.seasonNumber < 1) {
    return { valid: false, error: "Season number must be a positive integer." };
  }
  if (
    !Number.isInteger(input.rosterSize) ||
    input.rosterSize < 1 ||
    input.rosterSize > 20
  ) {
    return { valid: false, error: "Roster size must be between 1 and 20." };
  }
  return { valid: true };
}

/**
 * Generates a short, URL-safe invite code.
 * Uses crypto.randomUUID and takes the first segment for readability.
 * Uniqueness is enforced by the database UNIQUE constraint on invite_code.
 */
export function generateInviteCode(): string {
  // crypto.randomUUID is available in Node 14.17+ and all modern browsers
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}
