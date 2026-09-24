-- scenario_locks.locked_by -> auth.users was NO ACTION, which blocks deleting
-- any user who has ever locked a cost center ("Database error deleting user").
--
-- SET NULL rather than CASCADE: a lock records that a cost center's budget is
-- submitted. That state must survive the person who submitted it leaving.
-- The admin view shows such locks as "Borttagen användare".
--
-- DDL only — run verification in a separate snippet.

ALTER TABLE public.scenario_locks ALTER COLUMN locked_by DROP NOT NULL;

DO $$
DECLARE
  con text;
BEGIN
  SELECT c.conname INTO con
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.scenario_locks'::regclass
    AND c.confrelid = 'auth.users'::regclass
    AND a.attname = 'locked_by';

  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.scenario_locks DROP CONSTRAINT %I', con);
  END IF;

  ALTER TABLE public.scenario_locks
    ADD CONSTRAINT scenario_locks_locked_by_fkey
    FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;
