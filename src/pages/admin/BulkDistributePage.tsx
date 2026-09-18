import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import BulkDistributePanel from '@/components/BulkDistributePanel'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { scenarioPeriods, periodKey, type AccountRow } from '@/hooks/useBudget'
import { useSectionOrder, sortSections } from '@/hooks/useSectionOrder'
import { comparisonYearFor } from '@/components/ComparisonYearPicker'
import { applyBulkPlan, cellKey, type BulkGroup, type BulkTarget } from '@/lib/bulkDistribute'
import { cn } from '@/lib/utils'
import type { Company, CostCenter, Scenario } from '@/types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

type EntryRow = { account_id: number; cost_center_id: number; year: number; month: number; amount: number }

export default function BulkDistributePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState<number | null>(null)
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [allAccounts, setAllAccounts] = useState<AccountRow[]>([])
  const [lockedIds, setLockedIds] = useState<Set<number>>(new Set())
  const [entries, setEntries] = useState<Map<string, number>>(new Map())
  const [prevActuals, setPrevActuals] = useState<Map<string, number>>(new Map())
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [userId, setUserId] = useState('')
  /** Bumped after a run so the "already budgeted" numbers reflect what was written. */
  const [reloadToken, setReloadToken] = useState(0)

  const sectionOrderMap = useSectionOrder()

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      const rows = (data ?? []) as Company[]
      setCompanies(rows)
      setCompanyId((prev) => prev ?? rows[0]?.id ?? null)
    })
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  // Reference data for the selected company
  useEffect(() => {
    setScenarios([])
    setCostCenters([])
    setAllAccounts([])
    setScenarioId(null)
    setSelectedIds(new Set())
    if (!companyId) return

    supabase
      .from('scenarios')
      .select('*')
      .eq('company_id', companyId)
      .order('start_year', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as Scenario[]
        setScenarios(rows)
        setScenarioId(rows[0]?.id ?? null)
      })

    supabase
      .from('cost_centers')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))

    fetchAllRows<AccountRow>((from, to) =>
      supabase
        .from('accounts')
        .select('*, config:account_configs(*)')
        .eq('company_id', companyId)
        .order('account_number')
        .range(from, to),
    ).then(setAllAccounts)
  }, [companyId])

  // Locks belong to the scenario, not the selection
  useEffect(() => {
    setLockedIds(new Set())
    if (!scenarioId) return
    supabase
      .from('scenario_locks')
      .select('cost_center_id')
      .eq('scenario_id', scenarioId)
      .then(({ data }) => {
        setLockedIds(new Set((data ?? []).map((r) => r.cost_center_id as number)))
      })
  }, [scenarioId, reloadToken])

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null

  const periods = useMemo(() => (scenario ? scenarioPeriods(scenario) : []), [scenario])

  const futurePeriods = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    return periods.filter((p) => !(p.year < y || (p.year === y && p.month < m)))
  }, [periods])

  const comparisonLabel = useMemo(() => {
    if (!scenario || periods.length === 0) return '—'
    const years = [
      ...new Set(periods.map((p) => comparisonYearFor(scenario.comparison_periods, p.year, p.month))),
    ].sort()
    return years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`
  }, [scenario, periods])

  /**
   * The accounts a run can touch. Intercompany accounts are left out — their
   * amounts live on counterpart sub-rows, not on the account itself, so a plain
   * value here would become an invisible duplicate.
   */
  const budgetableAccounts = useMemo(
    () =>
      allAccounts.filter(
        (a) => a.config?.is_budgetable === true && a.config?.is_intercompany !== true,
      ),
    [allAccounts],
  )

  // Narrows both queries below — most accounts in a company are not budgetable,
  // and selecting every cost center otherwise pulls the whole ledger client-side
  const accountIdKey = useMemo(
    () => budgetableAccounts.map((a) => a.id).join(','),
    [budgetableAccounts],
  )

  /** Locked cost centers are never written to, so they are not targets. */
  const targets: BulkTarget[] = useMemo(
    () =>
      costCenters
        .filter((c) => selectedIds.has(c.id) && !lockedIds.has(c.id))
        .map((c) => ({ id: c.id, code: c.code, name: c.name })),
    [costCenters, selectedIds, lockedIds],
  )

  // A stable dependency — the array identity changes on every render
  const targetKey = targets.map((t) => t.id).join(',')

  // Current budget across the selected cost centers
  useEffect(() => {
    if (!scenarioId || targetKey === '' || accountIdKey === '') {
      setEntries(new Map())
      setLoadingEntries(false)
      return
    }
    const ids = targetKey.split(',').map(Number)
    const accountIds = accountIdKey.split(',').map(Number)
    let cancelled = false
    setLoadingEntries(true)

    fetchAllRows<EntryRow>((from, to) =>
      supabase
        .from('budget_entries')
        .select('account_id, cost_center_id, year, month, amount')
        .eq('scenario_id', scenarioId)
        .in('cost_center_id', ids)
        .in('account_id', accountIds)
        .is('counterpart_company_id', null)
        .order('cost_center_id')
        .order('account_id')
        .order('year')
        .order('month')
        .range(from, to),
    ).then((rows) => {
      if (cancelled) return
      const map = new Map<string, number>()
      for (const r of rows) {
        map.set(cellKey(r.cost_center_id, r.year, r.month, r.account_id), r.amount)
      }
      setEntries(map)
      setLoadingEntries(false)
    })

    return () => { cancelled = true }
  }, [scenarioId, targetKey, accountIdKey, reloadToken])

  // Comparison actuals, mapped from their source period onto the target period
  useEffect(() => {
    if (!scenario || !companyId || targetKey === '' || accountIdKey === '' || futurePeriods.length === 0) {
      setPrevActuals(new Map())
      setLoadingPrev(false)
      return
    }
    const ids = targetKey.split(',').map(Number)
    const accountIds = accountIdKey.split(',').map(Number)
    setLoadingPrev(true)

    // Each month may draw its comparison from a different year (comparison_periods)
    const targetsBySource = new Map<string, { year: number; month: number }[]>()
    for (const { year, month } of futurePeriods) {
      const sourceKey = periodKey(comparisonYearFor(scenario.comparison_periods, year, month), month)
      const list = targetsBySource.get(sourceKey)
      if (list) list.push({ year, month })
      else targetsBySource.set(sourceKey, [{ year, month }])
    }
    const sourceYears = [...targetsBySource.keys()].map((k) => Number(k.split('-')[0]))

    let cancelled = false
    fetchAllRows<EntryRow>((from, to) =>
      supabase
        .from('actuals')
        .select('account_id, cost_center_id, year, month, amount')
        .eq('company_id', companyId)
        .in('cost_center_id', ids)
        .in('account_id', accountIds)
        .gte('year', Math.min(...sourceYears))
        .lte('year', Math.max(...sourceYears))
        .order('cost_center_id')
        .order('account_id')
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
          map.set(cellKey(r.cost_center_id, t.year, t.month, r.account_id), r.amount)
        }
      }
      setPrevActuals(map)
      setLoadingPrev(false)
    })

    return () => { cancelled = true }
  }, [scenario, companyId, targetKey, accountIdKey, futurePeriods, reloadToken])

  /** The same accounts, grouped by section for the section filter. */
  const groups: BulkGroup[] = useMemo(() => {
    const bySection = new Map<string, AccountRow[]>()
    for (const account of budgetableAccounts) {
      const section = account.config?.section ?? '— Ingen sektion'
      const list = bySection.get(section)
      if (list) list.push(account)
      else bySection.set(section, [account])
    }
    const named = sortSections(
      [...bySection.keys()].filter((s) => s !== '— Ingen sektion'),
      sectionOrderMap,
    )
    if (bySection.has('— Ingen sektion')) named.push('— Ingen sektion')
    return named.map((section) => ({ section, accounts: bySection.get(section) ?? [] }))
  }, [budgetableAccounts, sectionOrderMap])

  function toggleCostCenter(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableIds = costCenters.filter((c) => !lockedIds.has(c.id)).map((c) => c.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  const selectedLocked = costCenters.filter((c) => selectedIds.has(c.id) && lockedIds.has(c.id))

  const blockedReason =
    futurePeriods.length === 0 && scenario
      ? 'Scenariot har inga framtida månader kvar att fylla.'
      : null

  function scenarioPeriod(s: Scenario) {
    return `${MONTHS[s.start_month - 1]} ${s.start_year} – ${MONTHS[s.end_month - 1]} ${s.end_year}`
  }

  const loadingData = loadingEntries || loadingPrev

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Massfördelning</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Fyller ett eller flera kostnadsställen med budget utifrån utfallet — som startpunkt inför
            detaljarbetet i budgetvyn
          </p>
        </div>
        <HelpButton section="admin-bulk" />
      </div>

      <div className="flex items-start gap-2 p-3 mb-6 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          Skriver direkt i budgeten för de valda kostnadsställena och går inte att ångra. Kör den
          helst innan budgetarbetet startat, eller med <em>Lämna orörda</em> så att inmatat arbete
          bevaras.
        </span>
      </div>

      {/* Target */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-5">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Bolag</label>
          <select
            value={companyId ?? ''}
            onChange={(e) => setCompanyId(Number(e.target.value))}
            className={SELECT_CLASS}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Scenario</label>
          <select
            value={scenarioId ?? ''}
            onChange={(e) => setScenarioId(Number(e.target.value))}
            disabled={scenarios.length === 0}
            className={SELECT_CLASS}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({scenarioPeriod(s)})</option>
            ))}
            {scenarios.length === 0 && <option value="">Inga scenarier för bolaget</option>}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-gray-500">
              Kostnadsställen
              {selectedIds.size > 0 && (
                <span className="text-gray-400 font-normal"> — {targets.length} valda</span>
              )}
            </label>
            <button
              onClick={() =>
                setSelectedIds(allSelected ? new Set() : new Set(selectableIds))
              }
              disabled={selectableIds.length === 0}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium disabled:text-gray-300"
            >
              {allSelected ? 'Avmarkera alla' : 'Markera alla'}
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {costCenters.map((c) => {
              const locked = lockedIds.has(c.id)
              return (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2',
                    locked ? 'cursor-not-allowed bg-gray-50' : 'cursor-pointer hover:bg-gray-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    disabled={locked}
                    onChange={() => toggleCostCenter(c.id)}
                    className="accent-brand-600"
                  />
                  <span className="font-mono text-xs text-gray-400">{c.code}</span>
                  <span className={cn('text-xs flex-1', locked ? 'text-gray-400' : 'text-gray-800')}>
                    {c.name}
                  </span>
                  {c.region && <span className="text-xs text-gray-400">{c.region}</span>}
                  {locked && (
                    <span
                      title="Låst i det här scenariot — lås upp i budgetvyn"
                      className="flex items-center gap-1 text-xs text-amber-600"
                    >
                      <Lock size={11} />
                      Låst
                    </span>
                  )}
                </label>
              )
            })}
            {costCenters.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-500">Inga kostnadsställen för bolaget.</p>
            )}
          </div>
          {selectedLocked.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-700">
              {selectedLocked.length} låsta kostnadsställen ingår inte i körningen.
            </p>
          )}
        </div>
      </div>

      {!scenario || targets.length === 0 || loadingData ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400">
          {loadingData
            ? 'Läser in budget och utfall…'
            : 'Välj bolag, scenario och minst ett kostnadsställe.'}
        </div>
      ) : (
        <BulkDistributePanel
          groups={groups}
          targets={targets}
          futurePeriods={futurePeriods}
          entries={entries}
          prevActuals={prevActuals}
          comparisonLabel={comparisonLabel}
          blockedReason={blockedReason}
          onApply={async (cells) => {
            const result = await applyBulkPlan(scenario.id, cells, userId)
            setReloadToken((t) => t + 1)
            return result
          }}
        />
      )}
    </div>
  )
}
