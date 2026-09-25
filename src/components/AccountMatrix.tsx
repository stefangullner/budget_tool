import { Fragment, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, ChevronRight, Columns3, Loader2, Lock, Minimize2, Scale, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DENSITY, type Density } from '@/lib/density'
import { scenarioPeriods, type AccountRow } from '@/hooks/useBudget'
import { cellKey, type BulkCell } from '@/lib/bulkDistribute'
import { comparisonYearFor } from '@/components/ComparisonYearPicker'
import AllocateTotalDialog, { type AllocationTarget } from '@/components/AllocateTotalDialog'
import type { Scenario, ScenarioLock, CostCenter } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

const NO_REGION = '— Ingen region'

interface Props {
  scenario: Scenario
  account: AccountRow
  costCenters: CostCenter[]
  locks: ScenarioLock[]
  entries: Map<string, number>
  actuals: Map<string, number>
  prevActuals: Map<string, number>
  saving: Set<string>
  /** False when the user's role may view but not edit the account's section. */
  canEdit: boolean
  onCellChange: (costCenterId: number, year: number, month: number, amount: number) => void
  onAllocate: (cells: BulkCell[]) => Promise<{ written: number; error: string | null }>
  saveError?: string | null
  onDismissSaveError?: () => void
}

/** RLS denials come back as raw Postgres text — say what it means instead. */
function describeSaveError(message: string) {
  if (/staff_locked_account/i.test(message)) {
    return 'Kontot räknas fram av personalbudgeten och kan inte ändras här.'
  }
  if (/row-level security|permission denied/i.test(message)) {
    return 'Du saknar behörighet att spara på det här kostnadsstället. Kontakta en administratör.'
  }
  if (/violates foreign key/i.test(message)) {
    return 'Kontot eller kostnadsstället finns inte längre. Ladda om sidan.'
  }
  return message
}

