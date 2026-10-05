-- Verification for fix_budget_actuals_rls_performance.sql.
-- Every step runs both before and after the migration. Before: a baseline for
-- step 1–2 and proof that step 3–4 behave the same way today. After: compare.
-- Everything runs as robert.vikstrom@onvia.se inside BEGIN … ROLLBACK — nothing is kept.
-- Run each step as its own snippet.

-- 0. The policies on the two tables (after: one _select each, writes unchanged
--    except FOR ALL split into _ins/_upd/_del)
SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('budget_entries', 'actuals')
ORDER BY tablename, cmd, policyname;

-- 1. Overview-sized read: the whole Budget 2027 scenario, every cost center Robert sees.
--    Compare Execution Time before and after.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'robert.vikstrom@onvia.se'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
EXPLAIN ANALYZE
SELECT cost_center_id, account_id, year, month, amount
FROM budget_entries
WHERE scenario_id = (SELECT id FROM scenarios WHERE company_id = 4 AND name = 'Budget 2027' LIMIT 1);
ROLLBACK;

-- 2. Actuals for the whole company, as the per-account view and overview read them.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'robert.vikstrom@onvia.se'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
EXPLAIN ANALYZE
SELECT cost_center_id, account_id, year, month, amount
FROM actuals
WHERE company_id = 4;
ROLLBACK;

-- 3. Saving still works — the same upsert the matrix does, on one of Robert's
--    cost centers and an ordinary (non-staff) budgetable account.
--    Expect: INSERT 0 1. Any RLS error here means the write policies broke.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'robert.vikstrom@onvia.se'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
WITH s AS (SELECT id FROM scenarios WHERE company_id = 4 AND name = 'Budget 2027' LIMIT 1),
     -- The existing rule, so this step also runs before the migration
     cc AS (SELECT id FROM cost_centers WHERE company_id = 4 AND user_can_access_company_cost_center(company_id, id) ORDER BY code LIMIT 1),
     acc AS (
       SELECT a.id FROM accounts a JOIN account_configs ac ON ac.account_id = a.id
       WHERE a.company_id = 4 AND ac.is_budgetable AND NOT coalesce(ac.is_intercompany, false)
         AND a.id NOT IN (SELECT account_id FROM staff_locked_account_ids((SELECT id FROM s)))
       ORDER BY a.account_number LIMIT 1
     )
INSERT INTO budget_entries (scenario_id, account_id, cost_center_id, year, month, amount, counterpart_company_id, updated_by, updated_at)
SELECT (SELECT id FROM s), (SELECT id FROM acc), (SELECT id FROM cc), 2027, 12, 1, NULL, auth.uid(), now()
ON CONFLICT (scenario_id, account_id, cost_center_id, year, month, counterpart_company_id)
DO UPDATE SET amount = EXCLUDED.amount;
ROLLBACK;

-- 4. And is still refused outside his scope. Expect: ERROR new row violates
--    row-level security policy. If it succeeds, scope got wider — stop and report.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id FROM auth.users WHERE email = 'robert.vikstrom@onvia.se'),
                    'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO budget_entries (scenario_id, account_id, cost_center_id, year, month, amount, counterpart_company_id, updated_by, updated_at)
SELECT
  (SELECT id FROM scenarios WHERE company_id = 4 AND name = 'Budget 2027' LIMIT 1),
  (SELECT a.id FROM accounts a JOIN account_configs ac ON ac.account_id = a.id
    WHERE a.company_id = 4 AND ac.is_budgetable ORDER BY a.account_number LIMIT 1),
  (SELECT cc.id FROM cost_centers cc
    WHERE cc.company_id = 4 AND NOT user_can_access_company_cost_center(cc.company_id, cc.id)
    ORDER BY cc.code LIMIT 1),
  2027, 12, 1, NULL, auth.uid(), now();
ROLLBACK;
