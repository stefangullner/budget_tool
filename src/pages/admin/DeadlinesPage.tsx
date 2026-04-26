import { useEffect, useState } from 'react'
import { Calendar, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company, Scenario } from '@/types'

export default function DeadlinesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [saving, setSaving] = useState<Set<number>>(new Set())

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      if (data) {
        setCompanies(data as Company[])
        setSelectedCompanyId(data[0]?.id ?? null)
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedCompanyId) return
    supabase
      .from('scenarios')
      .select('*')
      .eq('company_id', selectedCompanyId)
      .order('start_year', { ascending: false })
      .then(({ data }) => setScenarios((data ?? []) as Scenario[]))
  }, [selectedCompanyId])

  async function setDeadline(scenarioId: number, date: string | null) {
    setSaving((prev) => new Set(prev).add(scenarioId))
    await supabase.from('scenarios').update({ deadline_date: date }).eq('id', scenarioId)
    setScenarios((prev) =>
      prev.map((s) => (s.id === scenarioId ? { ...s, deadline_date: date } : s)),
    )
    setSaving((prev) => { const next = new Set(prev); next.delete(scenarioId); return next })
  }

  function daysLeft(dateStr: string): number {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const deadline = new Date(dateStr)
    return Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }

  function deadlineLabel(dateStr: string | null) {
    if (!dateStr) return null
    const d = daysLeft(dateStr)
    if (d < 0) return { text: `Passerad för ${Math.abs(d)} dagar sedan`, color: 'text-red-600' }
    if (d === 0) return { text: 'Deadline är idag', color: 'text-red-600' }
    if (d <= 7) return { text: `${d} dagar kvar`, color: 'text-amber-600' }
    return { text: `${d} dagar kvar`, color: 'text-gray-500' }
  }

  const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  function scenarioPeriod(s: Scenario) {
    return `${months[s.start_month - 1]} ${s.start_year} – ${months[s.end_month - 1]} ${s.end_year}`
  }

  return (
    <div className="p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Deadlines</h2>
      <p className="text-sm text-gray-500 mb-6">Sätt deadline per scenario — visas som varningsbanner för budgetansvariga</p>

      {/* Company tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCompanyId(c.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              selectedCompanyId === c.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500">Scenario</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Period</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-48">Deadline</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s, i) => {
              const label = deadlineLabel(s.deadline_date)
              const isSaving = saving.has(s.id)
              return (
                <tr key={s.id} className={cn('border-t border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {s.name}
                    {s.is_approved && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                        <Check size={9} /> Godkänt
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{scenarioPeriod(s)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={s.deadline_date ?? ''}
                        onChange={(e) => setDeadline(s.id, e.target.value || null)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 text-gray-700"
                      />
                      {s.deadline_date && (
                        <button
                          onClick={() => setDeadline(s.id, null)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          title="Ta bort deadline"
                        >
                          ×
                        </button>
                      )}
                      {isSaving && <span className="text-xs text-gray-400">Sparar…</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {label && (
                      <div className={cn('flex items-center gap-1.5 text-xs font-medium', label.color)}>
                        <Calendar size={12} />
                        {label.text}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {scenarios.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                  Inga scenarion för detta bolag.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
