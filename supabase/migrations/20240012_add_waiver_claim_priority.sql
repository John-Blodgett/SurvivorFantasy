-- Add priority column to waiver_claims for player-defined claim ordering
-- Lower number = higher priority (1 is highest)
ALTER TABLE waiver_claims ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 1;
