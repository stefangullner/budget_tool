import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const WORKSPACE_ID = 'febab450-3c4c-4bec-88b3-b03be0622aba'
const NOTEBOOK_SYNC_ACCOUNTS_ID = '2bb95f6f-4726-4464-9037-f4e2ec4d524e'
const LAKEHOUSE_BRONZE_ID = 'ea9e1c96-5416-4e2d-b080-9a4b43b3d32c'
const FABRIC_API = 'https://api.fabric.microsoft.com/v1'
const ONELAKE_API = 'https://onelake.dfs.fabric.microsoft.com'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function getAzureToken(tenantId: string, clientId: string, clientSecret: string, scope: string): Promise<string> {
  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  })
  if (!resp.ok) throw new Error(`Azure token error ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  return data.access_token
}

async function runFabricNotebook(notebookId: string, fabricToken: string) {
  const url = `${FABRIC_API}/workspaces/${WORKSPACE_ID}/items/${notebookId}/jobs/instances?jobType=RunNotebook`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fabricToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ executionData: {} }),
  })
  if (resp.status === 202) return { jobId: resp.headers.get('x-ms-operation-id') ?? 'started' }
  const text = await resp.text()
  throw new Error(`Fabric API ${resp.status}: ${text}`)
}

async function uploadToOneLake(path: string, content: string, storageToken: string) {
  const base = `${ONELAKE_API}/${WORKSPACE_ID}/${LAKEHOUSE_BRONZE_ID}/Files/${path}`
  const bytes = new TextEncoder().encode(content)

  // 1. Create file
  const create = await fetch(`${base}?resource=file&overwrite=true`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${storageToken}` },
  })
  if (!create.ok && create.status !== 201) {
    throw new Error(`OneLake create ${create.status}: ${await create.text()}`)
  }

  // 2. Append content
  const append = await fetch(`${base}?action=append&position=0`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes.length),
    },
    body: bytes,
  })
  if (!append.ok) {
    throw new Error(`OneLake append ${append.status}: ${await append.text()}`)
  }

  // 3. Flush
  const flush = await fetch(`${base}?action=flush&position=${bytes.length}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${storageToken}` },
  })
  if (!flush.ok) {
    throw new Error(`OneLake flush ${flush.status}: ${await flush.text()}`)
  }
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = r[h] ?? ''
        const s = String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ),
  ]
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Verify caller is authenticated admin
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(token ?? '')
  if (!user) return new Response('Unauthorized', { status: 401, headers: cors })
  const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id)
  if (!roles?.some((r) => r.role === 'admin'))
    return new Response('Forbidden', { status: 403, headers: cors })

  const tenantId = Deno.env.get('AZURE_TENANT_ID') ?? ''
  const clientId = Deno.env.get('AZURE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET') ?? ''

  if (!tenantId || !clientId || !clientSecret) {
    return json({ error: 'AZURE_TENANT_ID, AZURE_CLIENT_ID och AZURE_CLIENT_SECRET måste vara satta i edge function secrets' }, 500)
  }

  try {
    const body = await req.json()
    const { action } = body

    // --- Trigga kontosynk ---
    if (action === 'sync-accounts') {
      const fabricToken = await getAzureToken(tenantId, clientId, clientSecret, 'https://api.fabric.microsoft.com/.default')
      const result = await runFabricNotebook(NOTEBOOK_SYNC_ACCOUNTS_ID, fabricToken)
      await supabase.from('sync_log').insert({
        sync_type: 'accounts_trigger',
        triggered_by: user.email ?? user.id,
        status: 'success',
        details: result,
      })
      return json({ ok: true, ...result })
    }

    // --- Exportera scenario till Fabric ---
    if (action === 'export-scenario') {
      const storageToken = await getAzureToken(tenantId, clientId, clientSecret, 'https://storage.azure.com/.default')
      const { scenarioId } = body
      if (!scenarioId) return json({ error: 'scenarioId krävs' }, 400)

      const { data: scenario } = await supabase
        .from('scenarios')
        .select('id, name, company_id, companies(name)')
        .eq('id', scenarioId)
        .single()
      if (!scenario) return json({ error: 'Scenario hittades inte' }, 404)

      const { data: entries } = await supabase
        .from('budget_entries')
        .select(`
          year, month, amount,
          accounts(account_number, name),
          cost_centers(code, name)
        `)
        .eq('scenario_id', scenarioId)

      const rows = (entries ?? []).map((e: any) => ({
        scenario_id: scenarioId,
        scenario_name: scenario.name,
        company_id: scenario.company_id,
        company_name: (scenario as any).companies?.name ?? '',
        account_number: e.accounts?.account_number ?? '',
        account_name: e.accounts?.name ?? '',
        cost_center_code: e.cost_centers?.code ?? '',
        cost_center_name: e.cost_centers?.name ?? '',
        year: e.year,
        month: e.month,
        amount: e.amount,
      }))

      const csv = toCSV(rows)
      const date = new Date().toISOString().slice(0, 10)
      const safeName = scenario.name.replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '_')
      const filename = `forecasts/${safeName}_${date}.csv`

      await uploadToOneLake(filename, csv, storageToken)

      await supabase.from('sync_log').insert({
        sync_type: 'export',
        triggered_by: user.email ?? user.id,
        status: 'success',
        details: { scenario_id: scenarioId, scenario_name: scenario.name, rows: rows.length, file: filename },
      })

      return json({ ok: true, file: `lh_bronze/Files/${filename}`, rows: rows.length })
    }

    return json({ error: 'Okänd action' }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
