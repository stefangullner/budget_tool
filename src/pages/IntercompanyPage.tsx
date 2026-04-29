import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

type ScenarioRow = { id: number; name: string; company_id: number }

type EntryRow = {
  amount: number
  account_id: number
  scenario_id: number
  accounts: {
    account_number: string
    name: string
    company_id: number
    account_configs: { is_intercompany: boolean } | null
  } | null
}

type AccountLine = {
  account_number: string
  name: string
  amounts: Record<number, number>  // company_id → summa
  netto: number
}

function fmt(n: number) {
  if (n === 0) return '—'
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)
}

export default function IntercompanyPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [scenarioNames, setScenarioNames] = useState<string[]>([])
  const [selectedName, setSelectedName] = useState<string>('')
  const [lines, setLines] = useState<AccountLine[]>([])
  const [loading, setLoading] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(false)

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => setCompanies(data ?? []))
    supabase.from('scenarios').select('id, name, company_id').order('name').then(({ data }) => {
      const rows = (data ?? []) as ScenarioRow[]
      setScenarios(rows)
      const names = [...new Set(rows.map(s => s.name))].sort()
      setScenarioNames(names)
      if (names.length > 0) setSelectedName(names[0])
    })
  }, [])

  const loadData = useCallback(async (name: string) => {
    if (!name) return
    setLoading(true)
    try {
      const matchingIds = scenarios.filter(s => s.name === name).map(s => s.id)
      if (matchingIds.length === 0) { setLines([]); return }

      const { data, error } = await supabase
        .from('budget_entries')
        .select('amount, account_id, scenario_id, accounts(account_number, name, company_id, account_configs(is_intercompany))')
        .in('scenario_id', matchingIds)

      if (error) throw error

      const entries = (data ?? []) as unknown as EntryRow[]

      // Filtrera på intercompany-konton
      const icEntries = entries.filter(e => e.accounts?.account_configs?.is_intercompany)

      // Aggregera per (account_number, company_id)
      const map = new Map<string, AccountLine>()
      for (const e of icEntries) {
        if (!e.accounts) continue
        const key = e.accounts.account_number
        if (!map.has(key)) {
          map.set(key, { account_number: key, name: e.accounts.name, amounts: {}, netto: 0 })
        }
        const line = map.get(key)!
        const cid = e.accounts.company_id
        line.amounts[cid] = (line.amounts[cid] ?? 0) + e.amount
      }

      // Beräkna netto
      const result: AccountLine[] = [...map.values()].map(line => ({
        ...line,
        netto: Object.values(line.amounts).reduce((s, a) => s + a, 0),
      })).sort((a, b) => a.account_number.localeCompare(b.account_number))

      setLines(result)
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

  const displayed = onlyDiff ? lines.filter(l => Math.abs(l.netto) > 0.01) : lines
  const balanced = lines.filter(l => Math.abs(l.netto) <= 0.01).length

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Intercompany-avstämning</h1>
          <p className="text-sm text-gray-500 mt-0.5">Budgeterade intercompany-belopp per konto — netto ska vara noll</p>
        </div>
        <HelpButton section="intercompany" />
      </div>

      {/* Kontroller */}
      <div className="flex items-center gap-4 mb-6">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Scenario</label>
          <select
            value={selectedName}
            onChange={e => setSelectedName(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {scenarioNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setOnlyDiff(false)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              !onlyDiff ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            )}
          >
            Alla konton
          </button>
          <button
            onClick={() => setOnlyDiff(true)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg border transition-colors',
              onlyDiff ? 'bg-amber-50 border-amber-200 text-amber-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
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
            : 'Inga intercompany-konton budgeterade för detta scenario — markera konton som IC under Konton'}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-24">Kontonr</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Kontonamn</th>
                {companies.map(c => (
                  <th key={c.id} className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 w-32">{c.name}</th>
                ))}
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 w-32">Netto</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map(line => {
                const balanced = Math.abs(line.netto) <= 0.01
                return (
                  <tr key={line.account_number} className={cn(
                    'transition-colors',
                    balanced ? 'hover:bg-gray-50' : 'bg-amber-50 hover:bg-amber-100'
                  )}>
                    <td className="px-4 py-2.5 font-mono text-gray-700">{line.account_number}</td>
                    <td className="px-4 py-2.5 text-gray-900">{line.name}</td>
                    {companies.map(c => (
                      <td key={c.id} className="px-4 py-2.5 text-right text-gray-600 tabular-nums">
                        {fmt(line.amounts[c.id] ?? 0)}
                      </td>
                    ))}
                    <td className={cn(
                      'px-4 py-2.5 text-right font-medium tabular-nums',
                      balanced ? 'text-gray-400' : 'text-red-600'
                    )}>
                      {balanced ? '—' : fmt(line.netto)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {balanced
                        ? <CheckCircle2 size={14} className="text-green-500 mx-auto" />
                        : <AlertTriangle size={14} className="text-amber-500 mx-auto" />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {displayed.length === 0 && onlyDiff && (
            <div className="text-center py-8 text-sm text-green-600 font-medium">
              Alla intercompany-konton är i balans ✓
            </div>
          )}
        </div>
      )}
    </div>
  )
}
