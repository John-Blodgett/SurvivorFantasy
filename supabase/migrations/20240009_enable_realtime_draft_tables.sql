-- Enable Supabase Realtime for draft-related tables
-- so that all connected clients receive live updates when picks are made
ALTER PUBLICATION supabase_realtime ADD TABLE draft_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE drafts;
