import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getLeagueNavLinks } from "@/components/league-nav";
import { submitChallengeResponseAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string };
}

export default async function ChallengesPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  // Verify membership
  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();

  if (!membership) redirect("/dashboard");

  // Fetch league info
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch all challenges for this league with episode info
  const { data: rawChallenges } = await supabase
    .from("challenges")
    .select("*, episodes(number)")
    .eq("league_id", leagueId)
    .order("deadline", { ascending: false });

  const challenges = (rawChallenges ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    title: c.title as string,
    description: c.description as string | null,
    points: c.points as number,
    deadline: c.deadline as string,
    episode_number: (c.episodes as Record<string, unknown> | null)?.number as number ?? 0,
  }));

  // Fetch user's submissions
  const { data: rawSubmissions } = await supabase
    .from("challenge_submissions")
    .select("challenge_id, response, is_correct, submitted_at")
    .eq("player_id", user.id)
    .in(
      "challenge_id",
      challenges.map((c) => c.id)
    );

  const submissionMap = new Map(
    (rawSubmissions ?? []).map((s) => [s.challenge_id, s])
  );

  const now = new Date();

  return (
    <AppShell
      title={`${league.name} — Weekly Challenges`}
      backHref="/dashboard"
      backLabel="Dashboard"
      navLinks={getLeagueNavLinks(leagueId)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {challenges.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No challenges have been created yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {challenges.map((challenge) => {
              const deadline = new Date(challenge.deadline);
              const isPastDeadline = now > deadline;
              const submission = submissionMap.get(challenge.id);

              return (
                <div
                  key={challenge.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold">{challenge.title}</h2>
                      {challenge.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {challenge.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Episode {challenge.episode_number} · {challenge.points} pts ·
                        Deadline: {deadline.toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {isPastDeadline ? (
                        <span className="text-xs rounded px-2 py-0.5 bg-muted text-muted-foreground">
                          Closed
                        </span>
                      ) : (
                        <span className="text-xs rounded px-2 py-0.5 bg-green-100 text-green-800">
                          Open
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Show existing submission or submission form */}
                  {submission ? (
                    <div className="border-t border-border pt-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        Your submission:
                      </p>
                      <p className="text-sm">{submission.response}</p>
                      {submission.is_correct === true && (
                        <p className="text-xs text-green-700 font-medium mt-1">
                          ✓ Correct — {challenge.points} pts awarded
                        </p>
                      )}
                      {submission.is_correct === false && (
                        <p className="text-xs text-destructive font-medium mt-1">
                          ✗ Incorrect
                        </p>
                      )}
                      {submission.is_correct === null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Awaiting grading
                        </p>
                      )}
                    </div>
                  ) : !isPastDeadline ? (
                    <form
                      action={submitChallengeResponseAction}
                      className="border-t border-border pt-3 space-y-2"
                    >
                      <input type="hidden" name="league_id" value={leagueId} />
                      <input type="hidden" name="challenge_id" value={challenge.id} />
                      <label
                        htmlFor={`response-${challenge.id}`}
                        className="text-xs font-medium"
                      >
                        Your response
                      </label>
                      <textarea
                        id={`response-${challenge.id}`}
                        name="response"
                        required
                        rows={2}
                        className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                        placeholder="Enter your answer..."
                      />
                      <button
                        type="submit"
                        className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px]"
                      >
                        Submit
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs text-muted-foreground border-t border-border pt-2">
                      You did not submit a response before the deadline.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
