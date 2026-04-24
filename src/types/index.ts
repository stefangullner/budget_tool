export type Role = 'admin' | 'company_manager' | 'cost_center_manager'

export interface Company {
  id: number
  name: string
  org_number: string
  fiscal_year_start: number
}

export interface CostCenter {
  id: number
  company_id: number
  code: string
  name: string
  is_active: boolean
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
  formula: string | null
  display_order: number
  section: string | null
  notes: string | null
}

export interface Scenario {
  id: number
  company_id: number
  name: string
  year: number
  is_approved: boolean
  created_by: string
  created_at: string
}

export interface BudgetEntry {
  id: number
  scenario_id: number
  account_id: number
  cost_center_id: number
  month: number
  amount: number
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
}
