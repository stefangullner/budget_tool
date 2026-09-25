import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Plus, RefreshCw, Upload, X, XCircle,
} from 'lucide-react'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useWriteGuard } from '@/lib/writes'
import { scenarioPeriods } from '@/hooks/useBudget'
import { periodDate } from '@/hooks/useStaffBudget'
import SaveErrorBanner from '@/components/SaveErrorBanner'
import {
  downloadStaffTemplate, planMembers, readRows, scanWorkbook, type ImportRow, type SheetScan,
} from '@/lib/staffImport'
import { cn } from '@/lib/utils'
import type { Account, Company, CostCenter, Scenario, StaffParameters } from '@/types'

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december']
const SELECT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'
const INPUT = 'px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500'

/** New scenarios start from the rules in the 2026 staff budget file. */
const DEFAULTS: Omit<StaffParameters, 'scenario_id' | 'updated_by' | 'updated_at' | 'salary_increase_from'> = {
  salary_increase_pct: 3,
  vacation_supplement_pct: 0.8,
  vacation_supplement_month: null,
  employer_fee_pct: 31.42,
  pension_pct: 8.5,
  pension_model: 'flat',
  itp1_breakpoint: null,
  itp1_rate_below: 4.5,
  itp1_rate_above: 30,
  payroll_tax_pct: 24.26,
  absence_pct: 0,
  cost_sign: 1,
  account_salary: '7210',
  account_vacation_supplement: '7285',
  account_employer_fee: '7510',
  account_pension: '7410',
  account_payroll_tax: '7530',
  account_car_benefit: '7390',
  account_car_benefit_fee: '7510',
  book_car_benefit_value: false,
  default_salaries: { Trafiklärare: 27700 },
  visibility: 'company_managers',
}

const ACCOUNT_FIELDS: { key: keyof StaffParameters; label: string; hint: string }[] = [
  { key: 'account_salary', label: 'Lön', hint: 'Månadslön och tillägg × grad × andel' },
  { key: 'account_vacation_supplement', label: 'Semestertillägg', hint: 'Procent per semesterdag' },
  { key: 'account_employer_fee', label: 'Sociala avgifter', hint: 'På lön och semestertillägg' },
  { key: 'account_pension', label: 'Pension', hint: 'På lön och semestertillägg' },
  { key: 'account_payroll_tax', label: 'Löneskatt', hint: 'På pensionen' },
  { key: 'account_car_benefit', label: 'Bilförmån', hint: 'Förmånsvärdet, bara om det bokas' },
  { key: 'account_car_benefit_fee', label: 'Sociala avgifter bilförmån', hint: 'Avgiften på förmånsvärdet' },
]

type Draft = Omit<StaffParameters, 'scenario_id' | 'updated_by' | 'updated_at'>

function toDraft(p: StaffParameters): Draft {
  const { scenario_id: _s, updated_by: _u, updated_at: _a, ...rest } = p
  void _s; void _u; void _a
  return {
    ...rest,
    salary_increase_pct: Number(rest.salary_increase_pct),
    vacation_supplement_pct: Number(rest.vacation_supplement_pct),
    employer_fee_pct: Number(rest.employer_fee_pct),
    pension_pct: Number(rest.pension_pct),
    pension_model: rest.pension_model ?? 'flat',
    itp1_breakpoint: rest.itp1_breakpoint === null || rest.itp1_breakpoint === undefined ? null : Number(rest.itp1_breakpoint),
    itp1_rate_below: Number(rest.itp1_rate_below ?? 4.5),
    itp1_rate_above: Number(rest.itp1_rate_above ?? 30),
    payroll_tax_pct: Number(rest.payroll_tax_pct),
    absence_pct: Number(rest.absence_pct),
    default_salaries: rest.default_salaries ?? {},
  }
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return isNaN(n) ? null : n
}

