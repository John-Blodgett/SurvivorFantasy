-- ============================================================
-- Fantasy Survivor: Default Scoring Rules Seed Function
-- ============================================================
-- Creates a function that inserts the default scoring rules
-- for a newly created league. Called from the application
-- after inserting a row into the leagues table.
-- Requirements: 5.3, 15.1
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_default_scoring_rules(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.scoring_rules (league_id, name, points, is_default) VALUES
    -- Immunity & challenges
    (p_league_id, 'Individual Immunity Win',        5,   true),
    (p_league_id, 'Reward Challenge Win',           2,   true),
    (p_league_id, 'Tribal Council Vote (received)', -1,  true),
    -- Advantages & idols
    (p_league_id, 'Hidden Immunity Idol Found',     3,   true),
    (p_league_id, 'Hidden Immunity Idol Played',    5,   true),
    (p_league_id, 'Advantage Found',                2,   true),
    -- Tribal outcomes
    (p_league_id, 'Voted Out',                      -2,  true),
    (p_league_id, 'Survives Tribal Council',        1,   true),
    -- End-game
    (p_league_id, 'Makes Merge',                    5,   true),
    (p_league_id, 'Makes Final Tribal Council',     10,  true),
    (p_league_id, 'Season Winner',                  25,  true);
END;
$$;
