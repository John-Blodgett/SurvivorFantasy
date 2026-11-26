import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { buildLeagueNav } from "@/components/league-nav";
import SeasonReplayChart from "@/components/season-replay-chart";
import FadeInOnScroll from "@/components/fade-in-on-scroll";
import { loadAwardsInput } from "@/lib/league-awards";
import {
  AWARD_CATALOGUE,
  AWARD_EMOJI,
  buildStandingsHistory,
  computeAwards,
  flattenWinners,
} from "@/lib/awards";
import {
  AWARD_TINTS,
  buildRecapSeries,
  computePodium,
  initials,
  type PodiumStep,
} from "@/lib/season-recap";

interface PageProps {
  params: { id: string };
}

interface AwardRowWithName {
  award_key: string;
  player_id: string;
  stat_detail: string | null;
  profiles: { display_name: string } | null;
}

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

/**
 * Season Recap: final podium, an animated replay of everyone's points, and
 * the saved season awards. Only available once the season is complete;
 * before that it redirects to the leaderboard and reveals nothing.
 */
export default async function SeasonRecapPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season_number, admin_id, is_complete")
    .eq("id", leagueId)
    .single();
  if (!league) redirect("/dashboard");
  const isAdmin = league.admin_id === user.id;

  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();
  if (!membership && !isAdmin) redirect("/dashboard");

  // Players only see the recap once the season is complete. The admin can
  // preview it at any time; the preview uses live awards since none are saved.
  const isPreview = !league.is_complete;
  if (isPreview && !isAdmin) redirect(`/league/${leagueId}/leaderboard`);

  // Standings history drives both the podium and the replay chart.
  const input = await loadAwardsInput(supabase, leagueId);
  const history = buildStandingsHistory(input);
  const chartData = buildRecapSeries(history, input.players);

  const finalEntries = input.players.map((p) => {
    const last = history.standings.get(p.player_id)?.slice(-1)[0];
    return {
      player_id: p.player_id,
      display_name: p.display_name,
      total: last?.total ?? 0,
      rank: last?.rank ?? input.players.length,
    };
  });
  const podium = computePodium(finalEntries);
  const colorOf = new Map(chartData.series.map((s) => [s.player_id, s.color]));

  // What each podium player ended the season with.
  const castawayName = new Map(input.castaways.map((c) => [c.id, c.name]));
  const endedWith = new Map<string, string[]>();
  for (const a of input.assignments) {
    const list = endedWith.get(a.player_id) ?? [];
    list.push(castawayName.get(a.castaway_id) ?? "Unknown");
    endedWith.set(a.player_id, list);
  }
  for (const ally of input.allies) {
    if (ally.ended_at !== null) continue;
    const list = endedWith.get(ally.player_id) ?? [];
    list.push(`🤝 ${castawayName.get(ally.castaway_id) ?? "Unknown"}`);
    endedWith.set(ally.player_id, list);
  }

  // Awards: saved rows once complete (frozen at completion), live in preview.
  let rows: AwardRowWithName[];
  if (isPreview) {
    const names = new Map(input.players.map((p) => [p.player_id, p.display_name]));
    rows = flattenWinners(computeAwards(input)).map((r) => ({
      award_key: r.award_key,
      player_id: r.player_id,
      stat_detail: r.stat_detail,
      profiles: { display_name: names.get(r.player_id) ?? "Unknown Player" },
    }));
  } else {
    const { data: rowsRaw } = await supabase
      .from("league_awards")
      .select("award_key, player_id, stat_detail, profiles(display_name)")
      .eq("league_id", leagueId);
    rows = (rowsRaw ?? []) as unknown as AwardRowWithName[];
  }
  const byKey = new Map<string, AwardRowWithName[]>();
  for (const r of rows) {
    const list = byKey.get(r.award_key) ?? [];
    list.push(r);
    byKey.set(r.award_key, list);
  }
  // One flat list in catalogue order. Skips saved keys no longer in the catalogue.
  const givenAwards = AWARD_CATALOGUE.filter((a) => (byKey.get(a.key)?.length ?? 0) > 0);

  return (
    <AppShell
      title={`${league.name} — Season Recap`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="Leaderboard"
      navLinks={await buildLeagueNav(supabase, leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-10">
        {isPreview ? (
          <p
            role="status"
            className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-md px-3 py-2"
          >
            Admin preview. Players can&apos;t see this page until you mark the season complete.
            Everything here uses current data, and the awards are the ones that would be given
            right now.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Season {league.season_number} is in the books. Here&apos;s how it went.
          </p>
        )}

        {/* Podium */}
        <section aria-labelledby="podium-heading" className="space-y-4">
          <h2 id="podium-heading" className="text-lg font-semibold">
            {isPreview ? "Podium So Far" : "Final Podium"}
          </h2>
          <Podium steps={podium} colorOf={colorOf} endedWith={endedWith} />
        </section>

        {/* Replay chart */}
        <section aria-labelledby="replay-heading" className="space-y-3">
          <div className="space-y-1">
            <h2 id="replay-heading" className="text-lg font-semibold">
              The Season, Episode by Episode
            </h2>
            <p className="text-sm text-muted-foreground">
              Watch everyone&apos;s points climb from episode 1. Tap a name to follow one player.
            </p>
          </div>
          <SeasonReplayChart data={chartData} currentPlayerId={user.id} />
        </section>

        {/* Awards */}
        <section aria-labelledby="awards-heading" className="space-y-6">
          <div className="space-y-1">
            <h2 id="awards-heading" className="text-lg font-semibold">
              Season Awards
            </h2>
            <p className="text-sm text-muted-foreground">
              Just for fun. Awards don&apos;t change anyone&apos;s points.
            </p>
          </div>

          {givenAwards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">No awards were earned this season.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {givenAwards.map((def, index) => {
                const winners = [...(byKey.get(def.key) ?? [])].sort((a, b) =>
                  (a.profiles?.display_name ?? "").localeCompare(b.profiles?.display_name ?? "")
                );
                const tint = AWARD_TINTS[AWARD_CATALOGUE.indexOf(def) % AWARD_TINTS.length];
                return (
                  <FadeInOnScroll key={def.key} delay={(index % 2) * 120}>
                    <article className="h-full rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                      <div className="flex items-start gap-4">
                        <span
                          className="shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-3xl"
                          style={{ backgroundColor: tint }}
                          aria-hidden="true"
                        >
                          {AWARD_EMOJI[def.key] ?? "🏅"}
                        </span>
                        <div className="min-w-0 space-y-0.5 pt-1">
                          <h3 className="font-semibold leading-tight">{def.name}</h3>
                          <p className="text-xs italic text-muted-foreground">{def.description}</p>
                        </div>
                      </div>
                      <ul className="space-y-2">
                        {winners.map((w) => (
                          <li key={w.player_id} className="min-w-0">
                            <p className="font-semibold leading-tight">
                              {w.profiles?.display_name ?? "Unknown Player"}
                            </p>
                            {w.stat_detail && (
                              <p className="text-xs text-muted-foreground">{w.stat_detail}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </article>
                  </FadeInOnScroll>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/** Step look per place: block height, block color, and order (2nd, 1st, 3rd). */
const STEP_STYLE: Record<number, { height: string; color: string; order: string; label: string }> = {
  1: { height: "h-36 sm:h-44", color: "#f5c542", order: "order-2", label: "1st place" },
  2: { height: "h-24 sm:h-32", color: "#cbd5e1", order: "order-1", label: "2nd place" },
  3: { height: "h-16 sm:h-24", color: "#d08b4f", order: "order-3", label: "3rd place" },
};

/**
 * A real podium: three stepped blocks (2nd, 1st, 3rd) with the finishers
 * standing on top. Tied players share a step. A place nobody holds (for
 * example no 3rd after a tie for 2nd) shows an empty step so the podium keeps
 * its shape.
 */
function Podium({
  steps,
  colorOf,
  endedWith,
}: {
  steps: PodiumStep[];
  colorOf: Map<string, string>;
  endedWith: Map<string, string[]>;
}) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No standings yet.</p>;
  }

  return (
    <ol className="flex items-end justify-center gap-2 sm:gap-4 pt-2">
      {[1, 2, 3].map((rank) => {
        const style = STEP_STYLE[rank];
        const step = steps.find((s) => s.rank === rank);
        return (
          <li
            key={rank}
            className={`${style.order} flex flex-col items-center justify-end w-[32%] max-w-[12rem]`}
            aria-hidden={step ? undefined : true}
            aria-label={step ? `${style.label}${step.players.length > 1 ? " (tie)" : ""}` : undefined}
          >
            {/* Finishers standing on the step */}
            {step && (
              <div className="flex flex-col items-center gap-2 pb-2 w-full">
                {rank === 1 && (
                  <span className="text-3xl leading-none" aria-hidden="true">
                    👑
                  </span>
                )}
                <ul className="flex flex-wrap justify-center gap-x-3 gap-y-2 w-full">
                  {step.players.map((p) => (
                    <li key={p.player_id} className="flex flex-col items-center text-center min-w-0 max-w-full">
                      <span
                        className={`rounded-full flex items-center justify-center font-bold text-white shadow-sm ${
                          rank === 1 ? "w-14 h-14 text-lg" : "w-11 h-11 text-sm"
                        }`}
                        style={{ backgroundColor: colorOf.get(p.player_id) }}
                        aria-hidden="true"
                      >
                        {initials(p.display_name)}
                      </span>
                      <span className="mt-1 text-sm font-semibold truncate max-w-full">
                        {p.display_name}
                      </span>
                      {(endedWith.get(p.player_id)?.length ?? 0) > 0 && (
                        <span className="text-[11px] leading-tight text-muted-foreground line-clamp-2">
                          {endedWith.get(p.player_id)!.join(", ")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <span className="text-sm font-semibold tabular-nums">{step.total} pts</span>
              </div>
            )}

            {/* The step itself */}
            <div
              className={`w-full ${style.height} rounded-t-md flex flex-col items-center pt-2 shadow-inner ${
                step ? "" : "opacity-30"
              }`}
              style={{ backgroundColor: style.color }}
            >
              <span className="text-3xl sm:text-4xl font-black text-black/60 leading-none">
                {rank}
              </span>
              {step && (
                <span className="text-xl mt-1" aria-hidden="true">
                  {MEDALS[rank]}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
