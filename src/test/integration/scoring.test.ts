/**
 * Integration Tests: Episode Scoring & Finalization
 *
 * Exercises the full scoring lifecycle against a live Supabase database:
 * - Episode auto-creation when adding events
 * - Event validation (correct fields, finalized episode rejection)
 * - Finalization (player_id stamping, consolation events)
 * - Unfinalization (consolation deletion, manual events preserved)
 * - Consolation accumulation across multiple episodes
 * - Event removal (unfinalized OK, finalized rejected)
 *
 * Server action references:
 * - src/app/league/[id]/admin/episode/[num]/actions.ts
 *     (addEpisodeEventAction, finalizeEpisodeAction, unfinalizeEpisodeAction, removeEpisodeEventAction)
 * - src/app/league/[id]/admin/castaways/actions.ts (eliminateCastawayAction)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  addEpisodeEvent,
  finalizeEpisode,
  unfinalizeEpisode,
  removeEpisodeEvent,
  eliminateCastaway,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";
import { TEST_LEAGUE } from "./helpers/constants";

describe("Integration: Episode Scoring & Finalization", () => {
  let leagueId: string;
  let castawayIds: string[];
  let scoringRuleIds: string[] = [];

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    castawayIds = result.castawayIds;

    // Run an auto draft so players have team_assignments
    await startAutoDraft(leagueId);

    // Fetch scoring rule IDs seeded by seed_default_scoring_rules RPC
    const admin = getAdminClient();
    const { data: rules } = await admin
      .from("scoring_rules")
      .select("id, points")
      .eq("league_id", leagueId)
      .order("points", { ascending: false });

    scoringRuleIds = (rules ?? []).map((r) => r.id);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.1: Episode auto-creation + correct episode_events row
  // ---------------------------------------------------------------------------

  it("should auto-create episode when adding event to non-existent episode number", async () => {
    const admin = getAdminClient();

    // Episode 1 does not exist yet — adding an event should create it
    const result = await addEpisodeEvent(
      leagueId,
      1,
      castawayIds[0],
      scoringRuleIds[0]
    );

    expect(result.error).toBeUndefined();
    expect(result.eventId).toBeDefined();

    // Verify episode was auto-created
    const { data: episode } = await admin
      .from("episodes")
      .select("id, number, is_finalized")
      .eq("league_id", leagueId)
      .eq("number", 1)
      .single();

    expect(episode).not.toBeNull();
    expect(episode!.number).toBe(1);
    expect(episode!.is_finalized).toBe(false);
  });

  it("should create episode_events row with correct episode_id, castaway_id, scoring_rule_id, and points", async () => {
    const admin = getAdminClient();

    // Get the episode we just created
    const { data: episode } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 1)
      .single();

    // Get the scoring rule's points value
    const { data: rule } = await admin
      .from("scoring_rules")
      .select("points")
      .eq("id", scoringRuleIds[0])
      .single();

    // Verify the event row
    const { data: events } = await admin
      .from("episode_events")
      .select("episode_id, castaway_id, scoring_rule_id, points")
      .eq("episode_id", episode!.id)
      .eq("castaway_id", castawayIds[0]);

    expect(events).not.toBeNull();
    expect(events!.length).toBeGreaterThanOrEqual(1);

    const event = events![0];
    expect(event.episode_id).toBe(episode!.id);
    expect(event.castaway_id).toBe(castawayIds[0]);
    expect(event.scoring_rule_id).toBe(scoringRuleIds[0]);
    expect(event.points).toBe(rule!.points);
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.2: Cannot add events to finalized episode
  // ---------------------------------------------------------------------------

  it("should reject adding event to a finalized episode with error containing 'finalized episode'", async () => {
    // Finalize episode 1
    const finalizeResult = await finalizeEpisode(leagueId, 1);
    expect(finalizeResult.error).toBeUndefined();

    // Try to add another event — should fail
    const result = await addEpisodeEvent(
      leagueId,
      1,
      castawayIds[1],
      scoringRuleIds[0]
    );

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("finalized episode");
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.3: Finalization stamps player_id on each event
  // ---------------------------------------------------------------------------

  it("should stamp player_id on each event matching team_assignment owner at finalization", async () => {
    const admin = getAdminClient();

    // Get episode 1 events
    const { data: episode } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 1)
      .single();

    const { data: events } = await admin
      .from("episode_events")
      .select("id, castaway_id, player_id, scoring_rule_id")
      .eq("episode_id", episode!.id);

    // For each event with a scoring_rule_id (manual events), verify player_id
    const manualEvents = events!.filter((e) => e.scoring_rule_id !== null);
    expect(manualEvents.length).toBeGreaterThan(0);

    for (const event of manualEvents) {
      // Look up who owns this castaway
      const { data: assignment } = await admin
        .from("team_assignments")
        .select("player_id")
        .eq("league_id", leagueId)
        .eq("castaway_id", event.castaway_id)
        .maybeSingle();

      // If there's a team_assignment, player_id should match
      if (assignment) {
        expect(event.player_id).toBe(assignment.player_id);
      } else {
        // Castaway may have been traded/dropped — player_id should still be set
        // (stamped at finalization time based on who owned it then)
        expect(event.player_id).not.toBeNull();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.4: Consolation events for eliminated castaways
  // ---------------------------------------------------------------------------

  it("should auto-insert consolation events for eliminated castaways on finalization", async () => {
    const admin = getAdminClient();

    // Eliminate a castaway at episode 1 (so they get consolation from episode 2+)
    // Use a castaway that has a team_assignment (first 20 are drafted)
    await eliminateCastaway(castawayIds[2], 1);

    // Add an event to episode 2 and finalize it
    const addResult = await addEpisodeEvent(
      leagueId,
      2,
      castawayIds[0],
      scoringRuleIds[0]
    );
    expect(addResult.error).toBeUndefined();

    const finalizeResult = await finalizeEpisode(leagueId, 2);
    expect(finalizeResult.error).toBeUndefined();

    // Verify consolation event was created for the eliminated castaway
    const { data: episode2 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .single();

    const { data: consolationEvents } = await admin
      .from("episode_events")
      .select("castaway_id, points, scoring_rule_id")
      .eq("episode_id", episode2!.id)
      .is("scoring_rule_id", null);

    // Should have at least one consolation event for the eliminated castaway
    const castawayConsolation = consolationEvents!.filter(
      (e) => e.castaway_id === castawayIds[2]
    );
    expect(castawayConsolation.length).toBe(1);
    expect(castawayConsolation[0].points).toBe(TEST_LEAGUE.consolation_points);
    expect(castawayConsolation[0].scoring_rule_id).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.5: Unfinalization behavior
  // ---------------------------------------------------------------------------

  it("should unfinalize: set is_finalized=false, delete consolation events, keep manual events", async () => {
    const admin = getAdminClient();

    // Unfinalize episode 2
    const unfinalizeResult = await unfinalizeEpisode(leagueId, 2);
    expect(unfinalizeResult.error).toBeUndefined();

    // Verify is_finalized = false and finalized_at = null
    const { data: episode } = await admin
      .from("episodes")
      .select("id, is_finalized, finalized_at")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .single();

    expect(episode!.is_finalized).toBe(false);
    expect(episode!.finalized_at).toBeNull();

    // Verify consolation events (scoring_rule_id IS NULL) are deleted
    const { data: consolationEvents } = await admin
      .from("episode_events")
      .select("id")
      .eq("episode_id", episode!.id)
      .is("scoring_rule_id", null);

    expect(consolationEvents!.length).toBe(0);

    // Verify manual events (scoring_rule_id IS NOT NULL) remain
    const { data: manualEvents } = await admin
      .from("episode_events")
      .select("id")
      .eq("episode_id", episode!.id)
      .not("scoring_rule_id", "is", null);

    expect(manualEvents!.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.6: Consolation accumulates across multiple finalized episodes
  // ---------------------------------------------------------------------------

  it("should accumulate consolation events across multiple finalized episodes", async () => {
    const admin = getAdminClient();

    // Re-finalize episode 2
    const finalize2 = await finalizeEpisode(leagueId, 2);
    expect(finalize2.error).toBeUndefined();

    // Add event to episode 3 and finalize it
    const addResult3 = await addEpisodeEvent(
      leagueId,
      3,
      castawayIds[0],
      scoringRuleIds[0]
    );
    expect(addResult3.error).toBeUndefined();

    const finalize3 = await finalizeEpisode(leagueId, 3);
    expect(finalize3.error).toBeUndefined();

    // The castaway eliminated at episode 1 should have consolation events
    // in both episode 2 and episode 3
    const { data: episode2 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .single();

    const { data: episode3 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 3)
      .single();

    // Check consolation in episode 2
    const { data: consol2 } = await admin
      .from("episode_events")
      .select("points")
      .eq("episode_id", episode2!.id)
      .eq("castaway_id", castawayIds[2])
      .is("scoring_rule_id", null);

    expect(consol2!.length).toBe(1);
    expect(consol2![0].points).toBe(TEST_LEAGUE.consolation_points);

    // Check consolation in episode 3
    const { data: consol3 } = await admin
      .from("episode_events")
      .select("points")
      .eq("episode_id", episode3!.id)
      .eq("castaway_id", castawayIds[2])
      .is("scoring_rule_id", null);

    expect(consol3!.length).toBe(1);
    expect(consol3![0].points).toBe(TEST_LEAGUE.consolation_points);

    // Total consolation = consolation_points × 2 episodes
    const totalConsolation =
      consol2![0].points + consol3![0].points;
    expect(totalConsolation).toBe(TEST_LEAGUE.consolation_points * 2);
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.7: Remove event from unfinalized episode succeeds
  // ---------------------------------------------------------------------------

  it("should successfully remove an event from an unfinalized episode", async () => {
    const admin = getAdminClient();

    // Create episode 4 with an event (unfinalized)
    const addResult = await addEpisodeEvent(
      leagueId,
      4,
      castawayIds[0],
      scoringRuleIds[0]
    );
    expect(addResult.error).toBeUndefined();
    expect(addResult.eventId).toBeDefined();

    // Remove the event
    const removeResult = await removeEpisodeEvent(addResult.eventId!);
    expect(removeResult.error).toBeUndefined();

    // Verify the event is gone
    const { data: event } = await admin
      .from("episode_events")
      .select("id")
      .eq("id", addResult.eventId!)
      .maybeSingle();

    expect(event).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Requirement 6.8: Cannot remove event from finalized episode
  // ---------------------------------------------------------------------------

  it("should reject removing event from a finalized episode with error containing 'finalized episode'", async () => {
    const admin = getAdminClient();

    // Get an event from finalized episode 1
    const { data: episode1 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 1)
      .single();

    const { data: events } = await admin
      .from("episode_events")
      .select("id")
      .eq("episode_id", episode1!.id)
      .limit(1);

    expect(events!.length).toBeGreaterThan(0);

    // Try to remove it — should fail
    const removeResult = await removeEpisodeEvent(events![0].id);
    expect(removeResult.error).toBeDefined();
    expect(removeResult.error!.toLowerCase()).toContain("finalized episode");
  });
});
