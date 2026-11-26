-- ============================================================
-- Season awards: league_awards table
--
-- Awards are computed in application code and saved here when the
-- league admin completes the season. One row per winner per award
-- (shared awards have several rows). Unclaimed awards have no rows.
--
-- Clients can only read (league members). Writes go through
-- replace_league_awards(), a SECURITY DEFINER function that checks
-- the caller is the league admin, mirroring end_ally() and
-- execute_trade_swap().
-- ============================================================
CREATE TABLE IF NOT EXISTS league_awards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES leagues(id)  ON DELETE CASCADE,
  award_key   text NOT NULL,
  player_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stat_value  numeric,
  stat_detail text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, award_key, player_id)
);

CREATE INDEX IF NOT EXISTS league_awards_league_idx ON league_awards (league_id);

ALTER TABLE league_awards ENABLE ROW LEVEL SECURITY;

-- League members can read awards. No INSERT/UPDATE/DELETE policies:
-- all writes go through replace_league_awards().
CREATE POLICY "league_awards_select"
  ON league_awards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_awards.league_id
        AND lm.player_id = auth.uid()
    )
  );

-- ============================================================
-- replace_league_awards: deletes the league's saved awards and
-- inserts the supplied ones. Pass '[]' to just clear them.
-- Each element: { award_key, player_id, stat_value, stat_detail }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.replace_league_awards(
  p_league_id uuid,
  p_awards    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
     WHERE id = p_league_id
       AND admin_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'Only the league admin can save awards');
  END IF;

  DELETE FROM public.league_awards WHERE league_id = p_league_id;

  INSERT INTO public.league_awards (league_id, award_key, player_id, stat_value, stat_detail)
  SELECT p_league_id,
         a->>'award_key',
         (a->>'player_id')::uuid,
         NULLIF(a->>'stat_value', '')::numeric,
         a->>'stat_detail'
    FROM jsonb_array_elements(COALESCE(p_awards, '[]'::jsonb)) AS a;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_league_awards(uuid, jsonb) FROM PUBLIC;
-- Supabase also grants EXECUTE to anon by default on new functions.
REVOKE EXECUTE ON FUNCTION public.replace_league_awards(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_league_awards(uuid, jsonb) TO authenticated;

-- ============================================================
-- Down migration (reversible)
--
-- DROP FUNCTION IF EXISTS public.replace_league_awards(uuid, jsonb);
-- DROP TABLE IF EXISTS league_awards;
-- ============================================================
