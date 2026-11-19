-- ============================================================
-- When a player allies, their eliminated castaways leave their team.
--
-- Members cannot delete team_assignments directly (see 20240016), so this
-- SECURITY DEFINER function removes only the caller's own eliminated
-- castaways, and only while the caller has an active alliance in the league.
-- Historical points stay with the player via episode_events.player_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.drop_eliminated_for_ally(p_league_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.league_allies
     WHERE league_id = p_league_id
       AND player_id = auth.uid()
       AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'No active alliance';
  END IF;

  DELETE FROM public.team_assignments ta
   USING public.castaways c
   WHERE ta.castaway_id = c.id
     AND ta.league_id = p_league_id
     AND ta.player_id = auth.uid()
     AND c.is_eliminated = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.drop_eliminated_for_ally(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.drop_eliminated_for_ally(uuid) TO authenticated;
