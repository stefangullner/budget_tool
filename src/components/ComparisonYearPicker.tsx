import { cn } from '@/lib/utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

/** How many years back a period may pull its comparison actuals from. */
const MAX_YEARS_BACK = 4

export type ComparisonPeriods = Record<string, number>

interface Props {
  startYear: number
  startMonth: number
  endYear: number
  endMonth: number
  value: ComparisonPeriods
  onChange: (next: ComparisonPeriods) => void
  className?: string
}

export function enumeratePeriods(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  let y = startYear
  let m = startMonth
  // Guard against an inverted range producing an endless list
  while ((y < endYear || (y === endYear && m <= endMonth)) && out.length < 120) {
    out.push({ year: y, month: m })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Source year a period uses when the scenario has no explicit mapping. */
export function defaultComparisonYear(year: number) {
  return year - 1
}

export function comparisonYearFor(
  periods: ComparisonPeriods | null | undefined,
  year: number,
  month: number,
) {
  return periods?.[`${year}-${month}`] ?? defaultComparisonYear(year)
}

export default function ComparisonYearPicker({
  startYear, startMonth, endYear, endMonth, value, onChange, className,
}: Props) {
  const periods = enumeratePeriods(startYear, startMonth, endYear, endMonth)
  if (periods.length === 0) return null

  const offsets = Array.from({ length: MAX_YEARS_BACK }, (_, i) => i + 1)

  function setAll(offset: number) {
    const next: ComparisonPeriods = {}
    for (const p of periods) next[`${p.year}-${p.month}`] = p.year - offset
    onChange(next)
  }

  function setOne(year: number, month: number, sourceYear: number) {
    onChange({ ...value, [`${year}-${month}`]: sourceYear })
  }

  // Which offsets are currently applied to every period, for the shortcut buttons
  const activeOffset = offsets.find((o) =>
    periods.every((p) => comparisonYearFor(value, p.year, p.month) === p.year - o),
  )

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-xs text-gray-500 mr-1">Sätt alla till</span>
        {offsets.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setAll(o)}
            className={cn(
              'px-2 py-1 rounded text-xs font-medium border transition-colors',
              activeOffset === o
                ? 'bg-brand-50 text-brand-700 border-brand-300'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
            )}
          >
            −{o} år
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {periods.map(({ year, month }) => {
          const source = comparisonYearFor(value, year, month)
          const isDefault = source === defaultComparisonYear(year)
          return (
            <label
              key={`${year}-${month}`}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-colors',
                isDefault ? 'border-gray-200 bg-white' : 'border-brand-300 bg-brand-50',
              )}
            >
              <span className="text-gray-500 w-12 shrink-0 tabular-nums">
                {MONTHS[month - 1]}
                {startYear !== endYear ? ` ${String(year).slice(2)}` : ''}
              </span>
              <select
                value={source}
                onChange={(e) => setOne(year, month, Number(e.target.value))}
                className="flex-1 min-w-0 bg-transparent text-gray-800 font-medium focus:outline-none cursor-pointer tabular-nums"
              >
                {offsets.map((o) => (
                  <option key={o} value={year - o}>{year - o}</option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </div>
  )
}
