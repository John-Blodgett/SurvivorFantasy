-- ============================================================
-- Alliance feature: league_allies table
-- Players whose castaways are all eliminated can ally with
-- an active castaway and earn ceil(castaway_episode_pts / 2)
-- per finalized episode going forward.
-- ============================================================

CREATE TABLE IF NOT EXISTS league_allies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  castaway_id         uuid NOT NULL REFERENCES castaways(id) ON DELETE CASCADE,
  points_from_episode int NOT NULL,   -- first episode to earn ally points (latest_finalized + 1 at creation)
  created_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  ended_reason        text CHECK (ended_reason IN ('castaway_eliminated', 'admin_reset'))
);

-- One active alliance per player per league
CREATE UNIQUE INDEX league_allies_one_active_per_player
  ON league_allies (league_id, player_id)
  WHERE ended_at IS NULL;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE league_allies ENABLE ROW LEVEL SECURITY;

-- All league members can read alliances
CREATE POLICY "league_allies_select"
  ON league_allies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_allies.league_id
        AND lm.player_id = auth.uid()
    )
  );

-- Players can only create their own alliance
CREATE POLICY "league_allies_insert"
  ON league_allies FOR INSERT
  WITH CHECK (
    player_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_allies.league_id
        AND lm.player_id = auth.uid()
    )
  );

-- No direct UPDATE — use end_ally() SECURITY DEFINER function below

-- ============================================================
-- end_ally: ends an active alliance (used by server actions
-- and admin). SECURITY DEFINER so it can bypass RLS for
-- the update.
-- ============================================================

CREATE OR REPLACE FUNCTION public.end_ally(
  p_ally_id   uuid,
  p_reason    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ally public.league_allies%ROWTYPE;
BEGIN
  SELECT * INTO v_ally
    FROM public.league_allies
   WHERE id = p_ally_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Alliance not found');
  END IF;

  IF v_ally.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Alliance already ended');
  END IF;

  -- Only the allied player OR the league admin may call this
  IF v_ally.player_id <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.leagues
     WHERE id = v_ally.league_id
       AND admin_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  UPDATE public.league_allies
     SET ended_at     = now(),
         ended_reason = p_reason
   WHERE id = p_ally_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.end_ally(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_ally(uuid, text) TO authenticated;
