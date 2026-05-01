-- ============================================================
-- Fantasy Survivor: Fix Function Security Warnings
-- Fixes:
--   - function_search_path_mutable (set search_path = '')
--   - anon_security_definer_function_executable (revoke from anon)
--   - authenticated_security_definer_function_executable
--     (switch helpers to SECURITY INVOKER — they only need to
--      query tables the caller already has access to via RLS,
--      so INVOKER is both correct and safer)
-- ============================================================

-- ============================================================
-- is_league_member: switch to SECURITY INVOKER + fix search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league_id
      AND player_id = auth.uid()
  );
$$;

-- Revoke public execute (anon + authenticated inherit from PUBLIC)
REVOKE EXECUTE ON FUNCTION public.is_league_member(uuid) FROM PUBLIC;
-- Grant only to authenticated users
GRANT EXECUTE ON FUNCTION public.is_league_member(uuid) TO authenticated;

-- ============================================================
-- is_league_admin: switch to SECURITY INVOKER + fix search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_league_admin(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leagues
    WHERE id = p_league_id
      AND admin_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_league_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_league_admin(uuid) TO authenticated;

-- ============================================================
-- seed_default_scoring_rules: fix search_path + qualify table
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_scoring_rules(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.scoring_rules (league_id, name, points, is_default) VALUES
    (p_league_id, 'Individual Immunity Win',        5,   true),
    (p_league_id, 'Reward Challenge Win',           2,   true),
    (p_league_id, 'Tribal Council Vote (received)', -1,  true),
    (p_league_id, 'Hidden Immunity Idol Found',     3,   true),
    (p_league_id, 'Hidden Immunity Idol Played',    5,   true),
    (p_league_id, 'Advantage Found',                2,   true),
    (p_league_id, 'Voted Out',                      -2,  true),
    (p_league_id, 'Survives Tribal Council',        1,   true),
    (p_league_id, 'Makes Merge',                    5,   true),
    (p_league_id, 'Makes Final Tribal Council',     10,  true),
    (p_league_id, 'Season Winner',                  25,  true);
END;
$$;

-- seed_default_scoring_rules is called server-side only (from API routes),
-- so revoke from anon. Authenticated users also shouldn't call it directly —
-- it's invoked by the server after league creation.
REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) TO service_role;
