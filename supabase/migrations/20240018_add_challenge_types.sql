-- ============================================================
-- Add: configurable challenge types
--
-- Extends the `challenges` table with the columns needed to
-- support three challenge types (free_response, multiple_choice,
-- survivor_dropdown) plus their per-type configuration:
--
--   * challenge_type  — the type of challenge. NOT NULL with a
--                       DEFAULT of 'free_response' so every
--                       pre-existing challenge row is backfilled
--                       atomically to free response (Req 8.1).
--   * options         — ordered JSONB array of multiple-choice
--                       option texts (multiple_choice only).
--   * dropdown_scope  — 'all' | 'active_only' for the survivor
--                       dropdown option universe (survivor_dropdown
--                       only).
--   * correct_answer  — optional stored answer: the option text for
--                       multiple choice, or the castaway id for a
--                       survivor dropdown. Used for auto-grading.
--
-- Backward compatibility (Requirement 8):
--   * The DEFAULT 'free_response' backfills all existing rows in a
--     single atomic ALTER, so current challenges keep working and
--     are treated as free response.
--   * No statement here writes to `challenge_submissions`; existing
--     submissions and their response/is_correct values are left
--     untouched (Req 8.3).
--   * The whole change is wrapped in a single BEGIN/COMMIT
--     transaction, giving all-or-nothing semantics: any failure
--     rolls back every column addition (Req 8.4).
--
-- No existing RLS policy references these columns, so the current
-- `challenges` policies continue to apply unchanged.
-- ============================================================

BEGIN;

ALTER TABLE challenges
  ADD COLUMN challenge_type text NOT NULL DEFAULT 'free_response'
    CHECK (challenge_type IN ('free_response', 'multiple_choice', 'survivor_dropdown')),
  ADD COLUMN options jsonb,
  ADD COLUMN dropdown_scope text
    CHECK (dropdown_scope IN ('all', 'active_only')),
  ADD COLUMN correct_answer text;

COMMIT;

-- ============================================================
-- Down migration (reversible) — run to undo this migration.
-- Drops the columns in reverse dependency order within a single
-- transaction. This removes only the columns added above and does
-- not touch `challenge_submissions`.
--
-- BEGIN;
--
-- ALTER TABLE challenges
--   DROP COLUMN IF EXISTS correct_answer,
--   DROP COLUMN IF EXISTS dropdown_scope,
--   DROP COLUMN IF EXISTS options,
--   DROP COLUMN IF EXISTS challenge_type;
--
-- COMMIT;
-- ============================================================
