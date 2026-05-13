/**
 * Integration Tests: Challenges
 *
 * Exercises the full challenge lifecycle against a live Supabase database:
 * - Challenge creation with validation
 * - Player submission with deadline enforcement
 * - Duplicate submission prevention
 * - Admin grading (correct/incorrect)
 * - Challenge points reflected in leaderboard
 *
 * Server action references:
 * - src/app/league/[id]/challenges/actions.ts
 *     (createChallengeAction, submitChallengeResponseAction, gradeChallengeSubmissionAction)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanup, seed } from "./helpers/lifecycle";
import {
  startAutoDraft,
  addEpisodeEvent,
  finalizeEpisode,
  createChallenge,
  submitChallengeResponse,
  gradeSubmission,
} from "./helpers/actions";
import { getAdminClient } from "./helpers/supabase";

describe("Integration: Challenges", () => {
  let leagueId: string;
  let playerIds: string[];
  let castawayIds: string[];
  let episodeId: string;
  let scoringRuleId: string;

  beforeAll(async () => {
    await cleanup();
    const result = await seed();
    leagueId = result.leagueId;
    playerIds = result.playerIds;
    castawayIds = result.castawayIds;

    // Run auto draft so players have team_assignments
    await startAutoDraft(leagueId);

    // Get a scoring rule
    const admin = getAdminClient();
    const { data: rules } = await admin
      .from("scoring_rules")
      .select("id")
      .eq("league_id", leagueId)
      .limit(1);
    scoringRuleId = rules![0].id;

    // Create and finalize episode 1 so we have an episode_id
    await addEpisodeEvent(leagueId, 1, castawayIds[0], scoringRuleId);
    await finalizeEpisode(leagueId, 1);

    // Create episode 2 (unfinalized) for challenges
    await addEpisodeEvent(leagueId, 2, castawayIds[0], scoringRuleId);

    const { data: ep2 } = await admin
      .from("episodes")
      .select("id")
      .eq("league_id", leagueId)
      .eq("number", 2)
      .single();
    episodeId = ep2!.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.1: Create challenge with valid inputs
  // ---------------------------------------------------------------------------

  it("should create a challenges row with correct league_id, episode_id, title, points, and deadline", async () => {
    const admin = getAdminClient();
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await createChallenge(
      leagueId,
      episodeId,
      "Who gets voted out?",
      5,
      futureDeadline
    );

    expect(result.error).toBeUndefined();
    expect(result.challengeId).toBeDefined();

    const { data: challenge } = await admin
      .from("challenges")
      .select("league_id, episode_id, title, points, deadline")
      .eq("id", result.challengeId!)
      .single();

    expect(challenge).not.toBeNull();
    expect(challenge!.league_id).toBe(leagueId);
    expect(challenge!.episode_id).toBe(episodeId);
    expect(challenge!.title).toBe("Who gets voted out?");
    expect(challenge!.points).toBe(5);
    expect(challenge!.deadline).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.2: Empty title validation
  // ---------------------------------------------------------------------------

  it("should reject challenge with empty title", async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await createChallenge(leagueId, episodeId, "", 5, futureDeadline);

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("title");
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.3: Points <= 0 validation
  // ---------------------------------------------------------------------------

  it("should reject challenge with points <= 0", async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await createChallenge(leagueId, episodeId, "Test", 0, futureDeadline);

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("positive");
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.4: No deadline validation
  // ---------------------------------------------------------------------------

  it("should reject challenge with no deadline", async () => {
    const result = await createChallenge(leagueId, episodeId, "Test", 5, "");

    expect(result.error).toBeDefined();
    expect(result.error!.toLowerCase()).toContain("deadline");
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.5: Player submits response
  // ---------------------------------------------------------------------------

  it("should create challenge_submissions row with player_id, response, and is_correct=null", async () => {
    const admin = getAdminClient();
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create a challenge
    const challengeResult = await createChallenge(
      leagueId,
      episodeId,
      "Prediction challenge",
      5,
      futureDeadline
    );
    expect(challengeResult.error).toBeUndefined();

    // Player 2 submits a response
    const submitResult = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[1],
      "Castaway-05"
    );

    expect(submitResult.error).toBeUndefined();
    expect(submitResult.submissionId).toBeDefined();

    // Verify the submission row
    const { data: submission } = await admin
      .from("challenge_submissions")
      .select("player_id, response, is_correct")
      .eq("id", submitResult.submissionId!)
      .single();

    expect(submission).not.toBeNull();
    expect(submission!.player_id).toBe(playerIds[1]);
    expect(submission!.response).toBe("Castaway-05");
    expect(submission!.is_correct).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.6: Cannot submit after deadline
  // ---------------------------------------------------------------------------

  it("should reject submission after deadline has passed", async () => {
    // Create a challenge with deadline in the past
    const pastDeadline = new Date(Date.now() - 60 * 1000).toISOString();

    const challengeResult = await createChallenge(
      leagueId,
      episodeId,
      "Past deadline challenge",
      5,
      pastDeadline
    );
    expect(challengeResult.error).toBeUndefined();

    // Player 3 tries to submit
    const submitResult = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[2],
      "My answer"
    );

    expect(submitResult.error).toBeDefined();
    expect(submitResult.error!.toLowerCase()).toContain("deadline");
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.7: Cannot submit twice
  // ---------------------------------------------------------------------------

  it("should reject duplicate submission from same player", async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create a challenge
    const challengeResult = await createChallenge(
      leagueId,
      episodeId,
      "No duplicates challenge",
      5,
      futureDeadline
    );
    expect(challengeResult.error).toBeUndefined();

    // Player 4 submits first time
    const submit1 = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[3],
      "First answer"
    );
    expect(submit1.error).toBeUndefined();

    // Player 4 tries to submit again
    const submit2 = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[3],
      "Second answer"
    );

    expect(submit2.error).toBeDefined();
    expect(submit2.error!.toLowerCase()).toContain("already submitted");
  });

  // ---------------------------------------------------------------------------
  // Requirement 9.8 & 9.9: Admin grades correct and incorrect
  // ---------------------------------------------------------------------------

  it("should set is_correct=true when admin grades submission as correct", async () => {
    const admin = getAdminClient();
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create challenge
    const challengeResult = await createChallenge(
      leagueId,
      episodeId,
      "Grading test challenge",
      5,
      futureDeadline
    );
    expect(challengeResult.error).toBeUndefined();

    // Player 5 submits
    const submitResult = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[4],
      "Correct answer"
    );
    expect(submitResult.error).toBeUndefined();

    // Grade as correct
    await gradeSubmission(submitResult.submissionId!, true);

    // Verify
    const { data: submission } = await admin
      .from("challenge_submissions")
      .select("is_correct")
      .eq("id", submitResult.submissionId!)
      .single();

    expect(submission!.is_correct).toBe(true);
  });

  it("should set is_correct=false when admin grades submission as incorrect", async () => {
    const admin = getAdminClient();
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create challenge
    const challengeResult = await createChallenge(
      leagueId,
      episodeId,
      "Grading test challenge 2",
      5,
      futureDeadline
    );
    expect(challengeResult.error).toBeUndefined();

    // Player 6 submits
    const submitResult = await submitChallengeResponse(
      challengeResult.challengeId!,
      playerIds[5],
      "Wrong answer"
    );
    expect(submitResult.error).toBeUndefined();

    // Grade as incorrect
    await gradeSubmission(submitResult.submissionId!, false);

    // Verify
    const { data: submission } = await admin
      .from("challenge_submissions")
      .select("is_correct")
      .eq("id", submitResult.submissionId!)
      .single();

    expect(submission!.is_correct).toBe(false);
  });
});
