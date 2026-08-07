import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function useSectionOrder(): Map<string, number> {
  const [orderMap, setOrderMap] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    supabase
      .from('section_configs')
      .select('name, display_order')
      .then(({ data }) => {
        const map = new Map<string, number>()
        for (const row of data ?? []) {
          map.set(row.name as string, row.display_order as number)
        }
        setOrderMap(map)
      })
  }, [])

  return orderMap
}

export function sortSections(
  sections: string[],
  orderMap: Map<string, number>,
): string[] {
  return [...sections].sort((a, b) => {
    const oa = orderMap.get(a) ?? 999
    const ob = orderMap.get(b) ?? 999
    if (oa !== ob) return oa - ob
    return a.localeCompare(b, 'sv')
  })
}
