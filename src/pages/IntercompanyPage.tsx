import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

type ScenarioRow = { id: number; name: string; company_id: number; start_year: number; start_month: number; end_year: number; end_month: number }

type EntryRow = {
  amount: number
  account_id: number
  scenario_id: number
  year: number
  month: number
  counterpart_company_id: number | null
  accounts: {
    account_number: string
    name: string
    company_id: number
  } | null
}

type Period = { year: number; month: number }

type PairLine = {
  from_company_id: number
  to_company_id: number | null
  amounts: Map<string, number>  // "year-month" → amount
}

type AccountLine = {
  account_number: string
  name: string
  pairs: PairLine[]
}

function pKey(year: number, month: number) { return `${year}-${month}` }

function fmt(n: number) {
  if (n === 0) return '—'
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

function fmtNetto(n: number) {
  if (Math.abs(n) < 0.01) return '—'
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

function getAccountNetto(line: AccountLine, periods: Period[]): number {
  return periods.reduce((sum, { year, month }) => {
    const k = pKey(year, month)
    return sum + line.pairs.reduce((s, p) => s + (p.amounts.get(k) ?? 0), 0)
  }, 0)
}

function isBalanced(line: AccountLine, periods: Period[]): boolean {
  return Math.abs(getAccountNetto(line, periods)) < 0.01
}

export default function IntercompanyPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [scenarioNames, setScenarioNames] = useState<string[]>([])
  const [selectedName, setSelectedName] = useState<string>('')
  const [lines, setLines] = useState<AccountLine[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => setCompanies(data ?? []))
    supabase
      .from('scenarios')
      .select('id, name, company_id, start_year, start_month, end_year, end_month')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as ScenarioRow[]
        setScenarios(rows)
        const names = [...new Set(rows.map((s) => s.name))].sort()
        setScenarioNames(names)
        if (names.length > 0) setSelectedName(names[0])
      })
  }, [])

  const loadData = useCallback(async (name: string) => {
    if (!name) return
    setLoading(true)
    try {
      const matchingIds = scenarios.filter((s) => s.name === name).map((s) => s.id)
      if (matchingIds.length === 0) { setLines([]); setPeriods([]); setLoading(false); return }

      // Fetch ALL IC accounts (account_number + name, unique per account_number)
      const { data: icConfigData } = await supabase
        .from('account_configs')
        .select('account_id, accounts(id, account_number, name, company_id)')
        .eq('is_intercompany', true)

      // Deduplicate by account_number — keep first occurrence per number
      const icAccountByNumber = new Map<string, { name: string; id: number; company_id: number }>()
      const icAccountIds = new Set<number>()
      for (const cfg of (icConfigData ?? []) as any[]) {
        const acct = cfg.accounts
        if (!acct) continue
        icAccountIds.add(cfg.account_id)
        if (!icAccountByNumber.has(acct.account_number)) {
          icAccountByNumber.set(acct.account_number, {
            name: acct.name,
            id: cfg.account_id,
            company_id: acct.company_id,
          })
        }
      }

      // Fetch budget entries for matching scenarios, restricted to IC accounts
      const { data, error } = await supabase
        .from('budget_entries')
        .select('amount, account_id, scenario_id, year, month, counterpart_company_id, accounts(account_number, name, company_id)')
        .in('scenario_id', matchingIds)
        .in('account_id', [...icAccountIds])

      if (error) throw error

      const entries = (data ?? []) as unknown as EntryRow[]

      // Collect periods from entries
      const periodSet = new Map<string, Period>()
      for (const e of entries) {
        const k = pKey(e.year, e.month)
        if (!periodSet.has(k)) periodSet.set(k, { year: e.year, month: e.month })
      }

      // If no entries at all, derive periods from matching scenarios
      if (periodSet.size === 0) {
        const matchingScenarios = scenarios.filter((s) => matchingIds.includes(s.id))
        for (const s of matchingScenarios) {
          let y = s.start_year; let m = s.start_month
          while (y < s.end_year || (y === s.end_year && m <= s.end_month)) {
            periodSet.set(pKey(y, m), { year: y, month: m })
            m++; if (m > 12) { m = 1; y++ }
          }
        }
      }

      const sortedPeriods = [...periodSet.values()].sort(
        (a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month
      )
      setPeriods(sortedPeriods)

      // Build account lines — start with all IC accounts (empty pairs)
      const accountMap = new Map<string, AccountLine>()
      for (const [account_number, info] of icAccountByNumber) {
        accountMap.set(account_number, { account_number, name: info.name, pairs: [] })
      }

      // Fill in pairs from entries
      for (const e of entries) {
        if (!e.accounts) continue
        const acctKey = e.accounts.account_number
        if (!accountMap.has(acctKey)) {
          accountMap.set(acctKey, { account_number: acctKey, name: e.accounts.name, pairs: [] })
        }
        const line = accountMap.get(acctKey)!
        const fromId = e.accounts.company_id
        const toId = e.counterpart_company_id

        let pair = line.pairs.find((p) => p.from_company_id === fromId && p.to_company_id === toId)
        if (!pair) {
          pair = { from_company_id: fromId, to_company_id: toId, amounts: new Map() }
          line.pairs.push(pair)
        }
        const k = pKey(e.year, e.month)
        pair.amounts.set(k, (pair.amounts.get(k) ?? 0) + e.amount)
      }

      const result = [...accountMap.values()].sort((a, b) =>
        a.account_number.localeCompare(b.account_number)
      )
      setLines(result)

      // Auto-expand unbalanced accounts
      const toExpand = new Set<string>()
      for (const line of result) {
        if (line.pairs.length > 0 && !isBalanced(line, sortedPeriods))
          toExpand.add(line.account_number)
      }
      setExpandedAccounts(toExpand)

    } catch (err) {
      console.error('IntercompanyPage loadData error:', err)
      setLines([])
    } finally {
      setLoading(false)
    }
  }, [scenarios])

  useEffect(() => {
    if (selectedName && scenarios.length > 0) loadData(selectedName)
  }, [selectedName, scenarios, loadData])

  function toggleAccount(acctNr: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(acctNr)) next.delete(acctNr)
      else next.add(acctNr)
      return next
    })
  }

  function companyName(id: number | null): string {
    if (id === null) return '—'
    return companies.find((c) => c.id === id)?.name ?? `Bolag ${id}`
  }

  const displayed = onlyDiff
    ? lines.filter((l) => !isBalanced(l, periods))
    : lines

  const balanced = lines.filter((l) => isBalanced(l, periods)).length

  return (
    <div className="p-8 max-w-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Intercompany-avstämning</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Budgeterade intercompany-belopp per konto och motpart — netto ska vara noll
          </p>
        </div>
        <HelpButton section="intercompany" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mb-6">
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
            {balanced} av {lines.length} konton i balans
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : lines.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {scenarioNames.length === 0
            ? 'Inga scenarios hittades'
            : 'Inga intercompany-konton budgeterade — markera konton som IC under Administration → Konton och ange motparter i Budgetmatrisen'}
        </div>
      ) : displayed.length === 0 && onlyDiff ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-10 text-center text-sm text-green-700 font-medium">
          Alla intercompany-konton är i balans ✓
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((line) => {
            const balanced = isBalanced(line, periods)
            const isExpanded = expandedAccounts.has(line.account_number)

            // Netto per period
            const nettoByPeriod = periods.map(({ year, month }) => {
              const k = pKey(year, month)
              return line.pairs.reduce((sum, p) => sum + (p.amounts.get(k) ?? 0), 0)
            })
            const nettoTotal = nettoByPeriod.reduce((s, n) => s + n, 0)

            return (
              <div
                key={line.account_number}
                className={cn(
                  'border rounded-lg overflow-hidden',
                  balanced ? 'border-gray-200' : 'border-amber-200',
                )}
              >
                {/* Account header */}
                <button
                  onClick={() => toggleAccount(line.account_number)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                    balanced ? 'bg-gray-50 hover:bg-gray-100' : 'bg-amber-50 hover:bg-amber-100',
                  )}
                >
                  {isExpanded
                    ? <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                  <span className="font-mono text-gray-500 text-sm">{line.account_number}</span>
                  <span className="font-medium text-gray-900 text-sm">{line.name}</span>
                  <span className="text-xs text-gray-400 ml-1">
                    {line.pairs.length} {line.pairs.length === 1 ? 'rad' : 'rader'}
                  </span>
                  <div className="ml-auto">
                    {balanced
                      ? <CheckCircle2 size={15} className="text-green-500" />
                      : <AlertTriangle size={15} className="text-amber-500" />}
                  </div>
                </button>

                {/* Expanded table */}
                {isExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-max">
                      <thead>
                        <tr className="bg-white border-b border-gray-100">
                          <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-gray-500 w-40">Bolag</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-500 w-40">Motpart</th>
                          {periods.map(({ year, month }) => (
                            <th key={pKey(year, month)} className="px-3 py-2 text-right font-medium text-gray-500 w-24 min-w-[5rem]">
                              {MONTH_LABELS[month - 1]}{periods.some((p) => p.year !== periods[0].year) ? ` ${year}` : ''}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-right font-medium text-gray-700 w-28 bg-gray-50">Totalt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {line.pairs
                          .sort((a, b) => a.from_company_id - b.from_company_id)
                          .map((pair, i) => {
                            const pairTotal = periods.reduce(
                              (sum, { year, month }) => sum + (pair.amounts.get(pKey(year, month)) ?? 0),
                              0,
                            )
                            return (
                              <tr key={i} className="hover:bg-gray-50/50">
                                <td className="sticky left-0 bg-white px-4 py-2 font-medium text-gray-800 hover:bg-gray-50/50">
                                  {companyName(pair.from_company_id)}
                                </td>
                                <td className="px-4 py-2 text-blue-600">
                                  {pair.to_company_id
                                    ? `→ ${companyName(pair.to_company_id)}`
                                    : <span className="text-gray-400 italic">ej specificerad</span>}
                                </td>
                                {periods.map(({ year, month }) => {
                                  const val = pair.amounts.get(pKey(year, month)) ?? 0
                                  return (
                                    <td key={pKey(year, month)} className="px-3 py-2 text-right tabular-nums text-gray-700">
                                      {fmt(val)}
                                    </td>
                                  )
                                })}
                                <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 bg-gray-50">
                                  {fmt(pairTotal)}
                                </td>
                              </tr>
                            )
                          })}

                        {/* Netto row */}
                        <tr className={cn(
                          'border-t-2',
                          balanced ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50',
                        )}>
                          <td className={cn(
                            'sticky left-0 px-4 py-2 font-semibold',
                            balanced ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-700',
                          )} colSpan={2}>
                            Netto
                          </td>
                          {nettoByPeriod.map((n, i) => (
                            <td
                              key={i}
                              className={cn(
                                'px-3 py-2 text-right font-semibold tabular-nums',
                                Math.abs(n) < 0.01 ? 'text-gray-400' : 'text-red-600',
                              )}
                            >
                              {fmtNetto(n)}
                            </td>
                          ))}
                          <td className={cn(
                            'px-3 py-2 text-right font-bold tabular-nums',
                            balanced ? 'text-gray-400 bg-gray-100' : 'text-red-600 bg-amber-100',
                          )}>
                            {fmtNetto(nettoTotal)}
                          </td>
                        </tr>
                      </tbody>
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
