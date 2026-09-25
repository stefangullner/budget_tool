import { useState, useEffect, useMemo } from 'react'
import { LayoutList, Table2, Clock, AlertTriangle, Rows3, Users } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
import { useBudget } from '@/hooks/useBudget'
import { useAccountBudget } from '@/hooks/useAccountBudget'
import { useRoleSectionPermissions } from '@/hooks/useRoleSectionPermissions'
import { useSectionOrder, sortSections } from '@/hooks/useSectionOrder'
import { useStaffAccounts, useStaffVisibility } from '@/hooks/useStaffAccounts'
import { useRole } from '@/hooks/useRole'

import BudgetMatrix from '@/components/BudgetMatrix'
import BudgetOverview from '@/components/BudgetOverview'
import AccountMatrix from '@/components/AccountMatrix'
import StaffBudget from '@/components/StaffBudget'

import { cn } from '@/lib/utils'
import type { Company } from '@/types'

export default function BudgetPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null)
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<number | null>(null)

  const [view, setView] = useState<'matrix' | 'overview' | 'account' | 'staff'>('matrix')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [userId, setUserId] = useState<string>('')

  const sectionPerms = useRoleSectionPermissions()
  const sectionOrderMap = useSectionOrder()

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
    actualOnlyAccounts,
    entries,
    entryMeta,
    userNames,
    icEntries,
    actuals,
    prevActuals,
    locks,
    saving,
    icSaving,
    loading,
    saveError,
    clearSaveError,
    upsertEntry,
    upsertICEntry,
    toggleLock,
    reloadEntries,
  } = useBudget(selectedCompanyId, selectedScenarioId, selectedCostCenterId)

  // The staff view rewrites the staff accounts in the database; coming back to the
  // matrix must show the recalculated amounts, not the ones loaded before.
  const [lastView, setLastView] = useState(view)
  useEffect(() => {
    if (lastView === 'staff' && view !== 'staff') reloadEntries()
    setLastView(view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

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
  const staffAccountIds = useStaffAccounts(selectedScenarioId)
  const staffVisibility = useStaffVisibility(selectedScenarioId)
  const { role } = useRole()
  // While rolling out, only admins and company managers get the staff tab
  const showStaffTab =
    staffVisibility === 'everyone' ||
    ((staffVisibility === 'company_managers' || staffVisibility === null) &&
      (role === 'admin' || role === 'company_manager'))

  useEffect(() => {
    if (view === 'staff' && !showStaffTab) setView('matrix')
  }, [view, showStaffTab])

  /**
   * Accounts the per-account view can show. Intercompany accounts are left out —
   * their amounts live on counterpart sub-rows and get their own view.
   */
  const accountOptions = useMemo(() => {
    const plain = accounts.filter((a) => a.config?.is_intercompany !== true)
    const bySection = new Map<string, typeof plain>()
    for (const a of plain) {
      const section = a.config?.section ?? '— Ingen sektion'
      if (!sectionPerms || sectionPerms.canView(section)) {
        const list = bySection.get(section)
        if (list) list.push(a)
        else bySection.set(section, [a])
      }
    }
    const named = sortSections(
      [...bySection.keys()].filter((s) => s !== '— Ingen sektion'),
      sectionOrderMap,
    )
    if (bySection.has('— Ingen sektion')) named.push('— Ingen sektion')
    return named.map((section) => ({ section, accounts: bySection.get(section) ?? [] }))
  }, [accounts, sectionPerms, sectionOrderMap])

  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ?? null

  useEffect(() => {
    setSelectedAccountId(null)
  }, [selectedCompanyId])

  useEffect(() => {
    if (!selectedAccountId) {
      const first = accountOptions[0]?.accounts[0]
      if (first) setSelectedAccountId(first.id)
    }
  }, [accountOptions, selectedAccountId])

  const accountBudget = useAccountBudget(
    selectedCompanyId,
    selectedScenarioId,
    view === 'account' ? selectedAccountId : null,
    selectedScenario,
  )

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
          <HelpButton section={view === 'account' ? 'budget-account' : 'budget'} />
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
          <button
            onClick={() => setView('account')}
            title="Ett konto i taget, fördelat över kostnadsställen"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'account' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Rows3 size={13} />
            Per konto
          </button>
          {showStaffTab && <button
            onClick={() => setView('staff')}
            title="Personalbudget per kostnadsställe"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
              view === 'staff' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            <Users size={13} />
            Personal
          </button>}
        </div>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        {/* Company selector */}
        <div className="flex-1 max-w-xs">
          <label className="block text-xs font-medium text-gray-500 mb-1">Bolag</label>
          <select
            value={selectedCompanyId ?? ''}
            onChange={(e) => setSelectedCompanyId(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {companies.length === 0 && <option value="">Inga bolag</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

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

        {/* KS selector — replaced by the account selector in the per-account view */}
        {view === 'account' ? (
          <div className="flex-1 max-w-md">
            <label className="block text-xs font-medium text-gray-500 mb-1">Konto</label>
            <select
              value={selectedAccountId ?? ''}
              onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {accountOptions.length === 0 && <option value="">Inga budgeterbara konton</option>}
              {accountOptions.map(({ section, accounts: group }) => (
                <optgroup key={section} label={section}>
                  {group.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} — {a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        ) : (
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
        )}
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

      {/* Per account — one account across every cost center */}
      {view === 'account' && (!selectedScenario || !selectedAccount ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {scenarios.length === 0
            ? 'Skapa ett scenario för att börja budgetera.'
            : accountOptions.length === 0
              ? 'Inga budgeterbara konton du får se.'
              : 'Välj ett scenario och ett konto.'}
        </div>
      ) : accountBudget.loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : (
        <AccountMatrix
          scenario={selectedScenario}
          account={selectedAccount}
          costCenters={costCenters}
          locks={locks}
          entries={accountBudget.entries}
          actuals={accountBudget.actuals}
          prevActuals={accountBudget.prevActuals}
          saving={accountBudget.saving}
          canEdit={
            !staffAccountIds.has(selectedAccount.id) &&
            (sectionPerms
              ? sectionPerms.canEdit(selectedAccount.config?.section ?? '— Ingen sektion')
              : true)
          }
          onCellChange={(costCenterId, year, month, amount) =>
            accountBudget.upsertCell(costCenterId, year, month, amount, userId)
          }
          onAllocate={(cells) => accountBudget.writeCells(cells, userId)}
          saveError={accountBudget.saveError}
          onDismissSaveError={accountBudget.clearSaveError}
        />
      ))}

      {/* Staff budget — people per cost center, calculated into the staff accounts */}
      {view === 'staff' && showStaffTab && (!selectedScenario || !selectedCostCenterId ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {scenarios.length === 0
            ? 'Skapa ett scenario för att börja budgetera.'
            : 'Välj ett scenario och ett kostnadsställe.'}
        </div>
      ) : (
        <StaffBudget
          scenario={selectedScenario}
          costCenterId={selectedCostCenterId}
          costCenters={costCenters}
          isLocked={locks.some((l) => l.cost_center_id === selectedCostCenterId)}
          prevActuals={prevActuals}
          staffAccountIds={staffAccountIds}
        />
      ))}

      {/* Matrix */}
      {view === 'matrix' && (!selectedScenario || !selectedCostCenterId ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {scenarios.length === 0
            ? 'Skapa ett scenario för att börja budgetera.'
            : 'Välj ett scenario och ett kostnadsställe.'}
        </div>
      ) : accounts.length === 0 && actualOnlyAccounts.length === 0 ? (
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
          actualOnlyAccounts={actualOnlyAccounts}
          sectionPerms={sectionPerms}
          staffAccountIds={staffAccountIds}
          entries={entries}
          entryMeta={entryMeta}
          userNames={userNames}
          icEntries={icEntries}
          actuals={actuals}
          prevActuals={prevActuals}
          locks={locks}
          saving={saving}
          icSaving={icSaving}
          costCenterId={selectedCostCenterId}
          companyId={selectedCompanyId!}
          companies={companies}
          userId={userId}
          onCellChange={(accountId, year, month, amount) =>
            upsertEntry(accountId, year, month, amount, userId)
          }
          onICCellChange={(accountId, counterpartId, year, month, amount) =>
            upsertICEntry(accountId, counterpartId, year, month, amount, userId)
          }
          onToggleLock={() => toggleLock(selectedCostCenterId, userId)}
          saveError={saveError}
          onDismissSaveError={clearSaveError}
        />
      ))}

    </div>
  )
}
