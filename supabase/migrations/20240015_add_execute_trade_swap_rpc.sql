-- ============================================================
-- Add: execute_trade_swap RPC
--
-- A SECURITY DEFINER function that atomically swaps team
-- assignments when a trade is admin-approved. This is called
-- from the admin approveTradeAction server action, which runs
-- as the league admin (an authenticated user subject to RLS).
--
-- The admin-level DELETE RLS on team_assignments works via
-- is_league_admin() which is SECURITY INVOKER. In some edge
-- cases this can fail silently. This RPC bypasses that by
-- running the DELETE as the definer (bypassing RLS entirely).
--
-- Additionally, a SECURITY DEFINER function accept_trade is
-- provided for the receiver acceptance step. This validates
-- the trade and marks it 'accepted', which the existing
-- "trades: receiver or admin can update" RLS policy already
-- permits — so this is just a convenience wrapper with
-- server-side validation.
--
-- The intended trade lifecycle:
--   pending → accepted (by receiver via accept_trade RPC)
--   accepted → admin_approved (by admin via execute_trade_swap RPC)
-- ============================================================

-- ============================================================
-- 1. accept_trade: receiver marks trade as accepted
--    (validates ownership/eligibility, updates status only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_trade(p_trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trade public.trades%ROWTYPE;
BEGIN
  -- Load trade
  SELECT * INTO v_trade
    FROM public.trades
   WHERE id = p_trade_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Trade not found');
  END IF;

  -- Caller must be the receiver
  IF v_trade.receiver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', 'Only the receiver can accept this trade');
  END IF;

  -- Trade must be pending
  IF v_trade.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Trade is no longer pending');
  END IF;

  -- Proposer must still own their castaway
  IF NOT EXISTS (
    SELECT 1 FROM public.team_assignments
     WHERE league_id   = v_trade.league_id
       AND player_id   = v_trade.proposer_id
       AND castaway_id = v_trade.proposer_castaway
  ) THEN
    RETURN jsonb_build_object('error', 'Proposer no longer owns their castaway');
  END IF;

  -- Receiver must still own their castaway
  IF NOT EXISTS (
    SELECT 1 FROM public.team_assignments
     WHERE league_id   = v_trade.league_id
       AND player_id   = v_trade.receiver_id
       AND castaway_id = v_trade.receiver_castaway
  ) THEN
    RETURN jsonb_build_object('error', 'Receiver no longer owns their castaway');
  END IF;

  -- Neither castaway may be eliminated
  IF EXISTS (
    SELECT 1 FROM public.castaways
     WHERE id IN (v_trade.proposer_castaway, v_trade.receiver_castaway)
       AND is_eliminated = true
  ) THEN
    RETURN jsonb_build_object('error', 'One or both castaways have been eliminated');
  END IF;

  -- Mark trade as accepted (awaiting admin approval)
  UPDATE public.trades
     SET status = 'accepted'
   WHERE id = p_trade_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_trade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_trade(uuid) TO authenticated;


-- ============================================================
-- 2. execute_trade_swap: admin finalizes the assignment swap
--    Called from approveTradeAction after admin approves.
--    Uses SECURITY DEFINER to bypass admin-only DELETE RLS
--    on team_assignments (is_league_admin can fail silently
--    due to SECURITY INVOKER + RLS chain on leagues table).
-- ============================================================
CREATE OR REPLACE FUNCTION public.execute_trade_swap(p_trade_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trade     public.trades%ROWTYPE;
  v_latest_ep int;
  v_points    int;
BEGIN
  -- Load and lock the trade
  SELECT * INTO v_trade
    FROM public.trades
   WHERE id = p_trade_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Trade not found');
  END IF;

  -- Caller must be the league admin
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues
     WHERE id = v_trade.league_id
       AND admin_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'Only the league admin can approve trades');
  END IF;

  -- Trade must be in accepted status
  IF v_trade.status <> 'accepted' THEN
    RETURN jsonb_build_object('error', 'Trade must be accepted before admin approval');
  END IF;

  -- Determine points_from_episode (latest finalized + 1)
  SELECT COALESCE(MAX(number), 0) INTO v_latest_ep
    FROM public.episodes
   WHERE league_id    = v_trade.league_id
     AND is_finalized = true;

  v_points := v_latest_ep + 1;

  -- Mark as admin_approved
  UPDATE public.trades
     SET status = 'admin_approved',
         resolved_at = now()
   WHERE id = p_trade_id;

  -- Swap assignments (bypasses RLS — admin ownership already validated above)
  DELETE FROM public.team_assignments
   WHERE league_id   = v_trade.league_id
     AND castaway_id = v_trade.proposer_castaway;

  DELETE FROM public.team_assignments
   WHERE league_id   = v_trade.league_id
     AND castaway_id = v_trade.receiver_castaway;

  INSERT INTO public.team_assignments
    (league_id, player_id, castaway_id, points_from_episode, source)
  VALUES
    (v_trade.league_id, v_trade.receiver_id, v_trade.proposer_castaway, v_points, 'trade'),
    (v_trade.league_id, v_trade.proposer_id, v_trade.receiver_castaway, v_points, 'trade');

  RETURN jsonb_build_object('ok', true, 'points_from_episode', v_points);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_trade_swap(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_trade_swap(uuid) TO authenticated;
