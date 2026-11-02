import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import { buildLeagueNav } from "@/components/league-nav";
import SectionTabs from "@/components/section-tabs";
import AddCastawayForm from "@/components/add-castaway-form";
import EditCastawayForm from "@/components/edit-castaway-form";
import SubmitButton from "@/components/submit-button";
import { eliminateCastawayAction, restoreCastawayAction } from "./actions";
import {
  createTribeAction,
  updateTribeAction,
  deleteTribeAction,
} from "../tribes/actions";
import { adminEndAllyAction } from "../allies/actions";
import type { Castaway } from "@/lib/castaways";

type CastawaysSection = "roster" | "tribes" | "alliances";

interface PageProps {
  params: { id: string };
  searchParams: { error?: string; success?: string; section?: string };
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
    .select("id, name, color, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: true });

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

  // Castaway counts per tribe (for the Tribes section)
  const tribeCountMap = new Map<string, number>();
  for (const c of castaways ?? []) {
    if ((c as Castaway).tribe_id) {
      const tid = (c as Castaway).tribe_id as string;
      tribeCountMap.set(tid, (tribeCountMap.get(tid) ?? 0) + 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Alliances section data (folded in from the former /admin/allies page)
  // ---------------------------------------------------------------------------
  const { data: alliesRaw } = await supabase
    .from("league_allies")
    .select("id, player_id, castaway_id, points_from_episode, created_at, ended_at, ended_reason")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });

  const allies = alliesRaw ?? [];
  const allyPlayerIds = Array.from(new Set(allies.map((a) => a.player_id)));
  const allyCastawayIds = Array.from(new Set(allies.map((a) => a.castaway_id)));

  const { data: allyProfiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", allyPlayerIds.length > 0 ? allyPlayerIds : ["__none__"]);

  const { data: allyCastaways } = await supabase
    .from("castaways")
    .select("id, name, is_eliminated")
    .in("id", allyCastawayIds.length > 0 ? allyCastawayIds : ["__none__"]);

  const allyProfileMap = new Map((allyProfiles ?? []).map((p) => [p.id, p.display_name]));
  const allyCastawayMap = new Map((allyCastaways ?? []).map((c) => [c.id, c]));

  const activeAllies = allies.filter((a) => a.ended_at === null);
  const endedAllies = allies.filter((a) => a.ended_at !== null);

  // ---------------------------------------------------------------------------
  // Section resolution
  // ---------------------------------------------------------------------------
  const requestedSection = searchParams.section as CastawaysSection | undefined;
  const validSections: CastawaysSection[] = ["roster", "tribes", "alliances"];
  const section: CastawaysSection =
    requestedSection && validSections.includes(requestedSection)
      ? requestedSection
      : "roster";

  const sectionTabs = [
    { href: `/league/${leagueId}/admin/castaways?section=roster`, label: "Castaways" },
    {
      href: `/league/${leagueId}/admin/castaways?section=tribes`,
      label: "Tribes",
      badge: (tribes ?? []).length,
    },
    {
      href: `/league/${leagueId}/admin/castaways?section=alliances`,
      label: "Alliances",
      badge: activeAllies.length,
    },
  ];

  const statusMessage =
    searchParams.success === "added" ? "Castaway added successfully."
    : searchParams.success === "eliminated" ? "Castaway marked as eliminated."
    : searchParams.success === "updated" ? "Castaway updated successfully."
    : searchParams.success === "deleted" ? "Castaway deleted successfully."
    : searchParams.success === "created" ? "Tribe created successfully."
    : searchParams.success === "ally_ended" ? "Alliance ended successfully."
    : null;

  return (
    <AppShell
      title={`Castaways & Tribes — ${league.name}`}
      backHref={`/league/${leagueId}/admin`}
      backLabel="Admin"
      navLinks={await buildLeagueNav(supabase, leagueId, true)}
    >
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
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

        <SectionTabs tabs={sectionTabs} active={`/league/${leagueId}/admin/castaways?section=${section}`} />

        {/* ================================================================== */}
        {/* CASTAWAYS (roster) section                                         */}
        {/* ================================================================== */}
        {section === "roster" && (
          <div className="space-y-8">
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
        )}

        {/* ================================================================== */}
        {/* TRIBES section                                                     */}
        {/* ================================================================== */}
        {section === "tribes" && (
          <div className="space-y-8">
            <section aria-labelledby="create-heading">
              <h2 id="create-heading" className="text-base font-semibold mb-3">Create Tribe</h2>
              <div className="rounded-lg border border-border bg-card p-5">
                <form action={createTribeAction} className="flex flex-wrap gap-3 items-end">
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="redirect_section" value="tribes" />
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
                      castawayCount={tribeCountMap.get(tribe.id) ?? 0}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ================================================================== */}
        {/* ALLIANCES section                                                  */}
        {/* ================================================================== */}
        {section === "alliances" && (
          <div className="space-y-8">
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
                    const castaway = allyCastawayMap.get(ally.castaway_id);
                    return (
                      <div
                        key={ally.id}
                        className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <p className="text-sm font-medium">
                            {allyProfileMap.get(ally.player_id) ?? "Unknown"}
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

            {endedAllies.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Ended Alliances ({endedAllies.length})
                </h2>
                <div className="space-y-2">
                  {endedAllies.slice(0, 20).map((ally) => {
                    const castaway = allyCastawayMap.get(ally.castaway_id);
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
                            {allyProfileMap.get(ally.player_id) ?? "Unknown"}
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
        <input type="hidden" name="redirect_section" value="tribes" />
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
        <input type="hidden" name="redirect_section" value="tribes" />
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
