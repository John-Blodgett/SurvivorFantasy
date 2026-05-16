/**
 * Helper to generate navigation links for a league context.
 */
export function getLeagueNavLinks(leagueId: string) {
  return [
    { href: `/league/${leagueId}/leaderboard`, label: "Leaderboard" },
    { href: `/league/${leagueId}/scoring`, label: "Scoring" },
    { href: `/league/${leagueId}/episodes`, label: "Episodes" },
    { href: `/league/${leagueId}/challenges`, label: "Challenges" },
    { href: `/league/${leagueId}/draft`, label: "Draft" },
    { href: `/league/${leagueId}/trades`, label: "Trades" },
    { href: `/league/${leagueId}/waiver`, label: "Waiver Wire" },
    { href: `/league/${leagueId}/transactions`, label: "Transactions" },
  ];
}

/**
 * Combined nav links: player links + single admin hub link (if the user is admin).
 */
export function getAllLeagueNavLinks(leagueId: string, isAdmin: boolean) {
  const links = getLeagueNavLinks(leagueId);
  if (isAdmin) {
    links.push({ href: `/league/${leagueId}/admin`, label: "⚙ Admin" });
  }
  return links;
}
