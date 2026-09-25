import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Account ids the staff budget calculates in a scenario. Empty when the scenario
 * does not use the staff budget.
 *
 * The database decides this (`staff_locked_account_ids`) and also enforces it —
 * this hook only lets the UI show the rows as read-only instead of letting the
 * user type and then get rejected.
 */
export function useStaffAccounts(scenarioId: number | null) {
  const [ids, setIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!scenarioId) {
      setIds(new Set())
      return
    }
    let cancelled = false
    supabase
      .rpc('staff_locked_account_ids', { p_scenario_id: scenarioId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Before the migration has run the function does not exist — nothing is locked then.
          console.error('staff_locked_account_ids failed:', error.message)
          setIds(new Set())
          return
        }
        setIds(new Set(((data ?? []) as { account_id: number }[]).map((r) => r.account_id)))
      })
    return () => { cancelled = true }
  }, [scenarioId])

  return ids
}

/**
 * Who the staff budget is open to in a scenario, or null when it is not in use.
 * Only decides whether to show the tab — the database enforces the same rule
 * (`user_can_access_staff`), so hiding the tab is not what protects the salaries.
 */
export function useStaffVisibility(scenarioId: number | null) {
  const [visibility, setVisibility] = useState<'company_managers' | 'everyone' | null>(null)

  useEffect(() => {
    setVisibility(null)
    if (!scenarioId) return
    let cancelled = false
    supabase
      .from('staff_parameters')
      .select('visibility')
      .eq('scenario_id', scenarioId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setVisibility((data?.visibility as 'company_managers' | 'everyone' | undefined) ?? null)
      })
    return () => { cancelled = true }
  }, [scenarioId])

  return visibility
}
