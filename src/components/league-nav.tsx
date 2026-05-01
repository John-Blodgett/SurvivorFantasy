/**
 * Helper to generate navigation links for a league context.
 */
export function getLeagueNavLinks(leagueId: string) {
  return [
    { href: `/league/${leagueId}/leaderboard`, label: "Leaderboard" },
    { href: `/league/${leagueId}/episodes`, label: "Episodes" },
    { href: `/league/${leagueId}/challenges`, label: "Challenges" },
    { href: `/league/${leagueId}/draft`, label: "Draft" },
    { href: `/league/${leagueId}/waiver`, label: "Waiver Wire" },
  ];
}
