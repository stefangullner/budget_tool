import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Cost centres a user reaches, and which role label grants each one. */
export type AccessMatrix = Map<string, Map<number, string[]>>

export type SectionPerm = { canView: boolean; canEdit: boolean; via: string | null }
/** Section permissions per user, unioned across their roles by the database. */
export type SectionMatrix = Map<string, Map<string, SectionPerm>>

type MatrixRow = { user_id: string; email: string; cost_center_id: number; via: string[] }
type SectionRow = {
  user_id: string
  section_name: string
  can_view: boolean
  can_edit: boolean
  via: string | null
}

/**
 * Reads the effective permissions straight from the database.
 *
 * Both RPCs evaluate `role_matches_cost_center()` — the same predicate the RLS
 * policies go through — so this view cannot disagree with what the policies
 * actually allow. Recomputing the rule in TypeScript would reintroduce exactly
 * the drift this screen exists to catch.
 */
export function useAccessOverview() {
  const [matrix, setMatrix] = useState<AccessMatrix>(new Map())
  const [sections, setSections] = useState<SectionMatrix>(new Map())
  const [allSections, setAllSections] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [access, sectionAccess, sectionList] = await Promise.all([
      supabase.rpc('admin_access_matrix'),
      supabase.rpc('admin_section_access'),
      supabase.from('section_configs').select('name').order('display_order'),
    ])

    const failed = access.error ?? sectionAccess.error ?? sectionList.error
    if (failed) {
      setError(failed.message)
      setLoading(false)
      return
    }

    const byUser: AccessMatrix = new Map()
    for (const row of (access.data ?? []) as MatrixRow[]) {
      let forUser = byUser.get(row.user_id)
      if (!forUser) { forUser = new Map(); byUser.set(row.user_id, forUser) }
      forUser.set(row.cost_center_id, row.via ?? [])
    }

    const bySection: SectionMatrix = new Map()
    for (const row of (sectionAccess.data ?? []) as SectionRow[]) {
      let forUser = bySection.get(row.user_id)
      if (!forUser) { forUser = new Map(); bySection.set(row.user_id, forUser) }
      forUser.set(row.section_name, {
        canView: row.can_view,
        canEdit: row.can_edit,
        via: row.via,
      })
    }

    setMatrix(byUser)
    setSections(bySection)
    setAllSections(((sectionList.data ?? []) as { name: string }[]).map((s) => s.name))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { matrix, sections, allSections, loading, error, reload: load }
}
