-- ============================================================
-- Preserve the name of a deleted scoring rule on its events.
--
-- episode_events.scoring_rule_id is ON DELETE SET NULL, so the scoring log
-- could only show "Deleted rule". A BEFORE DELETE trigger now copies the
-- rule name onto the affected events before the reference is cleared.
-- Events whose rule was deleted before this migration keep a NULL name
-- (the name is no longer recoverable).
-- ============================================================
ALTER TABLE public.episode_events
  ADD COLUMN IF NOT EXISTS deleted_rule_name text;

CREATE OR REPLACE FUNCTION public.snapshot_deleted_rule_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.episode_events
     SET deleted_rule_name = OLD.name
   WHERE scoring_rule_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.snapshot_deleted_rule_name() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS scoring_rules_snapshot_name ON public.scoring_rules;
CREATE TRIGGER scoring_rules_snapshot_name
  BEFORE DELETE ON public.scoring_rules
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_deleted_rule_name();
