import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
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
import BatchScoringForm from "@/components/batch-scoring-form";
import type { Castaway } from "@/lib/castaways";
import type { ScoringRule } from "@/lib/scoring-rules";
import type { EpisodeEvent } from "@/lib/episodes";
import type { Challenge, ChallengeSubmission } from "@/lib/challenges";

interface PageProps {
  params: { id: string; num: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminEpisodePage({ params, searchParams }: PageProps) {
  const episodeNumber = parseInt(params.num, 10);
  if (isNaN(episodeNumber) || episodeNumber < 1) redirect("/dashboard");

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, consolation_points, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  const { data: episode } = await supabase
    .from("episodes").select("*").eq("league_id", leagueId).eq("number", episodeNumber).single();

  const { data: activeCastaways } = await supabase
    .from("castaways").select("*, tribes(name)").eq("league_id", leagueId).eq("is_eliminated", false).order("name");

  const { data: rules } = await supabase
    .from("scoring_rules").select("*").eq("league_id", leagueId).order("name");

  let events: Array<EpisodeEvent & { castaway_name: string; rule_name: string | null }> = [];
  if (episode) {
    const { data: rawEvents } = await supabase
      .from("episode_events")
      .select("id, episode_id, castaway_id, scoring_rule_id, points, created_at, castaways(name), scoring_rules(name)")
      .eq("episode_id", episode.id)
      .order("created_at", { ascending: false });

    events = (rawEvents ?? []).map((e: Record<string, unknown>) => ({
      id: e.id as string, episode_id: e.episode_id as string,
      castaway_id: e.castaway_id as string, scoring_rule_id: e.scoring_rule_id as string | null,
      points: e.points as number, created_at: e.created_at as string,
      castaway_name: (e.castaways as Record<string, unknown> | null)?.name as string ?? "Unknown",
      rule_name: (e.scoring_rules as Record<string, unknown> | null)?.name as string ?? null,
    }));
  }

  const isFinalized = episode?.is_finalized ?? false;
  const allCastaways = (activeCastaways ?? []) as Array<Record<string, unknown>>;
  const allRules: ScoringRule[] = rules ?? [];

  let challenges: Challenge[] = [];
  let challengeSubmissions: Array<ChallengeSubmission & { player_name: string }> = [];
  if (episode) {
    const { data: rawChallenges } = await supabase
      .from("challenges").select("*").eq("episode_id", episode.id).order("created_at");
    challenges = (rawChallenges ?? []) as Challenge[];

    if (challenges.length > 0) {
      const { data: rawSubmissions } = await supabase
        .from("challenge_submissions").select("*, profiles(display_name)")
        .in("challenge_id", challenges.map((c) => c.id)).order("submitted_at");

      challengeSubmissions = (rawSubmissions ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string, challenge_id: s.challenge_id as string,
        player_id: s.player_id as string, response: s.response as string,
        is_correct: s.is_correct as boolean | null, submitted_at: s.submitted_at as string,
        player_name: (s.profiles as Record<string, unknown> | null)?.display_name as string ?? "Unknown",
      }));
    }
  }

  const regularEvents = events.filter((e) => e.scoring_rule_id !== null);
  const consolationEvents = events.filter((e) => e.scoring_rule_id === null);

  const successMessage =
    searchParams.success === "finalized" ? "Episode finalized successfully."
    : searchParams.success === "unfinalized" ? "Episode un-finalized. You can now make corrections."
    : null;

