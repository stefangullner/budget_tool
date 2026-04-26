import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Scenario } from '@/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

interface Props {
  scenarios: Scenario[]
  onClose: () => void
  onCreate: (
    name: string,
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
    copyFromId?: number,
  ) => Promise<void>
}

type Preset = 'calendar' | 'rolling' | 'forecast' | 'custom'

function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = (year * 12 + (month - 1)) + n
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

export default function NewScenarioDialog({ scenarios, onClose, onCreate }: Props) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const [preset, setPreset] = useState<Preset>('calendar')
  const [calendarYear, setCalendarYear] = useState(currentYear)
  const [forecastStartMonth, setForecastStartMonth] = useState(currentMonth)
  const [name, setName] = useState(`Budget ${currentYear}`)
  const [nameEdited, setNameEdited] = useState(false)
  const [startYear, setStartYear] = useState(currentYear)
  const [startMonth, setStartMonth] = useState(1)
  const [endYear, setEndYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(12)
  const [copyFromId, setCopyFromId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)

  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

  // Derive period from preset
  function applyPreset(p: Preset, calYear = calendarYear, fMonth = forecastStartMonth) {
    setPreset(p)
    let sy: number, sm: number, ey: number, em: number, suggestedName: string
    if (p === 'calendar') {
      sy = calYear; sm = 1; ey = calYear; em = 12
      suggestedName = `Budget ${calYear}`
    } else if (p === 'rolling') {
      sy = currentYear; sm = currentMonth
      const end = addMonths(currentYear, currentMonth, 12)
      ey = end.year; em = end.month
      suggestedName = `Rullande 13 mån`
    } else if (p === 'forecast') {
      sy = currentYear; sm = fMonth; ey = currentYear; em = 12
      suggestedName = `Prognos ${currentYear} (${MONTHS[fMonth - 1]}–Dec)`
    } else {
      return
    }
    setStartYear(sy); setStartMonth(sm); setEndYear(ey); setEndMonth(em)
    if (!nameEdited) setName(suggestedName)
  }

  function handleCalendarYearChange(y: number) {
    setCalendarYear(y)
    if (preset === 'calendar') applyPreset('calendar', y, forecastStartMonth)
  }

  function handleForecastMonthChange(m: number) {
    setForecastStartMonth(m)
    if (preset === 'forecast') applyPreset('forecast', calendarYear, m)
  }

  const periodSummary = (() => {
    if (!startYear) return ''
    const s = `${MONTHS[startMonth - 1]} ${startYear}`
    const e = `${MONTHS[endMonth - 1]} ${endYear}`
    const months = (endYear * 12 + endMonth) - (startYear * 12 + startMonth) + 1
    if (months <= 0) return null
    return `${s} – ${e} (${months} månader)`
  })()

  const isValid =
    name.trim().length > 0 &&
    (endYear > startYear || (endYear === startYear && endMonth >= startMonth))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setSaving(true)
    await onCreate(name.trim(), startYear, startMonth, endYear, endMonth, copyFromId || undefined)
    setSaving(false)
    onClose()
  }

  const presetBtn = (p: Preset, label: string) => (
    <button
      type="button"
      onClick={() => applyPreset(p)}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
        preset === p
          ? 'bg-brand-600 text-white border-brand-600'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Nytt scenario</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Preset buttons */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Typ av period</label>
            <div className="flex flex-wrap gap-2">
              {presetBtn('calendar', 'Kalenderår')}
              {presetBtn('rolling', 'Rullande 13 mån')}
              {presetBtn('forecast', 'Prognos t.o.m. dec')}
              {presetBtn('custom', 'Anpassad')}
            </div>

            {/* Sub-options per preset */}
            {preset === 'calendar' && (
              <div className="flex gap-2 mt-3">
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => handleCalendarYearChange(y)}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      calendarYear === y
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                    )}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}

            {preset === 'forecast' && (
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1">Från månad</label>
                <div className="flex flex-wrap gap-1.5">
                  {MONTHS.map((m, i) => {
                    const disabled = i + 1 > 12
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleForecastMonthChange(i + 1)}
                        className={cn(
                          'px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                          forecastStartMonth === i + 1
                            ? 'bg-brand-50 text-brand-700 border-brand-300'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                          disabled && 'opacity-40 cursor-not-allowed',
                        )}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Slutar alltid 31 december innevarande år.
                </p>
              </div>
            )}

            {preset === 'rolling' && (
              <p className="text-xs text-gray-400 mt-2">
                Startar innevarande månad ({MONTHS[currentMonth - 1]} {currentYear}) och sträcker sig 12 månader framåt.
              </p>
            )}
          </div>

          {/* Manual period override (always visible for 'custom', collapsed summary otherwise) */}
          {preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Startperiod</label>
                <div className="flex gap-1">
                  <select
                    value={startYear}
                    onChange={(e) => setStartYear(Number(e.target.value))}
                    className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select
                    value={startMonth}
                    onChange={(e) => setStartMonth(Number(e.target.value))}
                    className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Slutperiod</label>
                <div className="flex gap-1">
                  <select
                    value={endYear}
                    onChange={(e) => setEndYear(Number(e.target.value))}
                    className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select
                    value={endMonth}
                    onChange={(e) => setEndMonth(Number(e.target.value))}
                    className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            periodSummary && (
              <div className="px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                <span className="font-medium">Period:</span> {periodSummary}
              </div>
            )
          )}

          {!isValid && preset === 'custom' && (
            <p className="text-xs text-red-500">Slutperioden måste vara efter startperioden.</p>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Namn</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="t.ex. Budget 2026, Prognos Q3..."
            />
          </div>

          {/* Copy from */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Kopiera belopp från (valfritt)
            </label>
            <select
              value={copyFromId}
              onChange={(e) => setCopyFromId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Tomt scenario</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({MONTHS[s.start_month - 1]} {s.start_year} – {MONTHS[s.end_month - 1]} {s.end_year})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Månader med utfall hämtas automatiskt från Fortnox när utfallssynken är aktiverad.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Avbryt
            </button>
            <button
              type="submit"
              disabled={!isValid || saving}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Skapar...' : 'Skapa scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
