"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  validateChallengeSubmission,
  validateEditResponse,
  validateTypedSubmission,
  autoGrade,
  normalizeChallengeType,
  normalizeDropdownScope,
  type CastawayOption,
  type ChallengeType,
} from "@/lib/challenges";

/**
 * Submit a response to a weekly challenge.
 * Validates the response against the challenge type, auto-grades against any
 * stored correct answer, and stores the normalized value.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.5, 7.1, 7.2, 7.3, 7.6, 10.1, 10.2, 10.3, 10.4
 */
export async function submitChallengeResponseAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const challengeId = formData.get("challenge_id") as string;
  const response = formData.get("response") as string;

  if (!challengeId) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Challenge not found."
      )}`
    );
  }

  // Verify user is a member of this league
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Fetch the challenge (including type config) and verify deadline
  const { data: challenge } = await supabase
    .from("challenges")
    .select(
      "id, deadline, league_id, challenge_type, options, dropdown_scope, correct_answer, episodes!inner(is_finalized)"
    )
    .eq("id", challengeId)
    .single();

  if (!challenge || challenge.league_id !== leagueId) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Challenge not found."
      )}`
    );
  }

  const episodeData = challenge.episodes as unknown as { is_finalized: boolean } | null;
  if (episodeData?.is_finalized) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "This episode has been finalized. No more submissions allowed."
      )}`
    );
  }

  const now = new Date();
  const deadline = new Date(challenge.deadline);
  const validation = validateChallengeSubmission(now, deadline);

  if (!validation.valid) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(validation.error!)}`
    );
  }

  // Check if user already submitted
  const { data: existing } = await supabase
    .from("challenge_submissions")
    .select("id")
    .eq("challenge_id", challengeId)
    .eq("player_id", user.id)
    .single();

  if (existing) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "You have already submitted a response to this challenge."
      )}`
    );
  }

  // Resolve the challenge type; null/absent => free_response (Req 8.1).
  const type: ChallengeType = normalizeChallengeType(challenge.challenge_type);

  // For survivor dropdowns, fetch the league's castaways to validate the
  // selected id against the challenge's scope (Req 5.3).
  let castaways: CastawayOption[] = [];
  if (type === "survivor_dropdown") {
    const { data: castawayRows } = await supabase
      .from("castaways")
      .select("id, name, is_eliminated")
      .eq("league_id", leagueId);
    castaways = (castawayRows ?? []) as CastawayOption[];
  }

  // Validate the response against the challenge type (Req 5.1–5.4, 6.1–6.3, 6.5).
  const submissionValidation = validateTypedSubmission({
    type,
    rawResponse: response ?? "",
    options: challenge.options as string[] | null,
    scope: type === "survivor_dropdown"
      ? normalizeDropdownScope(challenge.dropdown_scope)
      : null,
    castaways,
  });

  if (!submissionValidation.valid) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        submissionValidation.error!
      )}`
    );
  }

  const value = submissionValidation.value!;

  // Auto-grade against any stored correct answer (Req 7.1, 7.2, 7.3, 7.6).
  const { is_correct } = autoGrade({
    submittedValue: value,
    correctAnswer: challenge.correct_answer,
  });

  const { error } = await supabase.from("challenge_submissions").insert({
    challenge_id: challengeId,
    player_id: user.id,
    response: value,
    is_correct,
  });

  if (error) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Failed to submit response. Please try again."
      )}`
    );
  }

  revalidatePath(`/league/${leagueId}/challenges`);
}

/**
 * Edit/resubmit a challenge response before the deadline.
 * Blocked once the submission is graded. Re-runs typed validation and
 * auto-grade, updating both the normalized response value and is_correct.
 * Requirements: 5.1, 5.2, 5.3, 6.1, 7.1, 7.2, 9.5
 */
export async function editChallengeResponseAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const submissionId = formData.get("submission_id") as string;
  const response = formData.get("response") as string;

  if (!submissionId || !leagueId) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Missing required fields."
      )}`
    );
  }

  // Fetch the submission and its challenge (deadline + type config).
  const { data: submission } = await supabase
    .from("challenge_submissions")
    .select(
      "id, player_id, is_correct, challenge_id, challenges(deadline, league_id, challenge_type, options, dropdown_scope, correct_answer)"
    )
    .eq("id", submissionId)
    .single();

  if (!submission || submission.player_id !== user.id) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Submission not found."
      )}`
    );
  }

  const challengeData = submission.challenges as unknown as {
    deadline: string;
    league_id: string;
    challenge_type: string | null;
    options: string[] | null;
    dropdown_scope: string | null;
    correct_answer: string | null;
  } | null;
  if (!challengeData || challengeData.league_id !== leagueId) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Challenge not found."
      )}`
    );
  }

  // Enforce deadline + the rule that a graded submission cannot be edited
  // (existing behavior — validateEditResponse handles is_correct !== null).
  const validation = validateEditResponse({
    response: response ?? "",
    deadline: challengeData.deadline,
    isGraded: submission.is_correct !== null,
  });

  if (!validation.valid) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(validation.error!)}`
    );
  }

  // Resolve the challenge type; null/absent => free_response (Req 8.1).
  const type: ChallengeType = normalizeChallengeType(challengeData.challenge_type);

  // For survivor dropdowns, fetch the league's castaways to validate the
  // selected id against the challenge's scope (Req 5.3).
  let castaways: CastawayOption[] = [];
  if (type === "survivor_dropdown") {
    const { data: castawayRows } = await supabase
      .from("castaways")
      .select("id, name, is_eliminated")
      .eq("league_id", leagueId);
    castaways = (castawayRows ?? []) as CastawayOption[];
  }

  // Re-run typed validation against the challenge type (Req 5.1–5.3, 6.1).
  const submissionValidation = validateTypedSubmission({
    type,
    rawResponse: response ?? "",
    options: challengeData.options,
    scope:
      type === "survivor_dropdown"
        ? normalizeDropdownScope(challengeData.dropdown_scope)
        : null,
    castaways,
  });

  if (!submissionValidation.valid) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        submissionValidation.error!
      )}`
    );
  }

  const value = submissionValidation.value!;

  // Re-run auto-grade against any stored correct answer (Req 7.1, 7.2).
  const { is_correct } = autoGrade({
    submittedValue: value,
    correctAnswer: challengeData.correct_answer,
  });

  const { error } = await supabase
    .from("challenge_submissions")
    .update({ response: value, is_correct })
    .eq("id", submissionId);

  if (error) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Failed to update response. Please try again."
      )}`
    );
  }

  revalidatePath(`/league/${leagueId}/challenges`);
  redirect(
    `/league/${leagueId}/challenges?success=${encodeURIComponent(
      "Response updated successfully."
    )}`
  );
}
