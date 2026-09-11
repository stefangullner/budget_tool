import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * PostgREST caps every response at 1000 rows (Supabase's default `db-max-rows`),
 * silently — you get 1000 rows and no error. Any query that can exceed that must
 * page through with .range() instead of selecting in one go.
 *
 * Pass a callback that applies .range(from, to) to the query. Always include a
 * stable .order() so pages don't overlap or skip rows.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) {
      console.error('fetchAllRows failed after %d rows:', all.length, error)
      break
    }
    const batch = (data ?? []) as T[]
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

// Capture hash type before Supabase clears it on client init
export const initialHashType = new URLSearchParams(window.location.hash.slice(1)).get('type')
