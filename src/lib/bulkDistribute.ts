import { supabase } from '@/lib/supabase'
import { periodKey, type AccountRow } from '@/hooks/useBudget'

export type Period = { year: number; month: number }
export type BulkMethod = 'copy' | 'even'
export type BulkMode = 'skip' | 'overwrite'

/** A section the run may write to, with the accounts that take a plain value. */
export interface BulkGroup {
  section: string
  accounts: AccountRow[]
}

/** A cost center the run writes to. */
export interface BulkTarget {
  id: number
  code: string
  name: string
}

/**
 * One budget cell. Must be unique on (costCenterId, accountId, year, month) —
 * a repeated key makes Postgres reject the whole batch with
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 */
export interface BulkCell {
  costCenterId: number
  accountId: number
  year: number
  month: number
  amount: number
}

/** Lookup key for entries and comparison actuals across several cost centers. */
export function cellKey(costCenterId: number, year: number, month: number, accountId: number) {
  return `${costCenterId}:${periodKey(year, month)}:${accountId}`
}

/** Split a total into `count` parts, remainder on the last so the sum is exact. */
function splitEvenly(total: number, count: number): number[] {
  if (count === 0) return []
  const base = Math.trunc(total / count)
  const parts = Array(count).fill(base) as number[]
  parts[count - 1] = total - base * (count - 1)
  return parts
}

export interface BulkPlanOptions {
  groups: BulkGroup[]
  selectedSections: Set<string>
  targets: BulkTarget[]
  futurePeriods: Period[]
  /** Current budget, so already-filled cells can be left alone. */
  entries: Map<string, number>
  /** Comparison actuals, already mapped onto the target periods. */
  prevActuals: Map<string, number>
  method: BulkMethod
  mode: BulkMode
  /** 1.03 for +3 %. */
  factor: number
}

export interface BulkTargetPreview {
  costCenterId: number
  code: string
  name: string
  accounts: number
  cells: number
  total: number
}

export interface BulkPlan {
  cells: BulkCell[]
  perTarget: BulkTargetPreview[]
  total: number
  /** Account/cost-center pairs with no comparison actuals to derive a budget from. */
  withoutData: number
  /** Cells left alone because they already hold a budget. */
  keptFilled: number
}

/**
 * Work out exactly which cells a run would write. Pure — the preview the user
 * approves and the rows that get saved come from this one function.
 */
export function buildBulkPlan({
  groups,
  selectedSections,
  targets,
  futurePeriods,
  entries,
  prevActuals,
  method,
  mode,
  factor,
}: BulkPlanOptions): BulkPlan {
  const cells: BulkCell[] = []
  const perTarget: BulkTargetPreview[] = []
  let withoutData = 0
  let keptFilled = 0

  for (const target of targets) {
    let targetCells = 0
    let targetTotal = 0
    let targetAccounts = 0

    for (const group of groups) {
      if (!selectedSections.has(group.section)) continue

      for (const account of group.accounts) {
        const prev = futurePeriods.map(
          (p) => prevActuals.get(cellKey(target.id, p.year, p.month, account.id)) ?? 0,
        )
        if (prev.every((v) => v === 0)) {
          withoutData++
          continue
        }

        let amounts: number[]
        if (method === 'copy') {
          amounts = prev.map((v) => Math.round(v * factor))
        } else {
          // Same sum as the comparison actuals over the periods being written,
          // just flattened — past months are never touched, so this is not
          // necessarily a full year
          const periodTotal = Math.round(prev.reduce((s, v) => s + v, 0) * factor)
          amounts = splitEvenly(periodTotal, futurePeriods.length)
        }

        let touched = false
        futurePeriods.forEach((p, i) => {
          const existing = entries.get(cellKey(target.id, p.year, p.month, account.id)) ?? 0
          if (mode === 'skip') {
            if (existing !== 0) {
              keptFilled++
              return
            }
            // Nothing to write — the cell is already empty
            if (amounts[i] === 0) return
          }
          cells.push({
            costCenterId: target.id,
            accountId: account.id,
            year: p.year,
            month: p.month,
            amount: amounts[i],
          })
          targetCells++
          targetTotal += amounts[i]
          touched = true
        })

        if (touched) targetAccounts++
      }
    }

    perTarget.push({
      costCenterId: target.id,
      code: target.code,
      name: target.name,
      accounts: targetAccounts,
      cells: targetCells,
      total: targetTotal,
    })
  }

  return {
    cells,
    perTarget,
    total: cells.reduce((s, c) => s + c.amount, 0),
    withoutData,
    keptFilled,
  }
}

/**
 * Write a plan. Batched, because one cost center alone can be several thousand
 * rows and a run may cover dozens.
 *
 * A failed batch may land after earlier ones already committed, so the caller
 * must reload rather than assume nothing happened — `written` says how far it got.
 */
export async function applyBulkPlan(
  scenarioId: number,
  cells: BulkCell[],
  userId: string,
): Promise<{ written: number; error: string | null }> {
  if (cells.length === 0) return { written: 0, error: null }

  const now = new Date().toISOString()
  const payload = cells.map((c) => ({
    scenario_id: scenarioId,
    account_id: c.accountId,
    cost_center_id: c.costCenterId,
    year: c.year,
    month: c.month,
    amount: c.amount,
    counterpart_company_id: null,
    updated_by: userId,
    updated_at: now,
  }))

  const BATCH = 500
  for (let i = 0; i < payload.length; i += BATCH) {
    const { error } = await supabase.from('budget_entries').upsert(payload.slice(i, i + BATCH), {
      onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id',
    })
    if (error) return { written: i, error: error.message }
  }

  return { written: payload.length, error: null }
}
