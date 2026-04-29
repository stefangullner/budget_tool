import { useEffect, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase, initialHashType } from '@/lib/supabase'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsPasswordSet, setNeedsPasswordSet] = useState(
    initialHashType === 'invite' || initialHashType === 'recovery',
  )

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()
  const clearPasswordSet = () => setNeedsPasswordSet(false)

  return { session, loading, signOut, needsPasswordSet, clearPasswordSet }
}
