import AppShell from "@/components/app-shell";
import { buildLeagueNav } from "@/components/league-nav";
import { requireLeagueAdmin } from "../helpers";
import { loadAwardsInput } from "@/lib/league-awards";
import {
  AWARD_CATALOGUE,
  AWARD_CATEGORY_LABELS,
  AWARD_CATEGORY_ORDER,
  computeAwards,
} from "@/lib/awards";

interface PageProps {
  params: { id: string };
}

/**
 * Admin-only live preview of the season awards. Read-only: nothing is saved
 * until the season is marked complete.
 */
export default async function AdminAwardsPreviewPage({ params }: PageProps) {
  const leagueId = params.id;
  const { supabase } = await requireLeagueAdmin(leagueId);

  const { data: league } = await supabase
    .from("leagues")
    .select("name, is_complete")
    .eq("id", leagueId)
    .single();

  const input = await loadAwardsInput(supabase, leagueId);
  const results = computeAwards(input);
  const resultByKey = new Map(results.map((r) => [r.key, r]));
  const names = new Map(input.players.map((p) => [p.player_id, p.display_name]));
  const nameOf = (id: string) => names.get(id) ?? "Unknown Player";

  const hasEpisodes = input.finalizedEpisodes.length > 0;
  const givenCount = results.filter((r) => !r.unclaimed).length;

  return (
    <AppShell
      title={`Awards Preview — ${league?.name ?? "League"}`}
      backHref={`/league/${leagueId}/admin`}
      backLabel="Admin"
      navLinks={await buildLeagueNav(supabase, leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A live look at what the season awards would be right now. Nothing is saved
            until you mark the season complete.
            {league?.is_complete
              ? " This season is already complete, so players are seeing the saved awards. This preview uses current data and may differ."
              : ""}
          </p>
          {hasEpisodes ? (
            <p
              role="status"
              className="text-sm bg-muted/50 border border-border rounded-md px-3 py-2"
            >
              {givenCount} of {results.length} awards would be given right now.{" "}
              {results.length - givenCount} would go unclaimed.
            </p>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No episodes have been finalized yet, so there are no awards to preview.
              </p>
            </div>
          )}
        </div>

        {hasEpisodes &&
          AWARD_CATEGORY_ORDER.map((category) => {
            const defs = AWARD_CATALOGUE.filter((a) => a.category === category);
            return (
              <section key={category} className="space-y-3" aria-label={AWARD_CATEGORY_LABELS[category]}>
                <h2 className="text-base font-semibold">{AWARD_CATEGORY_LABELS[category]}</h2>
                <div className="grid gap-3">
                  {defs.map((def) => {
                    const result = resultByKey.get(def.key);
                    const unclaimed = !result || result.unclaimed;
                    const top = (result?.candidates ?? []).slice(0, 3);
                    return (
                      <article
                        key={def.key}
                        className="rounded-lg border border-border bg-card p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <h3 className="text-sm font-semibold">{def.name}</h3>
                            <p className="text-xs text-muted-foreground">{def.description}</p>
                            <p className="text-xs text-muted-foreground">
                              Threshold: {def.thresholdText}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 text-xs font-medium rounded-full px-2 py-0.5 border ${
                              unclaimed
                                ? "text-muted-foreground border-border"
                                : "text-green-800 bg-green-50 border-green-200"
                            }`}
                          >
                            {unclaimed ? "Unclaimed" : "Would be given"}
                          </span>
                        </div>

                        {!unclaimed && result && (
                          <ul className="text-sm space-y-0.5">
                            {result.winners.map((w) => (
                              <li key={w.player_id}>
                                <span className="font-medium">{nameOf(w.player_id)}</span>
                                <span className="text-muted-foreground"> — {w.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {top.length > 0 && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none">Top candidates</summary>
                            <ul className="mt-1 space-y-0.5">
                              {top.map((c) => (
                                <li key={c.player_id}>
                                  {nameOf(c.player_id)}: {c.detail}
                                  {!c.qualifies && " (below threshold)"}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
      </div>
    </AppShell>
  );
}
