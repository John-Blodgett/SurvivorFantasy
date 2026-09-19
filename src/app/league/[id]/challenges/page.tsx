import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import EditChallengeResponse from "@/components/edit-challenge-response";
import { submitChallengeResponseAction } from "./actions";
import { formatPacificDeadline } from "@/lib/timezone";
import {
  normalizeChallengeType,
  normalizeDropdownScope,
  resolveDropdownOptions,
  resolveDropdownDisplay,
  type ChallengeType,
  type CastawayOption,
} from "@/lib/challenges";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
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
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league) redirect("/dashboard");

  const isAdmin = league.admin_id === user.id;

  // Fetch all challenges for this league with episode info
  const { data: rawChallenges } = await supabase
    .from("challenges")
    .select("*, episodes(number, is_finalized)")
    .eq("league_id", leagueId)
    .order("deadline", { ascending: false });

  const challenges = (rawChallenges ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    title: c.title as string,
    description: c.description as string | null,
    points: c.points as number,
    deadline: c.deadline as string,
    challenge_type: normalizeChallengeType(c.challenge_type as string | null | undefined),
    options: (c.options as string[] | null) ?? null,
    dropdown_scope: c.dropdown_scope as string | null | undefined,
    episode_number: (c.episodes as Record<string, unknown> | null)?.number as number ?? 0,
    is_episode_finalized: (c.episodes as Record<string, unknown> | null)?.is_finalized as boolean ?? false,
  }));

  // Fetch league castaways (for survivor-dropdown challenges). The option list
  // is derived from live castaway state at render time (Req 4.6).
  const { data: rawCastaways } = await supabase
    .from("castaways")
    .select("id, name, is_eliminated")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  const castaways: CastawayOption[] = (rawCastaways ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    is_eliminated: (c.is_eliminated as boolean) ?? false,
  }));

  // Fetch user's submissions
  const { data: rawSubmissions } = await supabase
    .from("challenge_submissions")
    .select("id, challenge_id, response, is_correct, submitted_at")
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
      navLinks={getAllLeagueNavLinks(leagueId, isAdmin)}
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

        {searchParams.success && (
          <p
            role="status"
            className="text-sm text-green-800 bg-green-100 rounded-md px-3 py-2"
          >
            {searchParams.success}
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
              const isPastDeadline = now > deadline || challenge.is_episode_finalized;
              const submission = submissionMap.get(challenge.id);

              const type: ChallengeType = challenge.challenge_type;

              // For survivor-dropdown challenges, resolve the option list from
              // live castaway state (Req 4.4–4.6).
              const dropdownScope = normalizeDropdownScope(challenge.dropdown_scope);
              const dropdownOptions =
                type === "survivor_dropdown"
                  ? resolveDropdownOptions(dropdownScope, castaways)
                  : [];

              // Display an existing submission: for dropdowns, resolve the
              // stored castaway id to a name, falling back to the raw value
              // when it no longer resolves (Req 6.4, 6.6).
              const submissionDisplay = submission
                ? type === "survivor_dropdown"
                  ? resolveDropdownDisplay(submission.response, castaways)
                  : submission.response
                : "";

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
                        Deadline: {formatPacificDeadline(challenge.deadline)} PT
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
                      <p className="text-sm">{submissionDisplay}</p>
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
                      {/* Edit button: only if not graded and deadline hasn't passed */}
                      {submission.is_correct === null && !isPastDeadline && (
                        <EditChallengeResponse
                          leagueId={leagueId}
                          submissionId={submission.id}
                          currentResponse={submission.response}
                        />
                      )}
                    </div>
                  ) : !isPastDeadline ? (
                    // Suppress the input when a multiple-choice challenge has
                    // fewer than two options (Req 4.3).
                    type === "multiple_choice" &&
                    (challenge.options?.length ?? 0) < 2 ? (
                      <p
                        role="alert"
                        className="text-xs text-destructive border-t border-border pt-3"
                      >
                        This challenge is not answerable.
                      </p>
                    ) : // Suppress the input when a survivor-dropdown resolves to
                    // zero eligible castaways (Req 4.7).
                    type === "survivor_dropdown" && dropdownOptions.length === 0 ? (
                      <p
                        role="alert"
                        className="text-xs text-destructive border-t border-border pt-3"
                      >
                        No eligible options are available.
                      </p>
                    ) : (
                      <form
                        action={submitChallengeResponseAction}
                        className="border-t border-border pt-3 space-y-2"
                      >
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="challenge_id" value={challenge.id} />

                        {type === "multiple_choice" ? (
                          <fieldset className="space-y-2">
                            <legend className="text-xs font-medium">
                              Your response
                            </legend>
                            {(challenge.options ?? []).map((option, index) => {
                              const optionId = `response-${challenge.id}-${index}`;
                              return (
                                <div key={optionId} className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    id={optionId}
                                    name="response"
                                    value={option}
                                    required
                                    className="h-4 w-4 border-input text-primary focus:ring-primary"
                                  />
                                  <label htmlFor={optionId} className="text-sm">
                                    {option}
                                  </label>
                                </div>
                              );
                            })}
                          </fieldset>
                        ) : type === "survivor_dropdown" ? (
                          <>
                            <label
                              htmlFor={`response-${challenge.id}`}
                              className="text-xs font-medium"
                            >
                              Your response
                            </label>
                            <select
                              id={`response-${challenge.id}`}
                              name="response"
                              required
                              defaultValue=""
                              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                              aria-label="Select a castaway"
                            >
                              <option value="" disabled>
                                Select a castaway…
                              </option>
                              {dropdownOptions.map((castaway) => (
                                <option key={castaway.id} value={castaway.id}>
                                  {castaway.name}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <>
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
                              maxLength={500}
                              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                              placeholder="Enter your answer..."
                            />
                          </>
                        )}

                        <SubmitButton
                          pendingText="Submitting…"
                          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50"
                        >
                          Submit
                        </SubmitButton>
                      </form>
                    )
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
