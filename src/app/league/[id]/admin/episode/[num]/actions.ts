"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { buildConsolationEvents } from "@/lib/episodes";
import { validateCreateChallenge } from "@/lib/challenges";
import { buildTribeEvents } from "@/lib/tribes";
import { buildBatchEvents } from "@/lib/scoring";
import { toPacificISO } from "@/lib/timezone";
import { requireLeagueAdmin } from "../../helpers";

async function ensureEpisode(
  supabase: ReturnType<typeof createClient>,
  leagueId: string,
  episodeNumber: number
): Promise<string> {
  const { data: existing } = await supabase
    .from("episodes")
    .select("id")
    .eq("league_id", leagueId)
    .eq("number", episodeNumber)
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("episodes")
    .insert({ league_id: leagueId, number: episodeNumber })
    .select("id")
    .single();

  if (error || !created) throw new Error(`Failed to create episode: ${error?.message}`);
  return created.id;
}

export async function addEpisodeEventAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const castawayId = formData.get("castaway_id") as string;
  const ruleId = formData.get("rule_id") as string;
  const points = parseInt(formData.get("points") as string, 10);

  if (!castawayId || !ruleId || isNaN(points) || isNaN(episodeNumber)) {
    redirect(`${basePath}?error=${encodeURIComponent("Invalid event data.")}`);
  }

  const episodeId = await ensureEpisode(supabase, leagueId, episodeNumber);

  const { data: episode } = await supabase
    .from("episodes").select("is_finalized").eq("id", episodeId).single();

  if (episode?.is_finalized) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot add events to a finalized episode.")}`);
  }

  const { error } = await supabase.from("episode_events").insert({
    episode_id: episodeId, castaway_id: castawayId, scoring_rule_id: ruleId, points,
  });

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to record event.")}`);
  }

  revalidatePath(basePath);
}

export async function removeEpisodeEventAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase, leagueId: verifiedId } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${verifiedId}/admin/episode/${episodeNumber}`;

  const eventId = formData.get("event_id") as string;
  if (!eventId) redirect(`${basePath}?error=${encodeURIComponent("Missing event ID.")}`);

  const { data: event } = await supabase
    .from("episode_events")
    .select("episode_id, episodes!inner(is_finalized, league_id)")
    .eq("id", eventId)
    .single();

  const ep = event?.episodes as unknown as { is_finalized: boolean; league_id: string } | null;
  if (!ep || ep.league_id !== verifiedId) {
    redirect(`${basePath}?error=${encodeURIComponent("Event not found.")}`);
  }
  if (ep.is_finalized) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot remove events from a finalized episode.")}`);
  }

  await supabase.from("episode_events").delete().eq("id", eventId);
  revalidatePath(basePath);
}

export async function finalizeEpisodeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const { data: league } = await supabase
    .from("leagues").select("consolation_points").eq("id", leagueId).single();

  const episodeId = await ensureEpisode(supabase, leagueId, episodeNumber);

  const { data: eliminatedCastaways } = await supabase
    .from("castaways")
    .select("id, eliminated_episode")
    .eq("league_id", leagueId)
    .eq("is_eliminated", true)
    .not("eliminated_episode", "is", null);

  const consolationEvents = buildConsolationEvents(
    episodeId, episodeNumber,
    (eliminatedCastaways ?? []).map((c) => ({ castaway_id: c.id, eliminated_episode: c.eliminated_episode! })),
    league?.consolation_points ?? 0
  );

  if (consolationEvents.length > 0) {
    const { error } = await supabase.from("episode_events").insert(consolationEvents);
    if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to insert consolation events.")}`);
  }

  const { error } = await supabase
    .from("episodes")
    .update({ is_finalized: true, finalized_at: new Date().toISOString() })
    .eq("id", episodeId);

  if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to finalize episode.")}`);

  // Stamp player_id on all episode events based on current team ownership
  const { data: leagueFromEp } = await supabase
    .from("episodes").select("league_id").eq("id", episodeId).single();

  if (leagueFromEp) {
    const { data: assignments } = await supabase
      .from("team_assignments")
      .select("player_id, castaway_id")
      .eq("league_id", leagueFromEp.league_id);

    const ownerMap = new Map((assignments ?? []).map((a) => [a.castaway_id, a.player_id]));

    const { data: events } = await supabase
      .from("episode_events")
      .select("id, castaway_id")
      .eq("episode_id", episodeId);

    for (const event of events ?? []) {
      const playerId = ownerMap.get(event.castaway_id);
      if (playerId) {
        await supabase
          .from("episode_events")
          .update({ player_id: playerId })
          .eq("id", event.id);
      }
    }
  }
  revalidatePath(basePath);
  redirect(`${basePath}?success=finalized`);
}