function fmt(n: number) {
  if (n === 0) return ''
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function parseSEK(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export default function AccountMatrix({
  scenario,
  account,
  costCenters,
  locks,
  entries,
  actuals,
  prevActuals,
  saving,
  canEdit,
  onCellChange,
  onAllocate,
  saveError,
  onDismissSaveError,
}: Props) {
  const [showActuals, setShowActuals] = useState(true)
  const [compact, setCompact] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [allocating, setAllocating] = useState(false)

  const d: Density = compact ? DENSITY.compact : DENSITY.normal
  const periods = useMemo(() => scenarioPeriods(scenario), [scenario])

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  function isPastPeriod(year: number, month: number) {
    return year < currentYear || (year === currentYear && month < currentMonth)
  }

  const futurePeriods = periods.filter((p) => !isPastPeriod(p.year, p.month))
  const lockedIds = useMemo(() => new Set(locks.map((l) => l.cost_center_id)), [locks])

  function key(costCenterId: number, year: number, month: number) {
    return cellKey(costCenterId, year, month, account.id)
  }

  /** Past months show what happened; future months show what is budgeted. */
  function getValue(costCenterId: number, year: number, month: number): number {
    const k = key(costCenterId, year, month)
    if (isPastPeriod(year, month)) return actuals.get(k) ?? 0
    return entries.get(k) ?? 0
  }

  function getPrev(costCenterId: number, year: number, month: number): number {
    return prevActuals.get(key(costCenterId, year, month)) ?? 0
  }

  function rowTotal(costCenterId: number) {
    return periods.reduce((s, p) => s + getValue(costCenterId, p.year, p.month), 0)
  }

  function prevRowTotal(costCenterId: number) {
    return periods.reduce((s, p) => s + getPrev(costCenterId, p.year, p.month), 0)
  }

  /** A cost center is worth a row when it holds anything at all for this account. */
  function hasData(costCenterId: number) {
    return periods.some(
      (p) => getValue(costCenterId, p.year, p.month) !== 0 || getPrev(costCenterId, p.year, p.month) !== 0,
    )
  }

  const visible = useMemo(
    () => (showAll ? costCenters : costCenters.filter((c) => hasData(c.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [costCenters, showAll, entries, actuals, prevActuals],
  )

  const groups = useMemo(() => {
    const byRegion = new Map<string, CostCenter[]>()
    for (const c of visible) {
      const region = c.region ?? NO_REGION
      const list = byRegion.get(region)
      if (list) list.push(c)
      else byRegion.set(region, [c])
    }
    const named = [...byRegion.keys()].filter((r) => r !== NO_REGION).sort((a, b) => a.localeCompare(b, 'sv'))
    if (byRegion.has(NO_REGION)) named.push(NO_REGION)
    return named.map((region) => ({ region, rows: byRegion.get(region) ?? [] }))
  }, [visible])

  function toggleRegion(region: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  function sourceYear(year: number, month: number) {
    return comparisonYearFor(scenario.comparison_periods, year, month)
  }

  const sourceYears = [...new Set(periods.map((p) => sourceYear(p.year, p.month)))].sort()
  const comparisonLabel =
    sourceYears.length === 1
      ? String(sourceYears[0])
      : `${sourceYears[0]}–${sourceYears[sourceYears.length - 1]}`

  const colsPerPeriod = showActuals ? 2 : 1
  const totalCols = 1 + periods.length * colsPerPeriod + colsPerPeriod

  function isEditable(costCenterId: number, year: number, month: number) {
    return canEdit && !lockedIds.has(costCenterId) && !isPastPeriod(year, month)
  }

  /** Only unlocked cost centers may take an allocation. */
  const allocationTargets: AllocationTarget[] = useMemo(
    () =>
      visible
        .filter((c) => !lockedIds.has(c.id))
        .map((c) => ({ id: c.id, code: c.code, name: c.name })),
    [visible, lockedIds],
  )

  const grandTotal = visible.reduce((s, c) => s + rowTotal(c.id), 0)
  const grandPrevTotal = visible.reduce((s, c) => s + prevRowTotal(c.id), 0)
  const lockedVisible = visible.filter((c) => lockedIds.has(c.id)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          Visar <span className="font-medium text-gray-700">{visible.length} av {costCenters.length}</span>
          {' '}kostnadsställen
          {!showAll && ' — bara de som har utfall eller budget på kontot'}
          {lockedVisible > 0 && ` · ${lockedVisible} låsta`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              showAll
                ? 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            Visa alla KS
          </button>
          <button
            onClick={() => setCompact((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              compact
                ? 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            <Minimize2 size={13} />
            Kompakt
          </button>
          <button
            onClick={() => setShowActuals((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              showActuals
                ? 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            <Columns3 size={13} />
            Utfall {comparisonLabel}
          </button>
          {canEdit && futurePeriods.length > 0 && allocationTargets.length > 0 && (
            <button
              onClick={() => setAllocating(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Scale size={13} />
              Fördela totalbelopp
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="flex items-start gap-2.5 px-4 py-3 mb-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Ändringen sparades inte</p>
            <p className="mt-0.5 text-red-700">{describeSaveError(saveError)}</p>
          </div>
          {onDismissSaveError && (
            <button onClick={onDismissSaveError} className="shrink-0 text-red-400 hover:text-red-700" title="Stäng">
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 mb-3 rounded-lg text-xs bg-gray-50 border border-gray-200 text-gray-600">
          <Lock size={13} className="shrink-0 mt-0.5" />
          <span>
            Din roll får se men inte redigera sektionen <strong>{account.config?.section ?? 'utan sektion'}</strong>.
          </span>
        </div>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className={cn('min-w-max', d.table)}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th
                rowSpan={showActuals ? 2 : 1}
                className={cn('sticky left-0 bg-gray-50 py-2.5 text-left font-medium text-gray-500 z-10', d.namePad, d.nameCol)}
              >
                Kostnadsställe
              </th>
              {periods.map(({ year, month }) => (
                <th
                  key={`${year}-${month}`}
                  colSpan={colsPerPeriod}
                  className={cn(
                    'py-2.5 font-medium border-l border-gray-200',
                    d.cellPad,
                    showActuals ? 'text-center' : cn('text-right', d.budgetCol),
                    isPastPeriod(year, month) ? 'text-gray-400' : 'text-gray-500',
                    month === currentMonth && year === currentYear && 'bg-brand-50 text-brand-600',
                  )}
                >
                  {MONTH_LABELS[month - 1]}{year !== scenario.start_year ? ` ${year}` : ''}
                </th>
              ))}
              <th
                colSpan={colsPerPeriod}
                className={cn('py-2.5 font-medium text-gray-600 border-l border-gray-300 bg-gray-100', d.namePad, showActuals ? 'text-center' : 'text-right')}
              >
                Helår
              </th>
            </tr>
            {showActuals && (
              <tr className="bg-gray-50 border-b border-gray-200">
                {periods.map(({ year, month }) => (
                  <Fragment key={`${year}-${month}-sub`}>
                    <th className={cn('pb-2 text-right font-normal text-gray-400 border-l border-gray-200', d.cellPad, d.actualCol)}>
                      {sourceYear(year, month)}
                    </th>
                    <th className={cn('pb-2 text-right font-normal text-gray-500', d.cellPad, d.budgetCol)}>
                      Budget
                    </th>
                  </Fragment>
                ))}
                <th className={cn('pb-2 text-right font-normal text-gray-400 border-l border-gray-300 bg-gray-100', d.cellPad, d.actualCol)}>
                  Utfall
                </th>
                <th className={cn('pb-2 text-right font-normal text-gray-500 bg-gray-100', d.namePad, d.totalCol)}>
                  Budget
                </th>
              </tr>
            )}
          </thead>

          <tbody>
            {groups.map(({ region, rows }) => {
              const isCollapsed = collapsed.has(region)
              const regionTotal = rows.reduce((s, c) => s + rowTotal(c.id), 0)
              const regionPrevTotal = rows.reduce((s, c) => s + prevRowTotal(c.id), 0)

              return (
                <Fragment key={region}>
                  <tr className="bg-gray-50 border-t border-gray-200 cursor-pointer hover:bg-gray-100" onClick={() => toggleRegion(region)}>
                    <td className={cn('sticky left-0 bg-gray-50 py-2 z-10', d.namePad)}>
                      <div className="flex items-center gap-1.5">
                        {isCollapsed ? <ChevronRight size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                        <span className="font-semibold uppercase tracking-wide text-gray-600">{region}</span>
                        <span className="text-gray-400 font-normal normal-case tracking-normal">
                          {rows.length} {rows.length === 1 ? 'ställe' : 'ställen'}
                        </span>
                      </div>
                    </td>
                    {periods.map(({ year, month }) => {
                      const sum = rows.reduce((s, c) => s + getValue(c.id, year, month), 0)
                      const prevSum = rows.reduce((s, c) => s + getPrev(c.id, year, month), 0)
                      return (
                        <Fragment key={`${region}-${year}-${month}`}>
                          {showActuals && (
                            <td className={cn('py-2 text-right tabular-nums text-gray-400 bg-gray-50 border-l border-gray-200', d.cellPad)}>
                              {fmt(prevSum)}
                            </td>
                          )}
                          <td className={cn('py-2 text-right font-semibold text-gray-700', d.cellPad)}>
                            {fmt(sum)}
                          </td>
                        </Fragment>
                      )
                    })}
                    {showActuals && (
                      <td className={cn('py-2 text-right tabular-nums text-gray-400 border-l border-gray-300 bg-gray-100', d.cellPad)}>
                        {fmt(regionPrevTotal)}
                      </td>
                    )}
                    <td className={cn('py-2 text-right font-bold text-gray-900 bg-gray-100', d.namePad)}>
                      {fmt(regionTotal)}
                    </td>
                  </tr>

                  {!isCollapsed && rows.map((cc) => {
                    const locked = lockedIds.has(cc.id)
                    return (
                      <tr key={cc.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className={cn('sticky left-0 bg-white py-1 z-10 hover:bg-gray-50/50', d.namePad)}>
                          <div className="flex items-center gap-1.5 pl-4">
                            <span className="font-mono text-gray-400">{cc.code}</span>
                            <span className="text-gray-700 truncate">{cc.name}</span>
                            {locked && (
                              <span
                                title="Kostnadsstället är låst i det här scenariot"
                                className="flex items-center gap-0.5 px-1 py-0.5 rounded text-amber-700 bg-amber-50 font-medium shrink-0"
                              >
                                <Lock size={9} />
                                Låst
                              </span>
                            )}
                          </div>
                        </td>

                        {periods.map(({ year, month }) => {
                          const k = key(cc.id, year, month)
                          const isPast = isPastPeriod(year, month)
                          const editable = isEditable(cc.id, year, month)
                          const value = getValue(cc.id, year, month)
                          return (
                            <Fragment key={k}>
                              {showActuals && (
                                <td className={cn('py-1 text-right tabular-nums text-gray-400 bg-gray-50/70 border-l border-gray-200', d.cellPad)}>
                                  {fmt(getPrev(cc.id, year, month))}
                                </td>
                              )}
                              <td className={cn('py-1', d.cellPad)}>
                                {editable ? (
                                  <div className="relative">
                                    <input
                                      type="text"
                                      // Remount when the stored value changes, so a
                                      // bulk allocation is reflected in the cell
                                      key={`${k}:${value}`}
                                      defaultValue={fmt(value)}
                                      onBlur={(e) => {
                                        const next = parseSEK(e.target.value)
                                        if (next !== value) onCellChange(cc.id, year, month, next)
                                        e.target.value = fmt(next)
                                      }}
                                      placeholder="0"
                                      aria-label={`Budget ${MONTH_LABELS[month - 1]} ${year} ${cc.name}`}
                                      className={cn(
                                        'w-full text-right tabular-nums border border-gray-200 rounded bg-white placeholder:text-gray-300 hover:border-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
                                        d.inputPad,
                                      )}
                                    />
                                    {saving.has(k) && (
                                      <Loader2 size={10} className="animate-spin absolute right-0.5 top-1/2 -translate-y-1/2 text-brand-400" />
                                    )}
                                  </div>
                                ) : (
                                  <div className={cn('text-right tabular-nums', d.inputPad, isPast ? 'text-gray-400' : 'text-gray-500')}>
                                    {fmt(value)}
                                  </div>
                                )}
                              </td>
                            </Fragment>
                          )
                        })}

                        {showActuals && (
                          <td className={cn('py-1 text-right tabular-nums text-gray-400 border-l border-gray-300 bg-gray-50', d.cellPad)}>
                            {fmt(prevRowTotal(cc.id))}
                          </td>
                        )}
                        <td className={cn('py-1 text-right font-medium text-gray-800 bg-gray-50', d.namePad)}>
                          {fmt(rowTotal(cc.id))}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}

            {visible.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="py-10 text-center text-gray-400">
                  Inget utfall och ingen budget på kontot. Slå på <strong>Visa alla KS</strong> för att lägga in något.
                </td>
              </tr>
            )}

            <tr className="border-t-2 border-gray-300 bg-brand-50">
              <td className={cn('sticky left-0 bg-brand-50 py-2.5 font-bold text-brand-900 z-10', d.namePad)}>
                TOTALT {account.account_number} {account.name}
              </td>
              {periods.map(({ year, month }) => {
                const sum = visible.reduce((s, c) => s + getValue(c.id, year, month), 0)
                const prevSum = visible.reduce((s, c) => s + getPrev(c.id, year, month), 0)
                return (
                  <Fragment key={`total-${year}-${month}`}>
                    {showActuals && (
                      <td className={cn('py-2.5 text-right tabular-nums text-brand-400 border-l border-brand-200', d.cellPad)}>
                        {fmt(prevSum)}
                      </td>
                    )}
                    <td className={cn('py-2.5 text-right font-semibold text-brand-900', d.cellPad)}>
                      {fmt(sum)}
                    </td>
                  </Fragment>
                )
              })}
              {showActuals && (
                <td className={cn('py-2.5 text-right tabular-nums text-brand-400 border-l border-brand-200 bg-brand-100', d.cellPad)}>
                  {fmt(grandPrevTotal)}
                </td>
              )}
              <td className={cn('py-2.5 text-right font-bold text-brand-900 bg-brand-100', d.namePad)}>
                {fmt(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Totalraden är summan av de kostnadsställen du får se — en regionchef ser sin region, inte hela bolaget.
      </p>

      {allocating && (
        <AllocateTotalDialog
          accountLabel={`${account.account_number} ${account.name}`}
          accountId={account.id}
          targets={allocationTargets}
          futurePeriods={futurePeriods}
          entries={entries}
          prevActuals={prevActuals}
          comparisonLabel={comparisonLabel}
          onApply={onAllocate}
          onClose={() => setAllocating(false)}
        />
      )}
    </div>
  )
}
