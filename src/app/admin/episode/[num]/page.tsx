import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import {
  removeEpisodeEventAction,
  finalizeEpisodeAction,
  unfinalizeEpisodeAction,
  createChallengeAction,
  updateChallengeAction,
  deleteChallengeAction,
  gradeChallengeSubmissionAction,
} from "./actions";
import EpisodeScorerForm from "@/components/episode-scorer-form";
import type { Castaway } from "@/lib/castaways";
import type { ScoringRule } from "@/lib/scoring-rules";
import type { EpisodeEvent } from "@/lib/episodes";
import type { Challenge, ChallengeSubmission } from "@/lib/challenges";

interface PageProps {
  params: { num: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminEpisodePage({ params, searchParams }: PageProps) {
  const episodeNumber = parseInt(params.num, 10);
  if (isNaN(episodeNumber) || episodeNumber < 1) redirect("/dashboard");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, consolation_points")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch episode (may not exist yet — created on first event or finalize)
  const { data: episode } = await supabase
    .from("episodes")
    .select("*")
    .eq("league_id", league.id)
    .eq("number", episodeNumber)
    .single();

  // Fetch active castaways for the scorer grid
  const { data: activeCastaways } = await supabase
    .from("castaways")
    .select("*")
    .eq("league_id", league.id)
    .eq("is_eliminated", false)
    .order("name", { ascending: true });

  // Fetch scoring rules
  const { data: rules } = await supabase
    .from("scoring_rules")
    .select("*")
    .eq("league_id", league.id)
    .order("name", { ascending: true });

  // Fetch episode events with castaway and rule names (only if episode exists)
  let events: Array<
    EpisodeEvent & { castaway_name: string; rule_name: string | null }
  > = [];

  if (episode) {
    const { data: rawEvents } = await supabase
      .from("episode_events")
      .select(
        "id, episode_id, castaway_id, scoring_rule_id, points, created_at, castaways(name), scoring_rules(name)"
      )
      .eq("episode_id", episode.id)
      .order("created_at", { ascending: false });

    events = (rawEvents ?? []).map((e: Record<string, unknown>) => ({
      id: e.id as string,
      episode_id: e.episode_id as string,
      castaway_id: e.castaway_id as string,
      scoring_rule_id: e.scoring_rule_id as string | null,
      points: e.points as number,
      created_at: e.created_at as string,
      castaway_name: (e.castaways as Record<string, unknown> | null)?.name as string ?? "Unknown",
      rule_name: (e.scoring_rules as Record<string, unknown> | null)?.name as string ?? null,
    }));
  }

  const isFinalized = episode?.is_finalized ?? false;
  const allCastaways: Castaway[] = activeCastaways ?? [];
  const allRules: ScoringRule[] = rules ?? [];

  // Fetch challenges for this episode
  let challenges: Challenge[] = [];
  let challengeSubmissions: Array<ChallengeSubmission & { player_name: string }> = [];

  if (episode) {
    const { data: rawChallenges } = await supabase
      .from("challenges")
      .select("*")
      .eq("episode_id", episode.id)
      .order("created_at", { ascending: true });

    challenges = (rawChallenges ?? []) as Challenge[];

    // Fetch all submissions for challenges in this episode
    if (challenges.length > 0) {
      const challengeIds = challenges.map((c) => c.id);
      const { data: rawSubmissions } = await supabase
        .from("challenge_submissions")
        .select("*, profiles(display_name)")
        .in("challenge_id", challengeIds)
        .order("submitted_at", { ascending: true });

      challengeSubmissions = (rawSubmissions ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        challenge_id: s.challenge_id as string,
        player_id: s.player_id as string,
        response: s.response as string,
        is_correct: s.is_correct as boolean | null,
        submitted_at: s.submitted_at as string,
        player_name: (s.profiles as Record<string, unknown> | null)?.display_name as string ?? "Unknown",
      }));
    }
  }

  // Separate regular events from consolation events (consolation have no scoring_rule_id)
  const regularEvents = events.filter((e) => e.scoring_rule_id !== null);
  const consolationEvents = events.filter((e) => e.scoring_rule_id === null);

  const successMessage =
    searchParams.success === "finalized"
      ? "Episode finalized successfully."
      : searchParams.success === "unfinalized"
      ? "Episode un-finalized. You can now make corrections."
      : null;

