/**
 * Integration test constants — deterministic test data for the Fantasy Survivor
 * integration test suite. All tests target a dedicated league (season 99) to
 * avoid polluting production data.
 */

// ---------------------------------------------------------------------------
// Test League Configuration
// ---------------------------------------------------------------------------

export const TEST_LEAGUE = {
  name: "Integ Test League",
  season_number: 99,
  roster_size: 2,
  consolation_points: 2,
  waiver_budget: 100,
  draft_mode: "live" as const,
  pick_timer_seconds: 300,
};

// ---------------------------------------------------------------------------
// Test Players (10 players — Player 1 is league admin)
// ---------------------------------------------------------------------------

export const TEST_PLAYERS = Array.from({ length: 10 }, (_, i) => ({
  email: `integ-player-${i + 1}@test.local`,
  password: "TestPassword123!",
  display_name: `Player ${i + 1}`,
  is_admin: i === 0, // Player 1 is admin
}));

// ---------------------------------------------------------------------------
// Test Castaways (30 castaways across 3 tribes: Alpha, Beta, Gamma)
// ---------------------------------------------------------------------------

export const TEST_CASTAWAYS = Array.from({ length: 30 }, (_, i) => ({
  name: `Castaway-${String(i + 1).padStart(2, "0")}`,
  tribe_name: i < 10 ? "Alpha" : i < 20 ? "Beta" : "Gamma",
}));

// ---------------------------------------------------------------------------
// Environment Variable Validation
// ---------------------------------------------------------------------------

/**
 * Validates that all required environment variables are present for integration
 * tests. Throws a descriptive error if any are missing.
 *
 * Required:
 *  - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) — Supabase project URL
 *  - SUPABASE_SERVICE_ROLE_KEY — service role key for admin operations
 *  - NEXT_PUBLIC_SUPABASE_ANON_KEY — anon key for scoped (RLS-enforced) clients
 */
export function ensureEnvVars(): {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
} {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];

  if (!supabaseUrl) {
    missing.push(
      "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL (Supabase project URL)"
    );
  }

  if (!serviceRoleKey) {
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY (service role key for admin/bypass-RLS operations)"
    );
  }

  if (!anonKey) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (anon key for scoped/RLS-enforced clients)"
    );
  }

  if (missing.length > 0) {
    throw new Error(
      [
        "Integration tests require the following environment variables to be set:",
        ...missing.map((v) => `  • ${v}`),
        "",
        "Ensure these are defined in .env.local or your CI environment.",
      ].join("\n")
    );
  }

  return {
    supabaseUrl: supabaseUrl!,
    serviceRoleKey: serviceRoleKey!,
    anonKey: anonKey!,
  };
}
