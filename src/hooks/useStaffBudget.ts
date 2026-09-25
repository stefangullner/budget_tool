import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useWriteGuard } from '@/lib/writes'
import type { StaffCostRow, StaffMember, StaffParameters, StaffPeriod } from '@/types'

export type StaffMemberPatch = Partial<Pick<StaffMember,
  | 'first_name' | 'last_name' | 'title' | 'employment_type' | 'home_cost_center_id'
  | 'included' | 'employment_rate' | 'monthly_salary' | 'supplement' | 'vacation_days'
  | 'car_benefit' | 'note'
>>

export type NewRecruitment = {
  title: string
  employment_type: StaffMember['employment_type']
  home_cost_center_id: number
  employment_rate: number
  monthly_salary: number
  /** First day of the start month. Months before it get a 0 % period. */
  start_period: string | null
  /** First day of the scenario's first month — the 0 % period starts here. */
  scenario_start: string
  first_name?: string
  last_name?: string
  note?: string
}

export function memberName(m: Pick<StaffMember, 'first_name' | 'last_name' | 'is_recruitment' | 'title'>) {
  const name = `${m.first_name} ${m.last_name}`.trim()
  if (name) return name
  return m.is_recruitment ? `Ny ${(m.title ?? 'medarbetare').toLowerCase()}` : 'Namn saknas'
}

