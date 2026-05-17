"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { validateChallengeSubmission, validateEditResponse } from "@/lib/challenges";

/** Submit a response to a weekly challenge. Requirements: 9.2, 9.3 */
export async function submitChallengeResponseAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = formData.get("league_id") as string;
  const challengeId = formData.get("challenge_id") as string;
  const response = formData.get("response") as string;

  if (!challengeId || !response?.trim()) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Response is required."
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

  // Fetch the challenge and verify deadline
  const { data: challenge } = await supabase
    .from("challenges")
    .select("id, deadline, league_id, episodes!inner(is_finalized)")
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

  const { error } = await supabase.from("challenge_submissions").insert({
    challenge_id: challengeId,
    player_id: user.id,
    response: response.trim(),
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

/** Edit/resubmit a challenge response before the deadline. */
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

  // Fetch the submission and its challenge (for deadline)
  const { data: submission } = await supabase
    .from("challenge_submissions")
    .select("id, player_id, is_correct, challenge_id, challenges(deadline)")
    .eq("id", submissionId)
    .single();

  if (!submission || submission.player_id !== user.id) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Submission not found."
      )}`
    );
  }

  const challengeData = submission.challenges as unknown as { deadline: string } | null;
  if (!challengeData) {
    redirect(
      `/league/${leagueId}/challenges?error=${encodeURIComponent(
        "Challenge not found."
      )}`
    );
  }

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

  const { error } = await supabase
    .from("challenge_submissions")
    .update({ response: response.trim() })
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
