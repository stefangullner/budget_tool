import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Scenario, Account, AccountConfig, CostCenter, BudgetEntry, ScenarioLock } from '@/types'

export type AccountRow = Account & { config: AccountConfig | null }

export type PeriodKey = `${number}-${number}` // "2026-1"

export function periodKey(year: number, month: number): PeriodKey {
  return `${year}-${month}`
}

export function scenarioPeriods(s: Scenario): { year: number; month: number }[] {
  const periods: { year: number; month: number }[] = []
  let y = s.start_year
  let m = s.start_month
  while (y < s.end_year || (y === s.end_year && m <= s.end_month)) {
    periods.push({ year: y, month: m })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return periods
}

export function useBudget(companyId: number | null, scenarioId: number | null, costCenterId: number | null) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [entries, setEntries] = useState<Map<string, number>>(new Map())
  const [actuals, setActuals] = useState<Map<string, number>>(new Map())
  const [locks, setLocks] = useState<ScenarioLock[]>([])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  // Load scenarios for company
  useEffect(() => {
    if (!companyId) return
    supabase
      .from('scenarios')
      .select('*')
      .eq('company_id', companyId)
      .order('start_year', { ascending: false })
      .then(({ data }) => setScenarios((data ?? []) as Scenario[]))
  }, [companyId])

  // Load cost centers for company
  useEffect(() => {
    if (!companyId) return
    supabase
      .from('cost_centers')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
  }, [companyId])

  // Load accounts (budgetable only) for company
  useEffect(() => {
    if (!companyId) return
    supabase
      .from('accounts')
      .select('*, config:account_configs(*)')
      .eq('company_id', companyId)
      .order('account_number')
      .then(({ data }) => {
        const rows = ((data ?? []) as AccountRow[]).filter((a) => a.config?.is_budgetable)
        setAccounts(rows)
      })
  }, [companyId])

  const loadEntries = useCallback(async (scenarioId: number, costCenterId: number) => {
    setLoading(true)
    const { data } = await supabase
      .from('budget_entries')
      .select('account_id, year, month, amount')
      .eq('scenario_id', scenarioId)
      .eq('cost_center_id', costCenterId)

    const map = new Map<string, number>()
    for (const row of data ?? []) {
      map.set(periodKey(row.year, row.month) + ':' + row.account_id, row.amount)
    }
    setEntries(map)
    setLoading(false)
  }, [])

  const loadActuals = useCallback(async (companyId: number, costCenterId: number, scenario: Scenario) => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    const { data } = await supabase
      .from('actuals')
      .select('account_id, year, month, amount')
      .eq('company_id', companyId)
      .eq('cost_center_id', costCenterId)
      .gte('year', scenario.start_year)
      .lte('year', scenario.end_year)

    const map = new Map<string, number>()
    for (const row of data ?? []) {
      // Only include periods that are in the past (have actual data)
      const isPast = row.year < currentYear || (row.year === currentYear && row.month <= currentMonth)
      if (isPast) {
        map.set(periodKey(row.year, row.month) + ':' + row.account_id, row.amount)
      }
    }
    setActuals(map)
  }, [])

  const loadLocks = useCallback(async (scenarioId: number) => {
    const { data } = await supabase
      .from('scenario_locks')
      .select('*')
      .eq('scenario_id', scenarioId)
    setLocks((data ?? []) as ScenarioLock[])
  }, [])

  useEffect(() => {
    if (scenarioId && costCenterId) {
      loadEntries(scenarioId, costCenterId)
    }
  }, [scenarioId, costCenterId, loadEntries])

  useEffect(() => {
    if (companyId && costCenterId && scenarioId) {
      const scenario = scenarios.find((s) => s.id === scenarioId)
      if (scenario) loadActuals(companyId, costCenterId, scenario)
    }
  }, [companyId, costCenterId, scenarioId, scenarios, loadActuals])

  useEffect(() => {
    if (scenarioId) loadLocks(scenarioId)
  }, [scenarioId, loadLocks])

  async function upsertEntry(
    accountId: number,
    year: number,
    month: number,
    amount: number,
    userId: string,
  ) {
    if (!scenarioId || !costCenterId) return
    const key = periodKey(year, month) + ':' + accountId

    setSaving((prev) => new Set(prev).add(key))
    setEntries((prev) => new Map(prev).set(key, amount))

    await supabase.from('budget_entries').upsert(
      {
        scenario_id: scenarioId,
        account_id: accountId,
        cost_center_id: costCenterId,
        year,
        month,
        amount,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scenario_id,account_id,cost_center_id,year,month' },
    )

    setSaving((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  async function toggleLock(costCenterId: number, userId: string) {
    if (!scenarioId) return
    const isLocked = locks.some((l) => l.cost_center_id === costCenterId)

    if (isLocked) {
      await supabase
        .from('scenario_locks')
        .delete()
        .eq('scenario_id', scenarioId)
        .eq('cost_center_id', costCenterId)
      setLocks((prev) => prev.filter((l) => l.cost_center_id !== costCenterId))
    } else {
      await supabase.from('scenario_locks').insert({
        scenario_id: scenarioId,
        cost_center_id: costCenterId,
        locked_by: userId,
      })
      setLocks((prev) => [
        ...prev,
        { scenario_id: scenarioId, cost_center_id: costCenterId, locked_by: userId, locked_at: new Date().toISOString() },
      ])
    }
  }

  async function createScenario(
    companyId: number,
    name: string,
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
    userId: string,
    copyFromScenarioId?: number,
  ): Promise<Scenario | null> {
    const { data, error } = await supabase
      .from('scenarios')
      .insert({
        company_id: companyId,
        name,
        start_year: startYear,
        start_month: startMonth,
        end_year: endYear,
        end_month: endMonth,
        is_approved: false,
        created_by: userId,
      })
      .select()
      .single()

    if (error || !data) return null
    const newScenario = data as Scenario
    setScenarios((prev) => [newScenario, ...prev])

    // Copy entries from source scenario if specified
    if (copyFromScenarioId) {
      const { data: sourceEntries } = await supabase
        .from('budget_entries')
        .select('*')
        .eq('scenario_id', copyFromScenarioId)

      if (sourceEntries && sourceEntries.length > 0) {
        const periods = scenarioPeriods(newScenario)
        const periodSet = new Set(periods.map((p) => periodKey(p.year, p.month)))

        const toInsert = sourceEntries
          .filter((e: BudgetEntry) => periodSet.has(periodKey(e.year, e.month)))
          .map((e: BudgetEntry) => ({
            scenario_id: newScenario.id,
            account_id: e.account_id,
            cost_center_id: e.cost_center_id,
            year: e.year,
            month: e.month,
            amount: e.amount,
            updated_by: userId,
          }))

        if (toInsert.length > 0) {
          await supabase.from('budget_entries').insert(toInsert)
        }
      }
    }

    return newScenario
  }

  return {
    scenarios,
    costCenters,
    accounts,
    entries,
    actuals,
    locks,
    saving,
    loading,
    upsertEntry,
    toggleLock,
    createScenario,
  }
}
