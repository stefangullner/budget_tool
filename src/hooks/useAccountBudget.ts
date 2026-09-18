import { useCallback, useEffect, useState } from 'react'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { comparisonYearFor } from '@/components/ComparisonYearPicker'
import { cellKey, type BulkCell } from '@/lib/bulkDistribute'
import { periodKey, scenarioPeriods } from '@/hooks/useBudget'
import type { Scenario } from '@/types'

type Row = { cost_center_id: number; year: number; month: number; amount: number }

/**
 * The mirror image of `useBudget`: one account across every cost center, instead
 * of one cost center across every account. Keys follow `cellKey` so the same
 * lookup works here as in the mass distribution.
 */
export function useAccountBudget(
  companyId: number | null,
  scenarioId: number | null,
  accountId: number | null,
  scenario: Scenario | null,
) {
  const [entries, setEntries] = useState<Map<string, number>>(new Map())
  const [actuals, setActuals] = useState<Map<string, number>>(new Map())
  const [prevActuals, setPrevActuals] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Bumped after a bulk write so the grid reflects what actually landed. */
  const [reloadToken, setReloadToken] = useState(0)

  const key = useCallback(
    (costCenterId: number, year: number, month: number) =>
      cellKey(costCenterId, year, month, accountId ?? 0),
    [accountId],
  )

  // Budget for this account, every cost center
  useEffect(() => {
    if (!scenarioId || !accountId) {
      setEntries(new Map())
      return
    }
    let cancelled = false
    setLoading(true)

    fetchAllRows<Row>((from, to) =>
      supabase
        .from('budget_entries')
        .select('cost_center_id, year, month, amount')
        .eq('scenario_id', scenarioId)
        .eq('account_id', accountId)
        .is('counterpart_company_id', null)
        .order('cost_center_id')
        .order('year')
        .order('month')
        .range(from, to),
    ).then((rows) => {
      if (cancelled) return
      const map = new Map<string, number>()
      for (const r of rows) map.set(cellKey(r.cost_center_id, r.year, r.month, accountId), r.amount)
      setEntries(map)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [scenarioId, accountId, reloadToken])

  // Actuals inside the scenario window — past months show outcome, not budget
  useEffect(() => {
    if (!companyId || !accountId || !scenario) {
      setActuals(new Map())
      return
    }
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    let cancelled = false

    fetchAllRows<Row>((from, to) =>
      supabase
        .from('actuals')
        .select('cost_center_id, year, month, amount')
        .eq('company_id', companyId)
        .eq('account_id', accountId)
        .gte('year', scenario.start_year)
        .lte('year', scenario.end_year)
        .order('cost_center_id')
        .order('year')
        .order('month')
        .range(from, to),
    ).then((rows) => {
      if (cancelled) return
      const map = new Map<string, number>()
      for (const r of rows) {
        const isPast = r.year < currentYear || (r.year === currentYear && r.month <= currentMonth)
        if (isPast) map.set(cellKey(r.cost_center_id, r.year, r.month, accountId), r.amount)
      }
      setActuals(map)
    })

    return () => { cancelled = true }
  }, [companyId, accountId, scenario])

  // Comparison actuals, mapped from their source period onto the target period
  useEffect(() => {
    if (!companyId || !accountId || !scenario) {
      setPrevActuals(new Map())
      return
    }
    const targetsBySource = new Map<string, { year: number; month: number }[]>()
    for (const { year, month } of scenarioPeriods(scenario)) {
      const sourceKey = periodKey(comparisonYearFor(scenario.comparison_periods, year, month), month)
      const list = targetsBySource.get(sourceKey)
      if (list) list.push({ year, month })
      else targetsBySource.set(sourceKey, [{ year, month }])
    }
    if (targetsBySource.size === 0) {
      setPrevActuals(new Map())
      return
    }
    const sourceYears = [...targetsBySource.keys()].map((k) => Number(k.split('-')[0]))
    let cancelled = false

    fetchAllRows<Row>((from, to) =>
      supabase
        .from('actuals')
        .select('cost_center_id, year, month, amount')
        .eq('company_id', companyId)
        .eq('account_id', accountId)
        .gte('year', Math.min(...sourceYears))
        .lte('year', Math.max(...sourceYears))
        .order('cost_center_id')
        .order('year')
        .order('month')
        .range(from, to),
    ).then((rows) => {
      if (cancelled) return
      const map = new Map<string, number>()
      for (const r of rows) {
        const hits = targetsBySource.get(periodKey(r.year, r.month))
        if (!hits) continue
        for (const t of hits) {
          map.set(cellKey(r.cost_center_id, t.year, t.month, accountId), r.amount)
        }
      }
      setPrevActuals(map)
    })

    return () => { cancelled = true }
  }, [companyId, accountId, scenario])

  async function upsertCell(
    costCenterId: number,
    year: number,
    month: number,
    amount: number,
    userId: string,
  ) {
    if (!scenarioId || !accountId) return
    const k = key(costCenterId, year, month)
    const previous = entries.get(k)

    setSaving((prev) => new Set(prev).add(k))
    setEntries((prev) => new Map(prev).set(k, amount))

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
      setEntries((prev) => {
        const next = new Map(prev)
        if (previous === undefined) next.delete(k)
        else next.set(k, previous)
        return next
      })
      setSaveError(error.message)
    }

    setSaving((prev) => {
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  /** Used by the allocation dialog — writes many cost centers at once. */
  async function writeCells(cells: BulkCell[], userId: string) {
    if (!scenarioId || !accountId || cells.length === 0) return { written: 0, error: null }

    const now = new Date().toISOString()
    const payload = cells.map((c) => ({
      scenario_id: scenarioId,
      account_id: accountId,
      cost_center_id: c.costCenterId,
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
        setSaveError(error.message)
        setReloadToken((t) => t + 1)
        return { written: i, error: error.message }
      }
    }

    setReloadToken((t) => t + 1)
    return { written: payload.length, error: null }
  }

  return {
    entries,
    actuals,
    prevActuals,
    loading,
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
    upsertCell,
    writeCells,
  }
}