/** "2027-02-01" for a year and month. */
export function periodDate(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** The month before a period date, as a period date. */
function previousPeriod(date: string) {
  const [y, m] = date.split('-').map(Number)
  return m === 1 ? periodDate(y - 1, 12) : periodDate(y, m - 1)
}

/**
 * Staff budget for one scenario, narrowed to one cost center for display.
 *
 * Every number shown comes from `staff_cost_rows()` in the database — the same
 * function that writes the personnel accounts in the budget. Nothing is
 * calculated here, so the view and the budget cannot disagree. After each write
 * the database has already recalculated the budget; this hook just reloads.
 */
export function useStaffBudget(scenarioId: number | null, costCenterId: number | null) {
  const [params, setParams] = useState<StaffParameters | null | undefined>(undefined)
  const [members, setMembers] = useState<StaffMember[]>([])
  const [costs, setCosts] = useState<StaffCostRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<Set<number>>(new Set())
  const [userId, setUserId] = useState<string | null>(null)
  const guard = useWriteGuard()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const loadMembers = useCallback(async () => {
    if (!scenarioId) return
    const rows = await fetchAllRows<StaffMember>((from, to) =>
      supabase
        .from('staff_members')
        .select('*, staff_periods(*), staff_allocations(*)')
        .eq('scenario_id', scenarioId)
        .order('id')
        .range(from, to),
    )
    for (const m of rows) {
      m.staff_periods.sort((a, b) => a.from_period.localeCompare(b.from_period))
    }
    setMembers(rows)
  }, [scenarioId])

  const loadCosts = useCallback(async () => {
    if (!scenarioId || !costCenterId) {
      setCosts([])
      return
    }
    const rows = await fetchAllRows<StaffCostRow>((from, to) =>
      supabase
        .rpc('staff_cost_rows', { p_scenario_id: scenarioId, p_cost_center_ids: [costCenterId] })
        .order('member_id')
        .order('year')
        .order('month')
        .range(from, to),
    )
    setCosts(rows.map((r) => ({
      ...r,
      rate: Number(r.rate),
      share: Number(r.share),
      salary: Number(r.salary),
      vacation_supplement: Number(r.vacation_supplement),
      employer_fee: Number(r.employer_fee),
      pension: Number(r.pension),
      payroll_tax: Number(r.payroll_tax),
      car_benefit: Number(r.car_benefit),
      car_benefit_fee: Number(r.car_benefit_fee),
      total: Number(r.total),
    })))
  }, [scenarioId, costCenterId])

  // Parameters + members when the scenario changes
  useEffect(() => {
    setParams(undefined)
    setMembers([])
    setLoadError(null)
    if (!scenarioId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('staff_parameters')
        .select('*')
        .eq('scenario_id', scenarioId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setParams(null)
      } else {
        setParams((data as StaffParameters | null) ?? null)
        if (data) await loadMembers()
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [scenarioId, loadMembers])

  useEffect(() => {
    if (params) loadCosts()
    else setCosts([])
  }, [params, loadCosts])

  /** People with any part of their salary on the selected cost center. */
  const visibleMembers = useMemo(() => {
    if (!costCenterId) return []
    return members
      .filter(
        (m) =>
          m.home_cost_center_id === costCenterId ||
          m.staff_allocations.some((a) => a.cost_center_id === costCenterId),
      )
      .sort((a, b) =>
        Number(a.is_recruitment) - Number(b.is_recruitment) ||
        memberName(a).localeCompare(memberName(b), 'sv'),
      )
  }, [members, costCenterId])

  /** member_id → "year-month" → cost row on the selected cost center. */
  const costByMember = useMemo(() => {
    const map = new Map<number, Map<string, StaffCostRow>>()
    for (const r of costs) {
      let inner = map.get(r.member_id)
      if (!inner) {
        inner = new Map()
        map.set(r.member_id, inner)
      }
      inner.set(`${r.year}-${r.month}`, r)
    }
    return map
  }, [costs])

  /** Reload after a write. The database recalculated the budget in the same statement. */
  const refresh = useCallback(async () => {
    await Promise.all([loadMembers(), loadCosts()])
  }, [loadMembers, loadCosts])

  async function withSaving(memberId: number, op: () => Promise<boolean>) {
    setSaving((s) => new Set(s).add(memberId))
    try {
      const ok = await op()
      if (ok) await refresh()
      return ok
    } finally {
      setSaving((s) => {
        const next = new Set(s)
        next.delete(memberId)
        return next
      })
    }
  }

  function updateMember(id: number, patch: StaffMemberPatch) {
    return withSaving(id, () => guard.run(supabase.from('staff_members').update(patch).eq('id', id)))
  }

  function setReviewed(id: number, reviewed: boolean) {
    return withSaving(id, () =>
      guard.run(
        supabase
          .from('staff_members')
          .update({
            reviewed_by: reviewed ? userId : null,
            reviewed_at: reviewed ? new Date().toISOString() : null,
          })
          .eq('id', id),
      ),
    )
  }

  async function markAllReviewed(ids: number[]) {
    if (ids.length === 0) return true
    const ok = await guard.run(
      supabase
        .from('staff_members')
        .update({ reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .in('id', ids),
    )
    if (ok) await loadMembers()
    return ok
  }

  function addPeriod(memberId: number, period: Omit<StaffPeriod, 'id' | 'member_id'>) {
    return withSaving(memberId, () =>
      guard.run(supabase.from('staff_periods').insert({ member_id: memberId, ...period })),
    )
  }

  function deletePeriod(memberId: number, periodId: number) {
    return withSaving(memberId, () =>
      guard.run(supabase.from('staff_periods').delete().eq('id', periodId)),
    )
  }

  /**
   * Replace a person's split across cost centers. Upsert first, delete after:
   * removing everything first could drop the user's own access to the person
   * (it comes through the allocations) and block the insert that follows.
   */
  function setAllocations(memberId: number, shares: { cost_center_id: number; share: number }[]) {
    return withSaving(memberId, async () => {
      const keep = shares.filter((s) => s.share > 0)
      if (keep.length > 0) {
        const ok = await guard.run(
          supabase
            .from('staff_allocations')
            .upsert(
              keep.map((s) => ({ member_id: memberId, cost_center_id: s.cost_center_id, share: s.share })),
              { onConflict: 'member_id,cost_center_id' },
            ),
        )
        if (!ok) return false
      }
      const keepIds = keep.map((s) => s.cost_center_id)
      let del = supabase.from('staff_allocations').delete().eq('member_id', memberId)
      if (keepIds.length > 0) del = del.not('cost_center_id', 'in', `(${keepIds.join(',')})`)
      return guard.run(del)
    })
  }

  async function addRecruitment(r: NewRecruitment) {
    if (!scenarioId) return false
    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        scenario_id: scenarioId,
        is_recruitment: true,
        title: r.title,
        employment_type: r.employment_type,
        home_cost_center_id: r.home_cost_center_id,
        employment_rate: r.employment_rate,
        monthly_salary: r.monthly_salary,
        first_name: r.first_name ?? '',
        last_name: r.last_name ?? '',
        note: r.note || null,
      })
      .select('id')
      .single()
    if (error || !data) {
      guard.setError(error?.message ?? 'Rekryteringen sparades inte')
      return false
    }
    // Not employed before the start month
    if (r.start_period && r.start_period > r.scenario_start) {
      const ok = await guard.run(
        supabase.from('staff_periods').insert({
          member_id: data.id,
          from_period: r.scenario_start,
          to_period: previousPeriod(r.start_period),
          rate: 0,
          reason: 'Ej anställd än',
        }),
      )
      if (!ok) {
        await refresh()
        return false
      }
    }
    await refresh()
    return true
  }

  function deleteMember(id: number) {
    return withSaving(id, () => guard.run(supabase.from('staff_members').delete().eq('id', id)))
  }

  return {
    params,
    loading,
    loadError,
    members,
    visibleMembers,
    costByMember,
    saving,
    saveError: guard.error,
    clearSaveError: guard.clearError,
    updateMember,
    setReviewed,
    markAllReviewed,
    addPeriod,
    deletePeriod,
    setAllocations,
    addRecruitment,
    deleteMember,
    refresh,
  }
}
