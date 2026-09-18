import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { comparisonYearFor } from '@/components/ComparisonYearPicker'
import type { Scenario, Account, AccountConfig, CostCenter, BudgetEntry, ScenarioLock } from '@/types'

export type AccountRow = Account & { config: AccountConfig | null }

type ActualRow = { account_id: number; year: number; month: number; amount: number }
type EntryRow = ActualRow & { counterpart_company_id: number | null }

export type PeriodKey = `${number}-${number}` // "2026-1"

/** One budget cell in a bulk write. Must be unique on (accountId, year, month) —
 *  a repeated key makes Postgres reject the whole batch with
 *  "ON CONFLICT DO UPDATE command cannot affect row a second time". */
export type BulkCell = { accountId: number; year: number; month: number; amount: number }

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
  const [allAccounts, setAllAccounts] = useState<AccountRow[]>([])
  const [entries, setEntries] = useState<Map<string, number>>(new Map())
  const [icEntries, setIcEntries] = useState<Map<string, number>>(new Map())
  const [actuals, setActuals] = useState<Map<string, number>>(new Map())
  const [prevActuals, setPrevActuals] = useState<Map<string, number>>(new Map())
  // Account ids that have a non-zero actual for the selected scenario + cost center
  const [actualIds, setActualIds] = useState<Set<number>>(new Set())
  const [prevActualIds, setPrevActualIds] = useState<Set<number>>(new Set())
  const [locks, setLocks] = useState<ScenarioLock[]>([])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [icSaving, setIcSaving] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  /** Last write that was rejected. Cells update optimistically, so without this
   *  an RLS denial looks like a successful save until the page reloads. */
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load scenarios for company
  useEffect(() => {
    if (!companyId) return
    setScenarios([])
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
    setCostCenters([])
    supabase
      .from('cost_centers')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
  }, [companyId])

  // Load every account for the company. Budgetable ones are editable; the rest are still
  // needed so accounts that only have actuals can be shown read-only in the matrix.
  useEffect(() => {
    if (!companyId) return
    setAllAccounts([])
    setActualIds(new Set())
    setPrevActualIds(new Set())
    fetchAllRows<AccountRow>((from, to) =>
      supabase
        .from('accounts')
        .select('*, config:account_configs(*)')
        .eq('company_id', companyId)
        .order('account_number')
        .range(from, to),
    ).then(setAllAccounts)
  }, [companyId])

  /** Accounts the user may enter budget for. */
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.config?.is_budgetable === true),
    [allAccounts],
  )

  /**
   * Accounts that are not enabled for budgeting but have a non-zero actual in the
   * scenario window — shown read-only so the matrix reflects the real result.
   */
  const actualOnlyAccounts = useMemo(
    () =>
      allAccounts.filter(
        (a) =>
          a.config?.is_budgetable !== true &&
          (actualIds.has(a.id) || prevActualIds.has(a.id)),
      ),
    [allAccounts, actualIds, prevActualIds],
  )

  const loadEntries = useCallback(async (scenarioId: number, costCenterId: number) => {
    setLoading(true)
    // One KS can hold hundreds of accounts × 12 months — well past the 1000-row cap
    const data = await fetchAllRows<EntryRow>((from, to) =>
      supabase
        .from('budget_entries')
        .select('account_id, year, month, amount, counterpart_company_id')
        .eq('scenario_id', scenarioId)
        .eq('cost_center_id', costCenterId)
        .order('account_id')
        .order('year')
        .order('month')
        .range(from, to),
    )

    const map = new Map<string, number>()
    const icMap = new Map<string, number>()
    for (const row of data) {
      if (row.counterpart_company_id) {
        icMap.set(periodKey(row.year, row.month) + ':' + row.account_id + ':' + row.counterpart_company_id, row.amount)
      } else {
        map.set(periodKey(row.year, row.month) + ':' + row.account_id, row.amount)
      }
    }
    setEntries(map)
    setIcEntries(icMap)
    setLoading(false)
  }, [])

  const loadActuals = useCallback(async (companyId: number, costCenterId: number, scenario: Scenario) => {
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    const data = await fetchAllRows<ActualRow>((from, to) =>
      supabase
        .from('actuals')
        .select('account_id, year, month, amount')
        .eq('company_id', companyId)
        .eq('cost_center_id', costCenterId)
        .gte('year', scenario.start_year)
        .lte('year', scenario.end_year)
        .order('account_id')
        .order('year')
        .order('month')
        .range(from, to),
    )

    const map = new Map<string, number>()
    const ids = new Set<number>()
    for (const row of data) {
      const isPast = row.year < currentYear || (row.year === currentYear && row.month <= currentMonth)
      if (isPast) {
        map.set(periodKey(row.year, row.month) + ':' + row.account_id, row.amount)
        if (row.amount !== 0) ids.add(row.account_id)
      }
    }
    setActuals(map)
    setActualIds(ids)
  }, [])

  const loadPrevActuals = useCallback(async (companyId: number, costCenterId: number, scenario: Scenario) => {
    // Each period may draw its comparison from a different year, so build a
    // source (year, month) → target period(s) index rather than assuming year-1.
    const targetsBySource = new Map<string, PeriodKey[]>()
    for (const { year, month } of scenarioPeriods(scenario)) {
      const sourceYear = comparisonYearFor(scenario.comparison_periods, year, month)
      const sourceKey = periodKey(sourceYear, month)
      const targets = targetsBySource.get(sourceKey)
      if (targets) targets.push(periodKey(year, month))
      else targetsBySource.set(sourceKey, [periodKey(year, month)])
    }
    if (targetsBySource.size === 0) {
      setPrevActuals(new Map())
      setPrevActualIds(new Set())
      return
    }

    const sourceYears = [...targetsBySource.keys()].map((k) => Number(k.split('-')[0]))
    const data = await fetchAllRows<ActualRow>((from, to) =>
      supabase
        .from('actuals')
        .select('account_id, year, month, amount')
        .eq('company_id', companyId)
        .eq('cost_center_id', costCenterId)
        .gte('year', Math.min(...sourceYears))
        .lte('year', Math.max(...sourceYears))
        .order('account_id')
        .order('year')
        .order('month')
        .range(from, to),
    )

    const map = new Map<string, number>()
    const ids = new Set<number>()
    for (const row of data) {
      const targets = targetsBySource.get(periodKey(row.year, row.month))
      if (!targets) continue
      for (const target of targets) {
        map.set(target + ':' + row.account_id, row.amount)
      }
      if (row.amount !== 0) ids.add(row.account_id)
    }
    setPrevActuals(map)
    setPrevActualIds(ids)
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
      if (scenario) {
        loadActuals(companyId, costCenterId, scenario)
        loadPrevActuals(companyId, costCenterId, scenario)
      }
    }
  }, [companyId, costCenterId, scenarioId, scenarios, loadActuals, loadPrevActuals])

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
    const previous = entries.get(key)

    setSaving((prev) => new Set(prev).add(key))
    setEntries((prev) => new Map(prev).set(key, amount))

    const { error } = await supabase.from('budget_entries').upsert(
      {
        scenario_id: scenarioId,
        account_id: accountId,
        cost_center_id: costCenterId,
        year,
        month,
        amount,
        counterpart_company_id: null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id' },
    )

    if (error) {
      // Put the cell back so the screen matches what is actually stored
      setEntries((prev) => {
        const next = new Map(prev)
        if (previous === undefined) next.delete(key)
        else next.set(key, previous)
        return next
      })
      setSaveError(error.message)
    }

    setSaving((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  async function upsertICEntry(
    accountId: number,
    counterpartId: number,
    year: number,
    month: number,
    amount: number,
    userId: string,
  ) {
    if (!scenarioId || !costCenterId) return
    const key = periodKey(year, month) + ':' + accountId + ':' + counterpartId
    const previous = icEntries.get(key)

    setIcSaving((prev) => new Set(prev).add(key))
    setIcEntries((prev) => new Map(prev).set(key, amount))

    const { error } = await supabase.from('budget_entries').upsert(
      {
        scenario_id: scenarioId,
        account_id: accountId,
        cost_center_id: costCenterId,
        year,
        month,
        amount,
        counterpart_company_id: counterpartId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id' },
    )

    if (error) {
      setIcEntries((prev) => {
        const next = new Map(prev)
        if (previous === undefined) next.delete(key)
        else next.set(key, previous)
        return next
      })
      setSaveError(error.message)
    }

    setIcSaving((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  /**
   * Write many cells at once (mass distribution over a whole cost center).
   * Batched, because one KS × 12 months can be several thousand rows.
   *
   * A failed batch may land after earlier ones already committed, so recovery is
   * a reload rather than an optimistic rollback — only the server knows what
   * actually got written.
   */
  async function bulkUpsertEntries(
    cells: BulkCell[],
    userId: string,
  ): Promise<{ written: number; error: string | null }> {
    if (!scenarioId || !costCenterId || cells.length === 0) {
      return { written: 0, error: null }
    }

    setEntries((prev) => {
      const next = new Map(prev)
      for (const c of cells) next.set(periodKey(c.year, c.month) + ':' + c.accountId, c.amount)
      return next
    })

    const now = new Date().toISOString()
    const payload = cells.map((c) => ({
      scenario_id: scenarioId,
      account_id: c.accountId,
      cost_center_id: costCenterId,
      year: c.year,
      month: c.month,
      amount: c.amount,
      counterpart_company_id: null,
      updated_by: userId,
      updated_at: now,
    }))

    const BATCH = 500
    for (let i = 0; i < payload.length; i += BATCH) {
      const { error } = await supabase.from('budget_entries').upsert(payload.slice(i, i + BATCH), {
        onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id',
      })
      if (error) {
        await loadEntries(scenarioId, costCenterId)
        setSaveError(error.message)
        return { written: i, error: error.message }
      }
    }

    return { written: payload.length, error: null }
  }

  async function toggleLock(costCenterId: number, userId: string) {
    if (!scenarioId) return
    const isLocked = locks.some((l) => l.cost_center_id === costCenterId)

    if (isLocked) {
      const { error } = await supabase
        .from('scenario_locks')
        .delete()
        .eq('scenario_id', scenarioId)
        .eq('cost_center_id', costCenterId)
      if (error) { setSaveError(error.message); return }
      setLocks((prev) => prev.filter((l) => l.cost_center_id !== costCenterId))
    } else {
      const { error } = await supabase.from('scenario_locks').insert({
        scenario_id: scenarioId,
        cost_center_id: costCenterId,
        locked_by: userId,
      })
      if (error) { setSaveError(error.message); return }
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

    if (copyFromScenarioId) {
      const sourceEntries = await fetchAllRows<BudgetEntry>((from, to) =>
        supabase
          .from('budget_entries')
          .select('*')
          .eq('scenario_id', copyFromScenarioId)
          .order('cost_center_id')
          .order('account_id')
          .order('year')
          .order('month')
          .range(from, to),
      )

      if (sourceEntries.length > 0) {
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
            counterpart_company_id: e.counterpart_company_id ?? null,
            updated_by: userId,
          }))

        const BATCH = 500
        for (let i = 0; i < toInsert.length; i += BATCH) {
          await supabase.from('budget_entries').insert(toInsert.slice(i, i + BATCH))
        }
      }
    }

    return newScenario
  }

  return {
    scenarios,
    costCenters,
    accounts,
    actualOnlyAccounts,
    entries,
    icEntries,
    actuals,
    prevActuals,
    locks,
    saving,
    icSaving,
    loading,
    saveError,
    clearSaveError: () => setSaveError(null),
    upsertEntry,
    upsertICEntry,
    bulkUpsertEntries,
    toggleLock,
    createScenario,
  }
}
