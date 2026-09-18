import { useMemo, useState } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cellKey, type BulkCell } from '@/lib/bulkDistribute'

type Period = { year: number; month: number }
type Weighting = 'actuals' | 'current' | 'even'
type Spread = 'pattern' | 'even'

export interface AllocationTarget {
  id: number
  code: string
  name: string
}

interface Props {
  accountLabel: string
  /** Cost centers the run may write to — locked ones must not be passed in. */
  targets: AllocationTarget[]
  accountId: number
  futurePeriods: Period[]
  entries: Map<string, number>
  prevActuals: Map<string, number>
  comparisonLabel: string
  onApply: (cells: BulkCell[]) => Promise<{ written: number; error: string | null }>
  onClose: () => void
}

function parseSEK(s: string): number {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function fmt(n: number) {
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

/** Split a total into `count` parts, remainder on the last so the sum is exact. */
function splitEvenly(total: number, count: number): number[] {
  if (count === 0) return []
  const base = Math.trunc(total / count)
  const parts = Array(count).fill(base) as number[]
  parts[count - 1] = total - base * (count - 1)
  return parts
}

/** Split by weight, remainder on the largest share so the sum is exact. */
function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum === 0) return splitEvenly(total, weights.length)
  const parts = weights.map((w) => Math.round((total * w) / sum))
  const drift = total - parts.reduce((s, p) => s + p, 0)
  if (drift !== 0) {
    let biggest = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[biggest]) biggest = i
    parts[biggest] += drift
  }
  return parts
}

export default function AllocateTotalDialog({
  accountLabel,
  targets,
  accountId,
  futurePeriods,
  entries,
  prevActuals,
  comparisonLabel,
  onApply,
  onClose,
}: Props) {
  const [totalInput, setTotalInput] = useState('')
  const [weighting, setWeighting] = useState<Weighting>('actuals')
  const [spread, setSpread] = useState<Spread>('pattern')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = parseSEK(totalInput)

  /** Per cost center: comparison actuals and existing budget over the periods written. */
  const basis = useMemo(
    () =>
      targets.map((t) => {
        const prev = futurePeriods.map(
          (p) => prevActuals.get(cellKey(t.id, p.year, p.month, accountId)) ?? 0,
        )
        const current = futurePeriods.reduce(
          (s, p) => s + (entries.get(cellKey(t.id, p.year, p.month, accountId)) ?? 0),
          0,
        )
        return { target: t, prev, prevTotal: prev.reduce((s, v) => s + v, 0), current }
      }),
    [targets, futurePeriods, prevActuals, entries, accountId],
  )

  const plan = useMemo(() => {
    const weights = basis.map((b) =>
      weighting === 'actuals'
        ? Math.abs(b.prevTotal)
        : weighting === 'current'
          ? Math.abs(b.current)
          : 1,
    )
    const shares = splitByWeight(total, weights)
    const weightSum = weights.reduce((s, w) => s + w, 0)

    const cells: BulkCell[] = []
    const rows = basis.map((b, i) => {
      const share = shares[i]
      let amounts: number[]
      if (spread === 'pattern' && b.prevTotal !== 0) {
        amounts = splitByWeight(share, b.prev.map((v) => Math.abs(v)))
      } else {
        amounts = splitEvenly(share, futurePeriods.length)
      }
      futurePeriods.forEach((p, j) => {
        cells.push({
          costCenterId: b.target.id,
          accountId,
          year: p.year,
          month: p.month,
          amount: amounts[j],
        })
      })
      return {
        target: b.target,
        share,
        pct: weightSum === 0 ? 1 / basis.length : weights[i] / weightSum,
        prevTotal: b.prevTotal,
        flat: spread === 'pattern' && b.prevTotal === 0,
      }
    })

    return { cells, rows, fellBackToEven: weightSum === 0 }
  }, [basis, weighting, spread, total, futurePeriods, accountId])

  async function handleApply() {
    setApplying(true)
    setError(null)
    const result = await onApply(plan.cells)
    setApplying(false)
    if (result.error) {
      setError(
        result.written > 0
          ? `${fmt(result.written)} celler hann sparas innan det gick fel: ${result.error}`
          : result.error,
      )
      return
    }
    onClose()
  }

  const flatCount = plan.rows.filter((r) => r.flat).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Fördela totalbelopp</h2>
            <p className="text-xs text-gray-500 mt-0.5">{accountLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Totalbelopp för kontot (kr)
            </label>
            <input
              type="text"
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              placeholder="t.ex. 1 273 200"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              Slås ut över {targets.length} kostnadsställen och {futurePeriods.length} månader.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Fördelningsnyckel mellan kostnadsställen</p>
            <div className="space-y-2">
              {([
                ['actuals', `Utfall ${comparisonLabel}`, 'Varje KS får sin historiska andel'],
                ['current', 'Nuvarande budget', 'Behåller den fördelning som redan är inlagd'],
                ['even', 'Lika delar', 'Samma belopp på varje kostnadsställe'],
              ] as [Weighting, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="weighting"
                    value={value}
                    checked={weighting === value}
                    onChange={() => setWeighting(value)}
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

          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Fördelning över månader</p>
            <div className="space-y-2">
              {([
                ['pattern', 'Följ utfallets månadsmönster', 'Behåller säsongen inom varje KS'],
                ['even', 'Jämnt', 'Lika stora månader'],
              ] as [Spread, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="spread"
                    value={value}
                    checked={spread === value}
                    onChange={() => setSpread(value)}
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

          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Ersätter budgeten på kontot i samtliga listade kostnadsställen för de framtida
              månaderna. Går inte att ångra.
            </span>
          </div>

          {total !== 0 && (
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">Förhandsvisning</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Kostnadsställe</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Andel</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Belopp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r, i) => (
                      <tr
                        key={r.target.id}
                        className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                      >
                        <td className="px-3 py-1.5 text-gray-700">
                          <span className="font-mono text-gray-400 mr-1.5">{r.target.code}</span>
                          {r.target.name}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                          {(r.pct * 100).toFixed(1)} %
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-800">{fmt(r.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-700">Totalt</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-700">100 %</td>
                      <td className="px-3 py-2 text-right font-semibold font-mono text-gray-900">
                        {fmt(plan.rows.reduce((s, r) => s + r.share, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {plan.fellBackToEven && (
                <p className="mt-2 text-xs text-gray-500">
                  Ingen av nycklarna gav något att vikta på — beloppet delas lika.
                </p>
              )}
              {flatCount > 0 && !plan.fellBackToEven && (
                <p className="mt-2 text-xs text-gray-500">
                  {flatCount} kostnadsställen saknar utfall att forma månaderna efter och får jämn
                  fördelning.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            Avbryt
          </button>
          <button
            onClick={handleApply}
            disabled={total === 0 || targets.length === 0 || futurePeriods.length === 0 || applying}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {applying && <Loader2 size={13} className="animate-spin" />}
            {applying ? 'Sparar…' : 'Fördela'}
          </button>
        </div>
      </div>
    </div>
  )
}
