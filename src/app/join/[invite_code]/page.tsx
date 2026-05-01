import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

interface Props {
  params: { invite_code: string };
}

export default async function JoinLeaguePage({ params }: Props) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Preserve the invite link so the user lands here after login
    redirect(`/?next=/join/${params.invite_code}`);
  }

  // Look up the league by invite code — Requirement 2.2, 2.3
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, season_number, roster_size")
    .eq("invite_code", params.invite_code)
    .single();

  if (leagueError || !league) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-4 max-w-sm">
          <h1 className="text-2xl font-bold">Invalid Invite Link</h1>
          <p className="text-muted-foreground">
            League not found or invite link is invalid.
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Check if already a member — Requirement 16.3
  const { data: existing } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("league_id", league.id)
    .eq("player_id", user.id)
    .maybeSingle();

  if (existing) {
    redirect(`/dashboard?already_member=${league.id}`);
  }

  // Join the league
  const { error: joinError } = await supabase.from("league_members").insert({
    league_id: league.id,
    player_id: user.id,
  });

  if (joinError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-4 max-w-sm">
          <h1 className="text-2xl font-bold">Could Not Join</h1>
          <p className="text-muted-foreground">
            Something went wrong. You may already be a member of this league.
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  redirect(`/dashboard?joined=${league.id}`);
}
