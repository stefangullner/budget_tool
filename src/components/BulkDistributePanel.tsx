import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  buildBulkPlan,
  type BulkCell,
  type BulkGroup,
  type BulkMethod,
  type BulkMode,
  type BulkTarget,
  type Period,
} from '@/lib/bulkDistribute'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

interface Props {
  groups: BulkGroup[]
  targets: BulkTarget[]
  futurePeriods: Period[]
  /** Current budget across the selected cost centers, keyed by `cellKey`. */
  entries: Map<string, number>
  /** Comparison actuals, already mapped onto the target periods. */
  prevActuals: Map<string, number>
  comparisonLabel: string
  /** Set when nothing may be written at all — e.g. no future months left. */
  blockedReason?: string | null
  onApply: (cells: BulkCell[]) => Promise<{ written: number; error: string | null }>
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

export default function BulkDistributePanel({
  groups,
  targets,
  futurePeriods,
  entries,
  prevActuals,
  comparisonLabel,
  blockedReason,
  onApply,
}: Props) {
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<BulkMethod>('copy')
  const [upliftInput, setUpliftInput] = useState('')
  const [mode, setMode] = useState<BulkMode>('skip')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  // Track what has been turned OFF rather than what is on, so a section that
  // appears after the first render defaults to included.
  const selectedSections = useMemo(
    () => new Set(groups.map((g) => g.section).filter((s) => !deselected.has(s))),
    [groups, deselected],
  )

  const factor = 1 + parsePercent(upliftInput) / 100

  function toggleSection(section: string) {
    setDone(null)
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const plan = useMemo(
    () =>
      buildBulkPlan({
        groups,
        selectedSections,
        targets,
        futurePeriods,
        entries,
        prevActuals,
        method,
        mode,
        factor,
      }),
    [groups, selectedSections, targets, futurePeriods, entries, prevActuals, method, mode, factor],
  )

  async function handleApply() {
    setApplying(true)
    setError(null)
    setDone(null)
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
    setDone(result.written)
  }

  const rangeLabel =
    futurePeriods.length === 0
      ? '—'
      : futurePeriods.length === 1
        ? periodLabel(futurePeriods[0])
        : `${periodLabel(futurePeriods[0])} – ${periodLabel(futurePeriods[futurePeriods.length - 1])}`

  const allSelected = selectedSections.size === groups.length
  const touchedTargets = plan.perTarget.filter((t) => t.cells > 0).length

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      {/* Header */}
      <div className="p-5 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Layers size={15} className="text-brand-600" />
          Fördelning
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Fyller {rangeLabel} i {targets.length} {targets.length === 1 ? 'kostnadsställe' : 'kostnadsställen'}
          {' '}utifrån utfall {comparisonLabel}
        </p>
      </div>

      <div className="p-5 space-y-5">
        {/* Sections */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-700">Sektioner som ingår</p>
            <button
              onClick={() => {
                setDone(null)
                setDeselected(allSelected ? new Set(groups.map((g) => g.section)) : new Set())
              }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              {allSelected ? 'Avmarkera alla' : 'Markera alla'}
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
            {groups.map((group) => {
              const isOn = selectedSections.has(group.section)
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
                Inga budgeterbara konton i bolaget.
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
            ] as [BulkMethod, string, string][]).map(([value, label, desc]) => (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulk-method"
                  value={value}
                  checked={method === value}
                  onChange={() => { setMethod(value); setDone(null) }}
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Justering i procent</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={upliftInput}
              onChange={(e) => { setUpliftInput(e.target.value); setDone(null) }}
              placeholder="0"
              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <span className="text-xs text-gray-500">% på utfallet — negativt tal sänker</span>
          </div>
        </div>

        {/* Overwrite policy */}
        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">Redan ifyllda celler</p>
          <div className="space-y-2">
            {([
              ['skip', 'Lämna orörda', 'Skriver bara där det inte finns någon budget'],
              ['overwrite', 'Skriv över', 'Ersätter befintlig budget i valda sektioner'],
            ] as [BulkMode, string, string][]).map(([value, label, desc]) => (
              <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="bulk-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => { setMode(value); setDone(null) }}
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
                Befintlig budget i de valda sektionerna ersätts i samtliga valda kostnadsställen och
                går inte att ångra.
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
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Kostnadsställe</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Konton</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Celler</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Summa</th>
                </tr>
              </thead>
              <tbody>
                {plan.perTarget.map((t, i) => (
                  <tr
                    key={t.costCenterId}
                    className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                  >
                    <td className={cn('px-3 py-1.5', t.cells === 0 ? 'text-gray-400' : 'text-gray-700')}>
                      <span className="font-mono text-gray-400 mr-1.5">{t.code}</span>
                      {t.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{t.accounts}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{t.cells}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-800">{fmt(t.total)}</td>
                  </tr>
                ))}
                {plan.perTarget.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-gray-500">
                      Välj minst ett kostnadsställe.
                    </td>
                  </tr>
                )}
              </tbody>
              {plan.perTarget.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-100">
                    <td className="px-3 py-2 font-semibold text-gray-700">
                      Totalt — {touchedTargets} av {plan.perTarget.length} berörs
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-700">
                      {plan.perTarget.reduce((s, x) => s + x.accounts, 0)}
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
                  Räknat per kostnadsställe, så samma konto kan förekomma flera gånger.
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

        {done !== null && (
          <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            <span>{fmt(done)} celler sparade. Öppna kostnadsställena i budgetvyn för att granska.</span>
          </div>
        )}

        {blockedReason && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{blockedReason}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end p-4 border-t border-gray-200">
        <button
          onClick={handleApply}
          disabled={plan.cells.length === 0 || applying || !!blockedReason}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {applying && <Loader2 size={13} className="animate-spin" />}
          {applying ? 'Sparar…' : `Fördela ${fmt(plan.cells.length)} celler`}
        </button>
      </div>
    </div>
  )
}