export async function unfinalizeEpisodeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const { data: episode } = await supabase
    .from("episodes").select("id").eq("league_id", leagueId).eq("number", episodeNumber).single();

  if (!episode) redirect(`${basePath}?error=${encodeURIComponent("Episode not found.")}`);

  await supabase.from("episode_events").delete().eq("episode_id", episode.id).is("scoring_rule_id", null);

  const { error } = await supabase
    .from("episodes")
    .update({ is_finalized: false, finalized_at: null })
    .eq("id", episode.id);

  if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to un-finalize episode.")}`);

  revalidatePath(basePath);
  redirect(`${basePath}?success=unfinalized`);
}

export async function createChallengeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const points = parseInt(formData.get("points") as string, 10);
  const deadline = formData.get("deadline") as string;

  const validation = validateCreateChallenge({ title, description, points, deadline });
  if (!validation.valid) redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);

  const episodeId = await ensureEpisode(supabase, leagueId, episodeNumber);
  const deadlinePacific = toPacificISO(deadline);

  const { error } = await supabase.from("challenges").insert({
    league_id: leagueId, episode_id: episodeId,
    title: title.trim(), description: description?.trim() || null, points, deadline: deadlinePacific,
  });

  if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to create challenge.")}`);
  revalidatePath(basePath);
}

export async function updateChallengeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const challengeId = formData.get("challenge_id") as string;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const points = parseInt(formData.get("points") as string, 10);
  const deadline = formData.get("deadline") as string;

  const validation = validateCreateChallenge({ title, description, points, deadline });
  if (!validation.valid) redirect(`${basePath}?error=${encodeURIComponent(validation.error!)}`);

  const { data: challenge } = await supabase
    .from("challenges").select("id, deadline, league_id").eq("id", challengeId).single();

  if (!challenge || challenge.league_id !== leagueId) {
    redirect(`${basePath}?error=${encodeURIComponent("Challenge not found.")}`);
  }
  if (new Date(challenge.deadline) < new Date()) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot edit a challenge after its deadline.")}`);
  }

  const deadlinePacific = toPacificISO(deadline);

  const { error } = await supabase.from("challenges").update({
    title: title.trim(), description: description?.trim() || null, points, deadline: deadlinePacific,
  }).eq("id", challengeId);

  if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to update challenge.")}`);
  revalidatePath(basePath);
}

export async function deleteChallengeAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const challengeId = formData.get("challenge_id") as string;

  const { data: challenge } = await supabase
    .from("challenges").select("id, deadline, league_id").eq("id", challengeId).single();

  if (!challenge || challenge.league_id !== leagueId) {
    redirect(`${basePath}?error=${encodeURIComponent("Challenge not found.")}`);
  }
  if (new Date(challenge.deadline) < new Date()) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot delete a challenge after its deadline.")}`);
  }

  await supabase.from("challenges").delete().eq("id", challengeId);
  revalidatePath(basePath);
}

export async function gradeChallengeSubmissionAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const submissionId = formData.get("submission_id") as string;
  const isCorrect = formData.get("is_correct") === "true";

  const { data: submission } = await supabase
    .from("challenge_submissions")
    .select("id, challenge_id, challenges!inner(league_id)")
    .eq("id", submissionId)
    .single();

  const challengeData = submission?.challenges as unknown as { league_id: string } | null;
  if (!submission || !challengeData || challengeData.league_id !== leagueId) {
    redirect(`${basePath}?error=${encodeURIComponent("Submission not found.")}`);
  }

  const { error } = await supabase
    .from("challenge_submissions").update({ is_correct: isCorrect }).eq("id", submissionId);

  if (error) redirect(`${basePath}?error=${encodeURIComponent("Failed to grade submission.")}`);
  revalidatePath(basePath);
}

export async function addTribeEventAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const tribeId = formData.get("tribe_id") as string;
  const ruleId = formData.get("rule_id") as string;
  const points = parseInt(formData.get("points") as string, 10);

  if (!tribeId || !ruleId || isNaN(points) || isNaN(episodeNumber)) {
    redirect(`${basePath}?error=${encodeURIComponent("Invalid tribe event data.")}`);
  }

  const episodeId = await ensureEpisode(supabase, leagueId, episodeNumber);

  const { data: episode } = await supabase
    .from("episodes").select("is_finalized").eq("id", episodeId).single();

  if (episode?.is_finalized) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot add events to a finalized episode.")}`);
  }

  // Fetch all non-eliminated castaways in the tribe
  const { data: castaways } = await supabase
    .from("castaways")
    .select("id")
    .eq("league_id", leagueId)
    .eq("tribe_id", tribeId)
    .eq("is_eliminated", false);

  if (!castaways || castaways.length === 0) {
    redirect(`${basePath}?error=${encodeURIComponent("No active castaways in this tribe.")}`);
  }

  const events = buildTribeEvents(
    episodeId,
    castaways.map((c) => c.id),
    ruleId,
    points
  );

  const { error } = await supabase.from("episode_events").insert(events);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to record tribe events.")}`);
  }

  revalidatePath(basePath);
}

export async function addBatchEventsAction(formData: FormData) {
  const leagueId = formData.get("league_id") as string;
  const { supabase } = await requireLeagueAdmin(leagueId);
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const basePath = `/league/${leagueId}/admin/episode/${episodeNumber}`;

  const castawayIdsRaw = formData.get("castaway_ids") as string;
  const ruleIdsRaw = formData.get("rule_ids") as string;

  let castawayIds: string[];
  let ruleIds: string[];
  try {
    castawayIds = JSON.parse(castawayIdsRaw);
    ruleIds = JSON.parse(ruleIdsRaw);
  } catch {
    redirect(`${basePath}?error=${encodeURIComponent("Invalid batch data.")}`);
  }

  if (!Array.isArray(castawayIds) || !Array.isArray(ruleIds) || castawayIds.length === 0 || ruleIds.length === 0) {
    redirect(`${basePath}?error=${encodeURIComponent("Select at least one castaway and one rule.")}`);
  }

  const episodeId = await ensureEpisode(supabase, leagueId, episodeNumber);

  const { data: episode } = await supabase
    .from("episodes").select("is_finalized").eq("id", episodeId).single();

  if (episode?.is_finalized) {
    redirect(`${basePath}?error=${encodeURIComponent("Cannot add events to a finalized episode.")}`);
  }

  // Fetch points for each selected rule
  const { data: rules } = await supabase
    .from("scoring_rules")
    .select("id, points")
    .eq("league_id", leagueId)
    .in("id", ruleIds);

  if (!rules || rules.length === 0) {
    redirect(`${basePath}?error=${encodeURIComponent("No valid scoring rules found.")}`);
  }

  const rulePointsMap = new Map<string, number>(rules.map((r) => [r.id, r.points]));

  const events = buildBatchEvents(episodeId, castawayIds, ruleIds, rulePointsMap);

  const { error } = await supabase.from("episode_events").insert(events);

  if (error) {
    redirect(`${basePath}?error=${encodeURIComponent("Failed to record batch events.")}`);
  }

  revalidatePath(basePath);
}
