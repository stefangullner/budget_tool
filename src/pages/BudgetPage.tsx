import { useState, useEffect } from 'react'
import { LayoutList, Table2, Clock, AlertTriangle } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
import { useBudget } from '@/hooks/useBudget'

import BudgetMatrix from '@/components/BudgetMatrix'
import BudgetOverview from '@/components/BudgetOverview'

import { cn } from '@/lib/utils'
import type { Company } from '@/types'

export default function BudgetPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null)
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<number | null>(null)

  const [view, setView] = useState<'matrix' | 'overview'>('matrix')

  const [userId, setUserId] = useState<string>('')

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      if (data) {
        setCompanies(data as Company[])
        setSelectedCompanyId(data[0]?.id ?? null)
      }
    })
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  const {
    scenarios,
    costCenters,
    accounts,
    entries,
    actuals,
    prevActuals,
    locks,
    saving,
    loading,
    upsertEntry,
    toggleLock,
  } = useBudget(selectedCompanyId, selectedScenarioId, selectedCostCenterId)

  // Auto-select first scenario and first KS when company changes
  useEffect(() => {
    setSelectedScenarioId(null)
    setSelectedCostCenterId(null)
  }, [selectedCompanyId])

  useEffect(() => {
    if (scenarios.length > 0 && !selectedScenarioId) {
      setSelectedScenarioId(scenarios[0].id)
    }
  }, [scenarios, selectedScenarioId])

  useEffect(() => {
    if (costCenters.length > 0 && !selectedCostCenterId) {
      setSelectedCostCenterId(costCenters[0].id)
    }
  }, [costCenters, selectedCostCenterId])

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId) ?? null

  function formatScenarioPeriod(s: typeof scenarios[0]) {
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
    const start = `${months[s.start_month - 1]} ${s.start_year}`
    const end = `${months[s.end_month - 1]} ${s.end_year}`
    return `${start} – ${end}`
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Budget</h1>
          <p className="text-sm text-gray-500 mt-0.5">Mata in budget per konto och kostnadsställe</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton section="budget" />
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView('matrix')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'matrix' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Table2 size={13} />
            Matris
          </button>
          <button
            onClick={() => setView('overview')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'overview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <LayoutList size={13} />
            Översikt
          </button>
        </div>
        </div>
      </div>

      {/* Company tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200">
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

      <div className="flex gap-4 mb-6">
        {/* Scenario selector */}
        <div className="flex-1 max-w-sm">
          <label className="block text-xs font-medium text-gray-500 mb-1">Scenario</label>
          <div className="flex gap-2">
            <select
              value={selectedScenarioId ?? ''}
              onChange={(e) => setSelectedScenarioId(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {scenarios.length === 0 && <option value="">Inga scenarion</option>}
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatScenarioPeriod(s)}
                  {s.is_approved ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* KS selector */}
        <div className="flex-1 max-w-xs">
          <label className="block text-xs font-medium text-gray-500 mb-1">Kostnadsställe</label>
          <select
            value={selectedCostCenterId ?? ''}
            onChange={(e) => setSelectedCostCenterId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {costCenters.length === 0 && <option value="">Inga kostnadsställen</option>}
            {costCenters.map((ks) => (
              <option key={ks.id} value={ks.id}>
                {ks.code} — {ks.name}
                {locks.some((l) => l.cost_center_id === ks.id) ? ' 🔒' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Deadline banner */}
      {selectedScenario?.deadline_date && (() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const deadline = new Date(selectedScenario.deadline_date)
        const days = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        if (days > 14) return null
        const isPast = days < 0
        const isToday = days === 0
        return (
          <div className={cn(
            'flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm mb-5',
            isPast ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200',
          )}>
            {isPast ? <AlertTriangle size={15} className="shrink-0" /> : <Clock size={15} className="shrink-0" />}
            <span>
              <span className="font-medium">
                {isPast
                  ? `Deadline passerad för ${Math.abs(days)} dagar sedan`
                  : isToday
                  ? 'Deadline är idag!'
                  : `${days} ${days === 1 ? 'dag' : 'dagar'} kvar till deadline`}
              </span>
              {' — '}{selectedScenario.name}
            </span>
          </div>
        )
      })()}

      {/* Overview */}
      {view === 'overview' && (
        !selectedScenario ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            Välj ett scenario för att se översikten.
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            Inga budgeterbara konton konfigurerade.
          </div>
        ) : (
          <BudgetOverview
            scenario={selectedScenario}
            accounts={accounts}
            costCenters={costCenters}
            locks={locks}
            onSelectKS={(id) => {
              setSelectedCostCenterId(id)
              setView('matrix')
            }}
          />
        )
      )}

      {/* Matrix */}
      {view === 'matrix' && (!selectedScenario || !selectedCostCenterId ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {scenarios.length === 0
            ? 'Skapa ett scenario för att börja budgetera.'
            : 'Välj ett scenario och ett kostnadsställe.'}
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          Inga budgeterbara konton konfigurerade.{' '}
          <a href="/accounts" className="text-brand-600 underline">Gå till Kontokonfiguration</a>.
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : (
        <BudgetMatrix
          scenario={selectedScenario}
          accounts={accounts}
          entries={entries}
          actuals={actuals}
          prevActuals={prevActuals}
          locks={locks}
          saving={saving}
          costCenterId={selectedCostCenterId}
          companyId={selectedCompanyId!}
          userId={userId}
          onCellChange={(accountId, year, month, amount) =>
            upsertEntry(accountId, year, month, amount, userId)
          }
          onToggleLock={() => toggleLock(selectedCostCenterId, userId)}
        />
      ))}

    </div>
  )
}
