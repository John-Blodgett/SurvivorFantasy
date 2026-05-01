import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { updateWaiverScheduleAction, processWaiversAction } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AdminWaiverPage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  // Verify admin
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, waiver_budget, waiver_process_day, waiver_process_hour, waiver_process_minute")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  // Fetch all pending claims
  const { data: rawClaims } = await supabase
    .from("waiver_claims")
    .select("id, player_id, castaway_id, drop_castaway_id, bid_amount, submitted_at")
    .eq("league_id", league.id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  const claims = rawClaims ?? [];

  // Get names for display
  const playerIds = Array.from(new Set(claims.map((c) => c.player_id)));
  const castawayIds = Array.from(
    new Set(claims.flatMap((c) => [c.castaway_id, c.drop_castaway_id]))
  );

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", playerIds.length > 0 ? playerIds : ["__none__"]);

  const { data: castaways } = await supabase
    .from("castaways")
    .select("id, name")
    .in("id", castawayIds.length > 0 ? castawayIds : ["__none__"]);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));
  const castawayMap = new Map((castaways ?? []).map((c) => [c.id, c.name]));

  const toastMessage =
    searchParams.success === "schedule_updated"
      ? "Waiver processing schedule updated."
      : searchParams.success === "claims_processed"
      ? "Waiver claims processed successfully."
      : null;

  return (
    <AppShell title={`Waiver Wire Admin — ${league.name}`} backHref="/dashboard" backLabel="Dashboard">
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {toastMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {toastMessage}
          </p>
        )}
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {/* Processing schedule configuration */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Processing Schedule</h2>
          <form action={updateWaiverScheduleAction} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Day</label>
                <select
                  name="waiver_process_day"
                  defaultValue={league.waiver_process_day ?? 3}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                >
                  {DAYS.map((day, i) => (
                    <option key={i} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Hour</label>
                <input
                  type="number"
                  name="waiver_process_hour"
                  min={0}
                  max={23}
                  defaultValue={league.waiver_process_hour ?? 12}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Minute</label>
                <input
                  type="number"
                  name="waiver_process_minute"
                  min={0}
                  max={59}
                  defaultValue={league.waiver_process_minute ?? 0}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px]"
            >
              Save Schedule
            </button>
          </form>
        </section>

        {/* Manual trigger */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Manual Processing</h2>
          <p className="text-xs text-muted-foreground">
            Process all pending waiver claims immediately.
          </p>
          <form action={processWaiversAction}>
            <button
              type="submit"
              className="rounded bg-orange-600 text-white px-4 py-2 text-sm font-medium hover:bg-orange-700 transition-colors min-h-[44px]"
            >
              Process Now ({claims.length} pending)
            </button>
          </form>
        </section>

        {/* Pending claims list */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            Pending Claims ({claims.length})
          </h2>

          {claims.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center">
              <p className="text-muted-foreground text-sm">
                No pending waiver claims.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="rounded border border-border bg-card p-3 text-sm space-y-1"
                >
                  <p>
                    <span className="font-medium">
                      {profileMap.get(claim.player_id) ?? "Unknown"}
                    </span>{" "}
                    wants{" "}
                    <span className="font-medium">
                      {castawayMap.get(claim.castaway_id) ?? "Unknown"}
                    </span>{" "}
                    · dropping{" "}
                    <span className="font-medium">
                      {castawayMap.get(claim.drop_castaway_id) ?? "Unknown"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bid: {claim.bid_amount} ·{" "}
                    {new Date(claim.submitted_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
