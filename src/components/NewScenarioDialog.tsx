import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
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

export default function NewScenarioDialog({ scenarios, onClose, onCreate }: Props) {
  const currentYear = new Date().getFullYear()
  const [name, setName] = useState(`Budget ${currentYear}`)
  const [startYear, setStartYear] = useState(currentYear)
  const [startMonth, setStartMonth] = useState(1)
  const [endYear, setEndYear] = useState(currentYear)
  const [endMonth, setEndMonth] = useState(12)
  const [copyFromId, setCopyFromId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)

  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

  const isValid =
    name.trim().length > 0 &&
    (endYear > startYear || (endYear === startYear && endMonth >= startMonth))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setSaving(true)
    await onCreate(
      name.trim(),
      startYear,
      startMonth,
      endYear,
      endMonth,
      copyFromId ? copyFromId : undefined,
    )
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Nytt scenario</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Namn</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="t.ex. Budget 2026, Prognos Q3..."
              autoFocus
            />
          </div>

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

          {!isValid && endYear > 0 && (
            <p className="text-xs text-red-500">Slutperioden måste vara efter startperioden.</p>
          )}

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
                  {s.name} ({s.start_year}-{String(s.start_month).padStart(2, '0')} → {s.end_year}-{String(s.end_month).padStart(2, '0')})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Månader med utfall hämtas alltid automatiskt från Fortnox.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
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
