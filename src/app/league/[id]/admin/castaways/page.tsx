import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import AddCastawayForm from "@/components/add-castaway-form";
import EditCastawayForm from "@/components/edit-castaway-form";
import SubmitButton from "@/components/submit-button";
import { eliminateCastawayAction, restoreCastawayAction } from "./actions";
import type { Castaway } from "@/lib/castaways";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminCastawaysPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season_number, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  const { data: tribes } = await supabase
    .from("tribes")
    .select("id, name, color")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  const { data: castaways } = await supabase
    .from("castaways")
    .select("*")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: true });

  // Check if draft has started (blocks deletion)
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .single();

  const canDelete = !draft || draft.status === "pending";

  const active = (castaways ?? []).filter((c: Castaway) => !c.is_eliminated);
  const eliminated = (castaways ?? []).filter((c: Castaway) => c.is_eliminated);

  const statusMessage =
    searchParams.success === "added" ? "Castaway added successfully."
    : searchParams.success === "eliminated" ? "Castaway marked as eliminated."
    : searchParams.success === "updated" ? "Castaway updated successfully."
    : searchParams.success === "deleted" ? "Castaway deleted successfully."
    : null;

  return (
    <AppShell
      title={`Castaways — ${league.name}`}
      backHref={`/league/${leagueId}/leaderboard`}
      backLabel="League"
      navLinks={getAllLeagueNavLinks(leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
        {searchParams.error && (
          <p role="alert" className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {searchParams.error}
          </p>
        )}
        {statusMessage && (
          <p role="status" className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2">
            {statusMessage}
          </p>
        )}

        <section aria-labelledby="add-heading">
          <h2 id="add-heading" className="text-base font-semibold mb-3">Add Castaway</h2>
          <div className="rounded-lg border border-border bg-card p-5">
            <AddCastawayForm leagueId={leagueId} tribes={tribes ?? []} />
          </div>
        </section>

        <section aria-labelledby="active-heading">
          <h2 id="active-heading" className="text-base font-semibold mb-3">Active ({active.length})</h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active castaways yet.</p>
          ) : (
            <ul className="space-y-2">
              {active.map((c: Castaway) => (
                <CastawayRow key={c.id} castaway={c} action="eliminate" leagueId={leagueId} tribes={tribes ?? []} canDelete={canDelete} />
              ))}
            </ul>
          )}
        </section>

        {eliminated.length > 0 && (
          <section aria-labelledby="eliminated-heading">
            <h2 id="eliminated-heading" className="text-base font-semibold mb-3">Eliminated ({eliminated.length})</h2>
            <ul className="space-y-2">
              {eliminated.map((c: Castaway) => (
                <CastawayRow key={c.id} castaway={c} action="restore" leagueId={leagueId} tribes={tribes ?? []} canDelete={canDelete} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function CastawayRow({ castaway, action, leagueId, tribes, canDelete }: { castaway: Castaway; action: "eliminate" | "restore"; leagueId: string; tribes: Array<{ id: string; name: string; color: string | null }>; canDelete: boolean }) {
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center">
          {castaway.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={castaway.photo_url} alt={castaway.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground font-medium">{castaway.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{castaway.name}</p>
          {castaway.tribe_id && <p className="text-xs text-muted-foreground">Tribe assigned</p>}
          {castaway.is_eliminated && castaway.eliminated_episode && (
            <p className="text-xs text-destructive">Eliminated ep. {castaway.eliminated_episode}</p>
          )}
        </div>
        <span className={`text-xs rounded px-2 py-0.5 font-medium shrink-0 ${castaway.is_eliminated ? "bg-destructive/10 text-destructive" : "bg-green-100 text-green-800"}`}>
          {castaway.is_eliminated ? "Eliminated" : "Active"}
        </span>
        {action === "eliminate" ? (
          <form action={eliminateCastawayAction} className="flex items-center gap-2 shrink-0">
            <input type="hidden" name="league_id" value={leagueId} />
            <input type="hidden" name="castaway_id" value={castaway.id} />
            <input name="episode_number" type="number" min={1} placeholder="Ep #" aria-label="Episode number"
              className="w-16 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
            <SubmitButton pendingText="Eliminating…" className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50">
              Eliminate
            </SubmitButton>
          </form>
        ) : (
          <form action={restoreCastawayAction} className="shrink-0">
            <input type="hidden" name="league_id" value={leagueId} />
            <input type="hidden" name="castaway_id" value={castaway.id} />
            <SubmitButton pendingText="Restoring…" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-50">
              Restore
            </SubmitButton>
          </form>
        )}
      </div>
      <EditCastawayForm
        leagueId={leagueId}
        castaway={{ id: castaway.id, name: castaway.name, tribe_id: castaway.tribe_id, photo_url: castaway.photo_url }}
        tribes={tribes.map((t) => ({ id: t.id, name: t.name }))}
        canDelete={canDelete}
      />
    </li>
  );
}
