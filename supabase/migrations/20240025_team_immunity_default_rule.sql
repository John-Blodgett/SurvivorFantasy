-- ============================================================
-- Make team immunity a default scoring rule.
--
-- The seed previously created "Immunity Challenge Win" as a
-- non-default rule. It is a standard, frequently scored rule, so new
-- leagues now get it as a default named "Team Immunity Challenge Win"
-- (to distinguish it from "Individual Immunity Win").
--
-- Existing leagues: the Survivor 51 rule was already renamed and
-- marked default directly. The UPDATE below makes any other existing
-- copy match, and is a no-op where it already does.
-- ============================================================

UPDATE public.scoring_rules
   SET name = 'Team Immunity Challenge Win',
       is_default = true
 WHERE name ILIKE 'immunity challenge win';

CREATE OR REPLACE FUNCTION public.seed_default_scoring_rules(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.scoring_rules (league_id, name, points, is_default, description) VALUES
    (p_league_id, 'Individual Immunity Win',     3,   true,  NULL),
    (p_league_id, 'Team Immunity Challenge Win', 2,   true,  NULL),
    (p_league_id, 'Voted Out',                   -2,  true,  NULL),
    (p_league_id, 'Reward Challenge Win',        2,   true,  NULL),
    (p_league_id, 'Hidden Immunity Idol Found',  3,   true,  NULL),
    (p_league_id, 'Advantage Found',             2,   true,  NULL),
    (p_league_id, 'Season Winner',               10,  true,  NULL),
    (p_league_id, 'Journey Challenge',           2,   false,
      'Takes a boat away from tribe to a separate location for a challenge');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) TO service_role;