  return (
    <AppShell
      title={`Episode ${episodeNumber} — ${league.name}`}
      backHref="/dashboard"
      backLabel="Dashboard"
      badge={isFinalized ? "Finalized" : undefined}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {successMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {successMessage}
          </p>
        )}

        {/* Finalize / Un-finalize controls */}
        <section className="flex flex-wrap items-center gap-3">
          {!isFinalized ? (
            <form action={finalizeEpisodeAction}>
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <button
                type="submit"
                className="rounded bg-green-700 text-white px-4 py-2 text-sm font-medium hover:bg-green-800 transition-colors"
              >
                Finalize Episode
              </button>
            </form>
          ) : (
            <form action={unfinalizeEpisodeAction}>
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <button
                type="submit"
                className="rounded border border-amber-600 text-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-50 transition-colors"
              >
                Un-finalize Episode
              </button>
            </form>
          )}
          {league.consolation_points > 0 && (
            <p className="text-xs text-muted-foreground">
              Finalizing awards {league.consolation_points} consolation pt
              {league.consolation_points !== 1 ? "s" : ""} per eliminated castaway.
            </p>
          )}
        </section>

        {/* Scoring interface — hidden when finalized */}
        {!isFinalized && (
          <section aria-labelledby="score-heading">
            <h2 id="score-heading" className="text-base font-semibold mb-3">
              Record Event
            </h2>
            <EpisodeScorerForm
              episodeNumber={episodeNumber}
              castaways={allCastaways}
              rules={allRules}
            />
          </section>
        )}

        {/* Regular event log */}
        <section aria-labelledby="log-heading">
          <h2 id="log-heading" className="text-base font-semibold mb-3">
            Events ({regularEvents.length})
          </h2>

