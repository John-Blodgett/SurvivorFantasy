import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import { adminEndAllyAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { success?: string; error?: string };
}

export default async function AdminAlliesPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  // Fetch all alliances (active and recently ended) with player and castaway info
  const { data: alliesRaw } = await supabase
    .from("league_allies")
    .select("id, player_id, castaway_id, points_from_episode, created_at, ended_at, ended_reason")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });

  const allies = alliesRaw ?? [];

  // Build name lookups
  const playerIds = Array.from(new Set(allies.map((a) => a.player_id)));
  const castawayIds = Array.from(new Set(allies.map((a) => a.castaway_id)));

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", playerIds.length > 0 ? playerIds : ["__none__"]);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name, is_eliminated")
    .in("id", castawayIds.length > 0 ? castawayIds : ["__none__"]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const castawayMap = new Map((castaways ?? []).map((c) => [c.id, c]));

  const activeAllies = allies.filter((a) => a.ended_at === null);
  const endedAllies = allies.filter((a) => a.ended_at !== null);

  return (
    <AppShell
      title={`Alliance Management — ${league.name}`}
      backHref={`/league/${leagueId}/admin`}
      backLabel="Admin"
      navLinks={getAllLeagueNavLinks(leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {searchParams.success === "ally_ended" && (
          <p role="status" className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">
            Alliance ended successfully.
          </p>
        )}
        {searchParams.error && (
          <p role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2">
            {searchParams.error}
          </p>
        )}

        {/* Active alliances */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            Active Alliances ({activeAllies.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Force-ending an alliance frees the player to ally with a different castaway immediately.
          </p>

          {activeAllies.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No active alliances.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeAllies.map((ally) => {
                const castaway = castawayMap.get(ally.castaway_id);
                return (
                  <div
                    key={ally.id}
                    className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-medium">
                        {profileMap.get(ally.player_id) ?? "Unknown"}
                        <span className="mx-2 text-muted-foreground">→</span>
                        Allied with {castaway?.name ?? "Unknown"}
                        {castaway?.is_eliminated && (
                          <span className="ml-2 text-xs text-destructive bg-destructive/10 rounded px-1.5 py-0.5">
                            Eliminated
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Earning from Ep. {ally.points_from_episode} &middot;{" "}
                        Started {new Date(ally.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <form action={adminEndAllyAction} className="shrink-0">
                      <input type="hidden" name="league_id" value={leagueId} />
                      <input type="hidden" name="ally_id" value={ally.id} />
                      <SubmitButton
                        pendingText="Ending…"
                        className="rounded border border-destructive text-destructive px-3 py-1.5 text-xs font-medium hover:bg-destructive/10 transition-colors min-h-[36px]"
                      >
                        End Alliance
                      </SubmitButton>
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent ended alliances */}
        {endedAllies.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Ended Alliances ({endedAllies.length})
            </h2>
            <div className="space-y-2">
              {endedAllies.slice(0, 20).map((ally) => {
                const castaway = castawayMap.get(ally.castaway_id);
                const reasonLabel =
                  ally.ended_reason === "castaway_eliminated"
                    ? "Castaway eliminated"
                    : ally.ended_reason === "admin_reset"
                    ? "Admin reset"
                    : "Ended";
                return (
                  <div
                    key={ally.id}
                    className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">
                        {profileMap.get(ally.player_id) ?? "Unknown"}
                        <span className="mx-2">→</span>
                        {castaway?.name ?? "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reasonLabel} &middot;{" "}
                        {ally.ended_at
                          ? new Date(ally.ended_at).toLocaleDateString()
                          : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
