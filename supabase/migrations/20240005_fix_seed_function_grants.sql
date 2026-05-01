-- ============================================================
-- Fix: Revoke execute on seed_default_scoring_rules from
-- anon and authenticated roles explicitly.
-- This function is only called server-side via service_role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seed_default_scoring_rules(uuid) FROM authenticated;
