-- ============================================================
-- Fix: Draft-related RLS policies
--
-- Problems:
-- 1. league_members SELECT: non-admin members can only see
--    their own row, so generateSnakeOrder() gets 1 player
--    instead of all players. Fix: all members can see fellow
--    members via a non-recursive approach using SECURITY DEFINER.
--
-- 2. draft_picks INSERT: requires player_id = auth.uid(), but
--    auto-pick inserts on behalf of another player. Fix: also
--    allow league admin to insert picks during active draft.
--
-- 3. team_assignments INSERT: only admin can manage, but
--    players need to insert their own during draft. Fix: allow
--    players to insert their own assignments during active draft.
--
-- 4. drafts UPDATE: only admin can manage, but makeDraftPickAction
--    needs to advance current_pick_index. Fix: allow members to
--    update draft during active draft (server action validates turn).
-- ============================================================

-- ============================================================
-- 1. Fix league_members SELECT — use a SECURITY DEFINER helper
--    to break the circular RLS dependency.
-- ============================================================

-- Create a SECURITY DEFINER function that bypasses RLS to check membership
CREATE OR REPLACE FUNCTION public.is_league_member_definer(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
    WHERE league_id = p_league_id
      AND player_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_league_member_definer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_league_member_definer(uuid) TO authenticated;

-- Drop old policies
DROP POLICY IF EXISTS "league_members: users read own" ON league_members;
DROP POLICY IF EXISTS "league_members: admin reads all" ON league_members;
DROP POLICY IF EXISTS "league_members: members can read" ON league_members;

-- All league members can see fellow members (uses SECURITY DEFINER to avoid recursion)
CREATE POLICY "league_members: members can read all in league"
  ON league_members FOR SELECT
  TO authenticated
  USING (is_league_member_definer(league_id));

-- ============================================================
-- 2. Fix draft_picks INSERT — allow admin to insert on behalf
--    of players (for auto-pick on timer expiry)
-- ============================================================

DROP POLICY IF EXISTS "draft_picks: players can pick" ON draft_picks;

CREATE POLICY "draft_picks: players and admin can pick"
  ON draft_picks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM drafts d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = draft_id
        AND d.status = 'active'
        AND (
          player_id = auth.uid()
          OR l.admin_id = auth.uid()
        )
        AND is_league_member_definer(d.league_id)
    )
  );

-- ============================================================
-- 3. Fix team_assignments — allow players to insert their own
--    assignment during draft, in addition to admin managing all
-- ============================================================

-- Keep existing admin policy, add player self-insert for draft
CREATE POLICY "team_assignments: players can insert own from draft"
  ON team_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    player_id = auth.uid()
    AND source = 'draft'
    AND is_league_member_definer(league_id)
  );

-- ============================================================
-- 4. Fix drafts UPDATE — allow any league member to advance
--    the pick index during an active draft
-- ============================================================

CREATE POLICY "drafts: members can advance active draft"
  ON drafts FOR UPDATE
  TO authenticated
  USING (
    status = 'active'
    AND is_league_member_definer(league_id)
  )
  WITH CHECK (
    is_league_member_definer(league_id)
  );
