import { useEffect, useState } from 'react'
import { Lock, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/hooks/useBudget'
import type { CostCenter, Scenario, ScenarioLock } from '@/types'

const SECTIONS = ['Intäkter', 'Personal', 'Lokaler', 'Marknadsföring', 'Administration', 'Övrigt']

interface Props {
  scenario: Scenario
  accounts: AccountRow[]
  costCenters: CostCenter[]
  locks: ScenarioLock[]
  onSelectKS: (costCenterId: number) => void
}

type AllEntries = Map<string, number> // "costCenterId:accountId" → total amount

function fmt(n: number) {
  if (n === 0) return ''
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function entryKey(costCenterId: number, accountId: number) {
  return `${costCenterId}:${accountId}`
}

export default function BudgetOverview({ scenario, accounts, costCenters, locks, onSelectKS }: Props) {
  const [allEntries, setAllEntries] = useState<AllEntries>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!scenario) return
    setLoading(true)
    supabase
      .from('budget_entries')
      .select('account_id, cost_center_id, amount')
      .eq('scenario_id', scenario.id)
      .then(({ data }) => {
        // Sum all months per (costCenter, account) pair
        const map = new Map<string, number>()
        for (const row of data ?? []) {
          const k = entryKey(row.cost_center_id, row.account_id)
          map.set(k, (map.get(k) ?? 0) + (row.amount as number))
        }
        setAllEntries(map)
        setLoading(false)
      })
  }, [scenario.id])

  // Build section → account list lookup
  const accountsBySection = new Map<string, AccountRow[]>()
  for (const section of SECTIONS) {
    accountsBySection.set(
      section,
      accounts.filter((a) => (a.config?.section ?? 'Övrigt') === section),
    )
  }
  const visibleSections = SECTIONS.filter((s) => (accountsBySection.get(s)?.length ?? 0) > 0)

  function sectionTotal(costCenterId: number, section: string): number {
    const sectionAccounts = accountsBySection.get(section) ?? []
    return sectionAccounts.reduce(
      (sum, a) => sum + (allEntries.get(entryKey(costCenterId, a.id)) ?? 0),
      0,
    )
  }

  function ksTotal(costCenterId: number): number {
    return accounts.reduce(
      (sum, a) => sum + (allEntries.get(entryKey(costCenterId, a.id)) ?? 0),
      0,
    )
  }

  function isKsDone(costCenterId: number): boolean {
    return accounts.length > 0 && accounts.every(
      (a) => (allEntries.get(entryKey(costCenterId, a.id)) ?? 0) !== 0,
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={20} />
      </div>
    )
  }

  const doneCount = costCenters.filter((ks) => isKsDone(ks.id)).length
  const totalCount = costCenters.length

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-32 bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', doneCount === totalCount && totalCount > 0 ? 'bg-green-500' : 'bg-brand-500')}
              style={{ width: totalCount > 0 ? `${Math.round((doneCount / totalCount) * 100)}%` : '0%' }}
            />
          </div>
          <span className={cn('text-sm font-medium', doneCount === totalCount && totalCount > 0 ? 'text-green-600' : 'text-gray-700')}>
            {doneCount} av {totalCount} KS klara
          </span>
        </div>
      </div>
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="text-xs min-w-max w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="sticky left-0 bg-gray-50 px-3 py-2.5 text-left font-medium text-gray-500 w-64 z-10">
              Kostnadsställe
            </th>
            {visibleSections.map((s) => (
              <th key={s} className="px-3 py-2.5 text-right font-medium text-gray-500 min-w-[7rem]">
                {s}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium text-gray-700 bg-gray-100 min-w-[6rem]">
              Totalt
            </th>
            <th className="px-3 py-2.5 text-center font-medium text-gray-500 min-w-[6rem]">
              Framsteg
            </th>
            <th className="px-3 py-2.5 text-center font-medium text-gray-500 w-10" />
          </tr>
        </thead>
        <tbody>
          {costCenters.map((ks) => {
            const isLocked = locks.some((l) => l.cost_center_id === ks.id)
            const done = isKsDone(ks.id)

            return (
              <tr
                key={ks.id}
                className="border-t border-gray-100 hover:bg-brand-50/30 cursor-pointer transition-colors group"
                onClick={() => onSelectKS(ks.id)}
              >
                <td className="sticky left-0 bg-white px-3 py-2 z-10 group-hover:bg-brand-50/30 transition-colors">
                  <div className="flex items-center gap-2">
                    {isLocked && <Lock size={11} className="text-amber-500 shrink-0" />}
                    <span className="font-mono text-gray-400 text-[11px]">{ks.code}</span>
                    <span className="text-gray-700 truncate">{ks.name}</span>
                    <ChevronRight size={11} className="text-gray-300 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </td>
                {visibleSections.map((s) => (
                  <td key={s} className="px-3 py-2 text-right font-mono text-gray-700">
                    {fmt(sectionTotal(ks.id, s))}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900 bg-gray-50 border-l border-gray-200">
                  {fmt(ksTotal(ks.id))}
                </td>
                <td className="px-3 py-2 text-center">
                  {done
                    ? <span className="text-xs font-medium text-green-600">✓ Klar</span>
                    : <span className="text-xs text-gray-300">—</span>
                  }
                </td>
                <td />
              </tr>
            )
          })}
        </tbody>

        {/* Grand total row */}
        <tr className="border-t-2 border-gray-300 bg-gray-100">
          <td className="sticky left-0 bg-gray-100 px-3 py-2 font-semibold text-gray-800 z-10">
            Totalt alla KS
          </td>
          {visibleSections.map((s) => {
            const total = costCenters.reduce((sum, ks) => sum + sectionTotal(ks.id, s), 0)
            return (
              <td key={s} className="px-3 py-2 text-right font-mono font-semibold text-gray-800">
                {fmt(total)}
              </td>
            )
          })}
          <td className="px-3 py-2 text-right font-mono font-bold text-gray-900 bg-gray-200 border-l border-gray-300">
            {fmt(costCenters.reduce((sum, ks) => sum + ksTotal(ks.id), 0))}
          </td>
          <td />
          <td />
        </tr>
      </table>
    </div>
    </div>
  )
}
