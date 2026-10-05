-- Same fix as fix_accounts_rls_performance.sql, for budget_entries and actuals.
--
-- Their read policies call a scope function per row:
--   budget_entries → user_can_access_scenario_cost_center(scenario_id, cost_center_id)
--   actuals        → user_can_access_company_cost_center(company_id, cost_center_id)
-- Fine for the matrix (one cost center at a time), but the overview and the
-- per-account view read many cost centers at once. actuals already holds ~40 000
-- rows and budget_entries grows to ~500 000 per scenario once the staff budget and
-- mass distribution fill it — regional managers would hit the 8 s timeout the way
-- they did on accounts.
--
-- Here scope is per COST CENTER, not per company, so the set is cost center ids:
-- user_cost_center_ids() is computed once per statement and read policies become
-- `cost_center_id IN (SELECT user_cost_center_ids())` — a hashed InitPlan.
-- The rule is unchanged: user_can_access_company_cost_center() decides, as before.
-- (A cost center belongs to exactly one company, and a budget entry's cost center
-- is always in its scenario's company, so the scenario check adds nothing.)
--
-- WRITE RULES ARE NOT CHANGED. What this does to them:
--   * SELECT policies are replaced.
--   * FOR ALL policies are split into INSERT / UPDATE / DELETE policies with the
--     exact same expressions. A FOR ALL policy also applies to SELECT, so leaving
--     one in place would keep a per-row check on every read.
--   * INSERT / UPDATE / DELETE policies are left as they are.
-- The upsert the matrix saves with needs SELECT + INSERT + UPDATE to agree — run
-- step 3 in verify_budget_actuals_rls.sql right after this.
--
-- DDL only. Run verify_budget_actuals_rls.sql step 1–2 BEFORE this to have a
-- baseline, then all steps after.

CREATE OR REPLACE FUNCTION public.user_cost_center_ids()
RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cc.id
  FROM cost_centers cc
  WHERE is_admin()
     OR user_can_access_company_cost_center(cc.company_id, cc.id)
$$;

DO $$
DECLARE
  pol    record;
  roles  text;
  using_ text;
  check_ text;
BEGIN
  FOR pol IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('budget_entries', 'actuals')
  LOOP
    roles := array_to_string(ARRAY(SELECT quote_ident(r) FROM unnest(pol.roles) r), ', ');

    IF pol.cmd = 'SELECT' THEN
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);

    ELSIF pol.cmd = 'ALL' THEN
      -- For FOR ALL, a missing WITH CHECK means USING is the check
      using_ := COALESCE(pol.qual, pol.with_check);
      check_ := COALESCE(pol.with_check, pol.qual);
      EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR INSERT TO %s WITH CHECK (%s)',
        pol.policyname || '_ins', pol.tablename, pol.permissive, roles, check_);
      EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',
        pol.policyname || '_upd', pol.tablename, pol.permissive, roles, using_, check_);
      EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR DELETE TO %s USING (%s)',
        pol.policyname || '_del', pol.tablename, pol.permissive, roles, using_);
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
    END IF;
    -- INSERT / UPDATE / DELETE policies: untouched
  END LOOP;
END $$;

CREATE POLICY budget_entries_select ON public.budget_entries
  FOR SELECT TO authenticated
  USING (cost_center_id IN (SELECT public.user_cost_center_ids()));

CREATE POLICY actuals_select ON public.actuals
  FOR SELECT TO authenticated
  USING (cost_center_id IN (SELECT public.user_cost_center_ids()));
