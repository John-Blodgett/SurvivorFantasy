import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { configureDraftAction, startDraftAction } from "./actions";

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function AdminDraftPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Get the league this user admins
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, draft_mode, pick_timer_seconds, roster_size")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  // Get draft status
  const { data: draft } = await supabase
    .from("drafts")
    .select("id, status, current_pick_index")
    .eq("league_id", league.id)
    .single();

  // Count players and castaways for readiness check
  const { count: playerCount } = await supabase
    .from("league_members")
    .select("*", { count: "exact", head: true })
    .eq("league_id", league.id);

  const { count: castawayCount } = await supabase
    .from("castaways")
    .select("*", { count: "exact", head: true })
    .eq("league_id", league.id)
    .eq("is_eliminated", false);

  const draftStatus = draft?.status ?? "not_started";
  const isComplete = draftStatus === "complete";
  const isActive = draftStatus === "active";
  const canStart = !isComplete && !isActive;

  const successMessage =
    searchParams.success === "configured"
      ? "Draft settings saved."
      : searchParams.success === "auto_complete"
      ? "Auto draft completed successfully!"
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
        <h1 className="text-lg font-semibold">Draft — {league.name}</h1>
      </header>

      <main className="p-6 max-w-2xl mx-auto space-y-8">
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

        {/* Draft status banner */}
        <section aria-labelledby="status-heading">
          <h2 id="status-heading" className="text-base font-semibold mb-3">
            Draft Status
          </h2>
          <div className="rounded-lg border border-border bg-card p-5 space-y-3">
            <div className="flex items-center gap-3">
              <StatusBadge status={draftStatus} />
              <span className="text-sm text-muted-foreground">
                {playerCount ?? 0} player{playerCount !== 1 ? "s" : ""} &middot;{" "}
                {castawayCount ?? 0} available castaway{castawayCount !== 1 ? "s" : ""}
              </span>
            </div>

            {isActive && (
              <Link
                href={`/league/${league.id}/draft`}
                className="inline-block rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Go to Draft Room →
              </Link>
            )}

            {isComplete && (
              <p className="text-sm text-muted-foreground">
                The draft is complete. Players have been assigned their castaways.
              </p>
            )}
          </div>
        </section>

        {/* Configuration form — only shown when draft hasn't started */}
        {canStart && (
          <section aria-labelledby="config-heading">
            <h2 id="config-heading" className="text-base font-semibold mb-3">
              Configure Draft
            </h2>
            <div className="rounded-lg border border-border bg-card p-5">
              <form action={configureDraftAction} className="space-y-5">
                <input type="hidden" name="league_id" value={league.id} />

                {/* Draft mode */}
                <fieldset>
                  <legend className="text-sm font-medium mb-2">Draft Mode</legend>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="draft_mode"
                        value="auto"
                        defaultChecked={
                          !league.draft_mode || league.draft_mode === "auto"
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">Auto Draft</p>
                        <p className="text-xs text-muted-foreground">
                          Runs instantly using each player&apos;s pre-submitted
                          preference rankings. Players without rankings get
                          castaways in default order.
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="draft_mode"
                        value="live"
                        defaultChecked={league.draft_mode === "live"}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">Live Draft</p>
                        <p className="text-xs text-muted-foreground">
                          Players take turns picking in real-time in a shared
                          draft room. Snake order, with a pick timer.
                        </p>
                      </div>
                    </label>
                  </div>
                </fieldset>

                {/* Pick timer */}
                <div>
                  <label
                    htmlFor="pick_timer_seconds"
                    className="block text-sm font-medium mb-1"
                  >
                    Pick Timer (seconds)
                  </label>
                  <input
                    id="pick_timer_seconds"
                    name="pick_timer_seconds"
                    type="number"
                    min={10}
                    max={300}
                    defaultValue={league.pick_timer_seconds ?? 90}
                    className="w-32 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used in Live Draft mode. When the timer expires, the
                    highest-ranked available castaway is auto-selected.
                  </p>
                </div>

                <button
                  type="submit"
                  className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Save Settings
                </button>
              </form>
            </div>
          </section>
        )}

        {/* Start draft */}
        {canStart && (
          <section aria-labelledby="start-heading">
            <h2 id="start-heading" className="text-base font-semibold mb-3">
              Start Draft
            </h2>
            <div className="rounded-lg border border-border bg-card p-5 space-y-3">
              {(playerCount ?? 0) < 2 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  You need at least 2 players to start a draft.
                </p>
              )}
              {(castawayCount ?? 0) < (league.roster_size ?? 1) && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  You need at least {league.roster_size} available castaways
                  (one full roster) to start a draft.
                </p>
              )}

              <form action={startDraftAction}>
                <input type="hidden" name="league_id" value={league.id} />
                <button
                  type="submit"
                  disabled={
                    (playerCount ?? 0) < 2 ||
                    (castawayCount ?? 0) < (league.roster_size ?? 1)
                  }
                  className="rounded bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Draft
                </button>
              </form>

              <p className="text-xs text-muted-foreground">
                For Auto Draft, picks will be made immediately. For Live Draft,
                all players will be redirected to the draft room.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_started: "bg-muted text-muted-foreground",
    pending: "bg-muted text-muted-foreground",
    active: "bg-blue-100 text-blue-800",
    complete: "bg-green-100 text-green-800",
  };
  const labels: Record<string, string> = {
    not_started: "Not Started",
    pending: "Pending",
    active: "In Progress",
    complete: "Complete",
  };

  return (
    <span
      className={`text-xs font-medium rounded px-2 py-0.5 ${
        styles[status] ?? styles.not_started
      }`}
    >
      {labels[status] ?? "Unknown"}
    </span>
  );
}