function PercentInput({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(String(value).replace('.', ','))
  const [focused, setFocused] = useState(false)
  // Sync from outside only while not typing — "31,40" must not snap to "31,4" mid-edit
  useEffect(() => {
    if (!focused) setDraft(String(value).replace('.', ','))
  }, [value, focused])
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        aria-label={ariaLabel}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = parseNum(e.target.value)
          if (n !== null) onChange(n)
        }}
        className={cn(INPUT, 'w-20 text-right tabular-nums')}
      />
      <span className="text-gray-400 text-sm">%</span>
    </span>
  )
}

export default function StaffAdminPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState<number | null>(null)
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [params, setParams] = useState<StaffParameters | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [salarySign, setSalarySign] = useState<1 | -1 | null>(null)
  const [existingEntries, setExistingEntries] = useState<number | null>(null)
  const [memberCount, setMemberCount] = useState<{ total: number; reviewed: number } | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)
  const guard = useWriteGuard()

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      const rows = (data ?? []) as Company[]
      setCompanies(rows)
      setCompanyId((prev) => prev ?? rows[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    setScenarios([])
    setScenarioId(null)
    setCostCenters([])
    setAccounts([])
    if (!companyId) return
    supabase.from('scenarios').select('*').eq('company_id', companyId).order('start_year', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as Scenario[]
        setScenarios(rows)
        setScenarioId(rows[0]?.id ?? null)
      })
    supabase.from('cost_centers').select('*').eq('company_id', companyId).order('code')
      .then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
    fetchAllRows<Account>((from, to) =>
      supabase.from('accounts').select('*').eq('company_id', companyId).order('account_number').range(from, to),
    ).then(setAccounts)
  }, [companyId])

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null
  const periods = useMemo(() => (scenario ? scenarioPeriods(scenario) : []), [scenario])
  const accountByNumber = useMemo(() => new Map(accounts.map((a) => [a.account_number, a])), [accounts])

  const loadScenario = useCallback(async () => {
    setParams(undefined)
    setDraft(null)
    setMemberCount(null)
    setExistingEntries(null)
    if (!scenarioId) return
    const { data } = await supabase.from('staff_parameters').select('*').eq('scenario_id', scenarioId).maybeSingle()
    const p = (data as StaffParameters | null) ?? null
    setParams(p)
    setDraft(p ? toDraft(p) : null)
    const [{ count: total }, { count: reviewed }] = await Promise.all([
      supabase.from('staff_members').select('id', { count: 'exact', head: true }).eq('scenario_id', scenarioId),
      supabase.from('staff_members').select('id', { count: 'exact', head: true }).eq('scenario_id', scenarioId).not('reviewed_at', 'is', null),
    ])
    setMemberCount({ total: total ?? 0, reviewed: reviewed ?? 0 })
  }, [scenarioId])

  useEffect(() => { loadScenario() }, [loadScenario])

  // Which way costs are booked, read from the salary account's actuals
  const salaryAccountId = accountByNumber.get(draft?.account_salary ?? DEFAULTS.account_salary)?.id
  useEffect(() => {
    setSalarySign(null)
    if (!companyId || !salaryAccountId) return
    supabase.from('actuals').select('amount').eq('company_id', companyId).eq('account_id', salaryAccountId).limit(500)
      .then(({ data }) => {
        const sum = (data ?? []).reduce((s, r) => s + Number(r.amount), 0)
        setSalarySign(sum === 0 ? null : sum > 0 ? 1 : -1)
      })
  }, [companyId, salaryAccountId])

  // Hand-entered amounts on the staff accounts that turning it on would replace
  const staffAccountIds = useMemo(() => {
    const src = draft ?? DEFAULTS
    return ACCOUNT_FIELDS
      .map((f) => accountByNumber.get(String(src[f.key as keyof typeof src] ?? ''))?.id)
      .filter((id): id is number => id !== undefined)
  }, [draft, accountByNumber])
  useEffect(() => {
    if (!scenarioId || params !== null || staffAccountIds.length === 0) return
    supabase.from('budget_entries').select('id', { count: 'exact', head: true })
      .eq('scenario_id', scenarioId).in('account_id', staffAccountIds)
      .then(({ count }) => setExistingEntries(count ?? 0))
  }, [scenarioId, params, staffAccountIds])

  async function activate() {
    if (!scenario) return
    setBusy(true)
    const increaseFrom = periods.find((p) => p.month === 5) // May, as in the 2026 file
    const ok = await guard.run(
      supabase.from('staff_parameters').insert({
        scenario_id: scenario.id,
        ...DEFAULTS,
        cost_sign: salarySign ?? DEFAULTS.cost_sign,
        salary_increase_from: increaseFrom ? periodDate(increaseFrom.year, increaseFrom.month) : null,
      }),
    )
    setBusy(false)
    if (ok) await loadScenario()
  }

  async function save() {
    if (!scenarioId || !draft) return
    setBusy(true)
    const ok = await guard.run(supabase.from('staff_parameters').update(draft).eq('scenario_id', scenarioId))
    setBusy(false)
    if (ok) {
      setSavedAt(new Date())
      await loadScenario()
    }
  }

  async function recalc() {
    if (!scenarioId) return
    setBusy(true)
    const ok = await guard.run(supabase.rpc('admin_recalc_staff_budget', { p_scenario_id: scenarioId }))
    setBusy(false)
    if (ok) setSavedAt(new Date())
  }

  async function deactivate() {
    if (!scenarioId) return
    setBusy(true)
    const ok = await guard.run(supabase.from('staff_parameters').delete().eq('scenario_id', scenarioId))
    setBusy(false)
    if (ok) await loadScenario()
  }

  const dirty = params && draft ? JSON.stringify(toDraft(params)) !== JSON.stringify(draft) : false
  // The database refuses ITP1 without a breakpoint; say so before the save does
  const invalid = draft?.pension_model === 'itp1' && !draft.itp1_breakpoint
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Personal</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Regler för personalbudgeten och import av personallistan. Beräkningen görs i databasen och skrivs direkt till personalkontona.
        </p>
      </div>

      <SaveErrorBanner message={guard.error} onDismiss={guard.clearError} />

      <div className="flex gap-4">
        <div className="flex-1 max-w-xs">
          <label className="block text-xs font-medium text-gray-500 mb-1">Bolag</label>
          <select value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : null)} className={SELECT_CLASS}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex-1 max-w-sm">
          <label className="block text-xs font-medium text-gray-500 mb-1">Scenario</label>
          <select value={scenarioId ?? ''} onChange={(e) => setScenarioId(e.target.value ? Number(e.target.value) : null)} className={SELECT_CLASS}>
            {scenarios.length === 0 && <option value="">Inga scenarion</option>}
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {params === undefined && scenarioId && (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" size={20} /></div>
      )}

      {/* Not active yet */}
      {params === null && scenario && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Personalbudgeten är inte aktiverad för {scenario.name}</h3>
          <p className="text-sm text-gray-600 max-w-2xl">
            När den aktiveras räknas personalkontona fram ur personallistan och låses i budgetmatrisen.
            Satserna nedan kommer från Personalbudget 2026 och kan ändras efteråt.
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5">
            <li>Konton: {ACCOUNT_FIELDS.map((f) => DEFAULTS[f.key as keyof typeof DEFAULTS]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</li>
            <li>Löneökning 3 % från maj, sociala avgifter 31,42 %, pension 8,5 %, löneskatt 24,26 %, semestertillägg 0,8 % per dag</li>
            <li>Pensionen startar som fast procent. Byt till ITP1 och fyll i brytpunkten efter aktiveringen.</li>
          </ul>
          {existingEntries !== null && existingEntries > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              Scenariot har redan {existingEntries.toLocaleString('sv-SE')} budgetposter på personalkontona. De ersätts av beräkningen när du aktiverar.
            </div>
          )}
          <button onClick={activate} disabled={busy}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Aktiverar…' : 'Aktivera personalbudget'}
          </button>
        </div>
      )}

      {/* Parameters */}
      {params && draft && scenario && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800 mr-auto">Beräkningsregler</h3>
              {memberCount && (
                <span className="text-xs text-gray-500">
                  {memberCount.total} personer · {memberCount.reviewed} genomgångna
                </span>
              )}
              {savedAt && !dirty && (
                <span className="text-xs text-green-700 inline-flex items-center gap-1">
                  <CheckCircle2 size={13} /> Sparat och omräknat {savedAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button onClick={recalc} disabled={busy}
                title="Normalt behövs inte det här — allt räknas om vid varje ändring"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-md hover:border-gray-400 disabled:opacity-50">
                <RefreshCw size={13} /> Räkna om allt
              </button>
              <button onClick={save} disabled={!dirty || busy || invalid}
                title={invalid ? 'Fyll i brytpunkten för ITP1' : undefined}
                className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 disabled:opacity-40">
                {busy ? 'Sparar…' : 'Spara och räkna om'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50/60 text-sm">
              <span className="text-gray-600 font-medium">Synlig för</span>
              <select
                aria-label="Synlig för"
                value={draft.visibility}
                onChange={(e) => set('visibility', e.target.value as Draft['visibility'])}
                className={INPUT}
              >
                <option value="company_managers">Admin och bolagsansvariga</option>
                <option value="everyone">Alla med behörighet till kostnadsstället</option>
              </select>
              <span className="text-xs text-gray-500">
                {draft.visibility === 'company_managers'
                  ? 'Regioncheferna ser varken fliken eller lönerna. Personalkontona syns låsta i deras matris.'
                  : 'Regioncheferna ser och ändrar personalen på sina egna kostnadsställen.'}
              </span>
            </div>

            <div className="grid gap-8 lg:grid-cols-2 p-6">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Satser</h4>
                <div className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-2.5 items-center text-sm">
                  <span className="text-gray-600">Löneökning</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <PercentInput ariaLabel="Löneökning" value={draft.salary_increase_pct} onChange={(v) => set('salary_increase_pct', v)} />
                    <span className="text-gray-500">från</span>
                    <select aria-label="Löneökning från" value={draft.salary_increase_from ?? ''}
                      onChange={(e) => set('salary_increase_from', e.target.value || null)} className={INPUT}>
                      <option value="">Ingen ökning</option>
                      {periods.map((p) => {
                        const v = periodDate(p.year, p.month)
                        return <option key={v} value={v}>{MONTHS[p.month - 1]} {p.year}</option>
                      })}
                    </select>
                  </span>
                  <span className="text-gray-600">Sociala avgifter</span>
                  <PercentInput ariaLabel="Sociala avgifter" value={draft.employer_fee_pct} onChange={(v) => set('employer_fee_pct', v)} />
                  <span className="text-gray-600">Pension</span>
                  <select aria-label="Pensionsmodell" value={draft.pension_model}
                    onChange={(e) => set('pension_model', e.target.value as Draft['pension_model'])}
                    className={cn(INPUT, 'justify-self-start')}>
                    <option value="itp1">ITP1 — två satser kring brytpunkten</option>
                    <option value="flat">Fast procent på hela lönen</option>
                  </select>
                  {draft.pension_model === 'flat' ? (
                    <>
                      <span className="text-gray-600 pl-3">Sats</span>
                      <PercentInput ariaLabel="Pension" value={draft.pension_pct} onChange={(v) => set('pension_pct', v)} />
                    </>
                  ) : (
                    <>
                      <span className="text-gray-600 pl-3">Upp till brytpunkten</span>
                      <PercentInput ariaLabel="ITP1 under brytpunkten" value={draft.itp1_rate_below} onChange={(v) => set('itp1_rate_below', v)} />
                      <span className="text-gray-600 pl-3">Över brytpunkten</span>
                      <PercentInput ariaLabel="ITP1 över brytpunkten" value={draft.itp1_rate_above} onChange={(v) => set('itp1_rate_above', v)} />
                      <span className="text-gray-600 pl-3">Brytpunkt</span>
                      <Breakpoint value={draft.itp1_breakpoint} onChange={(v) => set('itp1_breakpoint', v)} />
                    </>
                  )}
                  <span className="text-gray-600">Löneskatt på pension</span>
                  <PercentInput ariaLabel="Löneskatt" value={draft.payroll_tax_pct} onChange={(v) => set('payroll_tax_pct', v)} />
                  <span className="text-gray-600">Semestertillägg per dag</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <PercentInput ariaLabel="Semestertillägg per dag" value={draft.vacation_supplement_pct} onChange={(v) => set('vacation_supplement_pct', v)} />
                    <select aria-label="Semestertillägg bokas" value={draft.vacation_supplement_month ?? ''}
                      onChange={(e) => set('vacation_supplement_month', e.target.value ? Number(e.target.value) : null)} className={INPUT}>
                      <option value="">jämnt över året</option>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>allt i {m}</option>)}
                    </select>
                  </span>
                  <span className="text-gray-600">Frånvaroavdrag</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <PercentInput ariaLabel="Frånvaroavdrag" value={draft.absence_pct} onChange={(v) => set('absence_pct', v)} />
                    <span className="text-xs text-gray-400">sänker lönekostnaden. 2026-filen räknade med ca 1,6 %.</span>
                  </span>
                  <span className="text-gray-600">Tecken på kostnader</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <select aria-label="Tecken" value={draft.cost_sign}
                      onChange={(e) => set('cost_sign', Number(e.target.value) as 1 | -1)} className={INPUT}>
                      <option value={1}>Positiva belopp</option>
                      <option value={-1}>Negativa belopp</option>
                    </select>
                    {salarySign !== null && (
                      <span className={cn('text-xs', salarySign === draft.cost_sign ? 'text-green-700' : 'text-red-600')}>
                        Utfallet på {draft.account_salary} är {salarySign > 0 ? 'positivt' : 'negativt'}
                        {salarySign === draft.cost_sign ? ' — stämmer' : ' — byt, annars får budgeten fel tecken'}
                      </span>
                    )}
                  </span>
                  <span className="text-gray-600">Bilförmånens värde</span>
                  <label className="flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={draft.book_car_benefit_value}
                      onChange={(e) => set('book_car_benefit_value', e.target.checked)} className="w-4 h-4 accent-brand-600" />
                    Bokför förmånsvärdet som kostnad
                    <span className="text-xs text-gray-400">(annars bara avgiften, som i 2026-filen)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Konton — låsta i budgetmatrisen</h4>
                <div className="space-y-2">
                  {ACCOUNT_FIELDS.map((f) => {
                    const v = String(draft[f.key as keyof Draft] ?? '')
                    const acc = v ? accountByNumber.get(v) : undefined
                    return (
                      <div key={f.key} className="grid grid-cols-[170px_80px_1fr] items-center gap-2 text-sm">
                        <span className="text-gray-600" title={f.hint}>{f.label}</span>
                        <input aria-label={`Konto ${f.label}`} value={v}
                          onChange={(e) => set(f.key as keyof Draft, (e.target.value.trim() || null) as never)}
                          className={cn(INPUT, 'font-mono w-20')} />
                        <span className={cn('text-xs truncate', !v ? 'text-gray-400' : acc ? 'text-gray-500' : 'text-red-600')}>
                          {!v ? 'Används inte' : acc ? acc.name : 'Kontot finns inte i bolaget — beloppet skrivs inte'}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-4">Ingångslöner för rekryteringar</h4>
                <DefaultSalaries value={draft.default_salaries} onChange={(v) => set('default_salaries', v)} />
              </div>
            </div>
          </div>

          <StaffImport
            scenario={scenario}
            costCenters={costCenters}
            existing={memberCount?.total ?? 0}
            onDone={loadScenario}
            setError={guard.setError}
          />

          <div className="text-xs text-gray-400 flex items-center gap-2">
            <span>Stänga av personalbudgeten låser upp kontona igen. Beloppen ligger kvar som vanliga budgetposter.</span>
            <button onClick={deactivate} disabled={busy} className="underline hover:text-red-600">Stäng av</button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * ITP1 breakpoint in kr per month, with a helper that derives it from the
 * income base amount (7.5 × IBB / 12) — the figure people actually look up.
 */
function Breakpoint({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  const [ibb, setIbb] = useState('')
  useEffect(() => {
    if (!focused) setDraft(value === null ? '' : String(value))
  }, [value, focused])
  const ibbNum = parseNum(ibb)

  return (
    <span className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5">
        <input
          aria-label="Brytpunkt kr per månad"
          value={draft}
          placeholder="kr"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = parseNum(e.target.value)
            onChange(n !== null && n > 0 ? n : null)
          }}
          className={cn(INPUT, 'w-28 text-right tabular-nums', value === null && 'border-red-300')}
        />
        <span className="text-gray-400 text-sm">kr/mån</span>
        {value === null && <span className="text-xs text-red-600">Krävs för ITP1</span>}
      </span>
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        Räkna från inkomstbasbelopp:
        <input
          aria-label="Inkomstbasbelopp"
          value={ibb}
          placeholder="IBB"
          onChange={(e) => setIbb(e.target.value)}
          className={cn(INPUT, 'w-24 text-right tabular-nums text-xs py-1')}
        />
        <button
          type="button"
          disabled={ibbNum === null || ibbNum <= 0}
          onClick={() => {
            if (ibbNum === null) return
            onChange(Math.round((7.5 * ibbNum) / 12))
            setIbb('')
          }}
          className="px-2 py-1 border border-gray-200 rounded-md hover:border-gray-400 disabled:opacity-40"
        >
          × 7,5 / 12
        </button>
      </span>
    </span>
  )
}

function DefaultSalaries({ value, onChange }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const entries = Object.entries(value)
  return (
    <div className="space-y-1.5 text-sm">
      {entries.length === 0 && <p className="text-xs text-gray-400">Inga ingångslöner. Rekryteringar får då fylla i lönen själva.</p>}
      {entries.map(([t, a]) => (
        <div key={t} className="flex items-center gap-2">
          <span className="w-40 text-gray-700">{t}</span>
          <span className="tabular-nums text-gray-700 w-20 text-right">{Number(a).toLocaleString('sv-SE')}</span>
          <button aria-label={`Ta bort ${t}`} onClick={() => {
            const next = { ...value }
            delete next[t]
            onChange(next)
          }} className="text-gray-400 hover:text-red-600"><X size={13} /></button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <input aria-label="Befattning" placeholder="Befattning" value={title} onChange={(e) => setTitle(e.target.value)} className={cn(INPUT, 'w-40')} />
        <input aria-label="Ingångslön" placeholder="Lön" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(INPUT, 'w-24 text-right')} />
        <button
          disabled={!title.trim() || parseNum(amount) === null}
          onClick={() => {
            onChange({ ...value, [title.trim()]: parseNum(amount)! })
            setTitle('')
            setAmount('')
          }}
          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md hover:border-gray-400 disabled:opacity-40"
        >
          <Plus size={12} /> Lägg till
        </button>
      </div>
    </div>
  )
}

function StaffImport({
  scenario, costCenters, existing, onDone, setError,
}: {
  scenario: Scenario
  costCenters: CostCenter[]
  existing: number
  onDone: () => Promise<void>
  setError: (m: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [scan, setScan] = useState<SheetScan | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // Rows are derived, so validation re-runs when the cost centers finish loading
  const rows: ImportRow[] = useMemo(() => (scan ? readRows(scan, costCenters) : []), [scan, costCenters])
  const plan = useMemo(() => planMembers(rows), [rows])
  const errorRows = rows.filter((r) => r.errors.length > 0)
  const shared = plan.filter((p) => p.allocations.length > 0)
  const recruitments = plan.filter((p) => p.is_recruitment)

  function onFile(file: File) {
    setFileName(file.name)
    setReadError(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const s = scanWorkbook(e.target?.result as ArrayBuffer)
        if (!s) setReadError('Hittade ingen rubrikrad med kostnadsställe och månadslön. Jämför med mallen.')
        setScan(s)
      } catch {
        setReadError('Kunde inte läsa filen. Kontrollera att det är en giltig .xlsx.')
        setScan(null)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function doImport() {
    if (plan.length === 0) return
    if (existing > 0 && !replace) return
    setResult(null)
    setProgress('Förbereder…')

    if (existing > 0) {
      const { error } = await supabase.from('staff_members').delete().eq('scenario_id', scenario.id)
      if (error) {
        setError(error.message)
        setProgress(null)
        return
      }
    }

    // People first. Numbers are unique per scenario, so allocations can be
    // matched on them; shared people without a number are matched on name.
    const BATCH = 200
    const idByKey = new Map<string, number>()
    for (let i = 0; i < plan.length; i += BATCH) {
      setProgress(`Personer ${Math.min(i + BATCH, plan.length)} av ${plan.length}`)
      const batch = plan.slice(i, i + BATCH)
      const { data, error } = await supabase
        .from('staff_members')
        .insert(batch.map(({ key: _k, allocations: _a, lines: _l, ...m }) => {
          void _k; void _a; void _l
          return { ...m, scenario_id: scenario.id }
        }))
        .select('id, employee_no, first_name, last_name')
      if (error) {
        setError(`Importen avbröts efter ${i} av ${plan.length} personer: ${error.message}`)
        setProgress(null)
        await onDone()
        return
      }
      for (const r of (data ?? []) as { id: number; employee_no: string | null; first_name: string; last_name: string }[]) {
        const match = batch.find((p) =>
          p.employee_no ? p.employee_no === r.employee_no : !idByKey.has(p.key) && p.first_name === r.first_name && p.last_name === r.last_name && !r.employee_no,
        )
        if (match) idByKey.set(match.key, r.id)
      }
    }

    const allocations = shared.flatMap((p) => {
      const id = idByKey.get(p.key)
      return id ? p.allocations.map((a) => ({ member_id: id, ...a })) : []
    })
    for (let i = 0; i < allocations.length; i += 500) {
      setProgress(`Fördelningar ${Math.min(i + 500, allocations.length)} av ${allocations.length}`)
      const { error } = await supabase.from('staff_allocations').insert(allocations.slice(i, i + 500))
      if (error) {
        setError(`Personerna importerades men fördelningen avbröts: ${error.message}`)
        setProgress(null)
        await onDone()
        return
      }
    }

    setProgress(null)
    setResult(
      `${plan.length} personer importerade, varav ${shared.length} delade och ${recruitments.length} rekryteringar.` +
      (errorRows.length ? ` ${errorRows.length} rader hoppades över.` : ''),
    )
    setScan(null)
    setFileName(null)
    setReplace(false)
    await onDone()
  }

  const errorSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of errorRows) for (const e of r.errors) counts.set(e, (counts.get(e) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [errorRows])

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex-1 min-w-[280px]">
          <h3 className="text-sm font-semibold text-gray-800">Importera personallistan</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            Exporten från personalsystemet läses in en gång per scenario. Kolumnerna känns igen på rubriken:
            anst.nr, efternamn, förnamn, befattning, anställningsform, kst, sysselsättningsgrad, månadslön,
            tillägg, semesterdagar, bilförmån och kommentar. Samma anställningsnummer på flera rader blir en
            person som delas på flera kostnadsställen.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadStaffTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-gray-400">
            <Download size={14} /> Mall
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
            <Upload size={14} /> Välj fil
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        </div>
      </div>

      {readError && (
        <div className="flex items-center gap-2 text-sm text-red-700"><XCircle size={15} /> {readError}</div>
      )}
      {result && (
        <div className="flex items-center gap-2 text-sm text-green-700"><CheckCircle2 size={15} /> {result}</div>
      )}

      {scan && fileName && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <FileSpreadsheet size={15} className="text-gray-400" />
            <span className="font-medium">{fileName}</span>
            <span className="text-gray-400">· fliken "{scan.sheetName}", rubrik på rad {scan.headerRow + 1}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden text-sm">
            {[
              ['Rader', rows.length],
              ['Personer', plan.length],
              ['Delade', shared.length],
              ['Rekryteringar', recruitments.length],
              ['Rader med fel', errorRows.length],
            ].map(([label, n]) => (
              <div key={label} className="bg-white px-3 py-2">
                <div className="text-xs text-gray-500">{label}</div>
                <div className={cn('font-semibold tabular-nums', label === 'Rader med fel' && Number(n) > 0 ? 'text-red-600' : 'text-gray-900')}>{n}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            Validerar mot {costCenters.length} kostnadsställen. Kolumner som hittades: {scan.columns.size} av 12.
          </p>

          {errorSummary.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-1">
              {errorSummary.map(([msg, n]) => <div key={msg}>{msg} — {n} rader</div>)}
              <div className="text-xs text-red-700">
                Rader: {errorRows.slice(0, 30).map((r) => r.line).join(', ')}{errorRows.length > 30 ? ' …' : ''}
              </div>
            </div>
          )}

          <div className="max-h-80 overflow-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Person</th>
                  <th className="text-left px-3 py-2 font-medium">Befattning</th>
                  <th className="text-left px-3 py-2 font-medium">KS</th>
                  <th className="text-right px-3 py-2 font-medium">Grad</th>
                  <th className="text-right px-3 py-2 font-medium">Månadslön</th>
                  <th className="text-left px-3 py-2 font-medium">Kommentar</th>
                </tr>
              </thead>
              <tbody>
                {plan.slice(0, 400).map((p) => {
                  const cc = (id: number) => costCenters.find((c) => c.id === id)?.code ?? id
                  return (
                    <tr key={p.key} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-800">
                        {p.is_recruitment ? <span className="text-violet-700">Rekrytering</span> : `${p.first_name} ${p.last_name}`}
                        {p.employee_no && <span className="text-gray-400"> · {p.employee_no}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{p.title} {p.employment_type && `· ${p.employment_type}`}</td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {p.allocations.length
                          ? p.allocations.map((a) => `${cc(a.cost_center_id)} ${a.share} %`).join(', ')
                          : cc(p.home_cost_center_id)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.employment_rate} %</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{p.monthly_salary.toLocaleString('sv-SE')}</td>
                      <td className="px-3 py-1.5 text-gray-500 max-w-xs truncate" title={p.note ?? ''}>{p.note}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {existing > 0 && (
            <label className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5 w-4 h-4" />
              Scenariot har redan {existing} personer. Ta bort dem, med perioder, fördelningar och regionchefernas ändringar, och ersätt med filen.
            </label>
          )}

          <div className="flex items-center gap-3">
            <button onClick={doImport} disabled={plan.length === 0 || (existing > 0 && !replace) || progress !== null}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-40">
              Importera {plan.length} personer
            </button>
            {progress && <span className="inline-flex items-center gap-1.5 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> {progress}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
