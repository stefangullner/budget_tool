// MCP server for the On Via Budget Tool database.
// Exposes budget, actuals and metadata tools over MCP Streamable HTTP, plus a guarded set of
// write tools (budget and intercompany amounts, comments, cost-center locks, new scenarios).
//
// Authentication: OAuth 2.1 through Supabase Auth. The MCP client discovers the authorization server
// from /.well-known/oauth-protected-resource (served below), registers itself, sends the user to the
// consent page in the budget tool, and then calls this function with the user's own access token.
// Every request runs as THAT USER: database queries go through a client carrying the user's token, so
// RLS applies per person (a regional manager only sees their own cost centers), and changes are
// attributed to the user. The service role is used for one thing only: the mcp_change_log table.
//
// Deploy with JWT verification disabled — the function validates the token itself so it can answer
// an unauthenticated client with the OAuth discovery challenge instead of a bare 401.
//
// Section permissions (role_section_permissions) are an app-level rule, not RLS, so they are applied
// here too: accounts in sections the user may not view are hidden, and writing needs can_edit.
//
// Write protocol — nothing is written by a propose_* tool:
//   1. propose_*  validates the change, stores the exact change in mcp_change_log and returns a
//                 preview (old -> new) plus a confirm_token (the log row id).
//   2. apply_change(confirm_token, summary) executes it. This is the ONLY tool that writes
//                 budget data. The client should ask the human to approve each apply_change call —
//                 never allowlist it. The summary must match the stored one, so what the human is
//                 shown is what runs. A token is single-use and expires after 30 minutes.
// Hard rules, re-checked at apply time: no writes to an approved scenario, none to a locked cost
// center, none to personnel accounts calculated by the staff budget, none to accounts that are
// not budgetable, intercompany amounts only on intercompany accounts with a counterparty.
//
// Env (all provided by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// No shared secret exists any more. Setup is in README.md (OAuth server, consent page, migration).

import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'onvia-budget'
const SERVER_VERSION = '3.0.0'
const MAX_ROWS = 5000
const MAX_CHANGES = 500
const PROPOSAL_TTL_MS = 30 * 60 * 1000
const MAX_SCENARIO_MONTHS = 36

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const RESOURCE_URL = `${SUPABASE_URL}/functions/v1/mcp`
const METADATA_URL = `${RESOURCE_URL}/.well-known/oauth-protected-resource`
const NO_SESSION = { persistSession: false, autoRefreshToken: false }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

/** Service role. Used ONLY for mcp_change_log and for validating access tokens — never for budget data. */
const admin: SupabaseClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: NO_SESSION,
})

type RequestContext = { client: SupabaseClient; userId: string; email: string | null; access?: Promise<Access> }
const requestContext = new AsyncLocalStorage<RequestContext>()

function currentContext(): RequestContext {
  const ctx = requestContext.getStore()
  if (!ctx) throw new Error('No request context')
  return ctx
}

/** The signed-in user's id — what every change is attributed to. */
function currentUserId(): string {
  return currentContext().userId
}

/**
 * The database client of the current request: it carries the caller's access token, so RLS applies.
 * A proxy lets every helper below keep writing `db.from(...)` without threading a client through.
 */
const db: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = currentContext().client as any
    const value = client[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

type Access = {
  isAdmin: boolean
  canView: (section: string | null) => boolean
  canEdit: (section: string | null) => boolean
}

/**
 * Section permissions as the app applies them (useRoleSectionPermissions): admin sees and edits
 * everything, otherwise the union of the user's roles' can_view/can_edit per section. No role, or a
 * section nobody granted, means no access. An account without a section is admin-only.
 */
async function loadAccess(): Promise<Access> {
  const ctx = currentContext()
  ctx.access ??= (async () => {
    const { data: roles, error } = await db.from('user_roles').select('role').eq('user_id', ctx.userId)
    if (error) throw new ToolError(`Could not read your roles: ${error.message}`)
    const roleNames = [...new Set(((roles ?? []) as { role: string }[]).map((r) => r.role))]
    if (roleNames.includes('admin')) return { isAdmin: true, canView: () => true, canEdit: () => true }
    if (roleNames.length === 0) return { isAdmin: false, canView: () => false, canEdit: () => false }

    const { data: permRows, error: permError } = await db
      .from('role_section_permissions')
      .select('section_name, can_view, can_edit')
      .in('role', roleNames)
    if (permError) throw new ToolError(`Could not read your section permissions: ${permError.message}`)
    const perms = new Map<string, { view: boolean; edit: boolean }>()
    for (const p of (permRows ?? []) as { section_name: string; can_view: boolean; can_edit: boolean }[]) {
      const existing = perms.get(p.section_name)
      perms.set(p.section_name, {
        view: (existing?.view ?? false) || p.can_view,
        edit: (existing?.edit ?? false) || p.can_edit,
      })
    }
    return {
      isAdmin: false,
      canView: (section: string | null) => (section ? perms.get(section)?.view ?? false : false),
      canEdit: (section: string | null) => (section ? perms.get(section)?.edit ?? false : false),
    }
  })()
  return ctx.access
}

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
  /** Whether the signed-in user may edit this account's section (admin: always). */
  can_edit: boolean
}

/**
 * The company's accounts that the signed-in user may VIEW. Accounts in sections the user has no
 * view permission for are left out entirely, so they cannot be read, named or written.
 */
async function loadAccounts(companyId: number): Promise<Map<number, AccountInfo>> {
  const { data, error } = await db
    .from('accounts')
    .select(
      'id, account_number, name, account_type, ' +
        'config:account_configs(is_budgetable, is_intercompany, section, display_order)',
    )
    .eq('company_id', companyId)
  const rows = expectRows(data, error)
  const access = await loadAccess()

  const map = new Map<number, AccountInfo>()
  for (const row of rows) {
    // PostgREST returns the 1:1 embed as an object, but tolerate an array too.
    const config = Array.isArray(row.config) ? row.config[0] : row.config
    const section: string | null = config?.section ?? null
    if (!access.canView(section)) continue
    map.set(row.id, {
      id: row.id,
      account_number: row.account_number,
      name: row.name,
      account_type: row.account_type,
      section,
      display_order: config?.display_order ?? 0,
      is_budgetable: config?.is_budgetable ?? false,
      is_intercompany: config?.is_intercompany ?? false,
      can_edit: access.canEdit(section),
    })
  }
  return map
}

