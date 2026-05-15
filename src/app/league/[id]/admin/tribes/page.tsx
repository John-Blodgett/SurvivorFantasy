import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { getAllLeagueNavLinks } from "@/components/league-nav";
import SubmitButton from "@/components/submit-button";
import { createTribeAction, updateTribeAction, deleteTribeAction } from "./actions";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string };
}

export default async function AdminTribesPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const leagueId = params.id;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, admin_id")
    .eq("id", leagueId)
    .single();

  if (!league || league.admin_id !== user.id) redirect("/dashboard");

  const { data: tribes } = await supabase
    .from("tribes")
    .select("id, name, color, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: true });

  // Get castaway counts per tribe
  const { data: castaways } = await supabase
    .from("castaways")
    .select("tribe_id")
    .eq("league_id", leagueId)
    .not("tribe_id", "is", null);

  const countMap = new Map<string, number>();
  for (const c of castaways ?? []) {
    if (c.tribe_id) {
      countMap.set(c.tribe_id, (countMap.get(c.tribe_id) ?? 0) + 1);
    }
  }

  const statusMessage =
    searchParams.success === "created" ? "Tribe created successfully."
    : searchParams.success === "updated" ? "Tribe updated successfully."
    : searchParams.success === "deleted" ? "Tribe deleted successfully."
    : null;

  return (
    <AppShell
      title={`Tribes — ${league.name}`}
      backHref={`/league/${leagueId}/admin`}
      backLabel="Admin"
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

        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className="text-base font-semibold mb-3">Create Tribe</h2>
          <div className="rounded-lg border border-border bg-card p-5">
            <form action={createTribeAction} className="flex flex-wrap gap-3 items-end">
              <input type="hidden" name="league_id" value={leagueId} />
              <div className="space-y-1 flex-1 min-w-[160px]">
                <label htmlFor="new-tribe-name" className="text-sm font-medium">
                  Name <span aria-hidden="true" className="text-destructive">*</span>
                </label>
                <input
                  id="new-tribe-name"
                  name="name"
                  type="text"
                  required
                  placeholder="e.g. Tika"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-tribe-color" className="text-sm font-medium">Color</label>
                <input
                  id="new-tribe-color"
                  name="color"
                  type="color"
                  defaultValue="#3B82F6"
                  className="h-9 w-14 rounded-md border border-input bg-background cursor-pointer"
                />
              </div>
              <SubmitButton
                pendingText="Creating…"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Create Tribe
              </SubmitButton>
            </form>
          </div>
        </section>

        <section aria-labelledby="tribes-heading">
          <h2 id="tribes-heading" className="text-base font-semibold mb-3">
            Tribes ({(tribes ?? []).length})
          </h2>
          {(tribes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tribes yet. Create one above.</p>
          ) : (
            <ul className="space-y-2">
              {(tribes ?? []).map((tribe) => (
                <TribeRow
                  key={tribe.id}
                  tribe={tribe}
                  leagueId={leagueId}
                  castawayCount={countMap.get(tribe.id) ?? 0}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function TribeRow({
  tribe,
  leagueId,
  castawayCount,
}: {
  tribe: { id: string; name: string; color: string | null };
  leagueId: string;
  castawayCount: number;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {tribe.color && (
        <span
          className="w-5 h-5 rounded-full shrink-0 border border-border"
          style={{ backgroundColor: tribe.color }}
          aria-label={`Color: ${tribe.color}`}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{tribe.name}</p>
        <p className="text-xs text-muted-foreground">
          {castawayCount} {castawayCount === 1 ? "castaway" : "castaways"}
        </p>
      </div>

      {/* Edit form */}
      <form action={updateTribeAction} className="flex items-center gap-2 shrink-0">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="tribe_id" value={tribe.id} />
        <input
          name="name"
          type="text"
          defaultValue={tribe.name}
          aria-label="Tribe name"
          className="w-24 rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          name="color"
          type="color"
          defaultValue={tribe.color ?? "#3B82F6"}
          aria-label="Tribe color"
          className="h-7 w-9 rounded border border-input bg-background cursor-pointer"
        />
        <SubmitButton
          pendingText="…"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-50"
        >
          Save
        </SubmitButton>
      </form>

      {/* Delete form */}
      <form action={deleteTribeAction} className="shrink-0">
        <input type="hidden" name="league_id" value={leagueId} />
        <input type="hidden" name="tribe_id" value={tribe.id} />
        <SubmitButton
          pendingText="…"
          className="rounded border border-destructive text-destructive px-2 py-1 text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          Delete
        </SubmitButton>
      </form>
    </li>
  );
}
