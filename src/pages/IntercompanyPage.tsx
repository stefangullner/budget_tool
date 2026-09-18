import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useIntercompanyLinks } from '@/hooks/useIntercompanyLinks'
import { useRole } from '@/hooks/useRole'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

type ScenarioRow = {
  id: number
  name: string
  company_id: number
  start_year: number
  start_month: number
  end_year: number
  end_month: number
}

type EntryRow = {
  account_id: number
  year: number
  month: number
  amount: number
  counterpart_company_id: number | null
}

type ICAccount = {
  id: number
  account_number: string
  name: string
  company_id: number
}

type Period = { year: number; month: number }

function pKey(year: number, month: number) { return `${year}-${month}` }

function fmt(n: number) {
  if (n === 0) return '—'
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

interface CounterpartLine {
  companyId: number
  costAccounts: ICAccount[]
  seller: Map<string, number>
  buyer: Map<string, number>
  sellerTotal: number
  buyerTotal: number
  netTotal: number
  balanced: boolean
  /** Both sides pointing the same way means the sign convention is not what we assume. */
  sameSign: boolean
}

interface AccountLine {
  accountId: number
  accountNumber: string
  accountName: string
  sellerCompanyId: number
  counterparts: CounterpartLine[]
  balanced: boolean
}

export default function IntercompanyPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [icAccounts, setIcAccounts] = useState<ICAccount[]>([])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const { links, accounts: linkedAccounts, loading: loadingLinks } = useIntercompanyLinks()
  const { isAdmin } = useRole()

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      setCompanies((data ?? []) as Company[])
    })
    supabase
      .from('scenarios')
      .select('id, name, company_id, start_year, start_month, end_year, end_month')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as ScenarioRow[]
        setScenarios(rows)
        const names = [...new Set(rows.map((s) => s.name))].sort()
        if (names.length > 0) setSelectedName((prev) => prev || names[0])
      })

    // Every IC-flagged account, so accounts without a link can be called out
    fetchAllRows<{ account_id: number; accounts: ICAccount | null }>((from, to) =>
      supabase
        .from('account_configs')
        .select('account_id, accounts(id, account_number, name, company_id)')
        .eq('is_intercompany', true)
        .order('account_id')
        .range(from, to),
    ).then((rows) => {
      setIcAccounts(rows.map((r) => r.accounts).filter((a): a is ICAccount => a !== null))
    })
  }, [])

  const scenarioNames = useMemo(
    () => [...new Set(scenarios.map((s) => s.name))].sort(),
    [scenarios],
  )

  const matching = useMemo(
    () => scenarios.filter((s) => s.name === selectedName),
    [scenarios, selectedName],
  )

  /** Scenario id per company, for the name in play. */
  const scenarioByCompany = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of matching) map.set(s.company_id, s.id)
    return map
  }, [matching])

  const periods: Period[] = useMemo(() => {
    const set = new Map<string, Period>()
    for (const s of matching) {
      let y = s.start_year
      let m = s.start_month
      while (y < s.end_year || (y === s.end_year && m <= s.end_month)) {
        set.set(pKey(y, m), { year: y, month: m })
        m++
        if (m > 12) { m = 1; y++ }
      }
    }
    return [...set.values()].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))
  }, [matching])

  /** Account ids the reconciliation touches — both sides of every link. */
  const involvedIds = useMemo(
    () => [...new Set(links.flatMap((l) => [l.revenue_account_id, l.cost_account_id]))],
    [links],
  )

  useEffect(() => {
    if (matching.length === 0 || involvedIds.length === 0) {
      setEntries([])
      return
    }
    let cancelled = false
    setLoading(true)
    const scenarioIds = matching.map((s) => s.id)

    fetchAllRows<EntryRow>((from, to) =>
      supabase
        .from('budget_entries')
        .select('account_id, year, month, amount, counterpart_company_id')
        .in('scenario_id', scenarioIds)
        .in('account_id', involvedIds)
        .order('account_id')
        .order('year')
        .order('month')
        .range(from, to),
    ).then((rows) => {
      if (cancelled) return
      setEntries(rows)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [matching, involvedIds])

  /**
   * One line per revenue account, one sub-line per counterpart company.
   *
   * The seller's amount sits on its own account with the buyer as counterpart;
   * the buyer's sits on the linked cost account(s) with the seller as counterpart.
   * Matching on account_number — what this page did before — only ever worked
   * when both companies happened to use identical charts of accounts.
   */
  const lines: AccountLine[] = useMemo(() => {
    const byAccount = new Map<string, number>()
    for (const e of entries) {
      const k = `${e.account_id}:${pKey(e.year, e.month)}:${e.counterpart_company_id ?? 0}`
      byAccount.set(k, (byAccount.get(k) ?? 0) + e.amount)
    }
    const amountOf = (accountId: number, p: Period, counterpart: number) =>
      byAccount.get(`${accountId}:${pKey(p.year, p.month)}:${counterpart}`) ?? 0

    // revenue account -> cost accounts
    const costByRevenue = new Map<number, ICAccount[]>()
    for (const link of links) {
      const cost = linkedAccounts.get(link.cost_account_id)
      if (!cost) continue
      const list = costByRevenue.get(link.revenue_account_id)
      if (list) list.push(cost)
      else costByRevenue.set(link.revenue_account_id, [cost])
    }

    const out: AccountLine[] = []
    for (const [revenueId, costs] of costByRevenue) {
      const revenue = linkedAccounts.get(revenueId)
      if (!revenue) continue

      const byCounterpart = new Map<number, ICAccount[]>()
      for (const c of costs) {
        const list = byCounterpart.get(c.company_id)
        if (list) list.push(c)
        else byCounterpart.set(c.company_id, [c])
      }

      const counterparts: CounterpartLine[] = []
      for (const [companyId, costAccounts] of byCounterpart) {
        const seller = new Map<string, number>()
        const buyer = new Map<string, number>()
        let sellerTotal = 0
        let buyerTotal = 0

        for (const p of periods) {
          const s = amountOf(revenueId, p, companyId)
          const b = costAccounts.reduce(
            (sum, c) => sum + amountOf(c.id, p, revenue.company_id),
            0,
          )
          seller.set(pKey(p.year, p.month), s)
          buyer.set(pKey(p.year, p.month), b)
          sellerTotal += s
          buyerTotal += b
        }

        const netTotal = sellerTotal + buyerTotal
        counterparts.push({
          companyId,
          costAccounts,
          seller,
          buyer,
          sellerTotal,
          buyerTotal,
          netTotal,
          balanced: Math.abs(netTotal) < 0.01,
          sameSign:
            sellerTotal !== 0 && buyerTotal !== 0 && Math.sign(sellerTotal) === Math.sign(buyerTotal),
        })
      }

      counterparts.sort((a, b) => a.companyId - b.companyId)
      out.push({
        accountId: revenueId,
        accountNumber: revenue.account_number,
        accountName: revenue.name,
        sellerCompanyId: revenue.company_id,
        counterparts,
        balanced: counterparts.every((c) => c.balanced),
      })
    }

    return out.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, 'sv'))
  }, [entries, links, linkedAccounts, periods])

  // Auto-expand what needs attention
  useEffect(() => {
    setExpanded(new Set(lines.filter((l) => !l.balanced).map((l) => l.accountId)))
  }, [lines])

  const linkedRevenueIds = useMemo(
    () => new Set(links.map((l) => l.revenue_account_id)),
    [links],
  )
  const linkedCostIds = useMemo(() => new Set(links.map((l) => l.cost_account_id)), [links])
  const unlinked = icAccounts.filter(
    (a) => !linkedRevenueIds.has(a.id) && !linkedCostIds.has(a.id),
  )

  const missingCounterpart = entries.filter((e) => e.counterpart_company_id === null).length
  const companiesWithoutScenario = companies.filter((c) => !scenarioByCompany.has(c.id))

  function companyName(id: number) {
    return companies.find((c) => c.id === id)?.name ?? `Bolag ${id}`
  }

  function toggle(accountId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const displayed = onlyDiff ? lines.filter((l) => !l.balanced) : lines
  const balancedCount = lines.filter((l) => l.balanced).length
  const busy = loading || loadingLinks

  return (
    <div className="p-8 max-w-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Intercompany-avstämning</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Säljarens intäktskonto mot köparens kopplade kostnadskonto — netto ska bli noll
          </p>
        </div>
        <HelpButton section="intercompany" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-5">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Scenario</label>
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {scenarioNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setOnlyDiff(false)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              !onlyDiff
                ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            )}
          >
            Alla konton
          </button>
          <button
            onClick={() => setOnlyDiff(true)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              onlyDiff
                ? 'bg-amber-50 border-amber-200 text-amber-700 font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            )}
          >
            Bara avvikelser
          </button>
        </div>

        {lines.length > 0 && (
          <div className="ml-auto text-xs text-gray-400 mt-4">
            {balancedCount} av {lines.length} kopplingar i balans
          </div>
        )}
      </div>

      {/* Notices */}
      <div className="space-y-2.5 mb-5">
        {!isAdmin && (
          <Notice tone="info">
            Du ser bara de bolag din roll har tillgång till. Saknar du åtkomst till motpartsbolaget
            visas dess sida som noll och allt ser ut att avvika.
          </Notice>
        )}

        {companiesWithoutScenario.length > 0 && selectedName && (
          <Notice tone="warn">
            {companiesWithoutScenario.map((c) => c.name).join(', ')} har inget scenario som heter{' '}
            <strong>{selectedName}</strong>. Det finns inget att stämma av mot i de bolagen.
          </Notice>
        )}

        {unlinked.length > 0 && (
          <Notice tone="warn">
            {unlinked.length} intercompany-konton saknar koppling och ingår inte i avstämningen
            {' '}({unlinked.slice(0, 4).map((a) => a.account_number).join(', ')}
            {unlinked.length > 4 ? ' m.fl.' : ''}).{' '}
            <a href="/admin/intercompany" className="underline font-medium">Sätt upp kopplingar</a>.
          </Notice>
        )}

        {missingCounterpart > 0 && (
          <Notice tone="warn">
            {missingCounterpart} budgetrader saknar motpart och kan inte stämmas av. Ange motpart i
            budgetmatrisen.
          </Notice>
        )}

        {lines.some((l) => l.counterparts.some((c) => c.sameSign)) && (
          <Notice tone="warn">
            Säljarens och köparens belopp har samma tecken på minst en koppling. Avstämningen antar
            att de tar ut varandra — stämmer inte det behöver teckenkonventionen ses över.
          </Notice>
        )}
      </div>

      {busy ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : links.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          Inga kontokopplingar uppsatta ännu.{' '}
          <a href="/admin/intercompany" className="text-brand-600 underline">
            Koppla intäktskonton till kostnadskonton
          </a>{' '}
          så vet avstämningen vilka belopp som hör ihop.
        </div>
      ) : displayed.length === 0 && onlyDiff ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-10 text-center text-sm text-green-700 font-medium">
          Alla kopplingar är i balans ✓
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((line) => {
            const isOpen = expanded.has(line.accountId)
            return (
              <div
                key={line.accountId}
                className={cn(
                  'border rounded-lg overflow-hidden',
                  line.balanced ? 'border-gray-200' : 'border-amber-200',
                )}
              >
                <button
                  onClick={() => toggle(line.accountId)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                    line.balanced ? 'bg-gray-50 hover:bg-gray-100' : 'bg-amber-50 hover:bg-amber-100',
                  )}
                >
                  {isOpen
                    ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                  <span className="font-mono text-gray-500 text-sm">{line.accountNumber}</span>
                  <span className="font-medium text-gray-900 text-sm">{line.accountName}</span>
                  <span className="text-xs text-gray-400">{companyName(line.sellerCompanyId)}</span>
                  <span className="text-xs text-gray-400">
                    {line.counterparts.length} {line.counterparts.length === 1 ? 'motpart' : 'motparter'}
                  </span>
                  <div className="ml-auto">
                    {line.balanced
                      ? <CheckCircle2 size={15} className="text-green-500" />
                      : <AlertTriangle size={15} className="text-amber-500" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-max">
                      <thead>
                        <tr className="bg-white border-b border-gray-100">
                          <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-gray-500 w-64">
                            Motpart
                          </th>
                          {periods.map((p) => (
                            <th
                              key={pKey(p.year, p.month)}
                              className="px-3 py-2 text-right font-medium text-gray-500 w-24 min-w-[5rem]"
                            >
                              {MONTH_LABELS[p.month - 1]}
                              {periods.some((q) => q.year !== periods[0].year) ? ` ${p.year}` : ''}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-right font-medium text-gray-700 w-28 bg-gray-50">
                            Totalt
                          </th>
                        </tr>
                      </thead>

                      {line.counterparts.map((cp) => (
                        <tbody key={cp.companyId} className="border-t border-gray-100">
                          <tr className="bg-gray-50/70">
                            <td
                              className="sticky left-0 bg-gray-50/70 px-4 py-2 font-medium text-brand-700"
                              colSpan={1}
                            >
                              → {companyName(cp.companyId)}
                            </td>
                            <td colSpan={periods.length} className="px-3 py-2 text-gray-400">
                              {cp.costAccounts.map((c) => c.account_number).join(', ')}
                              {cp.costAccounts.length > 1 && ' — köparens sida är summan'}
                            </td>
                            <td className="px-3 py-2 bg-gray-100"></td>
                          </tr>

                          <tr className="hover:bg-gray-50/50">
                            <td className="sticky left-0 bg-white px-4 py-2 pl-8 text-gray-600">
                              Säljarens sida
                            </td>
                            {periods.map((p) => (
                              <td key={pKey(p.year, p.month)} className="px-3 py-2 text-right tabular-nums text-gray-700">
                                {fmt(cp.seller.get(pKey(p.year, p.month)) ?? 0)}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 bg-gray-50">
                              {fmt(cp.sellerTotal)}
                            </td>
                          </tr>

                          <tr className="hover:bg-gray-50/50">
                            <td className="sticky left-0 bg-white px-4 py-2 pl-8 text-gray-600">
                              Köparens sida
                            </td>
                            {periods.map((p) => (
                              <td key={pKey(p.year, p.month)} className="px-3 py-2 text-right tabular-nums text-gray-500">
                                {fmt(cp.buyer.get(pKey(p.year, p.month)) ?? 0)}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-600 bg-gray-50">
                              {fmt(cp.buyerTotal)}
                            </td>
                          </tr>

                          <tr className={cn('border-t', cp.balanced ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50')}>
                            <td className={cn(
                              'sticky left-0 px-4 py-2 pl-8 font-semibold',
                              cp.balanced ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-700',
                            )}>
                              Netto
                            </td>
                            {periods.map((p) => {
                              const k = pKey(p.year, p.month)
                              const n = (cp.seller.get(k) ?? 0) + (cp.buyer.get(k) ?? 0)
                              return (
                                <td
                                  key={k}
                                  className={cn(
                                    'px-3 py-2 text-right font-semibold tabular-nums',
                                    Math.abs(n) < 0.01 ? 'text-gray-300' : 'text-red-600',
                                  )}
                                >
                                  {Math.abs(n) < 0.01 ? '0' : fmt(n)}
                                </td>
                              )
                            })}
                            <td className={cn(
                              'px-3 py-2 text-right font-bold tabular-nums',
                              cp.balanced ? 'text-gray-400 bg-gray-100' : 'text-red-600 bg-amber-100',
                            )}>
                              {cp.balanced ? '0' : fmt(cp.netTotal)}
                            </td>
                          </tr>
                        </tbody>
                      ))}
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: 'info' | 'warn'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div className={cn(
      'flex items-start gap-2.5 px-4 py-2.5 rounded-lg text-xs border',
      warn ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-600',
    )}>
      {warn
        ? <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        : <Info size={13} className="shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  )
}
