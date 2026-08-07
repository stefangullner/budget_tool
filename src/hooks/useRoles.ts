import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RoleDefinition } from '@/types'

export function useRoles() {
  const [roles, setRoles] = useState<RoleDefinition[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase
      .from('roles')
      .select('*')
      .order('is_system', { ascending: false })
      .order('label')
    setRoles((data ?? []) as RoleDefinition[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function createRole(label: string, scope_type: RoleDefinition['scope_type']): Promise<boolean> {
    const name = label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_åäö]/g, '')
    const { error } = await supabase.from('roles').insert({ name, label: label.trim(), scope_type, is_system: false })
    if (!error) await load()
    return !error
  }

  async function deleteRole(name: string): Promise<boolean> {
    const { error } = await supabase.from('roles').delete().eq('name', name)
    if (!error) await load()
    return !error
  }

  return { roles, loading, createRole, deleteRole }
}
