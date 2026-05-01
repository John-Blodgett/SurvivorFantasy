"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { buildConsolationEvents } from "@/lib/episodes";

/** Returns the league where the current user is admin, or redirects. */
async function getAdminLeague() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, consolation_points")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  return { supabase, user, league };
}

/**
 * Ensure an episode row exists for the given number; create it if not.
 * Returns the episode id.
 */
async function ensureEpisode(
  supabase: ReturnType<typeof createClient>,
  leagueId: string,
  episodeNumber: number
): Promise<string> {
  // Try to fetch existing
  const { data: existing } = await supabase
    .from("episodes")
    .select("id")
    .eq("league_id", leagueId)
    .eq("number", episodeNumber)
    .single();

  if (existing) return existing.id;

  // Create new episode
  const { data: created, error } = await supabase
    .from("episodes")
    .insert({ league_id: leagueId, number: episodeNumber })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create episode: ${error?.message}`);
  }

  return created.id;
}

/** Record an episode event (castaway + scoring rule). Requirements: 6.3 */
export async function addEpisodeEventAction(formData: FormData) {
  const { supabase, league } = await getAdminLeague();

  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const castawayId = formData.get("castaway_id") as string;
  const ruleId = formData.get("rule_id") as string;
  const points = parseInt(formData.get("points") as string, 10);

  if (!castawayId || !ruleId || isNaN(points) || isNaN(episodeNumber)) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent("Invalid event data.")}`
    );
  }

  const episodeId = await ensureEpisode(supabase, league.id, episodeNumber);

  // Verify episode is not finalized
  const { data: episode } = await supabase
    .from("episodes")
    .select("is_finalized")
    .eq("id", episodeId)
    .single();

  if (episode?.is_finalized) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Cannot add events to a finalized episode."
      )}`
    );
  }

  const { error } = await supabase.from("episode_events").insert({
    episode_id: episodeId,
    castaway_id: castawayId,
    scoring_rule_id: ruleId,
    points,
  });

  if (error) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Failed to record event. Please try again."
      )}`
    );
  }

  revalidatePath(`/admin/episode/${episodeNumber}`);
}

/** Remove an episode event. Requirements: 6.5 */
export async function removeEpisodeEventAction(formData: FormData) {
  const { supabase, league } = await getAdminLeague();

  const eventId = formData.get("event_id") as string;
  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);

  if (!eventId) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent("Missing event ID.")}`
    );
  }

  // Verify the event belongs to a non-finalized episode in this league
  const { data: event } = await supabase
    .from("episode_events")
    .select("episode_id, episodes!inner(is_finalized, league_id)")
    .eq("id", eventId)
    .single();

  const ep = event?.episodes as unknown as { is_finalized: boolean; league_id: string } | null;

  if (!ep || ep.league_id !== league.id) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent("Event not found.")}`
    );
  }

  if (ep.is_finalized) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Cannot remove events from a finalized episode."
      )}`
    );
  }

  const { error } = await supabase
    .from("episode_events")
    .delete()
    .eq("id", eventId);

  if (error) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Failed to remove event."
      )}`
    );
  }

  revalidatePath(`/admin/episode/${episodeNumber}`);
}

/** Finalize an episode. Requirements: 6.4, 14.1, 14.2 */
export async function finalizeEpisodeAction(formData: FormData) {
  const { supabase, league } = await getAdminLeague();

  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);
  const episodeId = await ensureEpisode(supabase, league.id, episodeNumber);

  // Fetch all eliminated castaways in this league
  const { data: eliminatedCastaways } = await supabase
    .from("castaways")
    .select("id, eliminated_episode")
    .eq("league_id", league.id)
    .eq("is_eliminated", true)
    .not("eliminated_episode", "is", null);

  const consolationEvents = buildConsolationEvents(
    episodeId,
    episodeNumber,
    (eliminatedCastaways ?? []).map((c) => ({
      castaway_id: c.id,
      eliminated_episode: c.eliminated_episode!,
    })),
    league.consolation_points
  );

  // Insert consolation events if any
  if (consolationEvents.length > 0) {
    const { error: consolationError } = await supabase
      .from("episode_events")
      .insert(consolationEvents);

    if (consolationError) {
      redirect(
        `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
          "Failed to insert consolation events."
        )}`
      );
    }
  }

  // Mark episode as finalized
  const { error } = await supabase
    .from("episodes")
    .update({ is_finalized: true, finalized_at: new Date().toISOString() })
    .eq("id", episodeId);

  if (error) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Failed to finalize episode."
      )}`
    );
  }

  revalidatePath(`/admin/episode/${episodeNumber}`);
  redirect(`/admin/episode/${episodeNumber}?success=finalized`);
}

/** Un-finalize an episode. Requirements: 6.6 */
export async function unfinalizeEpisodeAction(formData: FormData) {
  const { supabase, league } = await getAdminLeague();

  const episodeNumber = parseInt(formData.get("episode_number") as string, 10);

  const { data: episode } = await supabase
    .from("episodes")
    .select("id")
    .eq("league_id", league.id)
    .eq("number", episodeNumber)
    .single();

  if (!episode) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent("Episode not found.")}`
    );
  }

  // Remove consolation events (scoring_rule_id is null = consolation events)
  await supabase
    .from("episode_events")
    .delete()
    .eq("episode_id", episode.id)
    .is("scoring_rule_id", null);

  const { error } = await supabase
    .from("episodes")
    .update({ is_finalized: false, finalized_at: null })
    .eq("id", episode.id);

  if (error) {
    redirect(
      `/admin/episode/${episodeNumber}?error=${encodeURIComponent(
        "Failed to un-finalize episode."
      )}`
    );
  }

  revalidatePath(`/admin/episode/${episodeNumber}`);
  redirect(`/admin/episode/${episodeNumber}?success=unfinalized`);
}
