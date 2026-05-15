import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import { assignCastawayAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminLateJoinPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, roster_size, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  // Check if draft is complete
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", league.id)
    .single();

  const draftComplete = draft?.status === "complete";

  // Get all league members
  const { data: members } = await supabase
    .from("league_members")
    .select("player_id, profiles(id, display_name)")
    .eq("league_id", league.id);

  // Get all team assignments for this league
  const { data: assignments } = await supabase
    .from("team_assignments")
    .select("player_id, castaway_id")
    .eq("league_id", league.id);

  // Find players with no team assignments (or fewer than roster_size)
  const assignmentsByPlayer = new Map<string, number>();
  for (const a of assignments ?? []) {
    assignmentsByPlayer.set(
      a.player_id,
      (assignmentsByPlayer.get(a.player_id) ?? 0) + 1
    );
  }

  const playersNeedingAssignment = (members ?? [])
    .filter((m) => {
      const count = assignmentsByPlayer.get(m.player_id) ?? 0;
      return count < league.roster_size;
    })
    .map((m) => ({
      id: m.player_id,
      display_name:
        (m.profiles as unknown as { id: string; display_name: string })
          ?.display_name ?? "Unknown",
      current_count: assignmentsByPlayer.get(m.player_id) ?? 0,
    }));

  // Get available castaways (not on any team, not eliminated)
  const assignedCastawayIds = (assignments ?? []).map((a) => a.castaway_id);

  let availableCastaways: { id: string; name: string; tribe_id: string | null }[] = [];

  if (assignedCastawayIds.length > 0) {
    const { data } = await supabase
      .from("castaways")
      .select("id, name, tribe")
      .eq("league_id", league.id)
      .eq("is_eliminated", false)
      .not("id", "in", `(${assignedCastawayIds.join(",")})`);
    availableCastaways = data ?? [];
  } else {
    const { data } = await supabase
      .from("castaways")
      .select("id, name, tribe")
      .eq("league_id", league.id)
      .eq("is_eliminated", false);
    availableCastaways = data ?? [];
  }

  // Determine next unfinalized episode for display
  const { data: latestFinalizedEpisode } = await supabase
    .from("episodes")
    .select("number")
    .eq("league_id", league.id)
    .eq("is_finalized", true)
    .order("number", { ascending: false })
    .limit(1)
    .single();

  const pointsFromEpisode = (latestFinalizedEpisode?.number ?? 0) + 1;

  return (
    <AppShell
      title={`Late-Join Assignment — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={getAllLeagueNavLinks(leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {decodeURIComponent(searchParams.error.replace(/\+/g, " "))}
          </p>
        )}

        {searchParams.success === "assigned" && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            Castaway assigned successfully.
          </p>
        )}

        {!draftComplete && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              The draft has not been completed yet. Late-join assignments are
              only available after the draft is finished.
            </p>
          </div>
        )}

        {draftComplete && (
          <>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Points for assigned castaways will count from{" "}
                <span className="font-medium text-foreground">
                  Episode {pointsFromEpisode}
                </span>{" "}
                onward.
              </p>
            </div>

            {playersNeedingAssignment.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center">
                <p className="text-muted-foreground text-sm">
                  All players have full rosters. No late-join assignments needed.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {playersNeedingAssignment.map((player) => (
                  <div
                    key={player.id}
                    className="rounded-lg border border-border bg-card p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm">
                        {player.display_name}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {player.current_count} / {league.roster_size} castaways
                      </span>
                    </div>

                    {availableCastaways.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No available castaways to assign.
                      </p>
                    ) : (
                      <form action={assignCastawayAction} className="flex flex-col sm:flex-row gap-2">
                        <input type="hidden" name="league_id" value={leagueId} />
                        <input type="hidden" name="player_id" value={player.id} />
                        <select
                          name="castaway_id"
                          required
                          className="flex-1 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          aria-label={`Select castaway for ${player.display_name}`}
                        >
                          <option value="">Select a castaway...</option>
                          {availableCastaways.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton
                          pendingText="Assigning…"
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          Assign
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
