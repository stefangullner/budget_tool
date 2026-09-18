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

export interface ScenarioLock {
  scenario_id: number
  cost_center_id: number
  locked_by: string
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
