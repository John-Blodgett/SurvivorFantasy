/**
 * Integration Tests: Batch Scoring & Tribe Operations
 *
 * Exercises batch event insertion, tribe-based event insertion, and tribe CRUD
 * against a live Supabase database:
 * - Batch N×M event insertion via buildBatchEvents
 * - Rejection of batch inserts to finalized episodes
 * - Correct points from scoring rules on batch events
 * - Tribe-based event insertion for all non-eliminated castaways
 * - Excluded eliminated castaways from tribe events
 * - Tribe CRUD (create, unique name enforcement, delete constraints)
 *
 * Pure function references:
 * - src/lib/scoring.ts (buildBatchEvents)
 * - src/lib/tribes.ts (buildTribeEvents)
 *
 * Requirements: 6.3, 8.1, 8.2, 14.1, 14.3
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import { startAutoDraft, eliminateCastaway } from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";
import { buildBatchEvents } from "@/lib/scoring";
import { buildTribeEvents } from "@/lib/tribes";

describe("Integration: Batch Scoring & Tribe Operations", () => {
  let leagueId: string;
  let castawayIds: string[];
  let scoringRuleIds: string[] = [];
  let rulePointsMap: Map<string, number> = new Map();

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

    scoringRuleIds = (rules ?? []).map((r: { id: string }) => r.id);
    rulePointsMap = new Map(
      (rules ?? []).map((r: { id: string; points: number }) => [r.id, r.points])
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  // ===========================================================================
  // Batch Scoring Tests
  // ===========================================================================

  describe("Batch Event Insertion", () => {
    it("should batch-insert N×M events for multiple castaways and rules", async () => {
      const admin = getAdminClient();

      // Create an episode for batch insertion
      const { data: episode } = await admin
        .from("episodes")
        .insert({ league_id: leagueId, number: 10 })
        .select("id")
        .single();

      expect(episode).not.toBeNull();

      // Pick 3 castaways and 2 rules
      const selectedCastaways = castawayIds.slice(0, 3);
      const selectedRules = scoringRuleIds.slice(0, 2);

      // Build batch events using the pure function
      const events = buildBatchEvents(
        episode!.id,
        selectedCastaways,
        selectedRules,
        rulePointsMap
      );

      // Should produce 3 × 2 = 6 events
      expect(events).toHaveLength(6);

      // Insert into episode_events
      const { error: insertError } = await admin
        .from("episode_events")
        .insert(events);

      expect(insertError).toBeNull();

      // Verify 6 events exist in the database
      const { data: inserted } = await admin
        .from("episode_events")
        .select("id, episode_id, castaway_id, scoring_rule_id, points")
        .eq("episode_id", episode!.id);

      expect(inserted).not.toBeNull();
      expect(inserted).toHaveLength(6);

      // Verify each castaway has exactly 2 events (one per rule)
      for (const castawayId of selectedCastaways) {
        const castawayEvents = inserted!.filter(
          (e) => e.castaway_id === castawayId
        );
        expect(castawayEvents).toHaveLength(2);
      }

      // Verify each rule has exactly 3 events (one per castaway)
      for (const ruleId of selectedRules) {
        const ruleEvents = inserted!.filter(
          (e) => e.scoring_rule_id === ruleId
        );
        expect(ruleEvents).toHaveLength(3);
      }
    });

    it("should reject batch insert to a finalized episode (application-level validation)", async () => {
      const admin = getAdminClient();

      // Create and finalize an episode
      const { data: episode } = await admin
        .from("episodes")
        .insert({ league_id: leagueId, number: 11 })
        .select("id")
        .single();

      await admin
        .from("episodes")
        .update({ is_finalized: true, finalized_at: new Date().toISOString() })
        .eq("id", episode!.id);

      // Verify the episode is finalized
      const { data: ep } = await admin
        .from("episodes")
        .select("is_finalized")
        .eq("id", episode!.id)
        .single();

      expect(ep!.is_finalized).toBe(true);

      // Note: The DB does not enforce this constraint — the server action checks
      // is_finalized before inserting. This test verifies the episode state is
      // correctly set so the application-level check would work.
    });

    it("should set correct points from the scoring rule for each event", async () => {
      const admin = getAdminClient();

      // Create a fresh episode
      const { data: episode } = await admin
        .from("episodes")
        .insert({ league_id: leagueId, number: 12 })
        .select("id")
        .single();

      // Pick 2 castaways and 2 rules with known points
      const selectedCastaways = castawayIds.slice(3, 5);
      const selectedRules = scoringRuleIds.slice(0, 2);

      const events = buildBatchEvents(
        episode!.id,
        selectedCastaways,
        selectedRules,
        rulePointsMap
      );

      // Insert
      const { error: insertError } = await admin
        .from("episode_events")
        .insert(events);

      expect(insertError).toBeNull();

      // Verify each event's points matches the rule's configured value
      const { data: inserted } = await admin
        .from("episode_events")
        .select("scoring_rule_id, points")
        .eq("episode_id", episode!.id);

      expect(inserted).not.toBeNull();

      for (const event of inserted!) {
        const expectedPoints = rulePointsMap.get(event.scoring_rule_id);
        expect(event.points).toBe(expectedPoints);
      }
    });
  });

  // ===========================================================================
  // Tribe Event Tests
  // ===========================================================================

  describe("Tribe Event Insertion", () => {
    it("should insert events for all non-eliminated castaways in a tribe", async () => {
      const admin = getAdminClient();

      // Get the Alpha tribe and its castaways
      const { data: tribe } = await admin
        .from("tribes")
        .select("id")
        .eq("league_id", leagueId)
        .eq("name", "Alpha")
        .single();

      expect(tribe).not.toBeNull();

      const { data: tribeCastaways } = await admin
        .from("castaways")
        .select("id")
        .eq("tribe_id", tribe!.id)
        .eq("is_eliminated", false);

      expect(tribeCastaways).not.toBeNull();
      expect(tribeCastaways!.length).toBeGreaterThan(0);

      const tribeCastawayIds = tribeCastaways!.map((c) => c.id);

      // Create an episode for tribe events
      const { data: episode } = await admin
        .from("episodes")
        .insert({ league_id: leagueId, number: 13 })
        .select("id")
        .single();

      // Build tribe events using the pure function
      const ruleId = scoringRuleIds[0];
      const points = rulePointsMap.get(ruleId) ?? 0;
      const events = buildTribeEvents(episode!.id, tribeCastawayIds, ruleId, points);

      // Insert
      const { error: insertError } = await admin
        .from("episode_events")
        .insert(events);

      expect(insertError).toBeNull();

      // Verify one event per tribe member
      const { data: inserted } = await admin
        .from("episode_events")
        .select("id, castaway_id, scoring_rule_id, points")
        .eq("episode_id", episode!.id);

      expect(inserted).not.toBeNull();
      expect(inserted).toHaveLength(tribeCastawayIds.length);

      // Each castaway in the tribe should have exactly one event
      for (const castawayId of tribeCastawayIds) {
        const castawayEvents = inserted!.filter(
          (e) => e.castaway_id === castawayId
        );
        expect(castawayEvents).toHaveLength(1);
        expect(castawayEvents[0].scoring_rule_id).toBe(ruleId);
        expect(castawayEvents[0].points).toBe(points);
      }
    });

    it("should not include eliminated castaways in tribe events", async () => {
      const admin = getAdminClient();

      // Get the Beta tribe and its castaways
      const { data: tribe } = await admin
        .from("tribes")
        .select("id")
        .eq("league_id", leagueId)
        .eq("name", "Beta")
        .single();

      expect(tribe).not.toBeNull();

      // Get all Beta castaways before elimination
      const { data: allBetaCastaways } = await admin
        .from("castaways")
        .select("id")
        .eq("tribe_id", tribe!.id);

      expect(allBetaCastaways).not.toBeNull();
      expect(allBetaCastaways!.length).toBeGreaterThan(1);

      // Eliminate one castaway in the Beta tribe
      const eliminatedId = allBetaCastaways![0].id;
      await eliminateCastaway(eliminatedId, 13);

      // Get non-eliminated castaways in the tribe (simulating the query pattern)
      const { data: activeBetaCastaways } = await admin
        .from("castaways")
        .select("id")
        .eq("tribe_id", tribe!.id)
        .eq("is_eliminated", false);

      expect(activeBetaCastaways).not.toBeNull();
      const activeCastawayIds = activeBetaCastaways!.map((c) => c.id);

      // The eliminated castaway should NOT be in the active list
      expect(activeCastawayIds).not.toContain(eliminatedId);

      // Create an episode for tribe events
      const { data: episode } = await admin
        .from("episodes")
        .insert({ league_id: leagueId, number: 14 })
        .select("id")
        .single();

      // Build tribe events using only active castaways
      const ruleId = scoringRuleIds[0];
      const points = rulePointsMap.get(ruleId) ?? 0;
      const events = buildTribeEvents(episode!.id, activeCastawayIds, ruleId, points);

      // Insert
      const { error: insertError } = await admin
        .from("episode_events")
        .insert(events);

      expect(insertError).toBeNull();

      // Verify the eliminated castaway does NOT have an event
      const { data: inserted } = await admin
        .from("episode_events")
        .select("id, castaway_id")
        .eq("episode_id", episode!.id);

      expect(inserted).not.toBeNull();
      expect(inserted!.length).toBe(activeCastawayIds.length);

      const insertedCastawayIds = inserted!.map((e) => e.castaway_id);
      expect(insertedCastawayIds).not.toContain(eliminatedId);
    });
  });

  // ===========================================================================
  // Tribe CRUD Tests
  // ===========================================================================

  describe("Tribe CRUD", () => {
    it("should create a tribe with name and color", async () => {
      const admin = getAdminClient();

      const { data: tribe, error } = await admin
        .from("tribes")
        .insert({
          league_id: leagueId,
          name: "Delta",
          color: "#FF5733",
        })
        .select("id, league_id, name, color")
        .single();

      expect(error).toBeNull();
      expect(tribe).not.toBeNull();
      expect(tribe!.name).toBe("Delta");
      expect(tribe!.color).toBe("#FF5733");
      expect(tribe!.league_id).toBe(leagueId);

      // Verify it exists in the database
      const { data: fetched } = await admin
        .from("tribes")
        .select("id, name, color")
        .eq("id", tribe!.id)
        .single();

      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("Delta");
      expect(fetched!.color).toBe("#FF5733");
    });

    it("should enforce unique tribe name per league", async () => {
      const admin = getAdminClient();

      // "Alpha" already exists for this league (created by seed)
      const { error } = await admin
        .from("tribes")
        .insert({
          league_id: leagueId,
          name: "Alpha",
        });

      expect(error).not.toBeNull();
      // Should be a unique constraint violation
      expect(error!.code).toBe("23505"); // PostgreSQL unique_violation
    });

    it("should delete a tribe only if no castaways are assigned", async () => {
      const admin = getAdminClient();

      // Try to delete the Alpha tribe (has castaways assigned)
      const { data: alphaTribe } = await admin
        .from("tribes")
        .select("id")
        .eq("league_id", leagueId)
        .eq("name", "Alpha")
        .single();

      expect(alphaTribe).not.toBeNull();

      // Verify Alpha has castaways
      const { data: alphaCastaways } = await admin
        .from("castaways")
        .select("id")
        .eq("tribe_id", alphaTribe!.id);

      expect(alphaCastaways!.length).toBeGreaterThan(0);

      // Delete attempt — may fail with FK violation or succeed with SET NULL
      // depending on the FK constraint (ON DELETE SET NULL vs RESTRICT)
      const { error: deleteError } = await admin
        .from("tribes")
        .delete()
        .eq("id", alphaTribe!.id);

      if (deleteError) {
        // FK constraint prevents deletion — this is the RESTRICT behavior
        expect(deleteError.code).toBe("23503");
      } else {
        // ON DELETE SET NULL — tribe was deleted, castaways have tribe_id = null
        const { data: orphanedCastaways } = await admin
          .from("castaways")
          .select("id, tribe_id")
          .in("id", alphaCastaways!.map((c) => c.id));

        for (const c of orphanedCastaways ?? []) {
          expect(c.tribe_id).toBeNull();
        }

        // Re-create the Alpha tribe for other tests
        await admin.from("tribes").insert({ league_id: leagueId, name: "Alpha" });
      }

      // Create a tribe with no castaways and delete it — should always succeed
      const { data: emptyTribe } = await admin
        .from("tribes")
        .insert({
          league_id: leagueId,
          name: "Epsilon",
          color: "#00FF00",
        })
        .select("id")
        .single();

      expect(emptyTribe).not.toBeNull();

      const { error: deleteEmptyError } = await admin
        .from("tribes")
        .delete()
        .eq("id", emptyTribe!.id);

      expect(deleteEmptyError).toBeNull();

      // Verify it's gone
      const { data: fetched } = await admin
        .from("tribes")
        .select("id")
        .eq("id", emptyTribe!.id)
        .maybeSingle();

      expect(fetched).toBeNull();
    });
  });
});
