import { createClient } from 'jsr:@supabase/supabase-js@2'

const FORTNOX_TOKEN_URL = 'https://apps.fortnox.se/oauth-v1/token'
const FORTNOX_BASE_URL = 'https://api.fortnox.se/3'

const COMPANIES = [
  { fabricKey: 'bolag1', companyId: 1 },
  { fabricKey: 'bolag2', companyId: 2 },
  { fabricKey: 'bolag3', companyId: 3 },
  { fabricKey: 'bolag4', companyId: 4 },
]

function deriveAccountType(number: string): 'income' | 'expense' | 'balance' {
  const n = parseInt(number)
  if (n >= 3000 && n <= 3999) return 'income'
  if (n >= 4000 && n <= 8999) return 'expense'
  return 'balance'
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; newRefreshToken: string | null }> {
  const credentials = btoa(`${clientId}:${clientSecret}`)
  const resp = await fetch(FORTNOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!resp.ok) throw new Error(`Token error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return {
    accessToken: data.access_token,
    newRefreshToken: data.refresh_token !== refreshToken ? (data.refresh_token ?? null) : null,
  }
}

async function fortnoxGet(path: string, accessToken: string): Promise<any> {
  await new Promise((r) => setTimeout(r, 150))
  const resp = await fetch(`${FORTNOX_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!resp.ok) throw new Error(`Fortnox ${path} error ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

async function fetchAllAccounts(accessToken: string): Promise<any[]> {
  const fyData = await fortnoxGet('/financialyears', accessToken)
  const years: any[] = fyData.FinancialYears ?? []

  const seen = new Set<string>()
  const all: any[] = []

  for (const fy of years) {
    const data = await fortnoxGet(`/accounts?financialyear=${fy.Id}&limit=500`, accessToken)
    for (const acc of data.Accounts ?? []) {
      if (!seen.has(acc.Number)) {
        seen.add(acc.Number)
        all.push(acc)
      }
    }
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const clientId = Deno.env.get('FORTNOX_CLIENT_ID')!
    const clientSecret = Deno.env.get('FORTNOX_CLIENT_SECRET')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const results: Record<string, { synced?: number; error?: string }> = {}

    for (const { fabricKey, companyId } of COMPANIES) {
      try {
        const { data: tokenRow, error: tokenErr } = await supabase
          .from('fortnox_tokens')
          .select('refresh_token')
          .eq('company_fabric_key', fabricKey)
          .single()

        if (tokenErr || !tokenRow) {
          results[fabricKey] = { error: 'Refresh token saknas' }
          continue
        }

        const { accessToken, newRefreshToken } = await refreshAccessToken(
          tokenRow.refresh_token,
          clientId,
          clientSecret,
        )

        if (newRefreshToken) {
          await supabase
            .from('fortnox_tokens')
            .update({ refresh_token: newRefreshToken, updated_at: new Date().toISOString() })
            .eq('company_fabric_key', fabricKey)
        }

        const rawAccounts = await fetchAllAccounts(accessToken)

        const accountRows = rawAccounts
          .filter((a) => a.Active !== false && a.Number)
          .map((a) => ({
            company_id: companyId,
            account_number: String(a.Number),
            name: a.Description ?? '',
            account_type: deriveAccountType(String(a.Number)),
          }))

        if (accountRows.length > 0) {
          const { error: upsertErr } = await supabase
            .from('accounts')
            .upsert(accountRows, { onConflict: 'company_id,account_number' })
          if (upsertErr) throw upsertErr
        }

        // Ensure account_configs rows exist for all accounts (is_budgetable defaults to false)
        const { data: inserted } = await supabase
          .from('accounts')
          .select('id')
          .eq('company_id', companyId)

        if (inserted && inserted.length > 0) {
          await supabase.from('account_configs').upsert(
            inserted.map((a) => ({
              account_id: a.id,
              is_budgetable: false,
              is_calculated: false,
              display_order: 0,
            })),
            { onConflict: 'account_id', ignoreDuplicates: true },
          )
        }

        results[fabricKey] = { synced: accountRows.length }
      } catch (err) {
        results[fabricKey] = { error: String(err) }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
