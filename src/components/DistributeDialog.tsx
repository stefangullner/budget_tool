import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/hooks/useBudget'
import type { Scenario } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

type Method = 'even' | 'seasonal' | 'copy'

interface Props {
  account: AccountRow
  scenario: Scenario
  costCenterId: number
  companyId: number
  futurePeriods: { year: number; month: number }[]
  onDistribute: (amounts: { year: number; month: number; amount: number }[]) => void
  onClose: () => void
}

function parseSEK(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function fmt(n: number) {
  if (n === 0) return '0'
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function distributeEvenly(total: number, count: number): number[] {
  if (count === 0) return []
  const base = Math.trunc(total / count)
  const amounts = Array(count).fill(base) as number[]
  amounts[amounts.length - 1] = total - base * (count - 1)
  return amounts
}

export default function DistributeDialog({
  account,
  scenario,
  costCenterId,
  companyId,
  futurePeriods,
  onDistribute,
  onClose,
}: Props) {
  const [totalInput, setTotalInput] = useState('')
  const [method, setMethod] = useState<Method>('even')
  const [prevYearData, setPrevYearData] = useState<Map<number, number>>(new Map())
  const [loadingPrev, setLoadingPrev] = useState(false)

  const hasFuturePeriods = futurePeriods.length > 0
  const hasPrevData = prevYearData.size > 0

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

  function computePreview(): { year: number; month: number; amount: number }[] {
    if (!hasFuturePeriods) return []

    if (method === 'even') {
      const total = parseSEK(totalInput)
      const amounts = distributeEvenly(total, futurePeriods.length)
      return futurePeriods.map((p, i) => ({ ...p, amount: amounts[i] }))
    }

    if (method === 'seasonal') {
      const total = parseSEK(totalInput)
      const weights = futurePeriods.map((p) => Math.abs(prevYearData.get(p.month) ?? 0))
      const weightSum = weights.reduce((s, w) => s + w, 0)
      if (weightSum === 0) {
        const amounts = distributeEvenly(total, futurePeriods.length)
        return futurePeriods.map((p, i) => ({ ...p, amount: amounts[i] }))
      }
      const scaled = futurePeriods.map((p, i) => ({
        ...p,
        amount: Math.round((total * weights[i]) / weightSum),
      }))
      // Fix rounding remainder on last period
      const sumSoFar = scaled.reduce((s, p) => s + p.amount, 0)
      scaled[scaled.length - 1].amount += total - sumSoFar
      return scaled
    }

    if (method === 'copy') {
      return futurePeriods.map((p) => ({ ...p, amount: prevYearData.get(p.month) ?? 0 }))
    }

    return []
  }

  const preview = computePreview()
  const previewTotal = preview.reduce((s, p) => s + p.amount, 0)

  function handleConfirm() {
    if (preview.length > 0) {
      onDistribute(preview)
      onClose()
    }
  }

  const showTotalField = method !== 'copy'
  const showNoPrevWarning = (method === 'seasonal' || method === 'copy') && !loadingPrev && !hasPrevData

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Fördela årsbelopp</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono">{account.account_number}</span> {account.name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Method selector */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Fördelningsmetod</p>
            <div className="space-y-2">
              {([
                ['even', 'Jämnt', 'Delar totalbeloppet lika över alla framtida månader'],
                ['seasonal', 'Säsongsmönster', `Fördelar proportionellt baserat på utfall ${scenario.start_year - 1}`],
                ['copy', 'Kopiera från föregående år', `Kopierar exakta belopp från ${scenario.start_year - 1} (utan skalning)`],
              ] as [Method, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="radio"
                    name="method"
                    value={value}
                    checked={method === value}
                    onChange={() => setMethod(value)}
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
                Inga utfall för {scenario.start_year - 1} hittades för detta konto och kostnadsställe.
                {method === 'seasonal' && ' Faller tillbaka på jämn fördelning.'}
              </span>
            </div>
          )}

          {/* Total amount input */}
          {showTotalField && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Totalbelopp att fördela (kr)
              </label>
              <input
                type="text"
                value={totalInput}
                onChange={(e) => setTotalInput(e.target.value)}
                placeholder="t.ex. 120 000"
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Preview table */}
          {hasFuturePeriods && preview.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Förhandsvisning</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Månad</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Belopp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map(({ year, month, amount }, i) => (
                      <tr
                        key={`${year}-${month}`}
                        className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                      >
                        <td className="px-3 py-1.5 text-gray-600">
                          {MONTH_LABELS[month - 1]}{year !== scenario.start_year ? ` ${year}` : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-800">{fmt(amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-700">Totalt</td>
                      <td className="px-3 py-2 text-right font-semibold font-mono text-gray-900">{fmt(previewTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {!hasFuturePeriods && (
            <p className="text-xs text-gray-500">Inga framtida perioder att fördela till.</p>
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
            disabled={!hasFuturePeriods || (showTotalField && parseSEK(totalInput) === 0)}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Fördela
          </button>
        </div>
      </div>
    </div>
  )
}
