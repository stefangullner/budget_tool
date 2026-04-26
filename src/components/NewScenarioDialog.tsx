import { useState, type FormEvent } from 'react'
import { X, TrendingUp, Copy, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Company, Scenario } from '@/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

interface Props {
  scenarios: Scenario[]
  companies?: Company[]       // if provided, shows company selector (admin mode)
  defaultCompanyId?: number
  onClose: () => void
  onCreate: (
    name: string,
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
    copyFromId?: number,
    companyIds?: number[],   // only used in admin mode
  ) => Promise<void>
}

type Preset = 'calendar' | 'rolling' | 'forecast' | 'custom'

function addMonths(year: number, month: number, n: number) {
  const total = year * 12 + (month - 1) + n
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

function monthsBetween(sy: number, sm: number, ey: number, em: number) {
  return (ey * 12 + em) - (sy * 12 + sm) + 1
}

export default function NewScenarioDialog({
  scenarios, companies, defaultCompanyId, onClose, onCreate,
}: Props) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  // Period state
  const [preset, setPreset] = useState<Preset>('calendar')
  const [calendarYear, setCalendarYear] = useState(currentYear)
  const [forecastStartMonth, setForecastStartMonth] = useState(currentMonth)
  const [startYear, setStartYear] = useState(currentYear)
  const [startMonth, setStartMonth] = useState(1)
  const [endYear, setEndYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(12)

  // Name state
  const [name, setName] = useState(`Budget ${currentYear}`)
  const [nameEdited, setNameEdited] = useState(false)

  // Copy state
  const [copyFromId, setCopyFromId] = useState<number | ''>('')

  // Company selection (admin mode)
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<number>>(
    new Set(defaultCompanyId ? [defaultCompanyId] : companies?.map((c) => c.id) ?? []),
  )

  const [saving, setSaving] = useState(false)

  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

  function applyPreset(p: Preset, calYear = calendarYear, fMonth = forecastStartMonth) {
    setPreset(p)
    let sy: number, sm: number, ey: number, em: number, suggested: string
    if (p === 'calendar') {
      sy = calYear; sm = 1; ey = calYear; em = 12
      suggested = `Budget ${calYear}`
    } else if (p === 'rolling') {
      sy = currentYear; sm = currentMonth
      const end = addMonths(currentYear, currentMonth, 12)
      ey = end.year; em = end.month
      suggested = `Rullande 13 mån`
    } else if (p === 'forecast') {
      sy = currentYear; sm = fMonth; ey = currentYear; em = 12
      suggested = `Prognos ${currentYear} (${MONTHS[fMonth - 1]}–Dec)`
    } else {
      return
    }
    setStartYear(sy); setStartMonth(sm); setEndYear(ey); setEndMonth(em)
    if (!nameEdited) setName(suggested)
  }

  function handleCalendarYearChange(y: number) {
    setCalendarYear(y)
    if (preset === 'calendar') applyPreset('calendar', y, forecastStartMonth)
  }

  function handleForecastMonthChange(m: number) {
    setForecastStartMonth(m)
    if (preset === 'forecast') applyPreset('forecast', calendarYear, m)
  }

  function toggleCompany(id: number) {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  // Copy logic breakdown
  const totalMonths = monthsBetween(startYear, startMonth, endYear, endMonth)
  const pastMonths = Math.max(
    0,
    Math.min(totalMonths, monthsBetween(startYear, startMonth, currentYear, currentMonth) - 1),
  )
  const futureMonths = Math.max(0, totalMonths - pastMonths)
  const copySource = copyFromId
    ? scenarios.find((s) => s.id === copyFromId)?.name ?? 'valt scenario'
    : null

  const isValid =
    name.trim().length > 0 &&
    totalMonths > 0 &&
    (companies ? selectedCompanyIds.size > 0 : true)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setSaving(true)
    await onCreate(
      name.trim(), startYear, startMonth, endYear, endMonth,
      copyFromId || undefined,
      companies ? [...selectedCompanyIds] : undefined,
    )
    setSaving(false)
    onClose()
  }

  const presetBtn = (p: Preset, label: string) => (
    <button
      key={p}
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Nytt scenario</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Period presets ── */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Typ av period</label>
            <div className="flex flex-wrap gap-2">
              {presetBtn('calendar', 'Kalenderår')}
              {presetBtn('rolling', 'Rullande 13 mån')}
              {presetBtn('forecast', 'Prognos t.o.m. dec')}
              {presetBtn('custom', 'Anpassad')}
            </div>

            {preset === 'calendar' && (
              <div className="flex gap-2 mt-3">
                {years.map((y) => (
                  <button key={y} type="button" onClick={() => handleCalendarYearChange(y)}
                    className={cn(
                      'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      calendarYear === y
                        ? 'bg-brand-50 text-brand-700 border-brand-300'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                    )}>
                    {y}
                  </button>
                ))}
              </div>
            )}

            {preset === 'forecast' && (
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-1.5">Från månad (innevarande år)</label>
                <div className="flex flex-wrap gap-1.5">
                  {MONTHS.map((m, i) => (
                    <button key={i} type="button" onClick={() => handleForecastMonthChange(i + 1)}
                      className={cn(
                        'px-2.5 py-1 rounded text-xs font-medium border transition-colors',
                        forecastStartMonth === i + 1
                          ? 'bg-brand-50 text-brand-700 border-brand-300'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                      )}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Slutar alltid 31 december innevarande år.</p>
              </div>
            )}

            {preset === 'rolling' && (
              <p className="text-xs text-gray-400 mt-2">
                {MONTHS[currentMonth - 1]} {currentYear} → {(() => {
                  const e = addMonths(currentYear, currentMonth, 12)
                  return `${MONTHS[e.month - 1]} ${e.year}`
                })()} · 13 månader
              </p>
            )}

            {preset === 'custom' ? (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Startperiod</label>
                  <div className="flex gap-1">
                    <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}
                      className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}
                      className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Slutperiod</label>
                  <div className="flex gap-1">
                    <select value={endYear} onChange={(e) => setEndYear(Number(e.target.value))}
                      className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}
                      className="flex-1 px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              totalMonths > 0 && (
                <p className="text-xs text-gray-500 mt-2 font-medium">
                  {MONTHS[startMonth - 1]} {startYear} – {MONTHS[endMonth - 1]} {endYear} · {totalMonths} månader
                </p>
              )
            )}
          </div>

          {/* ── Copy logic breakdown (B) ── */}
          {totalMonths > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
              {pastMonths > 0 && (
                <div className="flex items-start gap-3 px-4 py-3">
                  <TrendingUp size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-gray-700">
                      {pastMonths} {pastMonths === 1 ? 'månad' : 'månader'} med utfall
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Hämtas automatiskt från Fortnox när utfallssynken är konfigurerad.
                    </p>
                  </div>
                </div>
              )}
              {futureMonths > 0 && (
                <div className="flex items-start gap-3 px-4 py-3">
                  {copySource ? <Copy size={14} className="text-brand-500 mt-0.5 shrink-0" /> : <FileText size={14} className="text-gray-400 mt-0.5 shrink-0" />}
                  <div>
                    <p className="text-xs font-medium text-gray-700">
                      {futureMonths} {futureMonths === 1 ? 'månad' : 'månader'} framåt
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {copySource
                        ? <>Kopieras från <span className="font-medium text-gray-600">{copySource}</span></>
                        : 'Tomt — fyll i manuellt i budgetmatrisen.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Name ── */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Namn</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameEdited(true) }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="t.ex. Budget 2026, Prognos Q3..."
              autoFocus
            />
          </div>

          {/* ── Copy from ── */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Kopiera belopp från (valfritt)</label>
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
          </div>

          {/* ── Company selector (C) — admin mode only ── */}
          {companies && companies.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">Skapa för bolag</label>
              <div className="grid grid-cols-2 gap-2">
                {companies.map((c) => (
                  <label key={c.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors text-sm',
                      selectedCompanyIds.has(c.id)
                        ? 'border-brand-400 bg-brand-50 text-brand-800'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCompanyIds.has(c.id)}
                      onChange={() => toggleCompany(c.id)}
                      className="accent-brand-600"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              {selectedCompanyIds.size > 1 && (
                <p className="text-xs text-gray-400 mt-1.5">
                  Skapar {selectedCompanyIds.size} separata scenarier med samma namn och period.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Avbryt
            </button>
            <button
              type="submit"
              disabled={!isValid || saving}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? 'Skapar...'
                : companies && selectedCompanyIds.size > 1
                  ? `Skapa ${selectedCompanyIds.size} scenarier`
                  : 'Skapa scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
