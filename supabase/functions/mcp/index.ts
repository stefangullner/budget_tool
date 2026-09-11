// MCP server for the On Via Budget Tool database.
// Exposes read-only budget, actuals and metadata tools over MCP Streamable HTTP.
//
// Deploy with JWT verification disabled — this function authenticates callers with
// its own MCP_TOKEN bearer token instead of a Supabase JWT.
//
// The function uses the service role key and therefore bypasses RLS. Every tool is
// read-only; whoever holds MCP_TOKEN can read all companies.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'onvia-budget'
const SERVER_VERSION = '1.0.0'
const MAX_ROWS = 5000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const db: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** An error whose message is safe to show the model as a tool result. */
class ToolError extends Error {}

function expectRows(data: unknown, error: { message: string } | null): any[] {
  if (error) throw new ToolError(error.message)
  return (data ?? []) as any[]
}

type AccountInfo = {
  id: number
  account_number: string
  name: string
  account_type: string
  section: string | null
  display_order: number
  is_budgetable: boolean
  is_intercompany: boolean
}

async function loadAccounts(companyId: number): Promise<Map<number, AccountInfo>> {
  const { data, error } = await db
    .from('accounts')
    .select(
      'id, account_number, name, account_type, ' +
        'config:account_configs(is_budgetable, is_intercompany, section, display_order)',
    )
    .eq('company_id', companyId)
  const rows = expectRows(data, error)

  const map = new Map<number, AccountInfo>()
  for (const row of rows) {
    // PostgREST returns the 1:1 embed as an object, but tolerate an array too.
    const config = Array.isArray(row.config) ? row.config[0] : row.config
    map.set(row.id, {
      id: row.id,
      account_number: row.account_number,
      name: row.name,
      account_type: row.account_type,
      section: config?.section ?? null,
      display_order: config?.display_order ?? 0,
      is_budgetable: config?.is_budgetable ?? false,
      is_intercompany: config?.is_intercompany ?? false,
    })
  }
  return map
}

async function loadCostCenters(companyId: number): Promise<Map<number, { code: string; name: string }>> {
  const { data, error } = await db.from('cost_centers').select('id, code, name').eq('company_id', companyId)
  return new Map(expectRows(data, error).map((r) => [r.id, { code: r.code, name: r.name }]))
}

async function loadCompanyNames(): Promise<Map<number, string>> {
  const { data, error } = await db.from('companies').select('id, name')
  return new Map(expectRows(data, error).map((r) => [r.id, r.name]))
}

/** Section display order from section_configs, used to sort section groups like the app does. */
async function loadSectionOrder(): Promise<Map<string, number>> {
  const { data, error } = await db.from('section_configs').select('name, display_order')
  return new Map(expectRows(data, error).map((r) => [r.name, r.display_order]))
}

async function getScenario(scenarioId: number) {
  const { data, error } = await db
    .from('scenarios')
    .select('id, company_id, name, start_year, start_month, end_year, end_month, is_approved, deadline_date')
    .eq('id', scenarioId)
    .maybeSingle()
  if (error) throw new ToolError(error.message)
  if (!data) throw new ToolError(`Scenario ${scenarioId} does not exist`)
  return data
}

/** Resolves an account_number filter to the matching account ids for a company. */
function accountIdsFor(accounts: Map<number, AccountInfo>, accountNumber?: string): number[] | null {
  if (!accountNumber) return null
  const ids = [...accounts.values()].filter((a) => a.account_number === accountNumber).map((a) => a.id)
  if (ids.length === 0) throw new ToolError(`Account ${accountNumber} does not exist for this company`)
  return ids
}

