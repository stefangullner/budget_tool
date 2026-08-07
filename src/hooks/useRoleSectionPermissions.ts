import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface SectionPerms {
  canView: (sectionName: string) => boolean
  canEdit: (sectionName: string) => boolean
  isAdmin: boolean
  loaded: boolean
}

export function useRoleSectionPermissions(): SectionPerms {
  const [perms, setPerms] = useState<Map<string, { can_view: boolean; can_edit: boolean }>>(new Map())
  const [isAdmin, setIsAdmin] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoaded(true); return }

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)

      if (!roles?.length) { setLoaded(true); return }

      if (roles.some((r) => r.role === 'admin')) {
        setIsAdmin(true)
        setLoaded(true)
        return
      }

      const roleTypes = [...new Set(roles.map((r) => r.role as string))]
      const { data: permRows } = await supabase
        .from('role_section_permissions')
        .select('section_name, can_view, can_edit')
        .in('role', roleTypes)

      const map = new Map<string, { can_view: boolean; can_edit: boolean }>()
      for (const p of permRows ?? []) {
        const existing = map.get(p.section_name)
        // Union of all roles: grant access if ANY role grants it
        map.set(p.section_name, {
          can_view: (existing?.can_view ?? false) || p.can_view,
          can_edit: (existing?.can_edit ?? false) || p.can_edit,
        })
      }
      setPerms(map)
      setLoaded(true)
    }
    load()
  }, [])

  function canView(sectionName: string): boolean {
    if (isAdmin) return true
    return perms.get(sectionName)?.can_view ?? false
  }

  function canEdit(sectionName: string): boolean {
    if (isAdmin) return true
    return perms.get(sectionName)?.can_edit ?? false
  }

  return { canView, canEdit, isAdmin, loaded }
}
