-- Pension according to ITP1: one rate on the monthly salary up to the breakpoint,
-- another on the part above. Runs after add_staff_budget.sql.
--
-- The breakpoint is 7.5 income base amounts per year, stored here per month
-- (7.5 × IBB / 12) because ITP1 premiums are paid on each month's salary.
--
-- The breakpoint applies to the PERSON'S whole pensionable salary, not to each
-- cost center's share of it: a regional manager split over 12 cost centers
-- would otherwise never reach it. The premium is calculated per person and month
-- and then split by share like every other cost.
--
-- Pensionable salary = salary + vacation supplement that month, the same base
-- the flat rate uses. When the vacation supplement is booked in one month, that
-- month's pensionable salary is higher — as it is in ITP1, which is paid on
-- what is actually paid out.
--
-- Changing a rule recalculates the scenario through staff_parameters_recalc.
-- Scenarios already active keep the flat rate until the model is switched.
--
-- DDL only.

ALTER TABLE public.staff_parameters
  ADD COLUMN IF NOT EXISTS pension_model    text    NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS itp1_breakpoint  numeric,                    -- kr per month
  ADD COLUMN IF NOT EXISTS itp1_rate_below  numeric NOT NULL DEFAULT 4.5,
  ADD COLUMN IF NOT EXISTS itp1_rate_above  numeric NOT NULL DEFAULT 30;

ALTER TABLE public.staff_parameters DROP CONSTRAINT IF EXISTS staff_parameters_pension_model_check;
ALTER TABLE public.staff_parameters
  ADD CONSTRAINT staff_parameters_pension_model_check
  CHECK (pension_model IN ('flat', 'itp1'));

ALTER TABLE public.staff_parameters DROP CONSTRAINT IF EXISTS staff_parameters_itp1_breakpoint_check;
ALTER TABLE public.staff_parameters
  ADD CONSTRAINT staff_parameters_itp1_breakpoint_check
  CHECK (pension_model <> 'itp1' OR itp1_breakpoint > 0);

CREATE OR REPLACE FUNCTION public.staff_cost_rows(
  p_scenario_id integer,
  p_cost_center_ids integer[] DEFAULT NULL
)
RETURNS TABLE (
  member_id            integer,
  cost_center_id       integer,
  year                 integer,
  month                integer,
  rate                 numeric,  -- effective employment rate that month, %
  share                numeric,  -- share of the person on this cost center, %
  salary               numeric,
  vacation_supplement  numeric,
  employer_fee         numeric,
  pension              numeric,
  payroll_tax          numeric,
  car_benefit          numeric,
  car_benefit_fee      numeric,
  total                numeric
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH p AS (
    SELECT sp.*, s.start_year, s.start_month, s.end_year, s.end_month
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
    SELECT m.* FROM staff_members m
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
      m.full_salary * m.r * m.sh * (1 - p.absence_pct / 100.0) AS sal,
      m.full_salary * m.r * m.sh * p.vacation_supplement_pct / 100.0 * m.vdays / 12.0 AS vac_spread,
      m.car_year / 12.0 * m.sh AS car
    FROM monthly m CROSS JOIN p
  ),
  vac AS (
    SELECT
      a.*,
      CASE
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
      -- The person's whole pensionable salary that month. Every cost-center row
      -- is its share of it, so dividing by the share gives the same figure on
      -- each of them.
      CASE WHEN v.sh > 0 THEN (v.sal + v.vac_amt) / v.sh ELSE 0 END AS pens_base
    FROM vac v
  ),
  parts AS (
    SELECT
      v.mid, v.ccid, v.period, v.r, v.sh,
      v.sal, v.vac_amt, v.car,
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
      x.mid, x.ccid, x.period, x.r, x.sh,
      p.cost_sign * x.sal                                              AS c_sal,
      p.cost_sign * x.vac_amt                                          AS c_vac,
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
    round(x.r * 100, 2), round(x.sh * 100, 2),
    x.c_sal, x.c_vac, x.c_fee, x.c_pen, x.c_tax, x.c_car, x.c_carfee,
    x.c_sal + x.c_vac + x.c_fee + x.c_pen + x.c_tax + x.c_car + x.c_carfee
  FROM signed x
$$;
