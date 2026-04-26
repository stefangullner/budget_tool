import { useRef, useCallback, Fragment, useState } from 'react'
import { Lock, Unlock, Loader2, ChevronDown, ChevronRight, Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'
import { periodKey, scenarioPeriods } from '@/hooks/useBudget'
import type { AccountRow } from '@/hooks/useBudget'
import type { Scenario, ScenarioLock } from '@/types'
import DistributeDialog from '@/components/DistributeDialog'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

const SECTION_ORDER = ['Intäkter', 'Personal', 'Lokaler', 'Marknadsföring', 'Administration', 'Övrigt', null]

interface Props {
  scenario: Scenario
  accounts: AccountRow[]
  entries: Map<string, number>
  actuals: Map<string, number>
  locks: ScenarioLock[]
  saving: Set<string>
  costCenterId: number
  companyId: number
  onCellChange: (accountId: number, year: number, month: number, amount: number) => void
  onToggleLock: () => void
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

export default function BudgetMatrix({
  scenario,
  accounts,
  entries,
  actuals,
  locks,
  saving,
  costCenterId,
  companyId,
  onCellChange,
  onToggleLock,
}: Props) {
  const periods = scenarioPeriods(scenario)
  const isLocked = locks.some((l) => l.cost_center_id === costCenterId)

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  function isPastPeriod(year: number, month: number) {
    return year < currentYear || (year === currentYear && month < currentMonth)
  }

  function cellKey(accountId: number, year: number, month: number) {
    return periodKey(year, month) + ':' + accountId
  }

  function getValue(accountId: number, year: number, month: number): number {
    const key = cellKey(accountId, year, month)
    if (isPastPeriod(year, month)) return actuals.get(key) ?? 0
    return entries.get(key) ?? 0
  }

  function getRowTotal(accountId: number): number {
    return periods.reduce((sum, { year, month }) => sum + getValue(accountId, year, month), 0)
  }

  function getPeriodTotal(year: number, month: number): number {
    return accounts.reduce((sum, a) => sum + getValue(a.id, year, month), 0)
  }

  function getGrandTotal(): number {
    return accounts.reduce((sum, a) => sum + getRowTotal(a.id), 0)
  }

  // Group accounts by section
  const grouped = SECTION_ORDER.map((section) => ({
    section: section ?? 'Övrigt',
    rows: accounts.filter((a) => (a.config?.section ?? null) === section),
  })).filter((g) => g.rows.length > 0)

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [distributeTarget, setDistributeTarget] = useState<AccountRow | null>(null)

  const futurePeriods = periods.filter((p) => !isPastPeriod(p.year, p.month))

  function toggleSection(section: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, accountIndex: number, periodIndex: number) => {
      let nextAccountIdx = accountIndex
      let nextPeriodIdx = periodIndex

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        nextPeriodIdx = periodIndex + 1
        if (nextPeriodIdx >= periods.length) {
          nextPeriodIdx = 0
          nextAccountIdx = accountIndex + 1
        }
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        nextPeriodIdx = periodIndex - 1
        if (nextPeriodIdx < 0) {
          nextPeriodIdx = periods.length - 1
          nextAccountIdx = accountIndex - 1
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextPeriodIdx = Math.min(periodIndex + 1, periods.length - 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nextPeriodIdx = Math.max(periodIndex - 1, 0)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        nextAccountIdx = Math.min(accountIndex + 1, accounts.length - 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        nextAccountIdx = Math.max(accountIndex - 1, 0)
      } else {
        return
      }

      const nextAccount = accounts[nextAccountIdx]
      const nextPeriod = periods[nextPeriodIdx]
      if (!nextAccount || !nextPeriod) return
      if (isPastPeriod(nextPeriod.year, nextPeriod.month)) return

      const key = cellKey(nextAccount.id, nextPeriod.year, nextPeriod.month)
      inputRefs.current.get(key)?.focus()
    },
    [accounts, periods],
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500">
          {isLocked ? (
            <span className="text-amber-600 font-medium">KS låst — skrivskyddat</span>
          ) : (
            <span>Redigera direkt i cellen — sparas automatiskt</span>
          )}
        </div>
        <button
          onClick={onToggleLock}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            isLocked
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          )}
        >
          {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
          {isLocked ? 'Lås upp KS' : 'Lås KS'}
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-xs min-w-max">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="sticky left-0 bg-gray-50 px-3 py-2.5 text-left font-medium text-gray-500 w-56 z-10">Konto</th>
              {periods.map(({ year, month }) => (
                <th
                  key={`${year}-${month}`}
                  className={cn(
                    'px-2 py-2.5 text-right font-medium w-24 min-w-[5.5rem]',
                    isPastPeriod(year, month) ? 'text-gray-400' : 'text-gray-500',
                    month === currentMonth && year === currentYear && 'bg-brand-50 text-brand-600',
                  )}
                >
                  {MONTH_LABELS[month - 1]}{year !== scenario.start_year ? ` ${year}` : ''}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-medium text-gray-700 w-28 bg-gray-100">Helår</th>
            </tr>
          </thead>

          <tbody>
            {grouped.map(({ section, rows }) => {
              const isCollapsed = collapsedSections.has(section)
              const sectionTotal = rows.reduce((sum, a) => sum + getRowTotal(a.id), 0)

              return (
                <Fragment key={section}>
                  {/* Section header — always visible, clickable */}
                  <tr
                    className="bg-gray-50 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSection(section)}
                  >
                    <td className="sticky left-0 bg-gray-50 hover:bg-gray-100 px-3 py-2 z-10 transition-colors">
                      <div className="flex items-center gap-1.5">
                        {isCollapsed
                          ? <ChevronRight size={13} className="text-gray-400 shrink-0" />
                          : <ChevronDown size={13} className="text-gray-400 shrink-0" />}
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          {section}
                        </span>
                        {isCollapsed && (
                          <span className="ml-2 text-xs text-gray-400 font-normal normal-case tracking-normal">
                            {rows.length} konton
                          </span>
                        )}
                      </div>
                    </td>
                    {periods.map(({ year, month }) => {
                      const total = rows.reduce((sum, a) => sum + getValue(a.id, year, month), 0)
                      return (
                        <td
                          key={`${year}-${month}`}
                          className={cn(
                            'px-2 py-2 text-right text-xs transition-colors',
                            isCollapsed ? 'font-semibold text-gray-800' : 'font-medium text-gray-500',
                          )}
                        >
                          {isCollapsed ? fmt(total) : ''}
                        </td>
                      )
                    })}
                    <td className={cn(
                      'px-3 py-2 text-right text-xs border-l border-gray-200 transition-colors',
                      isCollapsed
                        ? 'font-bold text-gray-900 bg-gray-100'
                        : 'font-medium text-gray-400 bg-gray-50',
                    )}>
                      {isCollapsed ? fmt(sectionTotal) : ''}
                    </td>
                  </tr>

                  {/* Account rows — hidden when collapsed */}
                  {!isCollapsed && rows.map((account) => {
                    const globalRowIdx = accounts.indexOf(account)
                    const rowTotal = getRowTotal(account.id)
                    return (
                      <tr key={account.id} className="group border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="sticky left-0 bg-white px-3 py-1 z-10 hover:bg-gray-50/50">
                          <div className="flex items-center justify-between gap-1">
                            <div className="min-w-0">
                              <span className="font-mono text-gray-400 mr-2">{account.account_number}</span>
                              <span className="text-gray-700">{account.name}</span>
                            </div>
                            {!isLocked && futurePeriods.length > 0 && (
                              <button
                                onClick={() => setDistributeTarget(account)}
                                title="Fördela årsbelopp"
                                className="invisible group-hover:visible shrink-0 p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                              >
                                <Calculator size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        {periods.map(({ year, month }, periodIdx) => {
                          const isPast = isPastPeriod(year, month)
                          const key = cellKey(account.id, year, month)
                          const value = getValue(account.id, year, month)
                          const isSaving = saving.has(key)
                          return (
                            <td key={`${year}-${month}`} className="px-1 py-0.5">
                              {isPast || isLocked ? (
                                <div className={cn(
                                  'px-2 py-1.5 text-right rounded',
                                  isPast ? 'text-gray-400 bg-gray-50' : 'text-gray-700',
                                )}>
                                  {fmt(value)}
                                </div>
                              ) : (
                                <div className="relative">
                                  <input
                                    key={`${key}-${value}`}
                                    ref={(el) => {
                                      if (el) inputRefs.current.set(key, el)
                                      else inputRefs.current.delete(key)
                                    }}
                                    type="text"
                                    defaultValue={value !== 0 ? fmt(value) : ''}
                                    onBlur={(e) => {
                                      const parsed = parseSEK(e.target.value)
                                      onCellChange(account.id, year, month, parsed)
                                      e.target.value = parsed !== 0 ? fmt(parsed) : ''
                                    }}
                                    onFocus={(e) => {
                                      const raw = entries.get(key) ?? 0
                                      e.target.value = raw !== 0 ? String(raw) : ''
                                      e.target.select()
                                    }}
                                    onKeyDown={(e) => handleKeyDown(e, globalRowIdx, periodIdx)}
                                    className="w-full px-2 py-1.5 text-right rounded border border-transparent focus:border-brand-400 focus:ring-1 focus:ring-brand-400 focus:outline-none bg-white hover:border-gray-200 text-gray-900"
                                  />
                                  {isSaving && (
                                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                                      <Loader2 size={10} className="animate-spin text-gray-300" />
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-3 py-1 text-right font-medium text-gray-700 bg-gray-50 border-l border-gray-200">
                          {fmt(rowTotal)}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Section subtotal — only shown when expanded */}
                  {!isCollapsed && (
                    <tr className="border-t border-gray-200 bg-gray-50/80">
                      <td className="sticky left-0 bg-gray-50/80 px-3 py-1.5 font-medium text-gray-600">
                        Σ {section}
                      </td>
                      {periods.map(({ year, month }) => {
                        const total = rows.reduce((sum, a) => sum + getValue(a.id, year, month), 0)
                        return (
                          <td key={`${year}-${month}`} className="px-2 py-1.5 text-right font-medium text-gray-700">
                            {fmt(total)}
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5 text-right font-semibold text-gray-800 bg-gray-100 border-l border-gray-200">
                        {fmt(sectionTotal)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}

            {/* Grand total */}
            <tr className="border-t-2 border-gray-300 bg-gray-100">
              <td className="sticky left-0 bg-gray-100 px-3 py-2 font-semibold text-gray-800">Totalt</td>
              {periods.map(({ year, month }) => (
                <td key={`${year}-${month}`} className="px-2 py-2 text-right font-semibold text-gray-800">
                  {fmt(getPeriodTotal(year, month))}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-bold text-gray-900 bg-gray-200 border-l border-gray-300">
                {fmt(getGrandTotal())}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {distributeTarget && (
        <DistributeDialog
          account={distributeTarget}
          scenario={scenario}
          costCenterId={costCenterId}
          companyId={companyId}
          futurePeriods={futurePeriods}
          onDistribute={(amounts) => {
            for (const { year, month, amount } of amounts) {
              onCellChange(distributeTarget.id, year, month, amount)
            }
          }}
          onClose={() => setDistributeTarget(null)}
        />
      )}
    </div>
  )
}
