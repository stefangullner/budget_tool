import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Scenario, ScenarioLock, CostCenter } from '@/types'

export type ScenarioWithStats = Scenario & {
  locked_ks: number
  total_ks: number
}

export type LockDetail = ScenarioLock & {
  cost_center: CostCenter
  locked_by_name: string
}

export function useAdminScenarios(companyId: number | null) {
  const [scenarios, setScenarios] = useState<ScenarioWithStats[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!companyId) return
    setLoading(true)

    Promise.all([
      supabase.from('scenarios').select('*').eq('company_id', companyId).order('start_year', { ascending: false }),
      supabase.from('scenario_locks').select('scenario_id'),
      supabase.from('cost_centers').select('id').eq('company_id', companyId).eq('is_active', true),
    ]).then(([{ data: raw }, { data: locks }, { data: costCenters }]) => {
      const totalKs = costCenters?.length ?? 0
      const lockMap = new Map<number, number>()
      for (const l of locks ?? []) {
        lockMap.set(l.scenario_id, (lockMap.get(l.scenario_id) ?? 0) + 1)
      }
      setScenarios(
        (raw ?? []).map((s) => ({
          ...(s as Scenario),
          locked_ks: lockMap.get(s.id) ?? 0,
          total_ks: totalKs,
        })),
      )
      setLoading(false)
    })
  }, [companyId, tick])

  async function loadLockDetails(scenarioId: number): Promise<LockDetail[]> {
    const { data: locks } = await supabase
      .from('scenario_locks')
      .select('*, cost_center:cost_centers(*)')
      .eq('scenario_id', scenarioId)

    if (!locks || locks.length === 0) return []

    const userIds = [...new Set(locks.map((l) => l.locked_by as string))]
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, display_name')
      .in('user_id', userIds)

    const nameMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) ?? [])

    return locks.map((l) => ({
      ...l,
      cost_center: l.cost_center as CostCenter,
      locked_by_name: nameMap.get(l.locked_by) ?? l.locked_by,
    })) as LockDetail[]
  }

  async function renameScenario(id: number, name: string) {
    await supabase.from('scenarios').update({ name }).eq('id', id)
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
  }

  async function toggleApprove(id: number, current: boolean) {
    await supabase.from('scenarios').update({ is_approved: !current }).eq('id', id)
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_approved: !current } : s)),
    )
  }

  async function deleteScenario(id: number) {
    await supabase.from('scenarios').delete().eq('id', id)
    setScenarios((prev) => prev.filter((s) => s.id !== id))
  }

  return { scenarios, loading, refetch, renameScenario, toggleApprove, deleteScenario, loadLockDetails }
}