/** Drops rows belonging to accounts the user may not view (they are absent from the lookup map). */
function visibleRows(rows: any[], accounts: Map<number, AccountInfo>): any[] {
  return rows.filter((r) => accounts.has(r.account_id))
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
// Write helpers
// ------------------------------------------------------------------

/** Pages through a query past PostgREST's 1000-row cap. The query must have a stable order. */
async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    const rows = expectRows(data, error)
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

/**
 * Reads up to MAX_ROWS rows, a page at a time. `.limit(5000)` is not enough: the project's PostgREST
 * max_rows silently caps every response at 1000, which would make totals wrong without any error.
 * `makeQuery` must return a fresh, fully filtered builder each call. `truncated` is true when the
 * cap cut the result off.
 */
async function fetchCapped(makeQuery: () => any): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = []
  for (let from = 0; from < MAX_ROWS; from += 1000) {
    const { data, error } = await makeQuery().order('id').range(from, from + 999)
    const page = expectRows(data, error)
    rows.push(...page)
    if (page.length < 1000) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

function periodIndex(year: number, month: number): number {
  return year * 12 + month
}

function inScenarioPeriod(
  s: { start_year: number; start_month: number; end_year: number; end_month: number },
  year: number,
  month: number,
): boolean {
  const at = periodIndex(year, month)
  return at >= periodIndex(s.start_year, s.start_month) && at <= periodIndex(s.end_year, s.end_month)
}

async function loadCostCentersFull(companyId: number) {
  const { data, error } = await db
    .from('cost_centers')
    .select('id, code, name, is_active')
    .eq('company_id', companyId)
  return new Map(expectRows(data, error).map((r) => [r.id as number, r as { id: number; code: string; name: string; is_active: boolean }]))
}

async function loadLockedCostCenterIds(scenarioId: number): Promise<Set<number>> {
  const { data, error } = await db.from('scenario_locks').select('cost_center_id').eq('scenario_id', scenarioId)
  return new Set(expectRows(data, error).map((r) => r.cost_center_id as number))
}

/**
 * Accounts the staff budget calculates. The database trigger that protects them only fires for the
 * authenticated/anon roles, so the service role used here would walk straight past it.
 */
async function loadStaffLockedAccountIds(scenarioId: number): Promise<Set<number>> {
  const { data, error } = await db.rpc('staff_locked_account_ids', { p_scenario_id: scenarioId })
  if (error) throw new ToolError(`Could not check the personnel-budget accounts, so nothing was written: ${error.message}`)
  return new Set(((data ?? []) as { account_id: number }[]).map((r) => r.account_id))
}

/**
 * The checks every write repeats at apply time — the world may have changed since the proposal:
 * an approved scenario, a locked cost center or a personnel account all stop the write.
 */
async function assertWritable(scenarioId: number, costCenterIds: number[], accountIds: number[]) {
  const scenario = await getScenario(scenarioId)
  if (scenario.is_approved) {
    throw new ToolError(`Scenario "${scenario.name}" (${scenarioId}) is approved and therefore locked for writing.`)
  }
  const locked = await loadLockedCostCenterIds(scenarioId)
  const hit = [...new Set(costCenterIds)].filter((id) => locked.has(id))
  if (hit.length > 0) {
    throw new ToolError(`Cost center(s) ${hit.join(', ')} are locked in scenario ${scenarioId}; unlock them first.`)
  }
  if (accountIds.length > 0) {
    const staff = await loadStaffLockedAccountIds(scenarioId)
    const staffHit = [...new Set(accountIds)].filter((id) => staff.has(id))
    if (staffHit.length > 0) {
      throw new ToolError(`Account id(s) ${staffHit.join(', ')} are calculated by the personnel budget and cannot be written.`)
    }
  }
  return scenario
}

type ChangeKind = 'budget_changes' | 'comment_changes' | 'lock_changes' | 'create_scenarios'

async function createProposal(kind: ChangeKind, summary: string, payload: unknown) {
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString()
  // The log is service-role only (RLS on, no policies); each proposal is bound to the user who made it.
  const { data, error } = await admin
    .from('mcp_change_log')
    .insert({ kind, summary, payload, expires_at: expiresAt, user_id: currentUserId() })
    .select('id')
    .single()
  if (error || !data) {
    const hint = /mcp_change_log/.test(error?.message ?? '')
      ? ' Run supabase/add_mcp_change_log.sql in the SQL editor first.'
      : ''
    throw new ToolError(`Could not store the proposal: ${error?.message}.${hint}`)
  }
  return { confirm_token: data.id as string, expires_at: expiresAt }
}

function applyInstruction(token: string, summary: string) {
  return (
    `Nothing has been written. To apply, call apply_change with confirm_token "${token}" and this exact ` +
    `summary: "${summary}". Show the summary and the preview to the user and get their approval first.`
  )
}

function requireArray(value: unknown, name: string): any[] {
  if (!Array.isArray(value) || value.length === 0) throw new ToolError(`${name} must be a non-empty array`)
  if (value.length > MAX_CHANGES) throw new ToolError(`${name} has ${value.length} items; the limit is ${MAX_CHANGES} per proposal`)
  return value
}

function fmtKr(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(round2(value)).toLocaleString('sv-SE')} kr`
}

// ------------------------------------------------------------------
// Tools
// ------------------------------------------------------------------

type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  handler: (args: Record<string, any>) => Promise<unknown>
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
// propose_* store a proposal row but never touch budget data.
const PROPOSE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const APPLY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }

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

      const makeQuery = () => {
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
        return query
      }
      const fetched = await fetchCapped(makeQuery)
      const rows = visibleRows(fetched.rows, lookups.accounts)
      const truncated = fetched.truncated

      const mode: GroupMode = group_by ?? 'none'
      const base = {
        scenario: { id: scenario.id, name: scenario.name, is_approved: scenario.is_approved },
        count: rows.length,
        truncated,
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

      const makeQuery = () => {
        let query = db
          .from('actuals')
          .select('account_id, cost_center_id, year, month, amount')
          .eq('company_id', company_id)
          .eq('year', year)
        if (month) query = query.eq('month', month)
        if (cost_center_id) query = query.eq('cost_center_id', cost_center_id)
        if (accountIds) query = query.in('account_id', accountIds)
        return query
      }
      const fetched = await fetchCapped(makeQuery)
      const rows = visibleRows(fetched.rows, lookups.accounts)
      const truncated = fetched.truncated

      const mode: GroupMode = group_by ?? 'none'
      const base = {
        company_id,
        year,
        count: rows.length,
        truncated,
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
        include_comments: {
          type: 'boolean',
          description:
            'Attach the budget owners\' comments to each line (group_by "account" only), so the variance comes ' +
            'with the owner\'s explanation. Defaults to false.',
        },
      },
      required: ['scenario_id', 'year'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, year, cost_center_id, through_month, group_by, min_abs_variance, include_comments }) => {
      const scenario = await getScenario(scenario_id)
      const range = monthRange(scenario, year)
      const to = through_month ? Math.min(range.to, through_month) : range.to
      if (to < range.from) {
        throw new ToolError(`through_month ${through_month} is before the scenario starts in ${year}`)
      }

      const [accounts, sectionOrder] = await Promise.all([loadAccounts(scenario.company_id), loadSectionOrder()])

      const makeBudgetQuery = () => {
        let q = db
          .from('budget_entries')
          .select('account_id, amount')
          .eq('scenario_id', scenario_id)
          .eq('year', year)
          .gte('month', range.from)
          .lte('month', to)
        if (cost_center_id) q = q.eq('cost_center_id', cost_center_id)
        return q
      }
      const makeActualQuery = () => {
        let q = db
          .from('actuals')
          .select('account_id, amount')
          .eq('company_id', scenario.company_id)
          .eq('year', year)
          .gte('month', range.from)
          .lte('month', to)
        if (cost_center_id) q = q.eq('cost_center_id', cost_center_id)
        return q
      }

      const [budgetResult, actualResult] = await Promise.all([
        fetchCapped(makeBudgetQuery),
        fetchCapped(makeActualQuery),
      ])
      const budgetRows = visibleRows(budgetResult.rows, accounts)
      const actualRows = visibleRows(actualResult.rows, accounts)

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

      // Comments live per account and cost center; month is null for the row-level comment.
      const commentsByAccount = new Map<string, { cost_center: string | null; month: number | null; comment: string }[]>()
      if (include_comments && !bySection) {
        const costCenters = await loadCostCenters(scenario.company_id)
        const makeCommentQuery = () => {
          let q = db
            .from('budget_comments')
            .select('account_id, cost_center_id, month, comment')
            .eq('scenario_id', scenario_id)
          if (cost_center_id) q = q.eq('cost_center_id', cost_center_id)
          return q
        }
        for (const row of (await fetchCapped(makeCommentQuery)).rows) {
          const number = accounts.get(row.account_id)?.account_number
          if (!number) continue
          const list = commentsByAccount.get(number) ?? []
          list.push({
            cost_center: costCenters.get(row.cost_center_id)?.code ?? null,
            month: row.month,
            comment: row.comment,
          })
          commentsByAccount.set(number, list)
        }
      }

      const threshold = min_abs_variance ?? 0
      const lines = [...sums.entries()]
        .map(([key, { budget, actual, accountId }]) => {
          const account = accounts.get(accountId)
          const variance = actual - budget
          return {
            ...(bySection
              ? { section: key }
              : { account_number: key, account_name: account?.name ?? null, section: account?.section ?? null }),
            ...(include_comments && !bySection ? { comments: commentsByAccount.get(key) ?? [] } : {}),
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
        truncated: budgetResult.truncated || actualResult.truncated,
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
      const rows = visibleRows(expectRows(data, error), lookups.accounts)

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

  // ----------------------------------------------------------------
  // More read tools
  // ----------------------------------------------------------------

  {
    name: 'get_locks',
    description:
      'Show which cost centers are locked in a scenario, and whether the scenario itself is approved. ' +
      'Both stop writes: a locked cost center and an approved scenario cannot be changed through this server.',
    inputSchema: {
      type: 'object',
      properties: { scenario_id: { type: 'integer', description: 'Scenario id from list_scenarios' } },
      required: ['scenario_id'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id }) => {
      const scenario = await getScenario(scenario_id)
      const [costCenters, lockResult] = await Promise.all([
        loadCostCentersFull(scenario.company_id),
        db.from('scenario_locks').select('cost_center_id, locked_by, locked_at').eq('scenario_id', scenario_id),
      ])
      const locks = expectRows(lockResult.data, lockResult.error)
      const lockedIds = new Set(locks.map((l) => l.cost_center_id as number))
      return {
        scenario: { id: scenario.id, name: scenario.name, is_approved: scenario.is_approved },
        writable: !scenario.is_approved,
        locked: locks
          .map((l) => ({
            cost_center_id: l.cost_center_id,
            code: costCenters.get(l.cost_center_id)?.code ?? null,
            name: costCenters.get(l.cost_center_id)?.name ?? null,
            locked_at: l.locked_at,
            locked_by: l.locked_by,
          }))
          .sort((a, b) => String(a.code).localeCompare(String(b.code))),
        unlocked: [...costCenters.values()]
          .filter((c) => c.is_active && !lockedIds.has(c.id))
          .map((c) => ({ cost_center_id: c.id, code: c.code, name: c.name }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      }
    },
  },

  {
    name: 'get_intercompany_budget',
    description:
      'Intercompany budget for a scenario name across all companies, reconciled the way the app does it: for ' +
      'each linked revenue account (seller) and counterparty (buyer) the seller side, the buyer side and the ' +
      'net. The sides should offset each other, so a net of zero means balanced. Scenarios are matched across ' +
      'companies by NAME, so pass any one scenario of the set. To change intercompany amounts, use ' +
      'propose_budget_changes with counterpart_company_id on the scenario of the company that owns the account.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'Any scenario of the set; the others are found by name' },
        only_unbalanced: { type: 'boolean', description: 'Only return pairs whose net is not zero. Defaults to false.' },
        include_cost_centers: {
          type: 'boolean',
          description: 'Add the seller and buyer amounts per cost center. Defaults to false.',
        },
      },
      required: ['scenario_id'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, only_unbalanced, include_cost_centers }) => {
      const anchor = await getScenario(scenario_id)
      const { data: matchData, error: matchError } = await db
        .from('scenarios')
        .select('id, company_id, name, is_approved')
        .eq('name', anchor.name)
      const matching = expectRows(matchData, matchError)

      const scenariosByCompany = new Map<number, number[]>()
      for (const s of matching) scenariosByCompany.set(s.company_id, [...(scenariosByCompany.get(s.company_id) ?? []), s.id])
      const ambiguousCompanies = [...scenariosByCompany.entries()].filter(([, ids]) => ids.length > 1).map(([c]) => c)

      const { data: linkData, error: linkError } = await db
        .from('intercompany_account_links')
        .select('revenue_account_id, cost_account_id')
      let links = expectRows(linkData, linkError)
      if (links.length === 0) return { scenario_name: anchor.name, note: 'No intercompany account links are configured.', lines: [] }

      let accountIds = [...new Set(links.flatMap((l) => [l.revenue_account_id, l.cost_account_id] as number[]))]
      const { data: accData, error: accError } = await db
        .from('accounts')
        .select('id, account_number, name, company_id')
        .in('id', accountIds)
      const accounts = new Map(expectRows(accData, accError).map((a) => [a.id as number, a]))

      // Section permissions: a pair is only shown when the user may view the sections of BOTH accounts.
      const access = await loadAccess()
      if (!access.isAdmin) {
        const { data: cfgData, error: cfgError } = await db
          .from('account_configs')
          .select('account_id, section')
          .in('account_id', accountIds)
        const viewable = new Set(
          expectRows(cfgData, cfgError)
            .filter((c) => access.canView(c.section ?? null))
            .map((c) => c.account_id as number),
        )
        links = links.filter((l) => viewable.has(l.revenue_account_id) && viewable.has(l.cost_account_id))
        if (links.length === 0) return { scenario_name: anchor.name, note: 'No intercompany pairs are visible to you.', lines: [] }
        // Only the accounts of the pairs left: entries on hidden accounts must not be read or counted.
        accountIds = [...new Set(links.flatMap((l) => [l.revenue_account_id, l.cost_account_id] as number[]))]
      }

      const scenarioIds = matching.map((s) => s.id as number)
      const entries = await fetchAll((from, to) =>
        db
          .from('budget_entries')
          .select('id, scenario_id, account_id, cost_center_id, amount, counterpart_company_id')
          .in('scenario_id', scenarioIds)
          .in('account_id', accountIds)
          .order('id')
          .range(from, to),
      )
      const scenarioCompany = new Map(matching.map((s) => [s.id as number, s.company_id as number]))

      const companyNames = await loadCompanyNames()
      let costCenterLookup = new Map<number, string>()
      if (include_cost_centers) {
        const { data, error } = await db
          .from('cost_centers')
          .select('id, code')
          .in('company_id', [...new Set([...accounts.values()].map((a) => a.company_id as number))])
        costCenterLookup = new Map(expectRows(data, error).map((c) => [c.id as number, c.code as string]))
      }

      // Seller revenue account -> buyer company -> buyer cost accounts
      const costByRevenue = new Map<number, Map<number, number[]>>()
      for (const link of links) {
        const cost = accounts.get(link.cost_account_id)
        if (!cost) continue
        const byCompany = costByRevenue.get(link.revenue_account_id) ?? new Map<number, number[]>()
        byCompany.set(cost.company_id, [...(byCompany.get(cost.company_id) ?? []), cost.id])
        costByRevenue.set(link.revenue_account_id, byCompany)
      }

      const sideTotals = (accountIdList: number[], companyId: number, counterpart: number) => {
        let total = 0
        const wanted = new Set(accountIdList)
        const perCostCenter = new Map<string, number>()
        for (const e of entries) {
          if (!wanted.has(e.account_id)) continue
          if (scenarioCompany.get(e.scenario_id) !== companyId) continue
          if (e.counterpart_company_id !== counterpart) continue
          total += Number(e.amount)
          const code = costCenterLookup.get(e.cost_center_id) ?? String(e.cost_center_id)
          perCostCenter.set(code, (perCostCenter.get(code) ?? 0) + Number(e.amount))
        }
        return {
          total: round2(total),
          perCostCenter: [...perCostCenter.entries()]
            .map(([cost_center, amount]) => ({ cost_center, amount: round2(amount) }))
            .filter((r) => r.amount !== 0)
            .sort((a, b) => a.cost_center.localeCompare(b.cost_center)),
        }
      }

      const lines: any[] = []
      for (const [revenueId, byBuyer] of costByRevenue) {
        const revenue = accounts.get(revenueId)
        if (!revenue) continue
        for (const [buyerCompanyId, costAccountIds] of byBuyer) {
          const seller = sideTotals([revenueId], revenue.company_id, buyerCompanyId)
          const buyer = sideTotals(costAccountIds, buyerCompanyId, revenue.company_id)
          const net = round2(seller.total + buyer.total)
          const line = {
            seller_company: { id: revenue.company_id, name: companyNames.get(revenue.company_id) ?? null },
            buyer_company: { id: buyerCompanyId, name: companyNames.get(buyerCompanyId) ?? null },
            revenue_account: `${revenue.account_number} ${revenue.name}`,
            buyer_cost_accounts: costAccountIds.map((id) => {
              const a = accounts.get(id)
              return a ? `${a.account_number} ${a.name}` : String(id)
            }),
            seller_total: seller.total,
            buyer_total: buyer.total,
            net,
            balanced: Math.abs(net) < 0.01,
            same_sign_warning: seller.total !== 0 && buyer.total !== 0 && Math.sign(seller.total) === Math.sign(buyer.total),
            seller_scenario_id: scenariosByCompany.get(revenue.company_id)?.[0] ?? null,
            buyer_scenario_id: scenariosByCompany.get(buyerCompanyId)?.[0] ?? null,
            ...(include_cost_centers ? { seller_by_cost_center: seller.perCostCenter, buyer_by_cost_center: buyer.perCostCenter } : {}),
          }
          if (!only_unbalanced || !line.balanced) lines.push(line)
        }
      }
      lines.sort((a, b) => a.revenue_account.localeCompare(b.revenue_account))

      const involvedCompanies = new Set(lines.flatMap((l) => [l.seller_company.id, l.buyer_company.id]))
      return {
        scenario_name: anchor.name,
        companies_without_a_scenario_of_this_name: [...involvedCompanies]
          .filter((c) => !scenariosByCompany.has(c))
          .map((c) => ({ id: c, name: companyNames.get(c) ?? null })),
        companies_with_duplicate_scenario_names: ambiguousCompanies.map((c) => ({ id: c, name: companyNames.get(c) ?? null })),
        entries_without_counterparty: entries.filter((e) => e.counterpart_company_id === null && Number(e.amount) !== 0).length,
        count: lines.length,
        lines,
      }
    },
  },

  // ----------------------------------------------------------------
  // Write tools — propose_* store a proposal, apply_change executes it
  // ----------------------------------------------------------------

  {
    name: 'propose_budget_changes',
    description:
      'Propose setting budget amounts (SEK) for specific cells: one cost center, account, year and month each. ' +
      'Also used for intercompany amounts — pass counterpart_company_id on a row and the account must be an ' +
      'intercompany account; leave it out for ordinary accounts. Setting 0 keeps the row at 0. Nothing is ' +
      `written: this validates, stores the change and returns a before/after preview plus a confirm_token. All rows ` +
      `must be valid or the whole proposal is rejected (max ${MAX_CHANGES} rows). Refused: approved scenarios, ` +
      'locked cost centers, accounts the personnel budget calculates, non-budgetable accounts, periods outside the ' +
      'scenario, and intercompany accounts without a counterparty. Show the preview to the user, then call ' +
      'apply_change.',
    annotations: PROPOSE,
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer', description: 'Scenario id from list_scenarios' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cost_center_id: { type: 'integer' },
              account_number: { type: 'string', description: 'Account number in the scenario\'s company, e.g. "5010"' },
              year: { type: 'integer' },
              month: { type: 'integer', minimum: 1, maximum: 12 },
              amount: { type: 'number', description: 'New amount in SEK' },
              counterpart_company_id: {
                type: ['integer', 'null'],
                description: 'Intercompany rows only: the other company\'s id',
              },
            },
            required: ['cost_center_id', 'account_number', 'year', 'month', 'amount'],
            additionalProperties: false,
          },
        },
        reason: { type: 'string', description: 'Why the change is made — kept in the change log' },
      },
      required: ['scenario_id', 'changes'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, changes, reason }) => {
      const items = requireArray(changes, 'changes')
      const scenario = await getScenario(scenario_id)
      if (scenario.is_approved) {
        throw new ToolError(`Scenario "${scenario.name}" (${scenario_id}) is approved and therefore locked for writing.`)
      }

      const [accounts, costCenters, locked, staffLocked, companies] = await Promise.all([
        loadAccounts(scenario.company_id),
        loadCostCentersFull(scenario.company_id),
        loadLockedCostCenterIds(scenario_id),
        loadStaffLockedAccountIds(scenario_id),
        loadCompanyNames(),
      ])
      const accountByNumber = new Map([...accounts.values()].map((a) => [a.account_number, a]))

      const errors: string[] = []
      const seen = new Set<string>()
      const rows: {
        account_id: number; cost_center_id: number; year: number; month: number
        amount: number; counterpart_company_id: number | null
      }[] = []

      items.forEach((c, i) => {
        const at = `changes[${i}]`
        const account = accountByNumber.get(String(c.account_number))
        const cc = costCenters.get(c.cost_center_id)
        const counterpart = c.counterpart_company_id ?? null
        if (!account) return void errors.push(`${at}: account ${c.account_number} does not exist in this scenario's company`)
        if (!cc) return void errors.push(`${at}: cost center ${c.cost_center_id} does not belong to this scenario's company`)
        if (!cc.is_active) errors.push(`${at}: cost center ${cc.code} is inactive`)
        if (locked.has(cc.id)) errors.push(`${at}: cost center ${cc.code} is locked`)
        if (!account.is_budgetable) errors.push(`${at}: account ${account.account_number} is not budgetable`)
        if (!account.can_edit) errors.push(`${at}: you may view but not edit section "${account.section}" (account ${account.account_number})`)
        if (staffLocked.has(account.id)) errors.push(`${at}: account ${account.account_number} is calculated by the personnel budget`)
        if (counterpart === null && account.is_intercompany) {
          errors.push(`${at}: ${account.account_number} is an intercompany account — counterpart_company_id is required`)
        }
        if (counterpart !== null) {
          if (!account.is_intercompany) errors.push(`${at}: ${account.account_number} is not an intercompany account, so it takes no counterparty`)
          if (!companies.has(counterpart)) errors.push(`${at}: counterpart company ${counterpart} does not exist`)
          if (counterpart === scenario.company_id) errors.push(`${at}: the counterparty cannot be the scenario's own company`)
        }
        if (!Number.isInteger(c.year) || !Number.isInteger(c.month) || c.month < 1 || c.month > 12 ||
            !inScenarioPeriod(scenario, c.year, c.month)) {
          errors.push(`${at}: ${c.year}-${c.month} is outside the scenario period`)
        }
        if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || Math.abs(c.amount) > 1e12) {
          errors.push(`${at}: amount must be a finite number`)
        }
        const key = `${account.id}:${cc.id}:${c.year}:${c.month}:${counterpart ?? ''}`
        if (seen.has(key)) errors.push(`${at}: the same cell appears twice`)
        seen.add(key)
        rows.push({
          account_id: account.id, cost_center_id: cc.id, year: c.year, month: c.month,
          amount: round2(Number(c.amount)), counterpart_company_id: counterpart,
        })
      })
      if (errors.length > 0) {
        throw new ToolError(`Proposal rejected, nothing stored. ${errors.length} problem(s):\n- ${errors.slice(0, 25).join('\n- ')}` +
          (errors.length > 25 ? `\n- …and ${errors.length - 25} more` : ''))
      }

      const existing = await fetchAll((from, to) =>
        db
          .from('budget_entries')
          .select('id, account_id, cost_center_id, year, month, amount, counterpart_company_id')
          .eq('scenario_id', scenario_id)
          .in('cost_center_id', [...new Set(rows.map((r) => r.cost_center_id))])
          .in('account_id', [...new Set(rows.map((r) => r.account_id))])
          .in('year', [...new Set(rows.map((r) => r.year))])
          .order('id')
          .range(from, to),
      )
      const existingByKey = new Map(
        existing.map((e) => [`${e.account_id}:${e.cost_center_id}:${e.year}:${e.month}:${e.counterpart_company_id ?? ''}`, Number(e.amount)]),
      )

      const toWrite = rows.filter((r) => {
        const old = existingByKey.get(`${r.account_id}:${r.cost_center_id}:${r.year}:${r.month}:${r.counterpart_company_id ?? ''}`)
        return old === undefined || round2(old) !== r.amount
      })
      if (toWrite.length === 0) throw new ToolError('Every row already has the requested amount — nothing to change.')

      const preview = toWrite.map((r) => {
        const old = existingByKey.get(`${r.account_id}:${r.cost_center_id}:${r.year}:${r.month}:${r.counterpart_company_id ?? ''}`)
        return {
          cost_center: costCenters.get(r.cost_center_id)?.code,
          account: `${accounts.get(r.account_id)?.account_number} ${accounts.get(r.account_id)?.name}`,
          period: `${r.year}-${String(r.month).padStart(2, '0')}`,
          ...(r.counterpart_company_id ? { counterparty: companies.get(r.counterpart_company_id) } : {}),
          old: old ?? null,
          new: r.amount,
        }
      })
      const delta = round2(toWrite.reduce((t, r) => {
        const old = existingByKey.get(`${r.account_id}:${r.cost_center_id}:${r.year}:${r.month}:${r.counterpart_company_id ?? ''}`) ?? 0
        return t + r.amount - old
      }, 0))
      const ccCodes = [...new Set(toWrite.map((r) => costCenters.get(r.cost_center_id)?.code))]
      const accNums = [...new Set(toWrite.map((r) => accounts.get(r.account_id)?.account_number))]
      const intercompany = toWrite.some((r) => r.counterpart_company_id !== null)
      const summary =
        `Set ${toWrite.length} ${intercompany ? 'budget/intercompany' : 'budget'} cell(s) in scenario "${scenario.name}" ` +
        `(${companies.get(scenario.company_id)}), cost center(s) ${ccCodes.slice(0, 6).join(', ')}${ccCodes.length > 6 ? '…' : ''}, ` +
        `account(s) ${accNums.slice(0, 6).join(', ')}${accNums.length > 6 ? '…' : ''}; net change ${fmtKr(delta)}`

      // `old` is what the user saw in the preview; apply refuses if a cell has moved since.
      const payloadRows = toWrite.map((r) => ({
        ...r,
        old: existingByKey.get(`${r.account_id}:${r.cost_center_id}:${r.year}:${r.month}:${r.counterpart_company_id ?? ''}`) ?? null,
      }))
      const proposal = await createProposal('budget_changes', summary, { scenario_id, reason: reason ?? null, rows: payloadRows })
      return {
        summary,
        net_change: delta,
        rows_to_write: toWrite.length,
        rows_unchanged: rows.length - toWrite.length,
        preview: preview.slice(0, 100),
        preview_truncated: preview.length > 100,
        ...proposal,
        instruction: applyInstruction(proposal.confirm_token, summary),
      }
    },
  },

  {
    name: 'propose_comment_changes',
    description:
      'Propose writing, updating or removing the row-level comment on an account in a cost center (the comment ' +
      'shown in the budget matrix). An empty comment removes the existing one. Nothing is written until ' +
      'apply_change. Refused on approved scenarios and locked cost centers.',
    annotations: PROPOSE,
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cost_center_id: { type: 'integer' },
              account_number: { type: 'string' },
              comment: { type: 'string', description: 'The comment text (max 2000 characters). Empty string removes it.' },
            },
            required: ['cost_center_id', 'account_number', 'comment'],
            additionalProperties: false,
          },
        },
      },
      required: ['scenario_id', 'comments'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, comments }) => {
      const items = requireArray(comments, 'comments')
      const scenario = await getScenario(scenario_id)
      if (scenario.is_approved) {
        throw new ToolError(`Scenario "${scenario.name}" (${scenario_id}) is approved and therefore locked for writing.`)
      }
      const [accounts, costCenters, locked] = await Promise.all([
        loadAccounts(scenario.company_id),
        loadCostCentersFull(scenario.company_id),
        loadLockedCostCenterIds(scenario_id),
      ])
      const accountByNumber = new Map([...accounts.values()].map((a) => [a.account_number, a]))

      const errors: string[] = []
      const seen = new Set<string>()
      const resolved: { account_id: number; cost_center_id: number; comment: string | null }[] = []
      items.forEach((c, i) => {
        const at = `comments[${i}]`
        const account = accountByNumber.get(String(c.account_number))
        const cc = costCenters.get(c.cost_center_id)
        if (!account) return void errors.push(`${at}: account ${c.account_number} does not exist in this scenario's company`)
        if (!cc) return void errors.push(`${at}: cost center ${c.cost_center_id} does not belong to this scenario's company`)
        if (locked.has(cc.id)) errors.push(`${at}: cost center ${cc.code} is locked`)
        if (!account.can_edit) errors.push(`${at}: you may view but not edit section "${account.section}" (account ${account.account_number})`)
        if (typeof c.comment !== 'string') errors.push(`${at}: comment must be a string`)
        const text = typeof c.comment === 'string' ? c.comment.trim() : ''
        if (text.length > 2000) errors.push(`${at}: comment is longer than 2000 characters`)
        const key = `${account.id}:${cc.id}`
        if (seen.has(key)) errors.push(`${at}: the same account and cost center appears twice`)
        seen.add(key)
        resolved.push({ account_id: account.id, cost_center_id: cc.id, comment: text === '' ? null : text })
      })
      if (errors.length > 0) {
        throw new ToolError(`Proposal rejected, nothing stored. ${errors.length} problem(s):\n- ${errors.slice(0, 25).join('\n- ')}`)
      }

      const existing = await fetchAll((from, to) =>
        db
          .from('budget_comments')
          .select('id, account_id, cost_center_id, comment')
          .eq('scenario_id', scenario_id)
          .is('month', null)
          .in('cost_center_id', [...new Set(resolved.map((r) => r.cost_center_id))])
          .order('id')
          .range(from, to),
      )
      const existingByKey = new Map(existing.map((e) => [`${e.account_id}:${e.cost_center_id}`, e.comment as string]))

      const toWrite = resolved.filter((r) => {
        const old = existingByKey.get(`${r.account_id}:${r.cost_center_id}`) ?? null
        return old !== r.comment
      })
      if (toWrite.length === 0) throw new ToolError('Every comment is already as requested — nothing to change.')

      const preview = toWrite.map((r) => ({
        cost_center: costCenters.get(r.cost_center_id)?.code,
        account: `${accounts.get(r.account_id)?.account_number} ${accounts.get(r.account_id)?.name}`,
        old: existingByKey.get(`${r.account_id}:${r.cost_center_id}`) ?? null,
        new: r.comment,
      }))
      const removals = toWrite.filter((r) => r.comment === null).length
      const excerpt = (text: string | null) => (text === null ? 'REMOVE' : `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`)
      const detail = toWrite
        .slice(0, 4)
        .map((r) => `${costCenters.get(r.cost_center_id)?.code}/${accounts.get(r.account_id)?.account_number} ${excerpt(r.comment)}`)
        .join('; ')
      const summary =
        `Write ${toWrite.length - removals} and remove ${removals} comment(s) in scenario "${scenario.name}" ` +
        `(company ${scenario.company_id}): ${detail}${toWrite.length > 4 ? `; …and ${toWrite.length - 4} more` : ''}`
      const proposal = await createProposal('comment_changes', summary, { scenario_id, rows: toWrite })
      return { summary, preview, ...proposal, instruction: applyInstruction(proposal.confirm_token, summary) }
    },
  },

  {
    name: 'propose_cost_center_locks',
    description:
      'Propose locking and/or unlocking cost centers in a scenario. A locked cost center takes no more budget ' +
      'changes from anyone. Locking is allowed on any scenario; unlocking is refused on an approved scenario. ' +
      'Nothing is changed until apply_change.',
    annotations: PROPOSE,
    inputSchema: {
      type: 'object',
      properties: {
        scenario_id: { type: 'integer' },
        lock: { type: 'array', items: { type: 'integer' }, description: 'Cost center ids to lock' },
        unlock: { type: 'array', items: { type: 'integer' }, description: 'Cost center ids to unlock' },
      },
      required: ['scenario_id'],
      additionalProperties: false,
    },
    handler: async ({ scenario_id, lock, unlock }) => {
      for (const [field, value] of [['lock', lock], ['unlock', unlock]] as const) {
        if (value !== undefined && (!Array.isArray(value) || !value.every(Number.isInteger))) {
          throw new ToolError(`${field} must be an array of integer cost center ids`)
        }
      }
      const toLock: number[] = [...new Set<number>(lock ?? [])]
      const toUnlock: number[] = [...new Set<number>(unlock ?? [])]
      if (toLock.length + toUnlock.length === 0) throw new ToolError('Pass at least one cost center in lock or unlock')
      if (toLock.length + toUnlock.length > 200) throw new ToolError('At most 200 cost centers per proposal')
      if (toLock.some((id) => toUnlock.includes(id))) throw new ToolError('A cost center cannot be both locked and unlocked')

      const scenario = await getScenario(scenario_id)
      if (toUnlock.length > 0 && scenario.is_approved) {
        throw new ToolError(`Scenario "${scenario.name}" is approved, so its cost centers cannot be unlocked.`)
      }
      const [costCenters, locked] = await Promise.all([
        loadCostCentersFull(scenario.company_id),
        loadLockedCostCenterIds(scenario_id),
      ])
      const unknown = [...toLock, ...toUnlock].filter((id) => !costCenters.has(id))
      if (unknown.length > 0) throw new ToolError(`Cost center(s) ${unknown.join(', ')} do not belong to this scenario's company`)

      const lockNow = toLock.filter((id) => !locked.has(id))
      const unlockNow = toUnlock.filter((id) => locked.has(id))
      if (lockNow.length + unlockNow.length === 0) throw new ToolError('Nothing to change — the cost centers are already in the requested state.')

      const names = (ids: number[]) => ids.map((id) => costCenters.get(id)?.code).join(', ')
      const summary =
        `${lockNow.length ? `Lock cost center(s) ${names(lockNow)}` : ''}` +
        `${lockNow.length && unlockNow.length ? '; ' : ''}` +
        `${unlockNow.length ? `Unlock cost center(s) ${names(unlockNow)}` : ''} in scenario "${scenario.name}" (company ${scenario.company_id})`
      const proposal = await createProposal('lock_changes', summary, { scenario_id, lock: lockNow, unlock: unlockNow })
      return {
        summary,
        will_lock: lockNow.map((id) => ({ id, code: costCenters.get(id)?.code, name: costCenters.get(id)?.name })),
        will_unlock: unlockNow.map((id) => ({ id, code: costCenters.get(id)?.code, name: costCenters.get(id)?.name })),
        already_in_state: toLock.length + toUnlock.length - lockNow.length - unlockNow.length,
        ...proposal,
        instruction: applyInstruction(proposal.confirm_token, summary),
      }
    },
  },

  {
    name: 'propose_create_scenarios',
    description:
      'Propose creating a new scenario with the same name in one or more companies (not approved, no locks). ' +
      'Optionally copy the budget entries from an existing scenario — only allowed when creating for that ' +
      'scenario\'s own company, since account ids are company-specific. Refuses a name that already exists in a ' +
      'company, so intercompany matching by name stays unambiguous. Nothing is created until apply_change.',
    annotations: PROPOSE,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        company_ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        start_year: { type: 'integer' },
        start_month: { type: 'integer', minimum: 1, maximum: 12 },
        end_year: { type: 'integer' },
        end_month: { type: 'integer', minimum: 1, maximum: 12 },
        deadline_date: { type: 'string', description: 'Optional, YYYY-MM-DD' },
        comparison_periods: {
          type: 'object',
          description:
            'Optional: which year each month takes comparison actuals from, {"<year>-<month>": <source year>}. ' +
            'Missing key = the year before.',
        },
        copy_from_scenario_id: { type: 'integer', description: 'Optional: copy budget entries from this scenario' },
      },
      required: ['name', 'company_ids', 'start_year', 'start_month', 'end_year', 'end_month'],
      additionalProperties: false,
    },
    handler: async (args) => {
      // The app restricts scenario creation to admins (RLS on scenarios); fail early with a clear message.
      if (!(await loadAccess()).isAdmin) throw new ToolError('Only administrators can create scenarios.')
      const name = String(args.name ?? '').trim()
      if (!name) throw new ToolError('name is required')
      if (!Array.isArray(args.company_ids) || args.company_ids.length === 0 || !args.company_ids.every(Number.isInteger)) {
        throw new ToolError('company_ids must be a non-empty array of integers')
      }
      const companyIds: number[] = [...new Set<number>(args.company_ids)]
      const period = { start_year: args.start_year, start_month: args.start_month, end_year: args.end_year, end_month: args.end_month }
      for (const [field, value] of Object.entries(period)) {
        const isMonth = field.endsWith('_month')
        if (!Number.isInteger(value) || (isMonth ? value < 1 || value > 12 : value < 2000 || value > 2100)) {
          throw new ToolError(`${field} is invalid: ${value}`)
        }
      }
      const startAt = periodIndex(period.start_year, period.start_month)
      const endAt = periodIndex(period.end_year, period.end_month)
      if (!Number.isInteger(startAt) || !Number.isInteger(endAt) || endAt < startAt) {
        throw new ToolError('The period is invalid: the end must not be before the start')
      }
      if (endAt - startAt + 1 > MAX_SCENARIO_MONTHS) throw new ToolError(`A scenario can cover at most ${MAX_SCENARIO_MONTHS} months`)
      if (args.deadline_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.deadline_date)) {
        throw new ToolError('deadline_date must be YYYY-MM-DD')
      }
      let comparison: Record<string, number> | null = null
      if (args.comparison_periods !== undefined) {
        const entries = Object.entries(args.comparison_periods as Record<string, unknown>)
        if (!entries.every(([k, v]) => /^\d{4}-\d{1,2}$/.test(k) && Number.isInteger(v))) {
          throw new ToolError('comparison_periods must look like {"2027-1": 2026}')
        }
        comparison = args.comparison_periods
      }

      const companies = await loadCompanyNames()
      const missing = companyIds.filter((id) => !companies.has(id))
      if (missing.length > 0) throw new ToolError(`Unknown company id(s): ${missing.join(', ')}`)

      const { data: existingData, error: existingError } = await db
        .from('scenarios')
        .select('id, company_id')
        .eq('name', name)
        .in('company_id', companyIds)
      const clash = expectRows(existingData, existingError)
      if (clash.length > 0) {
        throw new ToolError(
          `A scenario named "${name}" already exists for: ${clash.map((c) => companies.get(c.company_id)).join(', ')}. ` +
            'Pick another name — scenarios are matched across companies by name.',
        )
      }

      let copyRows = 0
      if (args.copy_from_scenario_id) {
        const source = await getScenario(args.copy_from_scenario_id)
        if (companyIds.length !== 1 || companyIds[0] !== source.company_id) {
          throw new ToolError('Copying is only possible when creating for the source scenario\'s own company (company_ids must be exactly that one company).')
        }
        const sourceEntries = await fetchAll((from, to) =>
          db.from('budget_entries').select('id, year, month').eq('scenario_id', source.id).order('id').range(from, to),
        )
        copyRows = sourceEntries.filter((e) => inScenarioPeriod(period, e.year, e.month)).length
      }

      const summary =
        `Create scenario "${name}" for ${companyIds.map((c) => companies.get(c)).join(', ')}, ` +
        `${period.start_year}-${period.start_month} to ${period.end_year}-${period.end_month}` +
        `${args.deadline_date ? `, deadline ${args.deadline_date}` : ''}` +
        `${comparison ? `, comparison periods ${JSON.stringify(comparison)}` : ''}` +
        `${args.copy_from_scenario_id ? `, copying ${copyRows} entries from scenario ${args.copy_from_scenario_id}` : ', empty'}`
      const proposal = await createProposal('create_scenarios', summary, {
        name, company_ids: companyIds, ...period,
        deadline_date: args.deadline_date ?? null,
        comparison_periods: comparison,
        copy_from_scenario_id: args.copy_from_scenario_id ?? null,
      })
      return { summary, entries_to_copy: copyRows, ...proposal, instruction: applyInstruction(proposal.confirm_token, summary) }
    },
  },

  {
    name: 'apply_change',
    description:
      'Execute a proposal made by one of the propose_* tools. This is the only tool that writes. The summary must ' +
      'be the exact summary text returned with the proposal — it is what the user approves. A token works once ' +
      'and expires after 30 minutes. All safety rules are checked again before anything is written.',
    annotations: APPLY,
    inputSchema: {
      type: 'object',
      properties: {
        confirm_token: { type: 'string', description: 'The confirm_token from a propose_* tool' },
        summary: { type: 'string', description: 'The exact summary text from the same proposal' },
      },
      required: ['confirm_token', 'summary'],
      additionalProperties: false,
    },
    handler: async ({ confirm_token, summary }) => {
      if (!/^[0-9a-f-]{36}$/i.test(String(confirm_token))) throw new ToolError('confirm_token is not valid')
      const { data: row, error } = await admin.from('mcp_change_log').select('*').eq('id', confirm_token).maybeSingle()
      if (error) throw new ToolError(error.message)
      // The same answer for "missing" and "someone else's" — a token must not reveal other users' proposals.
      if (!row || row.user_id !== currentUserId()) throw new ToolError('No such proposal.')
      if (row.applied_at) throw new ToolError('This proposal has already been applied. Propose the change again if it is still wanted.')
      if (new Date(row.expires_at).getTime() < Date.now()) throw new ToolError('This proposal has expired. Propose the change again.')
      if (String(summary).trim() !== String(row.summary).trim()) {
        throw new ToolError('The summary does not match the proposal. Pass the exact summary text that was shown to the user.')
      }

      // Claim first: a second apply with the same token must find it spent, even if this run fails midway.
      const { data: claimed, error: claimError } = await admin
        .from('mcp_change_log')
        .update({ applied_at: new Date().toISOString() })
        .eq('id', confirm_token)
        .eq('user_id', currentUserId())
        .is('applied_at', null)
        .select('id')
      if (claimError) throw new ToolError(claimError.message)
      if (!claimed || claimed.length === 0) throw new ToolError('This proposal has already been applied.')

      try {
        const result = await EXECUTORS[row.kind as ChangeKind](row.payload)
        await admin.from('mcp_change_log').update({ result }).eq('id', confirm_token)
        return { applied: true, summary: row.summary, ...result }
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Unexpected error: ${err}`
        await admin.from('mcp_change_log').update({ result: { error: message } }).eq('id', confirm_token)
        throw new ToolError(`${message} (The proposal is spent — propose the change again if it is still wanted.)`)
      }
    },
  },
]

// ------------------------------------------------------------------
// Executors — run by apply_change, each re-checking the safety rules
// ------------------------------------------------------------------

const EXECUTORS: Record<ChangeKind, (payload: any) => Promise<Record<string, unknown>>> = {
  async budget_changes({ scenario_id, rows }) {
    const scenario = await assertWritable(
      scenario_id,
      rows.map((r: any) => r.cost_center_id),
      rows.map((r: any) => r.account_id),
    )

    // The proposal may be up to 30 minutes old: re-check the account and cost-center rules and that no
    // cell has moved since the user saw "old -> new".
    const [accounts, costCenters, companies] = await Promise.all([
      loadAccounts(scenario.company_id),
      loadCostCentersFull(scenario.company_id),
      loadCompanyNames(),
    ])
    const problems: string[] = []
    for (const r of rows) {
      const account = accounts.get(r.account_id)
      const cc = costCenters.get(r.cost_center_id)
      const counterpart = r.counterpart_company_id ?? null
      if (!account || !cc) problems.push(`account ${r.account_id} or cost center ${r.cost_center_id} no longer belongs to the scenario's company`)
      else {
        if (!cc.is_active) problems.push(`cost center ${cc.code} is now inactive`)
        if (!account.is_budgetable) problems.push(`account ${account.account_number} is no longer budgetable`)
        if (!account.can_edit) problems.push(`you no longer have edit permission on section "${account.section}" (account ${account.account_number})`)
        if (counterpart === null && account.is_intercompany) problems.push(`account ${account.account_number} is now an intercompany account`)
        if (counterpart !== null && !account.is_intercompany) problems.push(`account ${account.account_number} is no longer an intercompany account`)
        if (counterpart !== null && (!companies.has(counterpart) || counterpart === scenario.company_id)) {
          problems.push(`counterparty ${counterpart} is not valid for account ${account.account_number}`)
        }
      }
      if (!inScenarioPeriod(scenario, r.year, r.month)) problems.push(`${r.year}-${r.month} is outside the scenario period`)
    }
    if (problems.length > 0) throw new ToolError(`Nothing was written — the rules changed since the proposal: ${[...new Set(problems)].slice(0, 10).join('; ')}`)

    const current = await fetchAll((from, to) =>
      db
        .from('budget_entries')
        .select('id, account_id, cost_center_id, year, month, amount, counterpart_company_id')
        .eq('scenario_id', scenario_id)
        .in('cost_center_id', [...new Set<number>(rows.map((r: any) => r.cost_center_id))])
        .in('account_id', [...new Set<number>(rows.map((r: any) => r.account_id))])
        .in('year', [...new Set<number>(rows.map((r: any) => r.year))])
        .order('id')
        .range(from, to),
    )
    const currentByKey = new Map(
      current.map((e) => [`${e.account_id}:${e.cost_center_id}:${e.year}:${e.month}:${e.counterpart_company_id ?? ''}`, Number(e.amount)]),
    )
    const moved = rows.filter((r: any) => {
      const now = currentByKey.get(`${r.account_id}:${r.cost_center_id}:${r.year}:${r.month}:${r.counterpart_company_id ?? ''}`) ?? null
      return (now === null ? null : round2(now)) !== (r.old === null || r.old === undefined ? null : round2(Number(r.old)))
    })
    if (moved.length > 0) {
      throw new ToolError(
        `Nothing was written — ${moved.length} cell(s) changed since the preview was made (e.g. cost center ${moved[0].cost_center_id}, ` +
          `account ${moved[0].account_id}, ${moved[0].year}-${moved[0].month}). Propose the change again to see the current values.`,
      )
    }

    const now = new Date().toISOString()
    const records = rows.map((r: any) => ({
      scenario_id,
      account_id: r.account_id,
      cost_center_id: r.cost_center_id,
      year: r.year,
      month: r.month,
      amount: r.amount,
      counterpart_company_id: r.counterpart_company_id ?? null,
      updated_by: currentUserId(),
      updated_at: now,
    }))
    // One statement, so a rejected row leaves nothing half-written (≤ MAX_CHANGES rows).
    const { error } = await db
      .from('budget_entries')
      .upsert(records, { onConflict: 'scenario_id,account_id,cost_center_id,year,month,counterpart_company_id' })
    if (error) throw new ToolError(`The database rejected the write: ${error.message}`)
    return { rows_written: records.length }
  },

  async comment_changes({ scenario_id, rows }) {
    await assertWritable(scenario_id, rows.map((r: any) => r.cost_center_id), [])
    const writes = rows.filter((r: any) => r.comment !== null)
    const removals = rows.filter((r: any) => r.comment === null)

    if (writes.length > 0) {
      const { error } = await db.from('budget_comments').upsert(
        writes.map((r: any) => ({
          scenario_id,
          account_id: r.account_id,
          cost_center_id: r.cost_center_id,
          month: null,
          comment: r.comment,
          created_by: currentUserId(),
        })),
        { onConflict: 'scenario_id,account_id,cost_center_id,month' },
      )
      if (error) throw new ToolError(`The database rejected the comments: ${error.message}`)
    }
    // One DELETE per cost center rather than per comment.
    const removalsByCostCenter = new Map<number, number[]>()
    for (const r of removals) {
      removalsByCostCenter.set(r.cost_center_id, [...(removalsByCostCenter.get(r.cost_center_id) ?? []), r.account_id])
    }
    let removed = 0
    for (const [costCenterId, accountIds] of removalsByCostCenter) {
      const { data: deleted, error } = await db
        .from('budget_comments')
        .delete()
        .eq('scenario_id', scenario_id)
        .eq('cost_center_id', costCenterId)
        .in('account_id', accountIds)
        .is('month', null)
        .select('id')
      if (error) throw new ToolError(`Comments were written but removing some failed: ${error.message}`)
      // RLS hides rows you may not delete: it deletes nothing and reports no error.
      removed += deleted?.length ?? 0
      if ((deleted?.length ?? 0) !== accountIds.length) {
        throw new ToolError(
          `Only ${deleted?.length ?? 0} of ${accountIds.length} comment(s) in cost center ${costCenterId} could be removed — ` +
            'you may not have permission to delete the others. Comments written before this point were saved.',
        )
      }
    }
    return { comments_written: writes.length, comments_removed: removed }
  },

  async lock_changes({ scenario_id, lock, unlock }) {
    const scenario = await getScenario(scenario_id)
    if (unlock.length > 0 && scenario.is_approved) {
      throw new ToolError(`Scenario "${scenario.name}" is approved, so its cost centers cannot be unlocked.`)
    }
    const ownCostCenters = await loadCostCentersFull(scenario.company_id)
    const foreign = [...lock, ...unlock].filter((id: number) => !ownCostCenters.has(id))
    if (foreign.length > 0) throw new ToolError(`Cost center(s) ${foreign.join(', ')} do not belong to this scenario's company`)
    if (lock.length > 0) {
      const { error } = await db.from('scenario_locks').upsert(
        lock.map((id: number) => ({
          scenario_id,
          cost_center_id: id,
          locked_by: currentUserId(),
          locked_at: new Date().toISOString(),
        })),
        { onConflict: 'scenario_id,cost_center_id', ignoreDuplicates: true },
      )
      if (error) throw new ToolError(`Locking failed: ${error.message}`)
    }
    if (unlock.length > 0) {
      const { data: deleted, error } = await db
        .from('scenario_locks')
        .delete()
        .eq('scenario_id', scenario_id)
        .in('cost_center_id', unlock)
        .select('cost_center_id')
      if (error) throw new ToolError(`${lock.length ? 'Locked, but unlocking' : 'Unlocking'} failed: ${error.message}`)
      // RLS hides rows you may not delete: it deletes nothing and reports no error.
      if ((deleted?.length ?? 0) !== unlock.length) {
        throw new ToolError(
          `Only ${deleted?.length ?? 0} of ${unlock.length} cost center(s) could be unlocked — you may not have ` +
            `permission for the others.${lock.length ? ' The locks requested in the same proposal were applied.' : ''}`,
        )
      }
    }
    return { locked: lock.length, unlocked: unlock.length }
  },

  async create_scenarios(p) {
    const created: { company_id: number; scenario_id: number; entries_copied: number }[] = []
    let source: any[] = []
    if (p.copy_from_scenario_id) {
      source = (
        await fetchAll((from, to) =>
          db.from('budget_entries').select('*').eq('scenario_id', p.copy_from_scenario_id).order('id').range(from, to),
        )
      ).filter((e) => inScenarioPeriod(p, e.year, e.month))
    }

    for (const companyId of p.company_ids as number[]) {
      const { data: clash } = await db.from('scenarios').select('id').eq('name', p.name).eq('company_id', companyId)
      if (clash && clash.length > 0) throw new ToolError(`A scenario named "${p.name}" now exists for company ${companyId}; created so far: ${JSON.stringify(created)}`)

      const { data, error } = await db
        .from('scenarios')
        .insert({
          company_id: companyId,
          name: p.name,
          start_year: p.start_year,
          start_month: p.start_month,
          end_year: p.end_year,
          end_month: p.end_month,
          deadline_date: p.deadline_date,
          comparison_periods: p.comparison_periods,
          is_approved: false,
          created_by: currentUserId(),
        })
        .select('id')
        .single()
      if (error || !data) throw new ToolError(`Creating the scenario for company ${companyId} failed: ${error?.message}; created so far: ${JSON.stringify(created)}`)

      let copied = 0
      const toInsert = source.map((e) => ({
        scenario_id: data.id,
        account_id: e.account_id,
        cost_center_id: e.cost_center_id,
        year: e.year,
        month: e.month,
        amount: e.amount,
        counterpart_company_id: e.counterpart_company_id ?? null,
        updated_by: currentUserId(),
      }))
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error: copyError } = await db.from('budget_entries').insert(toInsert.slice(i, i + 500))
        if (copyError) {
          throw new ToolError(
            `Scenario ${data.id} was created, but copying stopped after ${copied} of ${toInsert.length} entries: ${copyError.message}`,
          )
        }
        copied += Math.min(500, toInsert.length - i)
      }
      created.push({ company_id: companyId, scenario_id: data.id, entries_copied: copied })
    }
    return { created }
  },
}

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
          'Access to the On Via budget tool, acting as the signed-in user: you only see the companies, cost ' +
          'centers and sections that user may see, and changes are recorded under their name. ' +
          'Start with list_companies, then list_scenarios for that company. ' +
          'Amounts are in SEK. Budget figures always belong to a scenario; actuals are stored per company and ' +
          'are independent of scenarios. Use compare_budget_actuals (include_comments for the owners\' notes) ' +
          'for variance questions and pass through_month so months without actuals are not counted as a ' +
          'shortfall. Intercompany is reconciled with get_intercompany_budget. ' +
          'WRITING: every change is two steps. Call a propose_* tool, show the user the summary and preview, ' +
          'and only after the user has approved call apply_change with the confirm_token and the exact ' +
          'summary. Never call apply_change on your own initiative or without showing the preview first. ' +
          'Approved scenarios, locked cost centers and personnel-budget accounts cannot be written; check ' +
          'get_locks before proposing. After a write, read the figures back to confirm the result.',
      })

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations: annotations ?? READ_ONLY,
        })),
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

