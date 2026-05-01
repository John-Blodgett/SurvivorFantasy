import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  removeEpisodeEventAction,
  finalizeEpisodeAction,
  unfinalizeEpisodeAction,
} from "./actions";
import EpisodeScorerForm from "@/components/episode-scorer-form";
import type { Castaway } from "@/lib/castaways";
import type { ScoringRule } from "@/lib/scoring-rules";
import type { EpisodeEvent } from "@/lib/episodes";

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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">
          Episode {episodeNumber} — {league.name}
        </h1>
        {isFinalized && (
          <span className="ml-auto text-xs font-medium rounded px-2 py-0.5 bg-green-100 text-green-800">
            Finalized
          </span>
        )}
      </header>

      <main className="p-4 max-w-3xl mx-auto space-y-6">
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
      </main>
    </div>
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
