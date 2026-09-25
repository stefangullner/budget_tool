-- Vacation liability (semesterlöneskuld): earned days cost money every month,
-- taken days release it. Runs after add_staff_budget.sql and staff_pension_itp1.sql.
--
-- Two vacation models per scenario:
--   'simple'    — as before: the vacation supplement is spread evenly or booked in
--                 one chosen month. No liability.
--   'liability' — every month the person earns vacation_days / 12 days, and the
--                 days they take are planned per month. The change in liability
--                 goes to its own account (default 7290), with employer fees on it
--                 (default 7519). The vacation supplement (7285) is booked in the
--                 months the days are taken.
--
-- Value of one vacation day = vacation_liability_pct % of the monthly salary
-- (default 5.4 % = daily salary ~4.6 % + supplement 0.8 %, as in the 2026 file).
-- Holiday pay itself is in the ordinary monthly salary (sammalöneregeln), so over
-- a year where days taken = days earned, the liability account nets to zero.
--
-- Days taken per month come from, in order:
--   1. the person's own plan (staff_vacation_plan), if they have any rows
--   2. the scenario's default plan, scaled to the person's vacation days
--      (a 30-day person gets 30/25 of a plan written for 25 days)
--   3. otherwise evenly over the year — then the liability stays flat
--
-- Existing active scenarios keep 'simple' until the model is switched in admin.
-- DDL only.

-- ---------------------------------------------------------------------------
-- Parameters
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_parameters
  ADD COLUMN IF NOT EXISTS vacation_model                 text    NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS vacation_liability_pct         numeric NOT NULL DEFAULT 5.4,
  ADD COLUMN IF NOT EXISTS account_vacation_liability     text    DEFAULT '7290',
  ADD COLUMN IF NOT EXISTS account_vacation_liability_fee text    DEFAULT '7519',
  ADD COLUMN IF NOT EXISTS default_vacation_plan          jsonb   NOT NULL DEFAULT '{}'::jsonb; -- { "<month 1-12>": <days> }

ALTER TABLE public.staff_parameters DROP CONSTRAINT IF EXISTS staff_parameters_vacation_model_check;
ALTER TABLE public.staff_parameters
  ADD CONSTRAINT staff_parameters_vacation_model_check
  CHECK (vacation_model IN ('simple', 'liability'));

-- ---------------------------------------------------------------------------
-- Planned vacation per person and month
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_vacation_plan (
  member_id  integer NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  period     date    NOT NULL, -- first day of the month
  days       numeric NOT NULL CHECK (days >= 0 AND days <= 31),
  PRIMARY KEY (member_id, period)
);

ALTER TABLE public.staff_vacation_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_vacation_plan_all ON public.staff_vacation_plan;
CREATE POLICY staff_vacation_plan_all ON public.staff_vacation_plan
  FOR ALL TO authenticated
  USING (user_can_access_staff_member(member_id))
  WITH CHECK (user_can_access_staff_member(member_id));

-- Same recalculation as periods: both only carry a member_id
DROP TRIGGER IF EXISTS staff_vacation_plan_recalc_ins ON public.staff_vacation_plan;
DROP TRIGGER IF EXISTS staff_vacation_plan_recalc_upd ON public.staff_vacation_plan;
DROP TRIGGER IF EXISTS staff_vacation_plan_recalc_del ON public.staff_vacation_plan;
CREATE TRIGGER staff_vacation_plan_recalc_ins AFTER INSERT ON public.staff_vacation_plan
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.staff_periods_recalc();
CREATE TRIGGER staff_vacation_plan_recalc_upd AFTER UPDATE ON public.staff_vacation_plan
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.staff_periods_recalc();
CREATE TRIGGER staff_vacation_plan_recalc_del AFTER DELETE ON public.staff_vacation_plan
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.staff_periods_recalc_old();

-- ---------------------------------------------------------------------------
-- The calculation — new columns, so drop and recreate
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.staff_cost_rows(integer, integer[]);