/**
 * The OAuth challenge (RFC 9728 / MCP authorization): tells an unauthenticated client where to find the
 * protected-resource metadata, which in turn names Supabase Auth as the authorization server.
 */
function unauthorized(detail: string, invalidToken = false): Response {
  // RFC 6750: a token that was sent but is bad/expired must say so (error="invalid_token"), otherwise the
  // client treats the 401 as "never authorized" and restarts the whole flow instead of refreshing.
  const errorPart = invalidToken ? `, error="invalid_token", error_description="${detail}"` : ''
  return new Response(JSON.stringify({ error: invalidToken ? 'invalid_token' : 'unauthorized', error_description: detail }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="onvia-budget"${errorPart}, resource_metadata="${METADATA_URL}"`,
      ...CORS_HEADERS,
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })

  // Protected-resource metadata — public, no token. The path suffix is matched loosely because the
  // platform may or may not include the function name in the pathname.
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return jsonResponse({
      resource: RESOURCE_URL,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'On Via budget tool',
    })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'This MCP endpoint only accepts POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...CORS_HEADERS },
    })
  }

  const header = req.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) return unauthorized('Missing access token')

  // Validate the token with Supabase Auth and learn who is calling.
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData?.user) return unauthorized('Invalid or expired access token', true)

  // From here on every query carries the caller's own token, so RLS decides what they can see.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: NO_SESSION,
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  let message: any
  try {
    message = await req.json()
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'))
  }

  return requestContext.run(
    { client, userId: userData.user.id, email: userData.user.email ?? null },
    async () => {
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
    },
  )
})
