-- ============================================================
-- Fix: Remove overly-permissive team_assignments DELETE policy
--
-- The "members can delete for trades and waivers" policy allowed
-- ANY league member to delete ANY team assignment in their league.
-- This is too broad — it fails the RLS requirement that non-admin
-- direct deletes must be blocked (Req 12.10).
--
-- Trade assignment swaps are handled by execute_trade_swap()
-- (SECURITY DEFINER RPC added in migration 20240015).
-- Waiver processing runs via service_role (API route).
-- Neither requires a member-level DELETE policy.
--
-- Only the "admin can manage" FOR ALL policy governs DELETE.
-- ============================================================

DROP POLICY IF EXISTS "team_assignments: members can delete for trades and waivers" ON team_assignments;
