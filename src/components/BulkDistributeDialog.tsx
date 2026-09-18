import { useMemo, useState } from 'react'
import { X, AlertTriangle, Loader2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { periodKey, type AccountRow, type BulkCell } from '@/hooks/useBudget'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

type Period = { year: number; month: number }
type Method = 'copy' | 'even'
type Mode = 'skip' | 'overwrite'

/** A section the user may write to, with the accounts that accept input. */
export interface BulkGroup {
  section: string
  accounts: AccountRow[]
}

interface Props {
  groups: BulkGroup[]
  futurePeriods: Period[]
  /** Current budget, so already-filled cells can be left alone. */
  entries: Map<string, number>
  /** Comparison actuals, already mapped onto the target periods. */
  prevActuals: Map<string, number>
  comparisonLabel: string
  onApply: (cells: BulkCell[]) => Promise<{ written: number; error: string | null }>
  onClose: () => void
}

function parsePercent(s: string): number {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function fmt(n: number) {
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function periodLabel(p: Period) {
  return `${MONTH_LABELS[p.month - 1].toLowerCase()} ${p.year}`
}

/** Split a total into `count` parts, remainder on the last so the sum is exact. */
function splitEvenly(total: number, count: number): number[] {
  if (count === 0) return []
  const base = Math.trunc(total / count)
  const parts = Array(count).fill(base) as number[]
  parts[count - 1] = total - base * (count - 1)
  return parts
}

interface SectionPreview {
  section: string
  accounts: number
  cells: number
  total: number
}

interface Plan {
  cells: BulkCell[]
  perSection: SectionPreview[]
  total: number
  /** Accounts with no comparison actuals at all — nothing to derive a budget from. */
  withoutData: number
  /** Cells left alone because they already hold a budget. */
  keptFilled: number
}

export default function BulkDistributeDialog({
  groups,
  futurePeriods,
  entries,
  prevActuals,
  comparisonLabel,
  onApply,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(groups.map((g) => g.section)))
  const [method, setMethod] = useState<Method>('copy')
  const [upliftInput, setUpliftInput] = useState('')
  const [mode, setMode] = useState<Mode>('skip')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uplift = parsePercent(upliftInput)
  const factor = 1 + uplift / 100

  function toggleSection(section: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const plan: Plan = useMemo(() => {
    const cells: BulkCell[] = []
    const perSection: SectionPreview[] = []
    let withoutData = 0
    let keptFilled = 0

    for (const group of groups) {
      if (!selected.has(group.section)) continue

      let sectionCells = 0
      let sectionTotal = 0
      let sectionAccounts = 0

      for (const account of group.accounts) {
        const prev = futurePeriods.map(
          (p) => prevActuals.get(periodKey(p.year, p.month) + ':' + account.id) ?? 0,
        )
        if (prev.every((v) => v === 0)) {
          withoutData++
          continue
        }

        let amounts: number[]
        if (method === 'copy') {
          amounts = prev.map((v) => Math.round(v * factor))
        } else {
          // Same sum as the comparison actuals over the periods being written,
          // just flattened — past months are never touched, so this is not
          // necessarily a full year
          const yearTotal = Math.round(prev.reduce((s, v) => s + v, 0) * factor)
          amounts = splitEvenly(yearTotal, futurePeriods.length)
        }

        let touched = false
        futurePeriods.forEach((p, i) => {
          const key = periodKey(p.year, p.month) + ':' + account.id
          const existing = entries.get(key) ?? 0
          if (mode === 'skip') {
            if (existing !== 0) {
              keptFilled++
              return
            }
            // Nothing to write — the cell is already empty
            if (amounts[i] === 0) return
          }
          cells.push({ accountId: account.id, year: p.year, month: p.month, amount: amounts[i] })
          sectionCells++
          sectionTotal += amounts[i]
          touched = true
        })

        if (touched) sectionAccounts++
      }

      perSection.push({
        section: group.section,
        accounts: sectionAccounts,
        cells: sectionCells,
        total: sectionTotal,
      })
    }

    return {
      cells,
      perSection,
      total: cells.reduce((s, c) => s + c.amount, 0),
      withoutData,
      keptFilled,
    }
  }, [groups, selected, method, factor, mode, futurePeriods, entries, prevActuals])

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

  const rangeLabel =
    futurePeriods.length === 0
      ? '—'
      : futurePeriods.length === 1
        ? periodLabel(futurePeriods[0])
        : `${periodLabel(futurePeriods[0])} – ${periodLabel(futurePeriods[futurePeriods.length - 1])}`

  const allSelected = selected.size === groups.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Layers size={15} className="text-brand-600" />
              Massfördela kostnadsstället
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Fyller {rangeLabel} utifrån utfall {comparisonLabel}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-700">Sektioner som ingår</p>
              <button
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.section)))
                }
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                {allSelected ? 'Avmarkera alla' : 'Markera alla'}
              </button>
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
              {groups.map((group) => {
                const isOn = selected.has(group.section)
                return (
                  <label
                    key={group.section}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggleSection(group.section)}
                      className="accent-brand-600"
                    />
                    <span className={cn('text-xs flex-1', isOn ? 'text-gray-800' : 'text-gray-400')}>
                      {group.section}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {group.accounts.length} konton
                    </span>
                  </label>
                )
              })}
              {groups.length === 0 && (
                <p className="px-3 py-3 text-xs text-gray-500">
                  Inga sektioner du får redigera i det här kostnadsstället.
                </p>
              )}
            </div>
          </div>

          {/* Method */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Metod</p>
            <div className="space-y-2">
              {([
                ['copy', 'Följ utfallets månadsmönster', `Varje månad får sitt eget utfall från ${comparisonLabel}`],
                ['even', 'Jämna ut', 'Samma summa som utfallet för perioden, men lika stora månader'],
              ] as [Method, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-method"
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

          {/* Uplift */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Justering i procent
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={upliftInput}
                onChange={(e) => setUpliftInput(e.target.value)}
                placeholder="0"
                className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              <span className="text-xs text-gray-500">
                % på utfallet — negativt tal sänker
              </span>
            </div>
          </div>

          {/* Overwrite policy */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Redan ifyllda celler</p>
            <div className="space-y-2">
              {([
                ['skip', 'Lämna orörda', 'Skriver bara där det inte finns någon budget'],
                ['overwrite', 'Skriv över', 'Ersätter befintlig budget i valda sektioner'],
              ] as [Mode, string, string][]).map(([value, label, desc]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <span className="text-xs">
                    <span className="font-medium text-gray-800">{label}</span>
                    <span className="text-gray-500 ml-1">— {desc}</span>
                  </span>
                </label>
              ))}
            </div>
            {mode === 'overwrite' && (
              <div className="flex items-start gap-2 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  Befintlig budget i de valda sektionerna ersätts och går inte att ångra.
                </span>
              </div>
            )}
          </div>

          {/* Preview */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Förhandsvisning</p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Sektion</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Konton</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Celler</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.perSection.map((s, i) => (
                    <tr
                      key={s.section}
                      className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                    >
                      <td className="px-3 py-1.5 text-gray-700">{s.section}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{s.accounts}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{s.cells}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-800">{fmt(s.total)}</td>
                    </tr>
                  ))}
                  {plan.perSection.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-gray-500">
                        Välj minst en sektion.
                      </td>
                    </tr>
                  )}
                </tbody>
                {plan.perSection.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-100">
                      <td className="px-3 py-2 font-semibold text-gray-700">Totalt</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-700">
                        {plan.perSection.reduce((s, x) => s + x.accounts, 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-700">
                        {plan.cells.length}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold font-mono text-gray-900">
                        {fmt(plan.total)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {(plan.withoutData > 0 || plan.keptFilled > 0) && (
              <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                {plan.withoutData > 0 && (
                  <li>
                    {plan.withoutData} konton hoppas över — inget utfall {comparisonLabel} att utgå från.
                  </li>
                )}
                {plan.keptFilled > 0 && (
                  <li>{plan.keptFilled} celler lämnas orörda eftersom de redan har en budget.</li>
                )}
              </ul>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
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
            disabled={plan.cells.length === 0 || applying || futurePeriods.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {applying && <Loader2 size={13} className="animate-spin" />}
            {applying ? 'Sparar…' : `Fördela ${fmt(plan.cells.length)} celler`}
          </button>
        </div>
      </div>
    </div>
  )
}
