import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LogoutButton from "@/components/logout-button";
import InviteCopyButton from "@/components/invite-copy-button";

interface League {
  id: string;
  name: string;
  season_number: number;
  roster_size: number;
  invite_code: string;
  admin_id: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { created?: string; joined?: string; already_member?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("league_members")
    .select(
      "league_id, leagues ( id, name, season_number, roster_size, invite_code, admin_id )"
    )
    .eq("player_id", user.id)
    .order("joined_at", { ascending: false });

  const leagues: League[] = (memberships ?? []).flatMap((m) =>
    m.leagues ? [m.leagues as unknown as League] : []
  );

  const toastMessage = searchParams.created
    ? "League created! Share the invite link with your friends."
    : searchParams.joined
    ? "You've joined the league!"
    : searchParams.already_member
    ? "You're already a member of that league."
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fantasy Survivor</h1>
        <LogoutButton />
      </header>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            Welcome, {profile?.display_name ?? user.email}
          </h2>
          <Link
            href="/leagues/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New League
          </Link>
        </div>
        {toastMessage && (
          <p
            role="status"
            className="text-sm bg-green-50 text-green-800 border border-green-200 rounded-md px-3 py-2"
          >
            {toastMessage}
          </p>
        )}
        {leagues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-3">
            <p className="text-muted-foreground">
              You haven&apos;t joined any leagues yet.
            </p>
            <Link
              href="/leagues/new"
              className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Create a League
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {leagues.map((league) => (
              <LeagueCard
                key={league.id}
                league={league}
                isAdmin={league.admin_id === user.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function LeagueCard({ league, isAdmin }: { league: League; isAdmin: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">{league.name}</h3>
          <p className="text-xs text-muted-foreground">
            Season {league.season_number} &middot; {league.roster_size}{" "}
            castaways/team
          </p>
        </div>
        {isAdmin && (
          <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5 font-medium shrink-0">
            Admin
          </span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Link
          href={`/league/${league.id}/leaderboard`}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          View League
        </Link>
        <InviteCopyButton inviteCode={league.invite_code} />
      </div>
    </div>
  );
}