/** Restricts a requested year to the months the scenario actually covers. */
function monthRange(
  scenario: { start_year: number; start_month: number; end_year: number; end_month: number },
  year: number,
) {
  if (year < scenario.start_year || year > scenario.end_year) {
    throw new ToolError(
      `Year ${year} is outside the scenario period ` +
        `${scenario.start_year}-${scenario.start_month} to ${scenario.end_year}-${scenario.end_month}`,
    )
  }
  return {
    from: year === scenario.start_year ? scenario.start_month : 1,
    to: year === scenario.end_year ? scenario.end_month : 12,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function sum(rows: any[]): number {
  return round2(rows.reduce((total, r) => total + Number(r.amount), 0))
}

type GroupMode = 'none' | 'account' | 'cost_center' | 'month' | 'section'

type Lookups = {
  accounts: Map<number, AccountInfo>
  costCenters: Map<number, { code: string; name: string }>
  companies: Map<number, string>
  sectionOrder: Map<string, number>
}

function groupRows(rows: any[], mode: GroupMode, lookups: Lookups) {
  const groups = new Map<string, { key: string; label: string; amount: number; sort: number }>()
  for (const row of rows) {
    const account = lookups.accounts.get(row.account_id)
    const costCenter = lookups.costCenters.get(row.cost_center_id)
    let key: string
    let label = ''
    let sort = 0
    if (mode === 'account') {
      key = account?.account_number ?? String(row.account_id)
      label = account?.name ?? ''
    } else if (mode === 'cost_center') {
      key = costCenter?.code ?? String(row.cost_center_id)
      label = costCenter?.name ?? ''
    } else if (mode === 'section') {
      key = account?.section ?? '(no section)'
      sort = lookups.sectionOrder.get(key) ?? Number.MAX_SAFE_INTEGER
    } else {
      key = `${row.year}-${String(row.month).padStart(2, '0')}`
    }
    const bucket = groups.get(key) ?? { key, label, amount: 0, sort }
    bucket.amount += Number(row.amount)
    groups.set(key, bucket)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, amount: round2(g.amount) }))
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    .map(({ sort: _sort, ...rest }) => rest)
}

function detailRows(rows: any[], lookups: Lookups) {
  return rows.map((r) => ({
    account_number: lookups.accounts.get(r.account_id)?.account_number ?? null,
    account_name: lookups.accounts.get(r.account_id)?.name ?? null,
    section: lookups.accounts.get(r.account_id)?.section ?? null,
    cost_center: lookups.costCenters.get(r.cost_center_id)?.code ?? null,
    year: r.year,
    month: r.month,
    amount: Number(r.amount),
    // Only present on budget entries; identifies the other party on intercompany rows.
    ...(r.counterpart_company_id === undefined
      ? {}
      : { counterparty: r.counterpart_company_id ? lookups.companies.get(r.counterpart_company_id) ?? null : null }),
  }))
}

async function loadLookups(companyId: number): Promise<Lookups> {
  const [accounts, costCenters, companies, sectionOrder] = await Promise.all([
    loadAccounts(companyId),
    loadCostCenters(companyId),
    loadCompanyNames(),
    loadSectionOrder(),
  ])
  return { accounts, costCenters, companies, sectionOrder }
}

// ------------------------------------------------------------------
// Tools
// ------------------------------------------------------------------

type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, any>) => Promise<unknown>
}

const GROUP_BY_SCHEMA = {
  type: 'string',
  enum: ['none', 'account', 'cost_center', 'month', 'section'],
  description: 'Aggregate the amounts by this dimension. Defaults to "none" (one row per entry).',
}

