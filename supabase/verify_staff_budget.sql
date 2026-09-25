-- Verification for add_staff_budget.sql. Run AFTER the migration, as a separate
-- snippet. Read-only except step 4, which is wrapped in BEGIN … ROLLBACK.
-- Replace :scenario_id with a real id (the scenario where the staff budget is activated).

-- 1. Everything exists
SELECT proname FROM pg_proc
WHERE proname IN ('staff_cost_rows', 'recalc_staff_budget', 'staff_locked_account_ids',
                  'guard_staff_budget_entries', 'user_can_access_staff', 'admin_recalc_staff_budget')
ORDER BY 1;

SELECT tgname, tgrelid::regclass FROM pg_trigger
WHERE tgname LIKE 'staff_%' OR tgname = 'guard_staff_budget_entries'
ORDER BY 2, 1;

-- 2. The budget holds exactly what the calculation says (expect zero rows)
WITH calc AS (
  SELECT r.cost_center_id, r.year, r.month, round(sum(r.total)) AS amount
  FROM staff_cost_rows(:scenario_id) r
  GROUP BY 1, 2, 3
),
budget AS (
  SELECT be.cost_center_id, be.year, be.month, sum(be.amount) AS amount
  FROM budget_entries be
  WHERE be.scenario_id = :scenario_id
    AND be.account_id IN (SELECT account_id FROM staff_locked_account_ids(:scenario_id))
  GROUP BY 1, 2, 3
)
SELECT coalesce(c.cost_center_id, b.cost_center_id) AS cost_center_id,
       coalesce(c.year, b.year) AS year, coalesce(c.month, b.month) AS month,
       c.amount AS calculated, b.amount AS in_budget
FROM calc c FULL JOIN budget b USING (cost_center_id, year, month)
WHERE abs(coalesce(c.amount, 0) - coalesce(b.amount, 0)) > 7; -- rounding per account, up to 7 accounts

-- 3. Totals per cost center, for a sanity check against the 2026 Excel file
SELECT cc.code, cc.name, round(sum(r.total)) AS staff_cost, count(DISTINCT r.member_id) AS people
FROM staff_cost_rows(:scenario_id) r
JOIN cost_centers cc ON cc.id = r.cost_center_id
GROUP BY cc.code, cc.name
ORDER BY cc.code;

-- 4. The staff accounts are locked for the app (expect: ERROR staff_locked_account)
--    Impersonate any non-admin user who can budget in the scenario.
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '<user_id>', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
UPDATE budget_entries SET amount = amount + 1
WHERE scenario_id = :scenario_id
  AND account_id IN (SELECT account_id FROM staff_locked_account_ids(:scenario_id));
ROLLBACK;
