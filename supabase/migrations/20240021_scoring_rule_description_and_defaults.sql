-- ============================================================
-- Fantasy Survivor: Scoring rule descriptions + new season defaults
-- ============================================================
-- 1. Adds an optional `description` column so admins can provide
--    extra detail for a rule that players can read.
-- 2. Replaces the default scoring-rule seed set with the current
--    season's defaults.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Add description column
-- ------------------------------------------------------------
ALTER TABLE public.scoring_rules
  ADD COLUMN IF NOT EXISTS description text;

-- ------------------------------------------------------------
-- 2. Update the seed function with the new default rule set
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_scoring_rules(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.scoring_rules (league_id, name, points, is_default, description) VALUES
    (p_league_id, 'Individual Immunity Win',    3,   true,  NULL),
    (p_league_id, 'Voted Out',                  -2,  true,  NULL),
    (p_league_id, 'Reward Challenge Win',       2,   true,  NULL),
    (p_league_id, 'Hidden Immunity Idol Found', 3,   true,  NULL),
    (p_league_id, 'Advantage Found',            2,   true,  NULL),
    (p_league_id, 'Season Winner',              10,  true,  NULL),
    (p_league_id, 'Immunity Challenge Win',     2,   false, NULL),
    (p_league_id, 'Journey Challenge',          2,   false,
      'Takes a boat away from tribe to a separate location for a challenge');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) TO service_role;
