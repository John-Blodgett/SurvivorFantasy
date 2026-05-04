-- ============================================================
-- Add missing RLS policies for waiver_claims table
-- ============================================================

-- Players can read their own claims; league members can see all claims
CREATE POLICY "waiver_claims: players read own, admin reads all"
  ON waiver_claims FOR SELECT
  TO authenticated
  USING (
    player_id = auth.uid()
    OR is_league_member_definer(league_id)
  );

-- Players can submit their own claims
CREATE POLICY "waiver_claims: players can submit"
  ON waiver_claims FOR INSERT
  TO authenticated
  WITH CHECK (
    player_id = auth.uid()
    AND is_league_member_definer(league_id)
  );

-- Admin can update claims (process: mark won/lost)
CREATE POLICY "waiver_claims: admin can process"
  ON waiver_claims FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = waiver_claims.league_id
        AND leagues.admin_id = auth.uid()
    )
  );

-- Players can delete their own pending claims
CREATE POLICY "waiver_claims: players can cancel own pending"
  ON waiver_claims FOR DELETE
  TO authenticated
  USING (
    player_id = auth.uid()
    AND status = 'pending'
  );
