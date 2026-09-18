import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import BulkDistributePanel, { type BulkGroup } from '@/components/BulkDistributePanel'
import { supabase } from '@/lib/supabase'
import { useBudget, scenarioPeriods } from '@/hooks/useBudget'
import { useSectionOrder, sortSections } from '@/hooks/useSectionOrder'
import { comparisonYearFor } from '@/components/ComparisonYearPicker'
import type { Company } from '@/types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

export default function BulkDistributePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [scenarioId, setScenarioId] = useState<number | null>(null)
  const [costCenterId, setCostCenterId] = useState<number | null>(null)
  const [userId, setUserId] = useState('')

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

  const {
    scenarios,
    costCenters,
    accounts,
    entries,
    prevActuals,
    locks,
    loading,
    bulkUpsertEntries,
  } = useBudget(companyId, scenarioId, costCenterId)

  // Changing company invalidates both of the narrower choices
  useEffect(() => {
    setScenarioId(null)
    setCostCenterId(null)
  }, [companyId])

  useEffect(() => {
    if (scenarios.length > 0 && !scenarioId) setScenarioId(scenarios[0].id)
  }, [scenarios, scenarioId])

  useEffect(() => {
    if (costCenters.length > 0 && !costCenterId) setCostCenterId(costCenters[0].id)
  }, [costCenters, costCenterId])

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null
  const costCenter = costCenters.find((c) => c.id === costCenterId) ?? null

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const periods = useMemo(() => (scenario ? scenarioPeriods(scenario) : []), [scenario])

  const futurePeriods = useMemo(
    () =>
      periods.filter(
        (p) => !(p.year < currentYear || (p.year === currentYear && p.month < currentMonth)),
      ),
    [periods, currentYear, currentMonth],
  )

  const comparisonLabel = useMemo(() => {
    if (!scenario || periods.length === 0) return '—'
    const years = [
      ...new Set(periods.map((p) => comparisonYearFor(scenario.comparison_periods, p.year, p.month))),
    ].sort()
    return years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`
  }, [scenario, periods])

  /**
   * Budgetable accounts grouped by section. Intercompany accounts are left out —
   * their amounts live on counterpart sub-rows, not on the account itself, so a
   * plain value here would become an invisible duplicate.
   */
  const groups: BulkGroup[] = useMemo(() => {
    const bySection = new Map<string, typeof accounts>()
    for (const account of accounts) {
      if (account.config?.is_intercompany === true) continue
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
  }, [accounts, sectionOrderMap])

  const isLocked = costCenterId !== null && locks.some((l) => l.cost_center_id === costCenterId)

  const blockedReason = isLocked
    ? 'Kostnadsstället är låst i det här scenariot. Lås upp det i budgetvyn innan du fördelar.'
    : futurePeriods.length === 0
      ? 'Scenariot har inga framtida månader kvar att fylla.'
      : null

  function scenarioPeriod(s: typeof scenarios[0]) {
    return `${MONTHS[s.start_month - 1]} ${s.start_year} – ${MONTHS[s.end_month - 1]} ${s.end_year}`
  }

  const ready = scenario && costCenter && !loading

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Massfördelning</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Fyller ett helt kostnadsställe med budget utifrån utfallet — som startpunkt inför
            detaljarbetet i budgetvyn
          </p>
        </div>
        <HelpButton section="admin-bulk" />
      </div>

      <div className="flex items-start gap-2 p-3 mb-6 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          Skriver direkt i budgeten för det valda kostnadsstället och går inte att ångra. Kör den
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
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Kostnadsställe</label>
          <select
            value={costCenterId ?? ''}
            onChange={(e) => setCostCenterId(Number(e.target.value))}
            disabled={costCenters.length === 0}
            className={SELECT_CLASS}
          >
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}{c.region ? ` (${c.region})` : ''}
              </option>
            ))}
            {costCenters.length === 0 && <option value="">Inga kostnadsställen för bolaget</option>}
          </select>
        </div>
      </div>

      {!ready ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400">
          {loading ? 'Läser in kostnadsstället…' : 'Välj bolag, scenario och kostnadsställe.'}
        </div>
      ) : (
        <BulkDistributePanel
          key={`${scenarioId}-${costCenterId}`}
          groups={groups}
          futurePeriods={futurePeriods}
          entries={entries}
          prevActuals={prevActuals}
          comparisonLabel={comparisonLabel}
          blockedReason={blockedReason}
          onApply={(cells) => bulkUpsertEntries(cells, userId)}
        />
      )}
    </div>
  )
}
