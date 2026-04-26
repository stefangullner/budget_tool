import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/hooks/useBudget'
import type { Scenario } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

type Base = 'current' | 'prevyear'

interface Props {
  account: AccountRow
  scenario: Scenario
  costCenterId: number
  companyId: number
  futurePeriods: { year: number; month: number }[]
  entries: Map<string, number>
  onApply: (amounts: { year: number; month: number; amount: number }[]) => void
  onClose: () => void
}

function fmt(n: number) {
  if (n === 0) return '0'
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function periodKey(year: number, month: number) {
  return `${year}-${month}`
}

function parsePercent(s: string): number | null {
  const cleaned = s.replace('%', '').replace(',', '.').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

export default function PercentageDialog({
  account,
  scenario,
  costCenterId,
  companyId,
  futurePeriods,
  entries,
  onApply,
  onClose,
}: Props) {
  const [percentInput, setPercentInput] = useState('')
  const [base, setBase] = useState<Base>('current')
  const [prevYearData, setPrevYearData] = useState<Map<number, number>>(new Map())
  const [loadingPrev, setLoadingPrev] = useState(false)

  const hasPrevData = prevYearData.size > 0
  const showNoPrevWarning = base === 'prevyear' && !loadingPrev && !hasPrevData

  useEffect(() => {
    setLoadingPrev(true)
    const prevYear = scenario.start_year - 1
    supabase
      .from('actuals')
      .select('month, amount')
      .eq('company_id', companyId)
      .eq('account_id', account.id)
      .eq('cost_center_id', costCenterId)
      .eq('year', prevYear)
      .then(({ data }) => {
        const map = new Map<number, number>()
        for (const row of data ?? []) {
          map.set(row.month as number, row.amount as number)
        }
        setPrevYearData(map)
        setLoadingPrev(false)
      })
  }, [account.id, companyId, costCenterId, scenario.start_year])

  const pct = parsePercent(percentInput)
  const multiplier = pct !== null ? 1 + pct / 100 : null

  function computePreview(): { year: number; month: number; amount: number; base: number }[] {
    if (!futurePeriods.length || multiplier === null) return []

    return futurePeriods.map((p) => {
      const baseAmount =
        base === 'prevyear'
          ? (prevYearData.get(p.month) ?? 0)
          : (entries.get(periodKey(p.year, p.month) + ':' + account.id) ?? 0)
      return { ...p, amount: Math.round(baseAmount * multiplier), base: baseAmount }
    })
  }

  const preview = computePreview()
  const previewTotal = preview.reduce((s, p) => s + p.amount, 0)
  const canConfirm = multiplier !== null && futurePeriods.length > 0

  function handleConfirm() {
    if (!canConfirm) return
    onApply(preview.map(({ year, month, amount }) => ({ year, month, amount })))
    onClose()
  }

  const pctLabel = pct !== null
    ? pct >= 0 ? `+${pct}%` : `${pct}%`
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Procentuell förändring</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono">{account.account_number}</span> {account.name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Percent input */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Procentuell förändring
            </label>
            <div className="relative">
              <input
                type="text"
                value={percentInput}
                onChange={(e) => setPercentInput(e.target.value)}
                placeholder="t.ex. +5 eller -10"
                autoFocus
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
            {pctLabel && (
              <p className="mt-1 text-xs text-gray-500">
                Varje basbelopp multipliceras med{' '}
                <span className="font-medium text-gray-700">{(multiplier! * 100).toFixed(1)}%</span>
                {' '}({pctLabel})
              </p>
            )}
          </div>

          {/* Base selector */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Referensbas</p>
            <div className="space-y-2">
              {([
                ['current', 'Nuvarande värden', 'Räknar upp/ned de belopp som redan finns på raden'],
                ['prevyear', `Föregående år (${scenario.start_year - 1})`, 'Använder utfall från föregående år som bas'],
              ] as [Base, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="base"
                    value={value}
                    checked={base === value}
                    onChange={() => setBase(value)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <span className="text-xs">
                    <span className="font-medium text-gray-800">{label}</span>
                    <span className="text-gray-500 ml-1">— {desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Warning: no previous year data */}
          {showNoPrevWarning && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                Inga utfall för {scenario.start_year - 1} hittades — alla basvärden blir 0.
              </span>
            </div>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Förhandsvisning</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Månad</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Bas</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Nytt värde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(({ year, month, amount, base: baseAmt }, i) => (
                      <tr
                        key={`${year}-${month}`}
                        className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                      >
                        <td className="px-3 py-1.5 text-gray-600">
                          {MONTH_LABELS[month - 1]}{year !== scenario.start_year ? ` ${year}` : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-400">{fmt(baseAmt)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-900 font-medium">{fmt(amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-700" colSpan={2}>Totalt</td>
                      <td className="px-3 py-2 text-right font-semibold font-mono text-gray-900">{fmt(previewTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Tillämpa
          </button>
        </div>
      </div>
    </div>
  )
}
