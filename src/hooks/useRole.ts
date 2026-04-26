import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type UserRole = 'admin' | 'company_manager' | 'cost_center_manager' | null

export function useRole() {
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setLoading(false); return }
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .order('role')

      if (!roles || roles.length === 0) { setLoading(false); return }

      // Return the most privileged role
      if (roles.some((r) => r.role === 'admin')) setRole('admin')
      else if (roles.some((r) => r.role === 'company_manager')) setRole('company_manager')
      else setRole('cost_center_manager')

      setLoading(false)
    })
  }, [])

  return { role, isAdmin: role === 'admin', loading }
}