const TOOLS: Tool[] = [
  {
    name: 'list_companies',
    description:
      'List all companies in the budget tool with their id, name and org number. ' +
      'Call this first — every other tool needs a company_id or a scenario_id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { data, error } = await db
        .from('companies')
        .select('id, name, org_number, fiscal_year_start, fabric_key')
        .order('id')
      return { companies: expectRows(data, error) }
    },
  },

  {
    name: 'list_cost_centers',
    description:
      'List cost centers for a company, with their region. Returns only active cost centers ' +
      'unless include_inactive is true.',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'integer', description: 'Company id from list_companies' },
        region: { type: 'string', description: 'Only return cost centers in this region' },
        include_inactive: { type: 'boolean', description: 'Include cost centers marked inactive. Defaults to false.' },
      },
      required: ['company_id'],
      additionalProperties: false,
    },
    handler: async ({ company_id, region, include_inactive }) => {
      let query = db.from('cost_centers').select('id, code, name, is_active, region').eq('company_id', company_id)
      if (!include_inactive) query = query.eq('is_active', true)
      if (region) query = query.eq('region', region)
      const { data, error } = await query.order('code')
      return { cost_centers: expectRows(data, error) }
    },
  },

  {
    name: 'list_accounts',
    description:
      'List the chart of accounts for a company, including the curated configuration: whether the ' +
      'account is budgetable, whether it is an intercompany account, its report section and display order. ' +
      'Use budgetable_only to get just the accounts that are actually budgeted.',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'integer', description: 'Company id from list_companies' },
        budgetable_only: { type: 'boolean', description: 'Only return accounts flagged as budgetable. Defaults to false.' },
        intercompany_only: { type: 'boolean', description: 'Only return intercompany accounts. Defaults to false.' },
        account_type: { type: 'string', enum: ['income', 'expense', 'balance'], description: 'Filter by account type' },
        section: { type: 'string', description: 'Only return accounts mapped to this report section' },
        search: { type: 'string', description: 'Case-insensitive substring match on account number or name' },
      },
      required: ['company_id'],
      additionalProperties: false,
    },
    handler: async ({ company_id, budgetable_only, intercompany_only, account_type, section, search }) => {
      const accounts = await loadAccounts(company_id)
      const needle = search ? String(search).toLowerCase() : null

      const rows = [...accounts.values()]
        .filter((a) => (budgetable_only ? a.is_budgetable : true))
        .filter((a) => (intercompany_only ? a.is_intercompany : true))
        .filter((a) => (account_type ? a.account_type === account_type : true))
        .filter((a) => (section ? a.section === section : true))
        .filter((a) =>
          needle ? a.account_number.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle) : true,
        )
        .sort((a, b) => a.account_number.localeCompare(b.account_number))

      return { count: rows.length, accounts: rows }
    },
  },

  {
    name: 'list_sections',
    description:
      'List the report sections in their configured display order. Sections group accounts in the budget ' +
      'matrix and in exports; use this when you need to present figures in the same order the app does.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { data, error } = await db.from('section_configs').select('name, display_order').order('display_order')
      return { sections: expectRows(data, error) }
    },
  },

  {
    name: 'list_scenarios',
    description:
      'List budget scenarios for a company, with their period (start/end year and month), deadline and ' +
      'approval status. A scenario is the container every budget figure belongs to.',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'integer', description: 'Company id from list_companies' },
        approved_only: { type: 'boolean', description: 'Only return approved scenarios. Defaults to false.' },
      },
      required: ['company_id'],
      additionalProperties: false,
    },
    handler: async ({ company_id, approved_only }) => {
      let query = db
        .from('scenarios')
        .select(
          'id, name, start_year, start_month, end_year, end_month, is_approved, deadline_date, created_by, created_at',
        )
        .eq('company_id', company_id)
      if (approved_only) query = query.eq('is_approved', true)
      const { data, error } = await query.order('start_year', { ascending: false })
      return { scenarios: expectRows(data, error) }
    },
  },

  {
    name: 'get_budget',
    description:
      'Get budgeted amounts for a scenario, joined with account, section and cost center names. ' +
      'Filter by cost center, account number, year or month, and set group_by to aggregate instead of ' +
      'returning one row per month. Intercompany rows carry a counterparty company.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'Scenario id from list_scenarios' },
        cost_center_id: { type: 'integer', description: 'Limit to one cost center' },
        account_number: { type: 'string', description: 'Limit to one account number, e.g. "5010"' },
        year: { type: 'integer', description: 'Limit to one year' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: 'Limit to one month (1-12)' },
        intercompany: {
          type: 'string',
          enum: ['all', 'only', 'exclude'],
          description:
            'How to treat intercompany rows (rows with a counterpart company). "only" returns just those rows, ' +
            '"exclude" drops them. Defaults to "all".',
        },
        group_by: GROUP_BY_SCHEMA,
      },
      required: ['scenario_id'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, cost_center_id, account_number, year, month, intercompany, group_by }) => {
      const scenario = await getScenario(scenario_id)
      const lookups = await loadLookups(scenario.company_id)
      const accountIds = accountIdsFor(lookups.accounts, account_number)

      let query = db
        .from('budget_entries')
        .select('account_id, cost_center_id, year, month, amount, counterpart_company_id')
        .eq('scenario_id', scenario_id)
      if (cost_center_id) query = query.eq('cost_center_id', cost_center_id)
      if (accountIds) query = query.in('account_id', accountIds)
      if (year) query = query.eq('year', year)
      if (month) query = query.eq('month', month)
      if (intercompany === 'only') query = query.not('counterpart_company_id', 'is', null)
      if (intercompany === 'exclude') query = query.is('counterpart_company_id', null)

      const { data, error } = await query.limit(MAX_ROWS)
      const rows = expectRows(data, error)

      const mode: GroupMode = group_by ?? 'none'
      const base = {
        scenario: { id: scenario.id, name: scenario.name, is_approved: scenario.is_approved },
        count: rows.length,
        truncated: rows.length === MAX_ROWS,
        total: sum(rows),
      }

      return mode === 'none'
        ? { ...base, entries: detailRows(rows, lookups) }
        : { ...base, group_by: mode, groups: groupRows(rows, mode, lookups) }
    },
  },

  {
    name: 'get_actuals',
    description:
      'Get actual amounts for a company, joined with account, section and cost center names. Actuals are ' +
      'stored per company, account, cost center, year and month — they are not tied to a scenario. They arrive ' +
      'through the Fortnox/Fabric sync or the Excel import, so check get_sync_status if figures look stale.',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'integer', description: 'Company id from list_companies' },
        year: { type: 'integer', description: 'Fiscal year to read' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: 'Limit to one month (1-12)' },
        cost_center_id: { type: 'integer', description: 'Limit to one cost center' },
        account_number: { type: 'string', description: 'Limit to one account number, e.g. "5010"' },
        group_by: GROUP_BY_SCHEMA,
      },
      required: ['company_id', 'year'],
      additionalProperties: false,
    },
    handler: async ({ company_id, year, month, cost_center_id, account_number, group_by }) => {
      const lookups = await loadLookups(company_id)
      const accountIds = accountIdsFor(lookups.accounts, account_number)

      let query = db
        .from('actuals')
        .select('account_id, cost_center_id, year, month, amount')
        .eq('company_id', company_id)
        .eq('year', year)
      if (month) query = query.eq('month', month)
      if (cost_center_id) query = query.eq('cost_center_id', cost_center_id)
      if (accountIds) query = query.in('account_id', accountIds)

      const { data, error } = await query.limit(MAX_ROWS)
      const rows = expectRows(data, error)

      const mode: GroupMode = group_by ?? 'none'
      const base = {
        company_id,
        year,
        count: rows.length,
        truncated: rows.length === MAX_ROWS,
        total: sum(rows),
      }

      return mode === 'none'
        ? { ...base, entries: detailRows(rows, lookups) }
        : { ...base, group_by: mode, groups: groupRows(rows, mode, lookups) }
    },
  },

  {
    name: 'compare_budget_actuals',
    description:
      'Compare budget against actuals per account for one year of a scenario and return the variance. ' +
      'Only the months the scenario actually covers are included. This is the main tool for questions like ' +
      '"how are we doing against budget" or "which accounts are over budget". Use through_month to avoid ' +
      'comparing against months that have no actuals yet.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'Scenario id from list_scenarios' },
        year: { type: 'integer', description: 'Year to compare — must fall inside the scenario period' },
        cost_center_id: { type: 'integer', description: 'Limit to one cost center' },
        through_month: {
          type: 'integer',
          minimum: 1,
          maximum: 12,
          description: 'Only compare months up to and including this month',
        },
        group_by: {
          type: 'string',
          enum: ['account', 'section'],
          description: 'Report one line per account (default) or one line per report section',
        },
        min_abs_variance: { type: 'number', description: 'Only return lines whose absolute variance is at least this large' },
      },
      required: ['scenario_id', 'year'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, year, cost_center_id, through_month, group_by, min_abs_variance }) => {
      const scenario = await getScenario(scenario_id)
      const range = monthRange(scenario, year)
      const to = through_month ? Math.min(range.to, through_month) : range.to
      if (to < range.from) {
        throw new ToolError(`through_month ${through_month} is before the scenario starts in ${year}`)
      }

      const [accounts, sectionOrder] = await Promise.all([loadAccounts(scenario.company_id), loadSectionOrder()])

      let budgetQuery = db
        .from('budget_entries')
        .select('account_id, amount')
        .eq('scenario_id', scenario_id)
        .eq('year', year)
        .gte('month', range.from)
        .lte('month', to)
      let actualQuery = db
        .from('actuals')
        .select('account_id, amount')
        .eq('company_id', scenario.company_id)
        .eq('year', year)
        .gte('month', range.from)
        .lte('month', to)
      if (cost_center_id) {
        budgetQuery = budgetQuery.eq('cost_center_id', cost_center_id)
        actualQuery = actualQuery.eq('cost_center_id', cost_center_id)
      }

      const [budgetResult, actualResult] = await Promise.all([
        budgetQuery.limit(MAX_ROWS),
        actualQuery.limit(MAX_ROWS),
      ])
      const budgetRows = expectRows(budgetResult.data, budgetResult.error)
      const actualRows = expectRows(actualResult.data, actualResult.error)

      const bySection = group_by === 'section'
      const keyFor = (accountId: number) => {
        const account = accounts.get(accountId)
        if (bySection) return account?.section ?? '(no section)'
        return account?.account_number ?? String(accountId)
      }

      const sums = new Map<string, { budget: number; actual: number; accountId: number }>()
      const add = (accountId: number, field: 'budget' | 'actual', amount: number) => {
        const key = keyFor(accountId)
        const bucket = sums.get(key) ?? { budget: 0, actual: 0, accountId }
        bucket[field] += amount
        sums.set(key, bucket)
      }
      for (const row of budgetRows) add(row.account_id, 'budget', Number(row.amount))
      for (const row of actualRows) add(row.account_id, 'actual', Number(row.amount))

      const threshold = min_abs_variance ?? 0
      const lines = [...sums.entries()]
        .map(([key, { budget, actual, accountId }]) => {
          const account = accounts.get(accountId)
          const variance = actual - budget
          return {
            ...(bySection
              ? { section: key }
              : { account_number: key, account_name: account?.name ?? null, section: account?.section ?? null }),
            budget: round2(budget),
            actual: round2(actual),
            variance: round2(variance),
            variance_pct: budget === 0 ? null : round2((variance / Math.abs(budget)) * 100),
            sort: bySection ? sectionOrder.get(key) ?? Number.MAX_SAFE_INTEGER : 0,
          }
        })
        .filter((line) => Math.abs(line.variance) >= threshold)
        .sort((a, b) => (bySection ? a.sort - b.sort : Math.abs(b.variance) - Math.abs(a.variance)))
        .map(({ sort: _sort, ...rest }) => rest)

      const totalBudget = round2([...sums.values()].reduce((total, s) => total + s.budget, 0))
      const totalActual = round2([...sums.values()].reduce((total, s) => total + s.actual, 0))

      return {
        scenario: { id: scenario.id, name: scenario.name, is_approved: scenario.is_approved },
        company_id: scenario.company_id,
        year,
        months: { from: range.from, to },
        cost_center_id: cost_center_id ?? null,
        totals: {
          budget: totalBudget,
          actual: totalActual,
          variance: round2(totalActual - totalBudget),
          variance_pct: totalBudget === 0 ? null : round2(((totalActual - totalBudget) / Math.abs(totalBudget)) * 100),
        },
        truncated: budgetRows.length === MAX_ROWS || actualRows.length === MAX_ROWS,
        lines,
      }
    },
  },

  {
    name: 'get_budget_comments',
    description:
      'Read the comments budget owners left on individual budget rows. Useful for explaining why an ' +
      'account was budgeted the way it was.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'Scenario id from list_scenarios' },
        cost_center_id: { type: 'integer', description: 'Limit to one cost center' },
        account_number: { type: 'string', description: 'Limit to one account number' },
      },
      required: ['scenario_id'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, cost_center_id, account_number }) => {
      const scenario = await getScenario(scenario_id)
      const lookups = await loadLookups(scenario.company_id)
      const accountIds = accountIdsFor(lookups.accounts, account_number)

      let query = db
        .from('budget_comments')
        .select('account_id, cost_center_id, month, comment, created_by, created_at')
        .eq('scenario_id', scenario_id)
      if (cost_center_id) query = query.eq('cost_center_id', cost_center_id)
      if (accountIds) query = query.in('account_id', accountIds)

      const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
      const rows = expectRows(data, error)

      return {
        scenario: { id: scenario.id, name: scenario.name },
        comments: rows.map((r) => ({
          account_number: lookups.accounts.get(r.account_id)?.account_number ?? null,
          account_name: lookups.accounts.get(r.account_id)?.name ?? null,
          cost_center: lookups.costCenters.get(r.cost_center_id)?.code ?? null,
          month: r.month,
          comment: r.comment,
          created_by: r.created_by,
          created_at: r.created_at,
        })),
      }
    },
  },

  {
    name: 'get_sync_status',
    description:
      'Show the most recent sync and export events from the sync log, so you can tell how fresh the ' +
      'actuals and the chart of accounts are.',
    inputSchema: {
      type: 'object',
      properties: {
        sync_type: { type: 'string', description: 'Filter by sync type, e.g. "accounts" or "actuals"' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many log rows to return. Defaults to 10.' },
      },
      additionalProperties: false,
    },
    handler: async ({ sync_type, limit }) => {
      let query = db.from('sync_log').select('*')
      if (sync_type) query = query.eq('sync_type', sync_type)
      const { data, error } = await query.order('synced_at', { ascending: false }).limit(limit ?? 10)
      return { runs: expectRows(data, error) }
    },
  },
]

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