  return (
    <AppShell
      title={`Episode ${episodeNumber} — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      badge={isFinalized ? "Finalized" : undefined}
      navLinks={getAllLeagueNavLinks(leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        {searchParams.error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{searchParams.error}</p>
        )}
        {successMessage && (
          <p role="status" className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">{successMessage}</p>
        )}

        {/* Episode navigation */}
        <nav className="flex items-center justify-between" aria-label="Episode navigation">
          {episodeNumber > 1 ? (
            <Link
              href={`/league/${leagueId}/admin/episode/${episodeNumber - 1}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              ← Episode {episodeNumber - 1}
            </Link>
          ) : (
            <span />
          )}
          <Link
            href={`/league/${leagueId}/admin/episode/${episodeNumber + 1}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Episode {episodeNumber + 1} →
          </Link>
        </nav>

        {/* Finalize / Un-finalize controls */}
        <section className="flex flex-wrap items-center gap-3">
          {!isFinalized ? (
            <form action={finalizeEpisodeAction}>
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <SubmitButton pendingText="Finalizing…" className="rounded bg-green-700 text-white px-4 py-2 text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-50">
                Finalize Episode
              </SubmitButton>
            </form>
          ) : (
            <form action={unfinalizeEpisodeAction}>
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <SubmitButton pendingText="Un-finalizing…" className="rounded border border-amber-600 text-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-50 transition-colors disabled:opacity-50">
                Un-finalize Episode
              </SubmitButton>
            </form>
          )}
          {league.consolation_points > 0 && (
            <p className="text-xs text-muted-foreground">
              Finalizing awards {league.consolation_points} consolation pt{league.consolation_points !== 1 ? "s" : ""} per eliminated castaway.
            </p>
          )}
        </section>

        {!isFinalized && (
          <section aria-labelledby="score-heading">
            <h2 id="score-heading" className="text-base font-semibold mb-3">Record Event</h2>
            <EpisodeScorerForm leagueId={leagueId} episodeNumber={episodeNumber} castaways={allCastaways as unknown as Castaway[]} rules={allRules} />
          </section>
        )}

        {!isFinalized && (
          <section aria-labelledby="batch-score-heading">
            <h2 id="batch-score-heading" className="text-base font-semibold mb-3">Batch Scoring</h2>
            <BatchScoringForm
              leagueId={leagueId}
              episodeNumber={episodeNumber}
              castaways={allCastaways.map((c) => ({
                id: c.id as string,
                name: c.name as string,
                tribe_name: c.tribes
                  ? (c.tribes as Record<string, unknown>)?.name as string | null ?? null
                  : null,
              }))}
              scoringRules={allRules.map((r) => ({ id: r.id, name: r.name, points: r.points }))}
            />
          </section>
        )}

        <section aria-labelledby="log-heading">
          <h2 id="log-heading" className="text-base font-semibold mb-3">Events ({regularEvents.length})</h2>
          {regularEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {regularEvents.map((event) => (
                <EventRow key={event.id} event={event} leagueId={leagueId} episodeNumber={episodeNumber} isFinalized={isFinalized} />
              ))}
            </ul>
          )}
        </section>

        {isFinalized && consolationEvents.length > 0 && (
          <section aria-labelledby="consolation-heading">
            <h2 id="consolation-heading" className="text-base font-semibold mb-3">Consolation Points ({consolationEvents.length})</h2>
            <ul className="space-y-2">
              {consolationEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 opacity-75">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm"><span className="font-medium">{event.castaway_name}</span><span className="text-muted-foreground"> — Consolation</span></p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground shrink-0">+{event.points}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="challenges-heading">
          <h2 id="challenges-heading" className="text-base font-semibold mb-3">Weekly Challenges</h2>
          <details className="rounded-lg border border-border bg-card mb-4">
            <summary className="px-4 py-3 text-sm font-medium cursor-pointer hover:bg-muted/50">+ Create New Challenge</summary>
            <form action={createChallengeAction} className="p-4 pt-0 space-y-3">
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <div>
                <label htmlFor="challenge-title" className="text-sm font-medium">Title</label>
                <input id="challenge-title" name="title" type="text" required className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm" placeholder="e.g. Who will win immunity?" />
              </div>
              <div>
                <label htmlFor="challenge-description" className="text-sm font-medium">Description</label>
                <textarea id="challenge-description" name="description" className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm" rows={2} placeholder="Optional details" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="challenge-points" className="text-sm font-medium">Points</label>
                  <input id="challenge-points" name="points" type="number" min="1" required className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm" placeholder="5" />
                </div>
                <div>
                  <label htmlFor="challenge-deadline" className="text-sm font-medium">Deadline</label>
                  <input id="challenge-deadline" name="deadline" type="datetime-local" required className="mt-1 w-full rounded border border-input bg-background px-3 py-2 text-sm" />
                </div>
              </div>
              <SubmitButton pendingText="Creating…" className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50">
                Create Challenge
              </SubmitButton>
            </form>
          </details>

          {challenges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No challenges for this episode yet.</p>
          ) : (
            <div className="space-y-4">
              {challenges.map((challenge) => {
                const isPastDeadline = new Date(challenge.deadline) < new Date();
                const submissions = challengeSubmissions.filter((s) => s.challenge_id === challenge.id);
                return (
                  <ChallengeCard key={challenge.id} challenge={challenge} isPastDeadline={isPastDeadline}
                    submissions={submissions} leagueId={leagueId} episodeNumber={episodeNumber} />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function EventRow({
  event, leagueId, episodeNumber, isFinalized,
}: {
  event: EpisodeEvent & { castaway_name: string; rule_name: string | null };
  leagueId: string; episodeNumber: number; isFinalized: boolean;
}) {
  const isNegative = event.points < 0;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {event.castaway_name}<span className="text-muted-foreground font-normal"> — </span>{event.rule_name ?? "Custom"}
        </p>
      </div>
      <span className={`text-sm font-semibold tabular-nums shrink-0 ${isNegative ? "text-destructive" : "text-green-700"}`}>
        {event.points > 0 ? `+${event.points}` : event.points}
      </span>
      {!isFinalized && (
        <form action={removeEpisodeEventAction} className="shrink-0">
          <input type="hidden" name="league_id" value={leagueId} />
          <input type="hidden" name="event_id" value={event.id} />
          <input type="hidden" name="episode_number" value={episodeNumber} />
          <SubmitButton className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50">
            Remove
          </SubmitButton>
        </form>
      )}
    </li>
  );
}

function ChallengeCard({
  challenge, isPastDeadline, submissions, leagueId, episodeNumber,
}: {
  challenge: Challenge; isPastDeadline: boolean;
  submissions: Array<ChallengeSubmission & { player_name: string }>;
  leagueId: string; episodeNumber: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{challenge.title}</h3>
          {challenge.description && <p className="text-xs text-muted-foreground mt-0.5">{challenge.description}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            {challenge.points} pts · Deadline: {new Date(challenge.deadline).toLocaleString()}
            {isPastDeadline && <span className="ml-2 text-amber-600 font-medium">Past deadline</span>}
          </p>
        </div>
        {!isPastDeadline && (
          <div className="flex gap-1 shrink-0">
            <details className="relative">
              <summary className="rounded border border-input px-2 py-1 text-xs cursor-pointer hover:bg-muted">Edit</summary>
              <div className="absolute right-0 top-full mt-1 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
                <form action={updateChallengeAction} className="space-y-2">
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="episode_number" value={episodeNumber} />
                  <input type="hidden" name="challenge_id" value={challenge.id} />
                  <input name="title" type="text" defaultValue={challenge.title} required className="w-full rounded border border-input bg-background px-2 py-1 text-sm" />
                  <textarea name="description" defaultValue={challenge.description ?? ""} className="w-full rounded border border-input bg-background px-2 py-1 text-sm" rows={2} />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="points" type="number" min="1" defaultValue={challenge.points} required className="w-full rounded border border-input bg-background px-2 py-1 text-sm" />
                    <input name="deadline" type="datetime-local" defaultValue={challenge.deadline.slice(0, 16)} required className="w-full rounded border border-input bg-background px-2 py-1 text-sm" />
                  </div>
                  <SubmitButton pendingText="Saving…" className="rounded bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">Save</SubmitButton>
                </form>
              </div>
            </details>
            <form action={deleteChallengeAction}>
              <input type="hidden" name="league_id" value={leagueId} />
              <input type="hidden" name="episode_number" value={episodeNumber} />
              <input type="hidden" name="challenge_id" value={challenge.id} />
              <SubmitButton className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 disabled:opacity-50">Delete</SubmitButton>
            </form>
          </div>
        )}
      </div>

      {submissions.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium mb-2">Submissions ({submissions.length})</p>
          <ul className="space-y-2">
            {submissions.map((sub) => (
              <li key={sub.id} className="flex items-center gap-3 rounded border border-border px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{sub.player_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{sub.response}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <form action={gradeChallengeSubmissionAction}>
                    <input type="hidden" name="league_id" value={leagueId} />
                    <input type="hidden" name="episode_number" value={episodeNumber} />
                    <input type="hidden" name="submission_id" value={sub.id} />
                    <input type="hidden" name="is_correct" value="true" />
                    <SubmitButton className={`rounded px-2 py-1 text-xs font-medium min-h-[28px] ${sub.is_correct === true ? "bg-green-100 text-green-800 border border-green-300" : "border border-input hover:bg-green-50 text-muted-foreground"} disabled:opacity-50`}>✓</SubmitButton>
                  </form>
                  <form action={gradeChallengeSubmissionAction}>
                    <input type="hidden" name="league_id" value={leagueId} />
                    <input type="hidden" name="episode_number" value={episodeNumber} />
                    <input type="hidden" name="submission_id" value={sub.id} />
                    <input type="hidden" name="is_correct" value="false" />
                    <SubmitButton className={`rounded px-2 py-1 text-xs font-medium min-h-[28px] ${sub.is_correct === false ? "bg-red-100 text-red-800 border border-red-300" : "border border-input hover:bg-red-50 text-muted-foreground"} disabled:opacity-50`}>✗</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submissions.length === 0 && isPastDeadline && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">No submissions received.</p>
      )}
    </div>
  );
}
