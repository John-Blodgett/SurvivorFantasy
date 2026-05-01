import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AddCastawayForm from "@/components/add-castaway-form";
import { eliminateCastawayAction, restoreCastawayAction } from "./actions";
import type { Castaway } from "@/lib/castaways";

interface SearchParams {
  error?: string;
  success?: string;
}

export default async function AdminCastawaysPage({
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
    .select("id, name, season_number")
    .eq("admin_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!league) redirect("/dashboard");

  const { data: castaways } = await supabase
    .from("castaways")
    .select("*")
    .eq("league_id", league.id)
    .order("created_at", { ascending: true });

  const active = (castaways ?? []).filter((c: Castaway) => !c.is_eliminated);
  const eliminated = (castaways ?? []).filter((c: Castaway) => c.is_eliminated);

  const statusMessage =
    searchParams.success === "added"
      ? "Castaway added successfully."
      : searchParams.success === "eliminated"
      ? "Castaway marked as eliminated."
      : null;

  return (
    <AppShell
      title={`Castaways — ${league.name}`}
      backHref="/dashboard"
      backLabel="Dashboard"
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {searchParams.error && (
          <p
            role="alert"
            className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2"
          >
            {searchParams.error}
          </p>
        )}

        {statusMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {statusMessage}
          </p>
        )}

        {/* Add castaway form */}
        <section aria-labelledby="add-heading">
          <h2 id="add-heading" className="text-base font-semibold mb-3">
            Add Castaway
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            <AddCastawayForm />
          </div>
        </section>

        {/* Active castaways */}
        <section aria-labelledby="active-heading">
          <h2 id="active-heading" className="text-base font-semibold mb-3">
            Active ({active.length})
          </h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active castaways yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {active.map((c: Castaway) => (
                <CastawayRow
                  key={c.id}
                  castaway={c}
                  action="eliminate"
                />
              ))}
            </ul>
          )}
        </section>

        {/* Eliminated castaways */}
        {eliminated.length > 0 && (
          <section aria-labelledby="eliminated-heading">
            <h2 id="eliminated-heading" className="text-base font-semibold mb-3">
              Eliminated ({eliminated.length})
            </h2>
            <ul className="space-y-2">
              {eliminated.map((c: Castaway) => (
                <CastawayRow
                  key={c.id}
                  castaway={c}
                  action="restore"
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function CastawayRow({
  castaway,
  action,
}: {
  castaway: Castaway;
  action: "eliminate" | "restore";
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {/* Photo */}
      <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
        {castaway.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={castaway.photo_url}
            alt={castaway.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-xs text-muted-foreground font-medium">
            {castaway.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{castaway.name}</p>
        {castaway.tribe && (
          <p className="text-xs text-muted-foreground">{castaway.tribe}</p>
        )}
        {castaway.is_eliminated && castaway.eliminated_episode && (
          <p className="text-xs text-destructive">
            Eliminated ep. {castaway.eliminated_episode}
          </p>
        )}
      </div>

      {/* Status badge */}
      <span
        className={`text-xs rounded px-2 py-0.5 font-medium shrink-0 ${
          castaway.is_eliminated
            ? "bg-destructive/10 text-destructive"
            : "bg-green-100 text-green-800"
        }`}
      >
        {castaway.is_eliminated ? "Eliminated" : "Active"}
      </span>

      {/* Action */}
      {action === "eliminate" ? (
        <EliminateForm castawayId={castaway.id} />
      ) : (
        <RestoreForm castawayId={castaway.id} />
      )}
    </li>
  );
}

function EliminateForm({ castawayId }: { castawayId: string }) {
  return (
    <form action={eliminateCastawayAction} className="flex items-center gap-2 shrink-0">
      <input type="hidden" name="castaway_id" value={castawayId} />
      <input
        name="episode_number"
        type="number"
        min={1}
        placeholder="Ep #"
        aria-label="Episode number"
        className="w-16 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="submit"
        className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors"
      >
        Eliminate
      </button>
    </form>
  );
}

function RestoreForm({ castawayId }: { castawayId: string }) {
  return (
    <form action={restoreCastawayAction} className="shrink-0">
      <input type="hidden" name="castaway_id" value={castawayId} />
      <button
        type="submit"
        className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors"
      >
        Restore
      </button>
    </form>
  );
}