CREATE FUNCTION public.staff_cost_rows(
  p_scenario_id integer,
  p_cost_center_ids integer[] DEFAULT NULL
)
RETURNS TABLE (
  member_id               integer,
  cost_center_id          integer,
  year                    integer,
  month                   integer,
  rate                    numeric,  -- effective employment rate that month, %
  share                   numeric,  -- share of the person on this cost center, %
  vacation_days_taken     numeric,  -- the person's planned days that month (whole person, not the share)
  salary                  numeric,
  vacation_supplement     numeric,
  vacation_liability      numeric,  -- change in vacation liability
  vacation_liability_fee  numeric,  -- employer fees on that change
  employer_fee            numeric,
  pension                 numeric,
  payroll_tax             numeric,
  car_benefit             numeric,
  car_benefit_fee         numeric,
  total                   numeric
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH p AS (
    SELECT sp.*, s.start_year, s.start_month, s.end_year, s.end_month,
           (SELECT sum(value::numeric) FROM jsonb_each_text(sp.default_vacation_plan)) AS default_plan_total
    FROM staff_parameters sp
    JOIN scenarios s ON s.id = sp.scenario_id
    WHERE sp.scenario_id = p_scenario_id
  ),
  months AS (
    SELECT gs::date AS period
    FROM p, generate_series(
      make_date(p.start_year, p.start_month, 1),
      make_date(p.end_year, p.end_month, 1),
      interval '1 month'
    ) AS gs
  ),
  mem AS (
    SELECT m.*,
           EXISTS (SELECT 1 FROM staff_vacation_plan vp WHERE vp.member_id = m.id) AS has_plan
    FROM staff_members m
    WHERE m.scenario_id = p_scenario_id AND m.included
  ),
  alloc AS (
    SELECT
      mem.id AS mid,
      COALESCE(a.cost_center_id, mem.home_cost_center_id) AS ccid,
      CASE
        WHEN a.member_id IS NULL THEN 1.0
        WHEN sum(a.share) OVER w > 0 THEN a.share / sum(a.share) OVER w
        ELSE 1.0 / count(*) OVER w
      END AS sh
    FROM mem
    LEFT JOIN staff_allocations a ON a.member_id = mem.id
    WINDOW w AS (PARTITION BY mem.id)
  ),
  monthly AS (
    SELECT
      al.mid, al.ccid, al.sh, mo.period,
      COALESCE(
        (SELECT pr.rate FROM staff_periods pr
          WHERE pr.member_id = mem.id AND mo.period BETWEEN pr.from_period AND pr.to_period
          ORDER BY pr.from_period DESC, pr.id DESC
          LIMIT 1),
        mem.employment_rate
      ) / 100.0 AS r,
      (mem.monthly_salary + mem.supplement)
        * CASE WHEN p.salary_increase_from IS NOT NULL AND mo.period >= p.salary_increase_from
               THEN 1 + p.salary_increase_pct / 100.0 ELSE 1 END AS full_salary,
      mem.vacation_days AS vdays,
      CASE
        WHEN mem.has_plan THEN
          COALESCE((SELECT vp.days FROM staff_vacation_plan vp
                    WHERE vp.member_id = mem.id AND vp.period = mo.period), 0)
        WHEN p.default_plan_total > 0 THEN
          mem.vacation_days
            * COALESCE((p.default_vacation_plan ->> extract(month FROM mo.period)::integer::text)::numeric, 0)
            / p.default_plan_total
        ELSE mem.vacation_days / 12.0
      END AS vtaken,
      mem.car_benefit AS car_year
    FROM mem
    JOIN alloc al ON al.mid = mem.id
    CROSS JOIN months mo
    CROSS JOIN p
    WHERE p_cost_center_ids IS NULL OR al.ccid = ANY (p_cost_center_ids)
  ),
  amounts AS (
    SELECT
      m.*,
      m.full_salary * m.r * m.sh AS base,
      m.full_salary * m.r * m.sh * (1 - p.absence_pct / 100.0) AS sal,
      m.full_salary * m.r * m.sh * p.vacation_supplement_pct / 100.0 * m.vdays / 12.0 AS vac_spread,
      m.full_salary * m.r * m.sh * p.vacation_supplement_pct / 100.0 * m.vtaken AS vac_taken,
      CASE WHEN p.vacation_model = 'liability'
           THEN m.full_salary * m.r * m.sh * p.vacation_liability_pct / 100.0 * (m.vdays / 12.0 - m.vtaken)
           ELSE 0 END AS liab,
      m.car_year / 12.0 * m.sh AS car
    FROM monthly m CROSS JOIN p
  ),
  vac AS (
    SELECT
      a.*,
      CASE
        WHEN p.vacation_model = 'liability' THEN a.vac_taken
        WHEN p.vacation_supplement_month IS NULL THEN a.vac_spread
        WHEN extract(month FROM a.period) = p.vacation_supplement_month
          THEN sum(a.vac_spread) OVER (PARTITION BY a.mid, a.ccid)
        ELSE 0
      END AS vac_amt
    FROM amounts a CROSS JOIN p
  ),
  pens AS (
    SELECT
      v.*,
      -- The person's whole pensionable salary that month (see staff_pension_itp1.sql)
      CASE WHEN v.sh > 0 THEN (v.sal + v.vac_amt) / v.sh ELSE 0 END AS pens_base
    FROM vac v
  ),
  parts AS (
    SELECT
      v.mid, v.ccid, v.period, v.r, v.sh, v.vtaken,
      v.sal, v.vac_amt, v.liab, v.car,
      CASE
        WHEN p.pension_model = 'itp1' THEN
          v.sh * (
            p.itp1_rate_below / 100.0 * least(v.pens_base, p.itp1_breakpoint)
            + p.itp1_rate_above / 100.0 * greatest(v.pens_base - p.itp1_breakpoint, 0)
          )
        ELSE (v.sal + v.vac_amt) * p.pension_pct / 100.0
      END AS pen
    FROM pens v CROSS JOIN p
  ),
  signed AS (
    SELECT
      x.mid, x.ccid, x.period, x.r, x.sh, x.vtaken,
      p.cost_sign * x.sal                                              AS c_sal,
      p.cost_sign * x.vac_amt                                          AS c_vac,
      p.cost_sign * x.liab                                             AS c_liab,
      p.cost_sign * x.liab * p.employer_fee_pct / 100.0                AS c_liabfee,
      p.cost_sign * (x.sal + x.vac_amt) * p.employer_fee_pct / 100.0   AS c_fee,
      p.cost_sign * x.pen                                              AS c_pen,
      p.cost_sign * x.pen * p.payroll_tax_pct / 100.0                  AS c_tax,
      CASE WHEN p.book_car_benefit_value THEN p.cost_sign * x.car ELSE 0 END AS c_car,
      p.cost_sign * x.car * p.employer_fee_pct / 100.0                 AS c_carfee
    FROM parts x CROSS JOIN p
  )
  SELECT
    x.mid, x.ccid,
    extract(year FROM x.period)::integer,
    extract(month FROM x.period)::integer,
    round(x.r * 100, 2), round(x.sh * 100, 2), round(x.vtaken, 2),
    x.c_sal, x.c_vac, x.c_liab, x.c_liabfee, x.c_fee, x.c_pen, x.c_tax, x.c_car, x.c_carfee,
    x.c_sal + x.c_vac + x.c_liab + x.c_liabfee + x.c_fee + x.c_pen + x.c_tax + x.c_car + x.c_carfee
  FROM signed x
$$;

-- ---------------------------------------------------------------------------
-- Locked accounts, writing and clearing — now with the two liability accounts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_locked_account_ids(p_scenario_id integer)
RETURNS TABLE (account_id integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id
  FROM staff_parameters sp
  JOIN scenarios s ON s.id = sp.scenario_id
  JOIN accounts a ON a.company_id = s.company_id
  WHERE sp.scenario_id = p_scenario_id
    AND (
      a.account_number IN (
        sp.account_salary, sp.account_vacation_supplement, sp.account_employer_fee,
        sp.account_pension, sp.account_payroll_tax, sp.account_car_benefit,
        sp.account_car_benefit_fee
      )
      OR (
        sp.vacation_model = 'liability'
        AND a.account_number IN (sp.account_vacation_liability, sp.account_vacation_liability_fee)
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.recalc_staff_budget(
  p_scenario_id integer,
  p_cost_center_ids integer[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_parameters WHERE scenario_id = p_scenario_id) THEN
    RETURN; -- staff budget not in use for this scenario
  END IF;
  SELECT company_id INTO v_company FROM scenarios WHERE id = p_scenario_id;

  DELETE FROM budget_entries be
  WHERE be.scenario_id = p_scenario_id
    AND be.account_id IN (SELECT l.account_id FROM staff_locked_account_ids(p_scenario_id) l)
    AND (p_cost_center_ids IS NULL OR be.cost_center_id = ANY (p_cost_center_ids));

  INSERT INTO budget_entries
    (scenario_id, account_id, cost_center_id, year, month, amount, counterpart_company_id, updated_by, updated_at)
  SELECT p_scenario_id, acc.id, r.cost_center_id, r.year, r.month,
         round(sum(c.amount)), NULL, auth.uid(), now()
  FROM staff_cost_rows(p_scenario_id, p_cost_center_ids) r
  CROSS JOIN staff_parameters sp
  CROSS JOIN LATERAL (VALUES
    (sp.account_salary,              r.salary),
    (sp.account_vacation_supplement, r.vacation_supplement),
    (CASE WHEN sp.vacation_model = 'liability' THEN sp.account_vacation_liability END,     r.vacation_liability),
    (CASE WHEN sp.vacation_model = 'liability' THEN sp.account_vacation_liability_fee END, r.vacation_liability_fee),
    (sp.account_employer_fee,        r.employer_fee),
    (sp.account_pension,             r.pension),
    (sp.account_payroll_tax,         r.payroll_tax),
    (sp.account_car_benefit,         r.car_benefit),
    (sp.account_car_benefit_fee,     r.car_benefit_fee)
  ) AS c(account_number, amount)
  JOIN accounts acc ON acc.company_id = v_company AND acc.account_number = c.account_number
  WHERE sp.scenario_id = p_scenario_id AND c.account_number IS NOT NULL
  GROUP BY acc.id, r.cost_center_id, r.year, r.month
  HAVING round(sum(c.amount)) <> 0;
END $$;

REVOKE EXECUTE ON FUNCTION public.recalc_staff_budget(integer, integer[]) FROM PUBLIC, anon, authenticated;

-- Changing a rule clears the accounts the OLD rules owned before recalculating,
-- so switching model or renumbering an account leaves no stale, locked amounts.
CREATE OR REPLACE FUNCTION public.staff_parameters_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN NULL; -- turning it off keeps the amounts as ordinary, editable entries
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT company_id INTO v_company FROM scenarios WHERE id = OLD.scenario_id;
    DELETE FROM budget_entries be
    USING accounts a
    WHERE be.scenario_id = OLD.scenario_id
      AND a.id = be.account_id
      AND a.company_id = v_company
      AND (
        a.account_number IN (
          OLD.account_salary, OLD.account_vacation_supplement, OLD.account_employer_fee,
          OLD.account_pension, OLD.account_payroll_tax, OLD.account_car_benefit,
          OLD.account_car_benefit_fee
        )
        OR (
          OLD.vacation_model = 'liability'
          AND a.account_number IN (OLD.account_vacation_liability, OLD.account_vacation_liability_fee)
        )
      );
  END IF;
  PERFORM recalc_staff_budget(NEW.scenario_id, NULL);
  RETURN NULL;
END $$;
