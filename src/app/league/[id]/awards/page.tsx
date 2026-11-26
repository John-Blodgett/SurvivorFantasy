import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { buildLeagueNav } from "@/components/league-nav";
import {
  AWARD_CATALOGUE,
  AWARD_CATEGORY_LABELS,
  AWARD_CATEGORY_ORDER,
} from "@/lib/awards";

interface PageProps {
  params: { id: string };
}

interface AwardRowWithName {
  award_key: string;
  player_id: string;
  stat_detail: string | null;
  profiles: { display_name: string } | null;
}

/**
 * Player-facing season awards. Only available once the season is complete;
 * before that it redirects to the leaderboard and reveals nothing.
 */
export default async function AwardsPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: membership } = await supabase
    .from("league_members")
    .select("player_id")
    .eq("league_id", leagueId)
    .eq("player_id", user.id)
    .single();
  if (!membership) redirect("/dashboard");

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season_number, admin_id, is_complete")
    .eq("id", leagueId)
    .single();
  if (!league) redirect("/dashboard");
  if (!league.is_complete) redirect(`/league/${leagueId}/leaderboard`);

  const { data: rowsRaw } = await supabase
    .from("league_awards")
    .select("award_key, player_id, stat_detail, profiles(display_name)")
    .eq("league_id", leagueId);
  const rows = (rowsRaw ?? []) as unknown as AwardRowWithName[];

  const byKey = new Map<string, AwardRowWithName[]>();
  for (const r of rows) {
    const list = byKey.get(r.award_key) ?? [];
    list.push(r);
    byKey.set(r.award_key, list);
  }

  // Skip saved keys that are no longer in the catalogue.
  const sections = AWARD_CATEGORY_ORDER.map((category) => ({
    category,
    awards: AWARD_CATALOGUE.filter(
      (a) => a.category === category && (byKey.get(a.key)?.length ?? 0) > 0
    ),
  })).filter((s) => s.awards.length > 0);

  const isAdmin = league.admin_id === user.id;

  return (
    <AppShell
      title={`${league.name} — Awards`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="Leaderboard"
      navLinks={await buildLeagueNav(supabase, leagueId, isAdmin)}
    >
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          Season {league.season_number} awards. They don&apos;t change anyone&apos;s points.
        </p>

        {sections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No awards were earned this season.
            </p>
          </div>
        ) : (
          sections.map((section) => (
            <section
              key={section.category}
              className="space-y-3"
              aria-label={AWARD_CATEGORY_LABELS[section.category]}
            >
              <h2 className="text-base font-semibold">
                {AWARD_CATEGORY_LABELS[section.category]}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.awards.map((def) => {
                  const winners = [...(byKey.get(def.key) ?? [])].sort((a, b) =>
                    (a.profiles?.display_name ?? "").localeCompare(
                      b.profiles?.display_name ?? ""
                    )
                  );
                  return (
                    <article
                      key={def.key}
                      className="rounded-lg border border-border bg-card p-4 space-y-2"
                    >
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-semibold">🏅 {def.name}</h3>
                        <p className="text-xs text-muted-foreground">{def.description}</p>
                      </div>
                      <ul className="text-sm space-y-0.5">
                        {winners.map((w) => (
                          <li key={w.player_id}>
                            <span className="font-medium">
                              {w.profiles?.display_name ?? "Unknown Player"}
                            </span>
                            {w.stat_detail && (
                              <span className="text-muted-foreground"> — {w.stat_detail}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </AppShell>
  );
}
