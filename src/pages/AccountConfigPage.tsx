import { useEffect, useState, useCallback, Fragment } from 'react'
import { Check, X, Clock, ArrowLeftRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company, Account, AccountConfig } from '@/types'

type AccountRow = Account & { config: AccountConfig | null }

const ACCOUNT_TYPE_LABELS = {
  income: 'Intäkt',
  expense: 'Kostnad',
  balance: 'Balans',
}

const SECTIONS = ['Intäkter', 'Personal', 'Lokaler', 'Marknadsföring', 'Administration', 'Övrigt']

export default function AccountConfigPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterBudgetable, setFilterBudgetable] = useState<string>('all')

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      if (data) {
        setCompanies(data)
        setSelectedCompanyId(data[0]?.id ?? null)
      }
    })
    supabase
      .from('sync_log')
      .select('synced_at')
      .eq('sync_type', 'accounts')
      .eq('status', 'success')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setLastSynced(data.synced_at)
      })
  }, [])

  const loadAccounts = useCallback(async (companyId: number) => {
    setLoading(true)
    const { data } = await supabase
      .from('accounts')
      .select('*, config:account_configs(*)')
      .eq('company_id', companyId)
      .order('account_number')
    setAccounts((data ?? []) as AccountRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedCompanyId) loadAccounts(selectedCompanyId)
  }, [selectedCompanyId, loadAccounts])

  async function toggleBudgetable(account: AccountRow) {
    const config = account.config
    const newVal = !(config?.is_budgetable ?? false)

    if (config) {
      await supabase
        .from('account_configs')
        .update({ is_budgetable: newVal })
        .eq('account_id', account.id)
    } else {
      await supabase.from('account_configs').insert({
        account_id: account.id,
        is_budgetable: newVal,
        is_calculated: false,
        display_order: 0,
      })
    }

    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id
          ? { ...a, config: { ...(a.config ?? { id: 0, account_id: a.id, is_calculated: false, formula: null, display_order: 0, section: null, notes: null }), is_budgetable: newVal } }
          : a,
      ),
    )
  }

  async function toggleIntercompany(account: AccountRow) {
    const config = account.config
    const newVal = !(config?.is_intercompany ?? false)
    if (config) {
      await supabase.from('account_configs').update({ is_intercompany: newVal }).eq('account_id', account.id)
    } else {
      await supabase.from('account_configs').insert({ account_id: account.id, is_budgetable: false, is_calculated: false, display_order: 0, is_intercompany: newVal })
    }
    setAccounts(prev =>
      prev.map(a =>
        a.id === account.id
          ? { ...a, config: { ...(a.config ?? { id: 0, account_id: a.id, is_budgetable: false, is_calculated: false, formula: null, display_order: 0, section: null, notes: null }), is_intercompany: newVal } }
          : a
      )
    )
  }

  async function handleBulkToggleSection(section: string | null, value: boolean) {
    const affectedAccounts = accounts.filter(a => (a.config?.section ?? null) === section)
    const affectedIds = affectedAccounts.map(a => a.id)
    if (affectedIds.length === 0) return

    const upserts = affectedIds.map(id => ({
      account_id: id,
      is_budgetable: value,
      section,
      is_calculated: false,
      display_order: 0,
    }))
    await supabase.from('account_configs').upsert(upserts, { onConflict: 'account_id' })

    setAccounts(prev =>
      prev.map(a =>
        affectedIds.includes(a.id)
          ? { ...a, config: { ...(a.config ?? { id: 0, account_id: a.id, is_calculated: false, formula: null, display_order: 0, notes: null }), is_budgetable: value, section } }
          : a
      )
    )
  }

  async function updateSection(account: AccountRow, section: string) {
    const config = account.config
    if (config) {
      await supabase
        .from('account_configs')
        .update({ section: section || null })
        .eq('account_id', account.id)
    } else {
      await supabase.from('account_configs').insert({
        account_id: account.id,
        is_budgetable: false,
        is_calculated: false,
        display_order: 0,
        section: section || null,
      })
    }
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id
          ? { ...a, config: { ...(a.config ?? { id: 0, account_id: a.id, is_budgetable: false, is_calculated: false, formula: null, display_order: 0, section: null, notes: null }), section: section || null } }
          : a,
      ),
    )
  }

  const filtered = accounts.filter((a) => {
    if (filterType !== 'all' && a.account_type !== filterType) return false
    if (filterBudgetable === 'yes' && !a.config?.is_budgetable) return false
    if (filterBudgetable === 'no' && a.config?.is_budgetable) return false
    if (search && !a.account_number.includes(search) && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const budgetableCount = accounts.filter((a) => a.config?.is_budgetable).length

  const SECTION_KEYS = [...SECTIONS, null] as (string | null)[]
  const groupedSections = SECTION_KEYS
    .map(s => ({ section: s, rows: filtered.filter(a => (a.config?.section ?? null) === s) }))
    .filter(g => g.rows.length > 0)

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kontokonfiguration</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Välj vilka konton som ska budgeteras per bolag
          </p>
        </div>
        {lastSynced && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Clock size={12} />
            Senast synkad {new Date(lastSynced).toLocaleString('sv-SE')}
          </div>
        )}
      </div>

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

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Sök konto..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Alla typer</option>
          <option value="income">Intäkter</option>
          <option value="expense">Kostnader</option>
          <option value="balance">Balans</option>
        </select>
        <select
          value={filterBudgetable}
          onChange={(e) => setFilterBudgetable(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Alla konton</option>
          <option value="yes">Budgetera</option>
          <option value="no">Ej budgetera</option>
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {budgetableCount} av {accounts.length} konton budgeteras
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Inga konton — tryck "Synkronisera från Fortnox" för att hämta konton.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-24">Nummer</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Namn</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-24">Typ</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-44">Sektion</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 w-28">Budgetera</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 w-16" title="Intercompany">IC</th>
              </tr>
            </thead>
            <tbody>
              {groupedSections.map(({ section, rows }) => (
                <Fragment key={`section-${section ?? 'none'}`}>
                  <tr className="bg-gray-50 border-y border-gray-200">
                    <td colSpan={5} className="px-4 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {section ?? '— Ingen sektion'} ({rows.length})
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleBulkToggleSection(section, true)}
                            className="px-2 py-0.5 text-xs rounded border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors"
                          >
                            Aktivera alla
                          </button>
                          <button
                            onClick={() => handleBulkToggleSection(section, false)}
                            className="px-2 py-0.5 text-xs rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                          >
                            Inaktivera alla
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {rows.map((account) => (
                    <tr key={account.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100">
                      <td className="px-4 py-2.5 font-mono text-gray-700">{account.account_number}</td>
                      <td className="px-4 py-2.5 text-gray-900">{account.name}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          'inline-flex px-2 py-0.5 rounded text-xs font-medium',
                          account.account_type === 'income' && 'bg-green-50 text-green-700',
                          account.account_type === 'expense' && 'bg-red-50 text-red-700',
                          account.account_type === 'balance' && 'bg-gray-100 text-gray-600',
                        )}>
                          {ACCOUNT_TYPE_LABELS[account.account_type]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={account.config?.section ?? ''}
                          onChange={(e) => updateSection(account, e.target.value)}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                        >
                          <option value="">—</option>
                          {SECTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleBudgetable(account)}
                          className={cn(
                            'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                            account.config?.is_budgetable
                              ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
                          )}
                        >
                          {account.config?.is_budgetable ? <Check size={14} /> : <X size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleIntercompany(account)}
                          title={account.config?.is_intercompany ? 'Intercompany' : 'Markera som intercompany'}
                          className={cn(
                            'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                            account.config?.is_intercompany
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
                          )}
                        >
                          <ArrowLeftRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
