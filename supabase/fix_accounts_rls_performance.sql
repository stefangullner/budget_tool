-- Accounts and account configs were unreadable for regional managers: not denied,
-- but slow enough to hit the statement timeout (8 s for authenticated).
--
-- EXPLAIN ANALYZE as robert.vikstrom@onvia.se (2026-10-05): 4.5 s for the first
-- 1000 accounts. Each row re-ran the scope check — user_roles scanned, cost
-- centers matched on region — and account_configs' policy queried accounts, whose
-- own RLS queried cost_centers, whose RLS queried user_roles again: 26 000 user_roles
-- scans for one page. Admins never noticed, is_admin() short-circuits.
--
-- Fix: the set of companies a user can reach is computed ONCE per statement and
-- the policies only look it up. `IN (SELECT f())` with no reference to the row is
-- planned as a hashed InitPlan — evaluated once, not per row.
--
-- The rule itself is unchanged and still comes from the single source of truth:
-- a company is reachable when the user can access any of its cost centers through
-- user_can_access_company_cost_center() (company, region, cost center or global
-- role, plus admin).
--
-- Replaces every policy on the two tables with: one SELECT policy, one admin
-- write policy. Before this they were SELECT (scope) + SELECT (region) + ALL (admin).
-- DDL only.

CREATE OR REPLACE FUNCTION public.user_company_ids()
RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id
  FROM companies c
  WHERE is_admin()
     OR EXISTS (
       SELECT 1 FROM cost_centers cc
       WHERE cc.company_id = c.id
         AND user_can_access_company_cost_center(c.id, cc.id)
     )
$$;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('accounts', 'account_configs')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

CREATE POLICY accounts_select ON public.accounts
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()));

CREATE POLICY accounts_admin_write ON public.accounts
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Goes through accounts, whose policy is now a cheap lookup in the same set.
CREATE POLICY account_configs_select ON public.account_configs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = account_configs.account_id
      AND a.company_id IN (SELECT public.user_company_ids())
  ));

CREATE POLICY account_configs_admin_write ON public.account_configs
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
