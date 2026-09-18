import { useCallback, useEffect, useState } from 'react'
import { supabase, fetchAllRows } from '@/lib/supabase'
import type { IntercompanyAccountLink } from '@/types'

/** Account details the link list needs — resolved separately, by id. */
export type LinkedAccount = {
  id: number
  account_number: string
  name: string
  company_id: number
}

/**
 * The revenue↔cost account mapping behind intercompany reconciliation.
 *
 * Links are loaded raw and the account details resolved by id rather than
 * embedded: the table has two foreign keys to `accounts`, and an ambiguous
 * embed is a runtime error we cannot see until it hits a user.
 */
export function useIntercompanyLinks() {
  const [links, setLinks] = useState<IntercompanyAccountLink[]>([])
  const [accounts, setAccounts] = useState<Map<number, LinkedAccount>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: linkError } = await supabase
      .from('intercompany_account_links')
      .select('*')
      .order('id')

    if (linkError) {
      setError(linkError.message)
      setLinks([])
      setLoading(false)
      return
    }

    const rows = (data ?? []) as IntercompanyAccountLink[]
    setLinks(rows)
    setError(null)

    const ids = [...new Set(rows.flatMap((l) => [l.revenue_account_id, l.cost_account_id]))]
    if (ids.length === 0) {
      setAccounts(new Map())
      setLoading(false)
      return
    }

    const accountRows = await fetchAllRows<LinkedAccount>((from, to) =>
      supabase
        .from('accounts')
        .select('id, account_number, name, company_id')
        .in('id', ids)
        .order('id')
        .range(from, to),
    )

    setAccounts(new Map(accountRows.map((a) => [a.id, a])))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function addLink(revenueAccountId: number, costAccountId: number, userId: string) {
    const { error: insertError } = await supabase.from('intercompany_account_links').insert({
      revenue_account_id: revenueAccountId,
      cost_account_id: costAccountId,
      created_by: userId,
    })
    if (insertError) {
      setError(insertError.message)
      return false
    }
    await load()
    return true
  }

  async function removeLink(id: number) {
    const { error: deleteError } = await supabase
      .from('intercompany_account_links')
      .delete()
      .eq('id', id)
    if (deleteError) {
      setError(deleteError.message)
      return false
    }
    await load()
    return true
  }

  return {
    links,
    accounts,
    loading,
    error,
    clearError: () => setError(null),
    reload: load,
    addLink,
    removeLink,
  }
}
