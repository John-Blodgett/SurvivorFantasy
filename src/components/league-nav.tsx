/**
 * Options that influence which league nav links are shown.
 */
export interface LeagueNavOptions {
  /**
   * Current draft status (from the `drafts` table), if known.
   * When the draft is "complete" the live Draft tab is hidden — the draft
   * is over, and its history lives under the Transactions tab.
   */
  draftStatus?: "pending" | "active" | "complete" | "not_started" | null;
}

/**
 * Helper to generate navigation links for a league context.
 *
 * Note: the former standalone "Trades" tab has been folded into the "Moves"
 * tab (the `/waiver` route now hosts waiver claims, trades, and alliances).
 */
export function getLeagueNavLinks(leagueId: string, opts: LeagueNavOptions = {}) {
  const links = [
    { href: `/league/${leagueId}/leaderboard`, label: "Leaderboard" },
    { href: `/league/${leagueId}/scoring`, label: "Scoring" },
    { href: `/league/${leagueId}/challenges`, label: "Challenges" },
    { href: `/league/${leagueId}/draft`, label: "Draft" },
    { href: `/league/${leagueId}/waiver`, label: "Moves" },
    { href: `/league/${leagueId}/transactions`, label: "Transactions" },
  ];

  // Hide the live Draft tab once the draft is complete.
  if (opts.draftStatus === "complete") {
    return links.filter((l) => l.href !== `/league/${leagueId}/draft`);
  }

  return links;
}

/**
 * Combined nav links: player links + single admin hub link (if the user is admin).
 */
export function getAllLeagueNavLinks(
  leagueId: string,
  isAdmin: boolean,
  opts: LeagueNavOptions = {}
) {
  const links = getLeagueNavLinks(leagueId, opts);
  if (isAdmin) {
    links.push({ href: `/league/${leagueId}/admin`, label: "⚙ Admin" });
  }
  return links;
}

/**
 * The Supabase server client type, referenced type-only so this module stays
 * free of runtime (and server-only) imports.
 */
type SupabaseServerClient = ReturnType<typeof import("@/lib/supabase/server").createClient>;

/**
 * Async convenience wrapper that fetches the league's draft status and returns
 * the combined nav links with the live Draft tab hidden once the draft is
 * complete. Call this from server components that have a Supabase client.
 */
export async function buildLeagueNav(
  supabase: SupabaseServerClient,
  leagueId: string,
  isAdmin: boolean
) {
  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("league_id", leagueId)
    .maybeSingle();

  return getAllLeagueNavLinks(leagueId, isAdmin, {
    draftStatus: (draft?.status as LeagueNavOptions["draftStatus"]) ?? null,
  });
}
