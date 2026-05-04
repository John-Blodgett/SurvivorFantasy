-- Fix realtime subscriptions for draft tables.
-- Filtered subscriptions with RLS require FULL replica identity
-- so the realtime system can evaluate policies against the complete row.

ALTER TABLE drafts REPLICA IDENTITY FULL;
ALTER TABLE draft_picks REPLICA IDENTITY FULL;