// ------------------------------------------------------------------
// JSON-RPC / MCP transport
// ------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** Returns null for notifications, which expect no response body. */
async function handleRpc(message: any): Promise<Record<string, unknown> | null> {
  const { id, method, params } = message ?? {}
  if (id === undefined || id === null) return null

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Read-only access to the On Via budget tool. Start with list_companies, then list_scenarios for ' +
          'that company. Amounts are in SEK. Budget figures always belong to a scenario; actuals are stored ' +
          'per company and are independent of scenarios. Use compare_budget_actuals for variance questions ' +
          'and pass through_month so months without actuals are not counted as a shortfall.',
      })

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      })

    case 'tools/call': {
      const tool = TOOLS_BY_NAME.get(params?.name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        const result = await tool.handler(params?.arguments ?? {})
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        })
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Unexpected error: ${err}`
        return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true })
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'This MCP endpoint only accepts POST' }, 405)

  const token = Deno.env.get('MCP_TOKEN')
  if (!token) return jsonResponse({ error: 'MCP_TOKEN is not configured on the server' }, 500)
  if (req.headers.get('authorization') !== `Bearer ${token}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let message: any
  try {
    message = await req.json()
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'))
  }

  // A client may batch several calls into one array.
  if (Array.isArray(message)) {
    const responses = []
    for (const entry of message) {
      const response = await handleRpc(entry)
      if (response) responses.push(response)
    }
    return responses.length === 0
      ? new Response(null, { status: 202, headers: CORS_HEADERS })
      : jsonResponse(responses)
  }

  const response = await handleRpc(message)
  return response ? jsonResponse(response) : new Response(null, { status: 202, headers: CORS_HEADERS })
})
