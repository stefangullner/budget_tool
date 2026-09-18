import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Link2, Plus, Trash2, X } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useIntercompanyLinks } from '@/hooks/useIntercompanyLinks'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/hooks/useBudget'
import type { Company } from '@/types'

const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

export default function IntercompanyLinksPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [sellerCompanyId, setSellerCompanyId] = useState<number | null>(null)
  const [sellerAccounts, setSellerAccounts] = useState<AccountRow[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [userId, setUserId] = useState('')
  const [addingFor, setAddingFor] = useState<AccountRow | null>(null)

  const { links, accounts: linkedAccounts, loading, error, clearError, addLink, removeLink } =
    useIntercompanyLinks()

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      const rows = (data ?? []) as Company[]
      setCompanies(rows)
      setSellerCompanyId((prev) => prev ?? rows[0]?.id ?? null)
    })
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
  }, [])

  // Intercompany-flagged accounts in the selling company
  useEffect(() => {
    setSellerAccounts([])
    if (!sellerCompanyId) return
    setLoadingAccounts(true)
    fetchAllRows<AccountRow>((from, to) =>
      supabase
        .from('accounts')
        .select('*, config:account_configs(*)')
        .eq('company_id', sellerCompanyId)
        .order('account_number')
        .range(from, to),
    ).then((rows) => {
      setSellerAccounts(rows.filter((a) => a.config?.is_intercompany === true))
      setLoadingAccounts(false)
    })
  }, [sellerCompanyId])

  function companyName(id: number) {
    return companies.find((c) => c.id === id)?.name ?? `Bolag ${id}`
  }

  /** Links per revenue account, grouped by the counterpart company they point at. */
  const linksByRevenue = useMemo(() => {
    const map = new Map<number, { counterpart: number; costAccountId: number; linkId: number }[]>()
    for (const link of links) {
      const cost = linkedAccounts.get(link.cost_account_id)
      if (!cost) continue
      const list = map.get(link.revenue_account_id)
      const entry = { counterpart: cost.company_id, costAccountId: link.cost_account_id, linkId: link.id }
      if (list) list.push(entry)
      else map.set(link.revenue_account_id, [entry])
    }
    return map
  }, [links, linkedAccounts])

  const unlinked = sellerAccounts.filter((a) => !linksByRevenue.has(a.id))

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Internhandel</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Kopplar säljarens intäktskonto till köparens kostnadskonto, så att avstämningen vet vilka
            belopp som ska ta ut varandra
          </p>
        </div>
        <HelpButton section="admin-intercompany" />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 mb-5 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="shrink-0 text-red-400 hover:text-red-700">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <label className="text-xs font-medium text-gray-500 block mb-1.5">Säljande bolag</label>
        <select
          value={sellerCompanyId ?? ''}
          onChange={(e) => setSellerCompanyId(Number(e.target.value))}
          className={cn(SELECT_CLASS, 'max-w-sm')}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-gray-500">
          Visar bolagets konton som är markerade som intercompany under <strong>Konton</strong>.
          {sellerAccounts.length > 0 && (
            <> {sellerAccounts.length - unlinked.length} av {sellerAccounts.length} har minst en koppling.</>
          )}
        </p>
      </div>

      {loading || loadingAccounts ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : sellerAccounts.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          Inga intercompany-konton i bolaget. Markera konton som IC under{' '}
          <a href="/accounts" className="text-brand-600 underline">Kontokonfiguration</a>.
        </div>
      ) : (
        <div className="space-y-3">
          {sellerAccounts.map((account) => {
            const rows = linksByRevenue.get(account.id) ?? []
            const byCounterpart = new Map<number, typeof rows>()
            for (const r of rows) {
              const list = byCounterpart.get(r.counterpart)
              if (list) list.push(r)
              else byCounterpart.set(r.counterpart, [r])
            }
            const missing = companies.filter(
              (c) => c.id !== sellerCompanyId && !byCounterpart.has(c.id),
            )

            return (
              <div
                key={account.id}
                className={cn(
                  'border rounded-lg overflow-hidden',
                  rows.length === 0 ? 'border-amber-200' : 'border-gray-200',
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-3 px-4 py-3',
                    rows.length === 0 ? 'bg-amber-50' : 'bg-gray-50',
                  )}
                >
                  <span className="font-mono text-sm text-gray-500">{account.account_number}</span>
                  <span className="font-medium text-sm text-gray-900">{account.name}</span>
                  {rows.length === 0 && (
                    <span className="text-xs text-amber-700 font-medium">Ingen koppling</span>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={() => setAddingFor(account)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      <Plus size={13} />
                      Koppla konto
                    </button>
                  </div>
                </div>

                {rows.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {[...byCounterpart.entries()].map(([counterpartId, items]) => (
                      <div key={counterpartId} className="px-4 py-2.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <ArrowRight size={12} className="text-brand-500" />
                          <span className="text-xs font-medium text-brand-700">
                            {companyName(counterpartId)}
                          </span>
                          {items.length > 1 && (
                            <span className="text-xs text-gray-400">
                              {items.length} konton — köparens sida är summan
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 pl-5">
                          {items.map((item) => {
                            const cost = linkedAccounts.get(item.costAccountId)
                            return (
                              <div key={item.linkId} className="flex items-center gap-2 group">
                                <Link2 size={11} className="text-gray-300 shrink-0" />
                                <span className="font-mono text-xs text-gray-400">
                                  {cost?.account_number ?? '?'}
                                </span>
                                <span className="text-xs text-gray-700 flex-1 truncate">
                                  {cost?.name ?? 'Okänt konto'}
                                </span>
                                <button
                                  onClick={() => removeLink(item.linkId)}
                                  title="Ta bort kopplingen"
                                  className="invisible group-hover:visible p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {rows.length > 0 && missing.length > 0 && (
                  <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100 bg-gray-50/60">
                    Ingen koppling mot {missing.map((c) => c.name).join(', ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {addingFor && sellerCompanyId && (
        <AddLinkDialog
          revenueAccount={addingFor}
          companies={companies.filter((c) => c.id !== sellerCompanyId)}
          onAdd={async (costAccountId) => {
            const ok = await addLink(addingFor.id, costAccountId, userId)
            if (ok) setAddingFor(null)
          }}
          onClose={() => setAddingFor(null)}
        />
      )}
    </div>
  )
}

interface AddProps {
  revenueAccount: AccountRow
  companies: Company[]
  onAdd: (costAccountId: number) => Promise<void>
  onClose: () => void
}

function AddLinkDialog({ revenueAccount, companies, onAdd, onClose }: AddProps) {
  const [companyId, setCompanyId] = useState<number | null>(companies[0]?.id ?? null)
  const [options, setOptions] = useState<AccountRow[]>([])
  const [showAll, setShowAll] = useState(false)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setOptions([])
    setAccountId(null)
    if (!companyId) return
    setLoading(true)
    fetchAllRows<AccountRow>((from, to) =>
      supabase
        .from('accounts')
        .select('*, config:account_configs(*)')
        .eq('company_id', companyId)
        .order('account_number')
        .range(from, to),
    ).then((rows) => {
      setOptions(rows)
      setLoading(false)
    })
  }, [companyId])

  // IC-flagged accounts first: the counterpart's account is normally flagged too
  const visible = showAll ? options : options.filter((a) => a.config?.is_intercompany === true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Koppla kostnadskonto</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="font-mono">{revenueAccount.account_number}</span> {revenueAccount.name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Köpande bolag</label>
            <select
              value={companyId ?? ''}
              onChange={(e) => setCompanyId(Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Kostnadskonto</label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={() => setShowAll((v) => !v)}
                  className="accent-brand-600"
                />
                Visa alla konton
              </label>
            </div>
            <select
              value={accountId ?? ''}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
              disabled={loading || visible.length === 0}
              className={SELECT_CLASS}
            >
              <option value="">
                {loading
                  ? 'Läser in konton…'
                  : visible.length === 0
                    ? 'Inga IC-markerade konton i bolaget'
                    : 'Välj konto'}
              </option>
              {visible.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_number} — {a.name}
                </option>
              ))}
            </select>
            {!showAll && !loading && visible.length === 0 && (
              <p className="mt-1.5 text-xs text-gray-500">
                Markera motpartens konto som intercompany under Konton, eller kryssa i
                <em> Visa alla konton</em>.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
          >
            Avbryt
          </button>
          <button
            onClick={async () => {
              if (!accountId) return
              setSaving(true)
              await onAdd(accountId)
              setSaving(false)
            }}
            disabled={!accountId || saving}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Sparar…' : 'Koppla'}
          </button>
        </div>
      </div>
    </div>
  )
}
