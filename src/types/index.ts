export type Role = string

export interface RoleDefinition {
  name: string
  label: string
  scope_type: 'global' | 'company' | 'cost_center' | 'region'
  is_system: boolean
}

export interface Company {
  id: number
  name: string
  org_number: string
  fiscal_year_start: number
  fabric_key: string | null
}

export interface CostCenter {
  id: number
  company_id: number
  code: string
  name: string
  is_active: boolean
  region: string | null
}

export interface Account {
  id: number
  company_id: number
  account_number: string
  name: string
  account_type: 'income' | 'expense' | 'balance'
}

export interface AccountConfig {
  id: number
  account_id: number
  is_budgetable: boolean
  is_calculated: boolean
  is_intercompany?: boolean
  formula: string | null
  display_order: number
  section: string | null
  notes: string | null
}

/**
 * Which cost account belongs to which revenue account in intercompany trade.
 * The accounts carry company_id, so a link implicitly names the company pair.
 */
export interface IntercompanyAccountLink {
  id: number
  revenue_account_id: number
  cost_account_id: number
  note: string | null
  created_by: string | null
  created_at: string
}

export interface Scenario {
  id: number
  company_id: number
  name: string
  start_year: number
  start_month: number
  end_year: number
  end_month: number
  is_approved: boolean
  deadline_date: string | null
  /**
   * Which year each period compares against: { "<year>-<month>": <source year> }.
   * A missing key (or null column) means the period year minus one.
   */
  comparison_periods: Record<string, number> | null
  created_by: string
  created_at: string
}

export interface BudgetEntry {
  id: number
  scenario_id: number
  account_id: number
  cost_center_id: number
  year: number
  month: number
  amount: number
  counterpart_company_id: number | null
  updated_by: string
  updated_at: string
}

/** Calculation rules for the staff budget of one scenario. No row = not in use. */
export interface StaffParameters {
  scenario_id: number
  salary_increase_pct: number
  /** First day of the month the increase applies from. NULL = no increase. */
  salary_increase_from: string | null
  vacation_supplement_pct: number
  /** 1–12. NULL = spread evenly over the months. */
  vacation_supplement_month: number | null
  employer_fee_pct: number
  pension_pct: number
  payroll_tax_pct: number
  absence_pct: number
  cost_sign: 1 | -1
  account_salary: string
  account_vacation_supplement: string | null
  account_employer_fee: string | null
  account_pension: string | null
  account_payroll_tax: string | null
  account_car_benefit: string | null
  account_car_benefit_fee: string | null
  book_car_benefit_value: boolean
  default_salaries: Record<string, number>
  /** Rollout switch: who sees the staff budget besides admins. */
  visibility: 'company_managers' | 'everyone'
  updated_by: string | null
  updated_at: string
}

export type EmploymentType = 'TV' | 'PRO' | 'TID'

export interface StaffPeriod {
  id: number
  member_id: number
  /** First day of the month, e.g. "2027-02-01". */
  from_period: string
  /** First day of the month, inclusive. */
  to_period: string
  rate: number
  reason: string | null
}

export interface StaffAllocation {
  member_id: number
  cost_center_id: number
  share: number
  scenario_id: number
}

export interface StaffMember {
  id: number
  scenario_id: number
  employee_no: string | null
  first_name: string
  last_name: string
  title: string | null
  employment_type: EmploymentType | null
  is_recruitment: boolean
  home_cost_center_id: number
  included: boolean
  employment_rate: number
  monthly_salary: number
  supplement: number
  vacation_days: number
  car_benefit: number
  note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  updated_by: string | null
  updated_at: string
  staff_periods: StaffPeriod[]
  staff_allocations: StaffAllocation[]
}

/** One row of staff_cost_rows(): a person on a cost center in a month. */
export interface StaffCostRow {
  member_id: number
  cost_center_id: number
  year: number
  month: number
  rate: number
  share: number
  salary: number
  vacation_supplement: number
  employer_fee: number
  pension: number
  payroll_tax: number
  car_benefit: number
  car_benefit_fee: number
  total: number
}

export interface ScenarioLock {
  scenario_id: number
  cost_center_id: number
  // NULL once the user who locked it has been deleted — the lock itself stays
  locked_by: string | null
  locked_at: string
}

export interface Actual {
  id: number
  company_id: number
  account_id: number
  cost_center_id: number
  year: number
  month: number
  amount: number
  synced_at: string
}

export interface UserProfile {
  id: number
  entra_oid: string
  email: string
  display_name: string
  roles: UserRole[]
}

export interface UserRole {
  role: Role
  company_id: number | null
  cost_center_id: number | null
  region: string | null
}
