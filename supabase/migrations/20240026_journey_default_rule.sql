-- ============================================================
-- Make Journey a default scoring rule.
--
-- "Journey Challenge" becomes "Journey", is marked default, and gets a
-- clearer description. Existing copies are updated (a no-op where
-- already applied), and new leagues get it from the seed.
-- ============================================================

UPDATE public.scoring_rules
   SET name = 'Journey',
       is_default = true,
       description = 'Taking a boat from your island, away from your tribe, to another location for something.'
 WHERE name ILIKE 'journey challenge';

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
    (p_league_id, 'Journey',                     2,   true,
      'Taking a boat from your island, away from your tribe, to another location for something.');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) TO service_role;