          {regularEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {regularEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  episodeNumber={episodeNumber}
                  isFinalized={isFinalized}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Consolation points (shown after finalization) */}
        {isFinalized && consolationEvents.length > 0 && (
          <section aria-labelledby="consolation-heading">
            <h2 id="consolation-heading" className="text-base font-semibold mb-3">
              Consolation Points ({consolationEvents.length})
            </h2>
            <ul className="space-y-2">
              {consolationEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 opacity-75"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{event.castaway_name}</span>
                      <span className="text-muted-foreground"> — Consolation</span>
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground shrink-0">
                    +{event.points}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Weekly Challenges Section */}
        <section aria-labelledby="challenges-heading">
          <h2 id="challenges-heading" className="text-base font-semibold mb-3">
            Weekly Challenges
          </h2>

          {/* Challenge creation form */}
          <details className="rounded-lg border border-border bg-card mb-4">
            <summary className="px-4 py-3 text-sm font-medium cursor-pointer hover:bg-muted/50">
              + Create New Challenge
            </summary>
            <form action={createChallengeAction} className="p-4 pt-0 space-y-3">
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <div>
                <label htmlFor="challenge-title" className="text-sm font-medium">
                  Title
                </label>
                <input
                  id="challenge-title"
                  name="title"
                  type="text"
                  required
                  className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Who will win immunity?"
                />
              </div>
              <div>
                <label htmlFor="challenge-description" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="challenge-description"
                  name="description"
                  className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Optional details about the challenge"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="challenge-points" className="text-sm font-medium">
                    Points
                  </label>
                  <input
                    id="challenge-points"
                    name="points"
                    type="number"
                    min="1"
                    required
                    className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                    placeholder="5"
                  />
                </div>
                <div>
                  <label htmlFor="challenge-deadline" className="text-sm font-medium">
                    Deadline
                  </label>
                  <input
                    id="challenge-deadline"
                    name="deadline"
                    type="datetime-local"
                    required
                    className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px]"
              >
                Create Challenge
              </button>
            </form>
          </details>

          {/* Existing challenges list */}
          {challenges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No challenges for this episode yet.
            </p>
          ) : (
            <div className="space-y-4">
              {challenges.map((challenge) => {
                const isPastDeadline = new Date(challenge.deadline) < new Date();
                const submissions = challengeSubmissions.filter(
                  (s) => s.challenge_id === challenge.id
                );

                return (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    isPastDeadline={isPastDeadline}
                    submissions={submissions}
                    episodeNumber={episodeNumber}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Event row in the log
// ---------------------------------------------------------------------------

function EventRow({
  event,
  episodeNumber,
  isFinalized,
}: {
  event: EpisodeEvent & { castaway_name: string; rule_name: string | null };
  episodeNumber: number;
  isFinalized: boolean;
}) {
  const isNegative = event.points < 0;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {event.castaway_name}
          <span className="text-muted-foreground font-normal"> — </span>
          {event.rule_name ?? "Custom"}
        </p>
      </div>

      <span
        className={`text-sm font-semibold tabular-nums shrink-0 ${
          isNegative ? "text-destructive" : "text-green-700"
        }`}
      >
        {event.points > 0 ? `+${event.points}` : event.points}
      </span>

      {!isFinalized && (
        <form action={removeEpisodeEventAction} className="shrink-0">
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="episode_number" value={episodeNumber} />
          <button
            type="submit"
            aria-label="Remove event"
            className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors"
          >
            Remove
          </button>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Challenge card with edit/delete and submission grading
// ---------------------------------------------------------------------------

function ChallengeCard({
  challenge,
  isPastDeadline,
  submissions,
  episodeNumber,
}: {
  challenge: Challenge;
  isPastDeadline: boolean;
  submissions: Array<ChallengeSubmission & { player_name: string }>;
  episodeNumber: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{challenge.title}</h3>
          {challenge.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {challenge.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {challenge.points} pts · Deadline:{" "}
            {new Date(challenge.deadline).toLocaleString()}
            {isPastDeadline && (
              <span className="ml-2 text-amber-600 font-medium">Past deadline</span>
            )}
          </p>
        </div>

        {/* Edit/Delete only before deadline */}
        {!isPastDeadline && (
          <div className="flex gap-1 shrink-0">
            <details className="relative">
              <summary className="rounded border border-input px-2 py-1 text-xs cursor-pointer hover:bg-muted">
                Edit
              </summary>
              <div className="absolute right-0 top-full mt-1 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
                <form action={updateChallengeAction} className="space-y-2">
                  <input type="hidden" name="episode_number" value={episodeNumber} />
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input
                    name="title"
                    type="text"
                    defaultValue={challenge.title}
                    required
                    className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                  />
                  <textarea
                    name="description"
                    defaultValue={challenge.description ?? ""}
                    className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                    rows={2}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="points"
                      type="number"
                      min="1"
                      defaultValue={challenge.points}
                      required
                      className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                    />
                    <input
                      name="deadline"
                      type="datetime-local"
                      defaultValue={challenge.deadline.slice(0, 16)}
                      required
                      className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs font-medium"
                  >
                    Save
                  </button>
                </form>
              </div>
            </details>
            <form action={deleteChallengeAction}>
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <button
                type="submit"
                className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10"
              >
                Delete
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Submissions grading */}
      {submissions.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium mb-2">
            Submissions ({submissions.length})
          </p>
          <ul className="space-y-2">
            {submissions.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center gap-3 rounded border border-border px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{sub.player_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {sub.response}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <form action={gradeChallengeSubmissionAction}>
                    <input type="hidden" name="episode_number" value={episodeNumber} />
                    <input type="hidden" name="submission_id" value={sub.id} />
                    <input type="hidden" name="is_correct" value="true" />
                    <button
                      type="submit"
                      className={`rounded px-2 py-1 text-xs font-medium min-h-[28px] ${
                        sub.is_correct === true
                          ? "bg-green-100 text-green-800 border border-green-300"
                          : "border border-input hover:bg-green-50 text-muted-foreground"
                      }`}
                    >
                      ✓
                    </button>
                  </form>
                  <form action={gradeChallengeSubmissionAction}>
                    <input type="hidden" name="episode_number" value={episodeNumber} />
                    <input type="hidden" name="submission_id" value={sub.id} />
                    <input type="hidden" name="is_correct" value="false" />
                    <button
                      type="submit"
                      className={`rounded px-2 py-1 text-xs font-medium min-h-[28px] ${
                        sub.is_correct === false
                          ? "bg-red-100 text-red-800 border border-red-300"
                          : "border border-input hover:bg-red-50 text-muted-foreground"
                      }`}
                    >
                      ✗
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submissions.length === 0 && isPastDeadline && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">
          No submissions received.
        </p>
      )}
    </div>
  );
}
