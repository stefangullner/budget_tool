import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Info, List, ListFilter, Loader2, Lock, X,
} from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useIntercompanyLinks } from '@/hooks/useIntercompanyLinks'
import { useRole } from '@/hooks/useRole'
import { cn } from '@/lib/utils'
import type { Company, CostCenter } from '@/types'

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
  cost_center_id: number
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

/** One budget cell: account, cost center, period and the counterpart it faces. */
function eKey(accountId: number, costCenterId: number, year: number, month: number, counterpart: number) {
  return `${accountId}:${costCenterId}:${pKey(year, month)}:${counterpart}`
}

function fmt(n: number) {
  if (n === 0) return '—'
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

function fmtInput(n: number) {
  if (n === 0) return ''
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

function parseSEK(s: string): number {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

/** RLS denials come back as raw Postgres text — say what it means instead. */
function describeSaveError(message: string) {
  if (/row-level security|permission denied/i.test(message)) {
    return 'Du saknar behörighet att spara i det bolaget. Internhandel spänner över bolagsgränsen — motpartens sida kräver behörighet där.'
  }
  if (/violates foreign key/i.test(message)) {
    return 'Kontot eller kostnadsstället finns inte längre. Ladda om sidan.'
  }
  return message
}

interface SideRow {
  costCenter: CostCenter
  locked: boolean
  /** Whether the cost center already carries an amount on this side. */
  hasData: boolean
}

interface CounterpartLine {
  companyId: number
  costAccounts: ICAccount[]
  sellerRows: SideRow[]
  buyerRows: SideRow[]
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
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [icAccounts, setIcAccounts] = useState<ICAccount[]>([])
  const [amounts, setAmounts] = useState<Map<string, number>>(new Map())
  const [presentRows, setPresentRows] = useState<Map<string, Set<number>>>(new Map())
  /** Sides the user has expanded to every cost center, keyed by side. */
  const [showAllRows, setShowAllRows] = useState<Set<string>>(new Set())
  const [lockedCostCenters, setLockedCostCenters] = useState<Set<number>>(new Set())
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  /**
   * Sidor användaren fällt IHOP. Inverterat mot det uppenbara, eftersom
   * inmatningsfälten annars kräver två klick att nå — ett på kontot och ett på
   * sidan — och då är de svåra att ens upptäcka.
   */
  const [closedSides, setClosedSides] = useState<Set<string>>(new Set())
  const [userId, setUserId] = useState('')

  const { links, accounts: linkedAccounts, loading: loadingLinks } = useIntercompanyLinks()
  const { isAdmin } = useRole()

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  function isPastPeriod(year: number, month: number) {
    return year < currentYear || (year === currentYear && month < currentMonth)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id)
    })
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      setCompanies((data ?? []) as Company[])
    })
    supabase
      .from('cost_centers')
      .select('*')
      .eq('is_active', true)
      .order('code')
      .then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
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
      setAmounts(new Map())
      setPresentRows(new Map())
      return
    }
    let cancelled = false
    setLoading(true)
    const scenarioIds = matching.map((s) => s.id)

    Promise.all([
      fetchAllRows<EntryRow>((from, to) =>
        supabase
          .from('budget_entries')
          .select('account_id, cost_center_id, year, month, amount, counterpart_company_id')
          .in('scenario_id', scenarioIds)
          .in('account_id', involvedIds)
          .order('account_id')
          .order('cost_center_id')
          .order('year')
          .order('month')
          .range(from, to),
      ),
      supabase.from('scenario_locks').select('cost_center_id').in('scenario_id', scenarioIds),
    ]).then(([rows, lockResult]) => {
      if (cancelled) return

      const map = new Map<string, number>()
      const present = new Map<string, Set<number>>()
      for (const r of rows) {
        const counterpart = r.counterpart_company_id ?? 0
        const k = eKey(r.account_id, r.cost_center_id, r.year, r.month, counterpart)
        map.set(k, (map.get(k) ?? 0) + r.amount)
        const rowKey = `${r.account_id}:${counterpart}`
        const set = present.get(rowKey)
        if (set) set.add(r.cost_center_id)
        else present.set(rowKey, new Set([r.cost_center_id]))
      }
      setAmounts(map)
      setPresentRows(present)
      setLockedCostCenters(
        new Set((lockResult.data ?? []).map((l) => l.cost_center_id as number)),
      )
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [matching, involvedIds])

  function amountOf(accountId: number, costCenterId: number, p: Period, counterpart: number) {
    return amounts.get(eKey(accountId, costCenterId, p.year, p.month, counterpart)) ?? 0
  }

  /**
   * One line per revenue account, one sub-line per counterpart company, and
   * under each side the cost centers that carry the amounts.
   *
   * The seller's amounts sit on its own account with the buyer as counterpart;
   * the buyer's sit on the linked cost account(s) with the seller as counterpart.
   * Matching on account_number — what this page did before — only ever worked
   * when both companies happened to use identical charts of accounts.
   */
  const lines: AccountLine[] = useMemo(() => {
    const costByRevenue = new Map<number, ICAccount[]>()
    for (const link of links) {
      const cost = linkedAccounts.get(link.cost_account_id)
      if (!cost) continue
      const list = costByRevenue.get(link.revenue_account_id)
      if (list) list.push(cost)
      else costByRevenue.set(link.revenue_account_id, [cost])
    }

    /**
     * Cost centers with an amount, or — when the side is expanded, and by
     * default while the side is still empty — every cost center in the company.
     * An empty side would otherwise show nothing at all to type into.
     */
    function rowsFor(
      accountIds: number[],
      companyId: number,
      counterpart: number,
      sideKey: string,
    ): SideRow[] {
      const withData = new Set<number>()
      for (const accountId of accountIds) {
        for (const cc of presentRows.get(`${accountId}:${counterpart}`) ?? []) withData.add(cc)
      }
      const all = costCenters.filter((c) => c.company_id === companyId)
      const showAll = showAllRows.has(sideKey) || withData.size === 0
      return (showAll ? all : all.filter((c) => withData.has(c.id))).map((c) => ({
        costCenter: c,
        locked: lockedCostCenters.has(c.id),
        hasData: withData.has(c.id),
      }))
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
        const sellerRows = rowsFor(
          [revenueId], revenue.company_id, companyId, `${revenueId}:${companyId}:seller`,
        )
        const buyerRows = rowsFor(
          costAccounts.map((c) => c.id), companyId, revenue.company_id, `${revenueId}:${companyId}:buyer`,
        )

        const sellerTotal = sellerRows.reduce(
          (sum, r) => sum + periods.reduce((s, p) => s + amountOf(revenueId, r.costCenter.id, p, companyId), 0),
          0,
        )
        const buyerTotal = buyerRows.reduce(
          (sum, r) =>
            sum +
            costAccounts.reduce(
              (s, c) => s + periods.reduce((t, p) => t + amountOf(c.id, r.costCenter.id, p, revenue.company_id), 0),
              0,
            ),
          0,
        )

        const netTotal = sellerTotal + buyerTotal
        counterparts.push({
          companyId,
          costAccounts,
          sellerRows,
          buyerRows,
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
  }, [links, linkedAccounts, presentRows, showAllRows, costCenters, lockedCostCenters, amounts, periods])

  // Auto-expand what needs attention
  useEffect(() => {
    setExpanded(new Set(lines.filter((l) => !l.balanced).map((l) => l.accountId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links, selectedName])

  async function writeCell(
    companyId: number,
    accountId: number,
    costCenterId: number,
    year: number,
    month: number,
    amount: number,
    counterpart: number,
  ) {
    const scenarioId = scenarioByCompany.get(companyId)
    if (!scenarioId) {
      setSaveError('Bolaget saknar ett scenario med det här namnet — det finns inget att spara i.')
      return
    }
    const k = eKey(accountId, costCenterId, year, month, counterpart)
    const previous = amounts.get(k)

    setSavingKeys((prev) => new Set(prev).add(k))
    setAmounts((prev) => new Map(prev).set(k, amount))

    const { error } = await supabase.from('budget_entries').upsert(
      {
        scenario_id: scenarioId,
        account_id: accountId,
        cost_center_id: costCenterId,
        year,
        month,
        amount,
        counterpart_company_id: counterpart,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id' },
    )

    if (error) {
      setAmounts((prev) => {
        const next = new Map(prev)
        if (previous === undefined) next.delete(k)
        else next.set(k, previous)
        return next
      })
      setSaveError(error.message)
    }

    setSavingKeys((prev) => {
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  function toggleShowAll(sideKey: string) {
    setShowAllRows((prev) => {
      const next = new Set(prev)
      if (next.has(sideKey)) next.delete(sideKey)
      else next.add(sideKey)
      return next
    })
  }

  const linkedRevenueIds = useMemo(() => new Set(links.map((l) => l.revenue_account_id)), [links])
  const linkedCostIds = useMemo(() => new Set(links.map((l) => l.cost_account_id)), [links])
  const unlinked = icAccounts.filter((a) => !linkedRevenueIds.has(a.id) && !linkedCostIds.has(a.id))

  const missingCounterpart = useMemo(() => {
    let n = 0
    for (const [k, v] of amounts) if (k.endsWith(':0') && v !== 0) n++
    return n
  }, [amounts])

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

  function toggleSide(key: string) {
    setClosedSides((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const displayed = onlyDiff ? lines.filter((l) => !l.balanced) : lines
  const balancedCount = lines.filter((l) => l.balanced).length
  const busy = loading || loadingLinks
  const colCount = 1 + periods.length + 1

  /** Editable rows for one side, plus the control that widens the list. */
  function renderSide(
    line: AccountLine,
    cp: CounterpartLine,
    side: 'seller' | 'buyer',
  ) {
    const isSeller = side === 'seller'
    const sideKey = `${line.accountId}:${cp.companyId}:${side}`
    const isOpen = !closedSides.has(sideKey)
    const rows = isSeller ? cp.sellerRows : cp.buyerRows
    const companyId = isSeller ? line.sellerCompanyId : cp.companyId
    const counterpart = isSeller ? cp.companyId : line.sellerCompanyId
    // The buyer may have several linked accounts; only one can take input
    const writeAccountId = isSeller ? line.accountId : cp.costAccounts[0].id
    const readAccountIds = isSeller ? [line.accountId] : cp.costAccounts.map((c) => c.id)
    const ambiguous = !isSeller && cp.costAccounts.length > 1
    const total = isSeller ? cp.sellerTotal : cp.buyerTotal
    const hasScenario = scenarioByCompany.has(companyId)
    const totalCount = costCenters.filter((c) => c.company_id === companyId).length
    const withDataCount = rows.filter((r) => r.hasData).length
    const showingAll = rows.length === totalCount && totalCount > 0

    function cellValue(costCenterId: number, p: Period) {
      return readAccountIds.reduce((s, id) => s + amountOf(id, costCenterId, p, counterpart), 0)
    }

    return (
      <>
        <tr className="hover:bg-gray-50/50">
          <td className="sticky left-0 bg-white px-4 py-2 pl-8">
            <button
              onClick={() => toggleSide(sideKey)}
              className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
            >
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {isSeller ? 'Säljarens sida' : 'Köparens sida'}
              <span className="text-gray-400 font-normal">
                {withDataCount > 0
                  ? `${withDataCount} av ${totalCount} kostnadsställen`
                  : `alla ${totalCount} kostnadsställen`}
              </span>
            </button>
          </td>
          {periods.map((p) => (
            <td key={pKey(p.year, p.month)} className={cn(
              'px-3 py-2 text-right tabular-nums',
              isSeller ? 'text-gray-700' : 'text-gray-500',
            )}>
              {fmt(sideTotalForPeriod(line, cp, side, p))}
            </td>
          ))}
          <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 bg-gray-50">
            {fmt(total)}
          </td>
        </tr>

        {isOpen && rows.map((row) => (
          <tr key={`${sideKey}:${row.costCenter.id}`} className="bg-gray-50">
            <td className="sticky left-0 bg-gray-50 px-4 py-0.5 pl-14">
              <div className="flex items-center gap-1.5">
                <span className={cn('font-mono', row.hasData ? 'text-gray-400' : 'text-gray-300')}>
                  {row.costCenter.code}
                </span>
                <span className={cn('truncate', row.hasData ? 'text-gray-600' : 'text-gray-400')}>
                  {row.costCenter.name}
                </span>
                {row.locked && (
                  <span title="Kostnadsstället är låst i scenariot" className="flex items-center gap-0.5 px-1 rounded text-amber-700 bg-amber-50 font-medium">
                    <Lock size={9} />
                    Låst
                  </span>
                )}
              </div>
            </td>
            {periods.map((p) => {
              const k = eKey(writeAccountId, row.costCenter.id, p.year, p.month, counterpart)
              const value = cellValue(row.costCenter.id, p)
              const editable = !row.locked && !isPastPeriod(p.year, p.month) && !ambiguous && hasScenario
              return (
                <td key={pKey(p.year, p.month)} className="px-1 py-0.5">
                  {editable ? (
                    <div className="relative">
                      <input
                        type="text"
                        key={`${k}:${value}`}
                        defaultValue={fmtInput(value)}
                        onBlur={(e) => {
                          const next = parseSEK(e.target.value)
                          if (next !== value) {
                            writeCell(companyId, writeAccountId, row.costCenter.id, p.year, p.month, next, counterpart)
                          }
                          e.target.value = fmtInput(next)
                        }}
                        placeholder="0"
                        aria-label={`${MONTH_LABELS[p.month - 1]} ${p.year} ${row.costCenter.name}`}
                        // Vit ruta mot den gråa raden — fältet ska synas innan
                        // man klickar, inte först vid hover
                        className="w-full px-2 py-1 text-right tabular-nums bg-white border border-gray-200 rounded placeholder:text-gray-300 hover:border-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      />
                      {savingKeys.has(k) && (
                        <Loader2 size={9} className="animate-spin absolute right-0.5 top-1/2 -translate-y-1/2 text-brand-400" />
                      )}
                    </div>
                  ) : (
                    <div className="px-2 py-1 text-right tabular-nums text-gray-400">{fmt(value)}</div>
                  )}
                </td>
              )
            })}
            <td className="px-3 py-0.5 text-right tabular-nums text-gray-500 bg-gray-100">
              {fmt(periods.reduce((s, p) => s + cellValue(row.costCenter.id, p), 0))}
            </td>
          </tr>
        ))}

        {/* Fotnoten får bara en rad när den faktiskt säger något — "alla visas"
            står redan i sidrubriken och behöver ingen egen rad per motpart. */}
        {isOpen && (ambiguous || !hasScenario || withDataCount > 0) && (
          <tr className="bg-gray-50">
            <td colSpan={colCount} className="px-4 py-1.5 pl-14">
              {ambiguous ? (
                <span className="text-gray-400">
                  {cp.costAccounts.length} kopplade konton — beloppen visas summerade och måste matas
                  in i budgetmatrisen per konto.
                </span>
              ) : !hasScenario ? (
                <span className="text-amber-700">
                  {companyName(companyId)} saknar ett scenario som heter {selectedName}.
                </span>
              ) : (
                <button
                  onClick={() => toggleShowAll(sideKey)}
                  className="flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium"
                >
                  {showingAll ? <ListFilter size={11} /> : <List size={11} />}
                  {showingAll
                    ? `Visa bara de ${withDataCount} med belopp`
                    : `Visa alla ${totalCount} kostnadsställen`}
                </button>
              )}
            </td>
          </tr>
        )}
      </>
    )
  }

  function sideTotalForPeriod(line: AccountLine, cp: CounterpartLine, side: 'seller' | 'buyer', p: Period) {
    if (side === 'seller') {
      return cp.sellerRows.reduce((s, r) => s + amountOf(line.accountId, r.costCenter.id, p, cp.companyId), 0)
    }
    return cp.buyerRows.reduce(
      (s, r) =>
        s + cp.costAccounts.reduce((t, c) => t + amountOf(c.id, r.costCenter.id, p, line.sellerCompanyId), 0),
      0,
    )
  }

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

      {saveError && (
        <div className="flex items-start gap-2.5 px-4 py-3 mb-4 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Ändringen sparades inte</p>
            <p className="mt-0.5 text-red-700">{describeSaveError(saveError)}</p>
          </div>
          <button onClick={() => setSaveError(null)} className="shrink-0 text-red-400 hover:text-red-700">
            <X size={15} />
          </button>
        </div>
      )}

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
            Du ser och kan redigera de bolag din roll har tillgång till. Saknar du åtkomst till
            motpartsbolaget visas dess sida som noll och allt ser ut att avvika.
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
            {missingCounterpart} budgetposter saknar motpart och ingår inte i någon sida. Ange motpart
            i budgetmatrisen.
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
                          <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-gray-500 w-72">
                            Motpart
                          </th>
                          {periods.map((p) => (
                            <th
                              key={pKey(p.year, p.month)}
                              className={cn(
                                'px-3 py-2 text-right font-medium w-24 min-w-[5.5rem]',
                                isPastPeriod(p.year, p.month) ? 'text-gray-400' : 'text-gray-500',
                              )}
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
                            <td className="sticky left-0 bg-gray-50/70 px-4 py-2 font-medium text-brand-700">
                              → {companyName(cp.companyId)}
                            </td>
                            <td colSpan={periods.length} className="px-3 py-2 text-gray-400">
                              {cp.costAccounts.map((c) => c.account_number).join(', ')}
                              {cp.costAccounts.length > 1 && ' — köparens sida är summan'}
                            </td>
                            <td className="px-3 py-2 bg-gray-100"></td>
                          </tr>

                          {renderSide(line, cp, 'seller')}
                          {renderSide(line, cp, 'buyer')}

                          <tr className={cn('border-t', cp.balanced ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50')}>
                            <td className={cn(
                              'sticky left-0 px-4 py-2 pl-8 font-semibold',
                              cp.balanced ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-700',
                            )}>
                              Netto
                            </td>
                            {periods.map((p) => {
                              const n =
                                sideTotalForPeriod(line, cp, 'seller', p) +
                                sideTotalForPeriod(line, cp, 'buyer', p)
                              return (
                                <td
                                  key={pKey(p.year, p.month)}
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
