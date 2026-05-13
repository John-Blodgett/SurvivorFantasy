/**
 * Integration test lifecycle manager — cleanup and seeding routines for the
 * Fantasy Survivor integration test suite.
 *
 * Provides:
 *  - cleanup()       — deletes all test league data in FK-safe order
 *  - seed()          — creates test league, members, castaways, scoring rules
 *  - getLeagueId()   — retrieves the current test league UUID
 *  - getPlayerIds()  — retrieves test player UUIDs ordered by joined_at
 *  - getCastawayIds() — retrieves test castaway UUIDs ordered by name
 */

import { getAdminClient, createTestUser, getTestUser } from "./supabase";
import { TEST_LEAGUE, TEST_PLAYERS, TEST_CASTAWAYS } from "./constants";

// ---------------------------------------------------------------------------
// Cleanup — FK-safe deletion of all test league data
// ---------------------------------------------------------------------------

/**
 * Deletes all data associated with the integration test league in FK-safe
 * order (children before parents). Scoped exclusively to the league with
 * name = "Integ Test League" AND season_number = 99.
 *
 * If the league does not exist, this is a no-op.
 */
export async function cleanup(): Promise<void> {
  const admin = getAdminClient();

  // Find ALL test leagues (there may be multiple from failed/parallel runs)
  const { data: leagues } = await admin
    .from("leagues")
    .select("id")
    .eq("name", TEST_LEAGUE.name)
    .eq("season_number", TEST_LEAGUE.season_number);

  if (!leagues || leagues.length === 0) {
    return;
  }

  const leagueIds = leagues.map((l) => l.id);

  // Batch delete in FK-safe order across ALL test leagues at once
  // 1. challenge_submissions
  const { data: challenges } = await admin
    .from("challenges")
    .select("id")
    .in("league_id", leagueIds);
  if (challenges && challenges.length > 0) {
    const challengeIds = challenges.map((c: { id: string }) => c.id);
    await admin.from("challenge_submissions").delete().in("challenge_id", challengeIds);
  }

  // 2. challenges
  await admin.from("challenges").delete().in("league_id", leagueIds);

  // 3. waiver_claims
  await admin.from("waiver_claims").delete().in("league_id", leagueIds);

  // 4. episode_events
  const { data: episodes } = await admin
    .from("episodes")
    .select("id")
    .in("league_id", leagueIds);
  if (episodes && episodes.length > 0) {
    const episodeIds = episodes.map((e: { id: string }) => e.id);
    await admin.from("episode_events").delete().in("episode_id", episodeIds);
  }

  // 5. episodes
  await admin.from("episodes").delete().in("league_id", leagueIds);

  // 6. trades
  await admin.from("trades").delete().in("league_id", leagueIds);

  // 7. team_assignments
  await admin.from("team_assignments").delete().in("league_id", leagueIds);

  // 8. draft_picks
  const { data: drafts } = await admin
    .from("drafts")
    .select("id")
    .in("league_id", leagueIds);
  if (drafts && drafts.length > 0) {
    const draftIds = drafts.map((d: { id: string }) => d.id);
    await admin.from("draft_picks").delete().in("draft_id", draftIds);
  }

  // 9. draft_preferences
  await admin.from("draft_preferences").delete().in("league_id", leagueIds);

  // 10. drafts
  await admin.from("drafts").delete().in("league_id", leagueIds);

  // 11. scoring_rules
  await admin.from("scoring_rules").delete().in("league_id", leagueIds);

  // 12. castaways
  await admin.from("castaways").delete().in("league_id", leagueIds);

  // 13. league_members
  await admin.from("league_members").delete().in("league_id", leagueIds);

  // 14. leagues
  await admin.from("leagues").delete().in("id", leagueIds);
}

// ---------------------------------------------------------------------------
// Seed — create test league with full configuration
// ---------------------------------------------------------------------------

/**
 * Creates the integration test league with:
 *  - 1 league row (TEST_LEAGUE config)
 *  - 10 league members (Player 1 as admin via leagues.admin_id)
 *  - 30 castaways (Alpha/Beta/Gamma tribes)
 *  - Default scoring rules via seed_default_scoring_rules RPC
 *
 * Returns the league ID, player IDs (ordered by joined_at), and castaway IDs
 * (ordered by name).
 */
