import type { AwardsInput } from "@/lib/awards";

/**
 * Structural type for the Supabase server client. Only the query-builder
 * surface used below is relied on, matching src/lib/league-standings.ts.
 */
type SupabaseLike = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (query: string) => any;
  };
};

const PAGE_SIZE = 1000;

/**
 * Fetches every row of a query, paging past Supabase's default 1000-row cap.
 * `build` must return a fresh query builder each call.
 */
async function fetchAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await build().range(from, from + PAGE_SIZE - 1);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Loads everything the award engine needs for one league. Contains no award
 * rules: it only maps database rows into an AwardsInput.
 */
export async function loadAwardsInput(
  supabase: SupabaseLike,
  leagueId: string
): Promise<AwardsInput> {
  const { data: league } = await supabase
    .from("leagues")
    .select("roster_size, waiver_budget, consolation_points")
    .eq("id", leagueId)
    .single();

  const members = await fetchAll<{
    player_id: string;
    profiles: { display_name: string } | null;
  }>(() =>
    supabase
      .from("league_members")
      .select("player_id, profiles(display_name)")
      .eq("league_id", leagueId)
      .order("player_id")
  );

  const episodes = await fetchAll<{ number: number; finalized_at: string | null }>(() =>
    supabase
      .from("episodes")
      .select("number, finalized_at")
      .eq("league_id", leagueId)
      .eq("is_finalized", true)
      .order("number")
  );

  const castaways = await fetchAll<{
    id: string;
    name: string;
    eliminated_episode: number | null;
  }>(() =>
    supabase
      .from("castaways")
      .select("id, name, eliminated_episode")
      .eq("league_id", leagueId)
      .order("id")
  );

  const eventRows = await fetchAll<{
    id: string;
    castaway_id: string;
    points: number;
    player_id: string | null;
    scoring_rules: { name: string } | null;
    episodes: { number: number };
  }>(() =>
    supabase
      .from("episode_events")
      .select(
        "id, castaway_id, points, player_id, scoring_rules(name), episodes!inner(league_id, number, is_finalized)"
      )
      .eq("episodes.league_id", leagueId)
      .eq("episodes.is_finalized", true)
      .order("id")
  );

  const assignments = await fetchAll<AwardsInput["assignments"][number]>(() =>
    supabase
      .from("team_assignments")
      .select("player_id, castaway_id, points_from_episode, source")
      .eq("league_id", leagueId)
      .order("id")
  );

  const claims = await fetchAll<AwardsInput["claims"][number]>(() =>
    supabase
      .from("waiver_claims")
      .select("player_id, castaway_id, drop_castaway_id, bid_amount, status, processed_at")
      .eq("league_id", leagueId)
      .order("id")
  );

  const allies = await fetchAll<AwardsInput["allies"][number]>(() =>
    supabase
      .from("league_allies")
      .select("player_id, castaway_id, points_from_episode, ended_at")
      .eq("league_id", leagueId)
      .order("id")
  );

  const trades = await fetchAll<AwardsInput["trades"][number]>(() =>
    supabase
      .from("trades")
      .select("proposer_id, receiver_id, status")
      .eq("league_id", leagueId)
      .order("id")
  );

  const challengeRows = await fetchAll<{
    id: string;
    points: number;
    episodes: { number: number } | null;
  }>(() =>
    supabase
      .from("challenges")
      .select("id, points, episodes(number)")
      .eq("league_id", leagueId)
      .order("id")
  );

  const submissions = await fetchAll<AwardsInput["submissions"][number]>(() =>
    supabase
      .from("challenge_submissions")
      .select("challenge_id, player_id, is_correct, challenges!inner(league_id)")
      .eq("challenges.league_id", leagueId)
      .order("id")
  );

  return {
    league: {
      roster_size: league?.roster_size ?? 1,
      waiver_budget: league?.waiver_budget ?? 100,
      consolation_points: league?.consolation_points ?? 0,
    },
    players: members.map((m) => ({
      player_id: m.player_id,
      display_name: m.profiles?.display_name ?? "Unknown Player",
    })),
    finalizedEpisodes: episodes,
    castaways,
    events: eventRows.map((e) => ({
      episode_number: e.episodes.number,
      castaway_id: e.castaway_id,
      points: e.points,
      player_id: e.player_id,
      rule_name: e.scoring_rules?.name ?? null,
    })),
    assignments,
    claims,
    allies,
    trades,
    challenges: challengeRows
      .filter((c) => c.episodes !== null)
      .map((c) => ({
        id: c.id,
        episode_number: (c.episodes as { number: number }).number,
        points: c.points,
      })),
    submissions: submissions.map((s) => ({
      challenge_id: s.challenge_id,
      player_id: s.player_id,
      is_correct: s.is_correct,
    })),
  };
}