export async function seed(): Promise<{
  leagueId: string;
  playerIds: string[];
  castawayIds: string[];
}> {
  const admin = getAdminClient();

  // --- Ensure all test users exist in Supabase Auth ---
  const playerIds: string[] = [];

  for (const player of TEST_PLAYERS) {
    const existing = await getTestUser(player.email);
    if (existing) {
      playerIds.push(existing.id);
    } else {
      const id = await createTestUser(player.email, player.password);
      playerIds.push(id);
    }
  }

  // --- Ensure profiles exist for each user ---
  for (let i = 0; i < TEST_PLAYERS.length; i++) {
    await admin.from("profiles").upsert(
      {
        id: playerIds[i],
        display_name: TEST_PLAYERS[i].display_name,
      },
      { onConflict: "id" }
    );
  }

  // --- Create the league ---
  const { data: league, error: leagueError } = await admin
    .from("leagues")
    .insert({
      name: TEST_LEAGUE.name,
      season_number: TEST_LEAGUE.season_number,
      roster_size: TEST_LEAGUE.roster_size,
      consolation_points: TEST_LEAGUE.consolation_points,
      waiver_budget: TEST_LEAGUE.waiver_budget,
      draft_mode: TEST_LEAGUE.draft_mode,
      pick_timer_seconds: TEST_LEAGUE.pick_timer_seconds,
      admin_id: playerIds[0], // Player 1 is admin
      invite_code: `integ-test-${Date.now()}`, // Unique invite code
    })
    .select("id")
    .single();

  if (leagueError || !league) {
    throw new Error(
      `Failed to create test league: ${leagueError?.message ?? "no data returned"}`
    );
  }

  const leagueId = league.id;

  // --- Insert league members with staggered joined_at for deterministic ordering ---
  const baseTime = new Date("2024-01-01T00:00:00Z");

  for (let i = 0; i < TEST_PLAYERS.length; i++) {
    const joinedAt = new Date(baseTime.getTime() + i * 60_000); // 1 minute apart

    const { error: memberError } = await admin.from("league_members").insert({
      league_id: leagueId,
      player_id: playerIds[i],
      joined_at: joinedAt.toISOString(),
      waiver_budget_remaining: TEST_LEAGUE.waiver_budget,
    });

    if (memberError) {
      throw new Error(
        `Failed to insert league member ${TEST_PLAYERS[i].email}: ${memberError.message}`
      );
    }
  }

  // --- Insert 30 castaways ---
  const castawayRows = TEST_CASTAWAYS.map((c) => ({
    league_id: leagueId,
    name: c.name,
    tribe: c.tribe,
  }));

  const { data: castaways, error: castawayError } = await admin
    .from("castaways")
    .insert(castawayRows)
    .select("id, name")
    .order("name", { ascending: true });

  if (castawayError || !castaways) {
    throw new Error(
      `Failed to insert castaways: ${castawayError?.message ?? "no data returned"}`
    );
  }

  const castawayIds = castaways.map((c: { id: string }) => c.id);

  // --- Seed default scoring rules via RPC ---
  const { error: rpcError } = await admin.rpc("seed_default_scoring_rules", {
    p_league_id: leagueId,
  });

  if (rpcError) {
    throw new Error(
      `Failed to seed scoring rules: ${rpcError.message}`
    );
  }

  return { leagueId, playerIds, castawayIds };
}

// ---------------------------------------------------------------------------
// Helper Queries
// ---------------------------------------------------------------------------

/**
 * Retrieves the UUID of the integration test league.
 * Throws if the league does not exist.
 */
export async function getLeagueId(): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("leagues")
    .select("id")
    .eq("name", TEST_LEAGUE.name)
    .eq("season_number", TEST_LEAGUE.season_number)
    .single();

  if (error || !data) {
    throw new Error(
      `Test league not found: ${error?.message ?? "no data returned"}`
    );
  }

  return data.id;
}

/**
 * Retrieves the player UUIDs (user_ids) for the test league, ordered by
 * joined_at ascending. This matches the snake draft order.
 */
export async function getPlayerIds(): Promise<string[]> {
  const admin = getAdminClient();
  const leagueId = await getLeagueId();

  const { data, error } = await admin
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  if (error || !data) {
    throw new Error(
      `Failed to retrieve player IDs: ${error?.message ?? "no data returned"}`
    );
  }

  return data.map((row: { player_id: string }) => row.player_id);
}

/**
 * Retrieves the castaway UUIDs for the test league, ordered by name ascending.
 * This provides a deterministic ordering for test assertions.
 */
export async function getCastawayIds(): Promise<string[]> {
  const admin = getAdminClient();
  const leagueId = await getLeagueId();

  const { data, error } = await admin
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  if (error || !data) {
    throw new Error(
      `Failed to retrieve castaway IDs: ${error?.message ?? "no data returned"}`
    );
  }

  return data.map((row: { id: string }) => row.id);
}
