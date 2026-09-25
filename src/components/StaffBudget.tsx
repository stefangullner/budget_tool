import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Lock, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { scenarioPeriods, periodKey } from '@/hooks/useBudget'
import { memberName, periodDate, useStaffBudget } from '@/hooks/useStaffBudget'
import SaveErrorBanner from '@/components/SaveErrorBanner'
import type { CostCenter, EmploymentType, Scenario, StaffCostRow, StaffMember, StaffParameters } from '@/types'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: 'TV', label: 'Tillsvidare' },
  { value: 'PRO', label: 'Provanställning' },
  { value: 'TID', label: 'Tidsbegränsad / timmar' },
]

const PERIOD_REASONS = ['Föräldraledig', 'Tjänstledig', 'Sjukskriven', 'Slutar', 'Ändrad grad', 'Ej anställd än', 'Annat']

const INPUT = 'px-2 py-1 border border-gray-200 rounded text-xs bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500'

interface Props {
  scenario: Scenario
  costCenterId: number
  /** Cost centers the user can see — for the allocation editor and home KS. */
  costCenters: CostCenter[]
  isLocked: boolean
  /** Comparison actuals of the selected KS, keyed "year-month:accountId". */
  prevActuals: Map<string, number>
  staffAccountIds: Set<number>
}

function fmt(n: number) {
  if (Math.round(n) === 0) return ''
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function fmtTkr(n: number) {
  return `${(n / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} tkr`
}

function parseNum(s: string): number | null {
  const cleaned = s.replace(/\s/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function periodLabel(date: string) {
  const [y, m] = date.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** A number field that saves on blur or Enter, and only when the value changed. */
function NumberField({
  value, onCommit, disabled, className, min, max, suffix, ariaLabel,
}: {
  value: number
  onCommit: (v: number) => void
  disabled?: boolean
  className?: string
  min?: number
  max?: number
  suffix?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    const n = parseNum(draft)
    if (n === null) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    if (clamped !== value) onCommit(clamped)
    else setDraft(String(value))
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(String(value))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={cn(INPUT, 'text-right tabular-nums', disabled && 'border-transparent bg-transparent hover:border-transparent', className)}
      />
      {suffix && <span className="text-gray-400">{suffix}</span>}
    </span>
  )
}

function TextField({
  value, onCommit, disabled, placeholder, className, ariaLabel,
}: {
  value: string
  onCommit: (v: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={cn(INPUT, disabled && 'border-transparent bg-transparent hover:border-transparent', className)}
    />
  )
}

export default function StaffBudget({
  scenario, costCenterId, costCenters, isLocked, prevActuals, staffAccountIds,
}: Props) {
  const staff = useStaffBudget(scenario.id, costCenterId)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)

  const periods = useMemo(() => scenarioPeriods(scenario), [scenario])
  const scenarioStart = periodDate(scenario.start_year, scenario.start_month)
  const ccById = useMemo(() => new Map(costCenters.map((c) => [c.id, c])), [costCenters])

  const monthTotals = useMemo(
    () =>
      periods.map((p) => {
        let sum = 0
        for (const m of staff.visibleMembers) {
          sum += staff.costByMember.get(m.id)?.get(`${p.year}-${p.month}`)?.total ?? 0
        }
        return sum
      }),
    [periods, staff.visibleMembers, staff.costByMember],
  )
  const total = monthTotals.reduce((a, b) => a + b, 0)

  const prevTotals = useMemo(
    () =>
      periods.map((p) => {
        let sum = 0
        for (const id of staffAccountIds) sum += prevActuals.get(`${periodKey(p.year, p.month)}:${id}`) ?? 0
        return sum
      }),
    [periods, staffAccountIds, prevActuals],
  )
  const prevTotal = prevTotals.reduce((a, b) => a + b, 0)

  const fte = useMemo(() => {
    if (periods.length === 0) return 0
    let sum = 0
    for (const m of staff.visibleMembers) {
      const rows = staff.costByMember.get(m.id)
      if (!rows) continue
      for (const r of rows.values()) sum += (r.rate / 100) * (r.share / 100)
    }
    return sum / periods.length
  }, [periods, staff.visibleMembers, staff.costByMember])

  function memberTotal(id: number) {
    let sum = 0
    for (const r of staff.costByMember.get(id)?.values() ?? []) sum += r.total
    return sum
  }

  function toggleExpand(id: number) {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (staff.params === undefined || (staff.loading && staff.members.length === 0)) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (staff.params === null) {
    return (
      <div className="text-center py-20 text-gray-500 text-sm">
        {staff.loadError
          ? <>Personalbudgeten kunde inte läsas: {staff.loadError}</>
          : <>Personalbudgeten är inte aktiverad för det här scenariot. En administratör aktiverar den under Admin → Personal.</>}
      </div>
    )
  }

  const people = staff.visibleMembers
  const included = people.filter((m) => m.included)
  const recruitments = included.filter((m) => m.is_recruitment)
  const reviewed = people.filter((m) => m.reviewed_at).length
  const delta = total - prevTotal
  const editable = !isLocked

  return (
    <div className="space-y-4">
      <SaveErrorBanner message={staff.saveError} onDismiss={staff.clearSaveError} />

      {isLocked && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
          <Lock size={14} className="shrink-0" />
          Kostnadsstället är låst. Lås upp det i matrisen för att ändra personalbudgeten.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-gray-500">Personalkostnad helår</div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">{fmtTkr(total)}</div>
          {prevTotal !== 0 && (
            <div className="text-xs tabular-nums">
              <span className={Math.abs(delta) < 1000 ? 'text-gray-500' : (delta * Math.sign(prevTotal) > 0 ? 'text-red-600' : 'text-green-700')}>
                {delta >= 0 ? '+' : '−'}{fmtTkr(Math.abs(delta))}
              </span>{' '}
              <span className="text-gray-400">mot utfall på personalkontona</span>
            </div>
          )}
        </div>
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-gray-500">Årsarbetare här (snitt)</div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">
            {fte.toLocaleString('sv-SE', { maximumFractionDigits: 1 })}
          </div>
          <div className="text-xs text-gray-400">grad × andel på det här KS:et</div>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-gray-500">Personer med</div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">{included.length}</div>
          <div className="text-xs text-gray-400">
            {people.length - included.length > 0 ? `${people.length - included.length} bockade ur` : 'alla med'}
          </div>
        </div>
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-gray-500">Rekryteringar</div>
          <div className="text-lg font-semibold text-gray-900 tabular-nums">{recruitments.length}</div>
          <div className="text-xs text-gray-400">
            {recruitments.length ? `${fmtTkr(recruitments.reduce((s, m) => s + memberTotal(m.id), 0))} helår` : 'inga'}
          </div>
        </div>
      </div>

      {/* Review progress */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span className="tabular-nums">{reviewed} av {people.length} genomgångna</span>
        <div className="flex-1 min-w-[120px] max-w-md h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-green-600 rounded-full transition-all"
            style={{ width: `${people.length ? (reviewed / people.length) * 100 : 0}%` }}
          />
        </div>
        {editable && reviewed < people.length && (
          <button
            onClick={() => staff.markAllReviewed(people.filter((m) => !m.reviewed_at).map((m) => m.id))}
            className="px-2.5 py-1 text-xs font-medium border border-gray-200 rounded-md hover:border-gray-400"
          >
            Markera alla som genomgångna
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          Ändringar räknas om direkt och skrivs till personalkontona i budgeten.
        </span>
      </div>

      {/* Matrix */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="sticky left-0 bg-white z-10 text-left font-medium px-3 py-2 min-w-[240px]">Person</th>
              <th className="text-center font-medium px-2 py-2">Med</th>
              <th className="text-right font-medium px-2 py-2">Grad</th>
              <th className="text-right font-medium px-2 py-2">Månadslön</th>
              <th className="text-right font-medium px-2 py-2">Tillägg</th>
              {periods.map((p) => (
                <th key={periodKey(p.year, p.month)} className="text-right font-medium px-2 py-2 min-w-[64px]">
                  {MONTH_LABELS[p.month - 1]}
                  {(p.month === 1 || p === periods[0]) && (
                    <span className="block text-[10px] font-normal text-gray-400">{p.year}</span>
                  )}
                </th>
              ))}
              <th className="text-right font-medium px-3 py-2 min-w-[90px] border-l border-gray-200">Helår här</th>
              <th className="text-left font-medium px-2 py-2 min-w-[180px]">Notering</th>
              <th className="text-left font-medium px-2 py-2">Genomgången</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={periods.length + 8} className="px-3 py-10 text-center text-gray-400">
                  Ingen personal på det här kostnadsstället. Lägg till en rekrytering nedan, eller be en administratör importera personallistan.
                </td>
              </tr>
            )}
            {people.map((m) => {
              const rows = staff.costByMember.get(m.id)
              const isOpen = expanded.has(m.id)
              const isSaving = staff.saving.has(m.id)
              const shared = m.staff_allocations.length > 1
              const shareHere = m.staff_allocations.find((a) => a.cost_center_id === costCenterId)
              const shareTotal = m.staff_allocations.reduce((s, a) => s + Number(a.share), 0)
              return (
                <Fragment key={m.id}>
                  <tr className={cn('border-t border-gray-100 group hover:bg-gray-50/50', !m.included && 'text-gray-400')}>
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-3 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <button
                          onClick={() => toggleExpand(m.id)}
                          className="mt-0.5 text-gray-400 hover:text-gray-700 shrink-0"
                          aria-label={isOpen ? 'Fäll ihop' : 'Visa detaljer'}
                        >
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('font-medium', m.included ? 'text-gray-800' : 'text-gray-400 line-through')}>
                              {memberName(m)}
                            </span>
                            {isSaving && <Loader2 size={11} className="animate-spin text-gray-400" />}
                          </div>
                          <div className="text-gray-500">
                            {[m.title, m.employment_type, m.employee_no].filter(Boolean).join(' · ')}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {m.is_recruitment && (
                              <span className="px-1.5 rounded-full bg-violet-50 text-violet-700">Rekrytering</span>
                            )}
                            {shared && (
                              <span
                                className="px-1.5 rounded-full bg-blue-50 text-blue-700"
                                title={m.staff_allocations
                                  .map((a) => `${ccById.get(a.cost_center_id)?.code ?? 'annat KS'}: ${a.share} %`)
                                  .join(', ')}
                              >
                                {shareHere && shareTotal > 0 ? `${Math.round((Number(shareHere.share) / shareTotal) * 100)} % här` : 'Delad'}
                                {' · '}{m.staff_allocations.length} KS
                              </span>
                            )}
                            {m.staff_periods.map((p) => (
                              <span key={p.id} className="px-1.5 rounded-full bg-amber-50 text-amber-800">
                                {p.reason ?? 'Period'} {periodLabel(p.from_period)}–{periodLabel(p.to_period)}
                                {Number(p.rate) > 0 && ` ${p.rate} %`}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center px-2">
                      <input
                        type="checkbox"
                        aria-label="Med i budget"
                        checked={m.included}
                        disabled={!editable}
                        onChange={(e) => staff.updateMember(m.id, { included: e.target.checked })}
                        className="w-4 h-4 accent-brand-600"
                      />
                    </td>
                    <td className="text-right px-2">
                      <NumberField
                        ariaLabel="Anställningsgrad"
                        value={Number(m.employment_rate)}
                        min={0}
                        max={100}
                        suffix="%"
                        disabled={!editable}
                        className="w-14"
                        onCommit={(v) => staff.updateMember(m.id, { employment_rate: v })}
                      />
                    </td>
                    <td className="text-right px-2">
                      <NumberField
                        ariaLabel="Månadslön"
                        value={Number(m.monthly_salary)}
                        min={0}
                        disabled={!editable}
                        className="w-20"
                        onCommit={(v) => staff.updateMember(m.id, { monthly_salary: v })}
                      />
                    </td>
                    <td className="text-right px-2">
                      <NumberField
                        ariaLabel="Tillägg per månad"
                        value={Number(m.supplement)}
                        disabled={!editable}
                        className="w-16"
                        onCommit={(v) => staff.updateMember(m.id, { supplement: v })}
                      />
                    </td>
                    {periods.map((p) => {
                      const r = rows?.get(`${p.year}-${p.month}`)
                      const rate = r?.rate ?? 0
                      return (
                        <td
                          key={periodKey(p.year, p.month)}
                          title={r
                            ? `Grad ${rate} % · andel ${r.share} % · ${fmt(r.total)} kr` +
                              (r.vacation_days_taken > 0 ? ` · semester ${r.vacation_days_taken} dagar` : '')
                            : 'Ingen kostnad'}
                          className={cn(
                            'text-right tabular-nums px-2 py-1.5',
                            !r || rate === 0
                              ? 'text-gray-300 bg-gray-50/70'
                              : rate < Number(m.employment_rate)
                                ? 'bg-amber-50/70 text-amber-900'
                                : 'text-gray-700',
                          )}
                        >
                          {r ? (rate === 0 ? '0 %' : fmt(r.total)) : '–'}
                        </td>
                      )
                    })}
                    <td className="text-right tabular-nums px-3 font-medium text-gray-800 border-l border-gray-200">
                      {fmt(memberTotal(m.id))}
                    </td>
                    <td className="px-2">
                      <TextField
                        ariaLabel="Notering"
                        value={m.note ?? ''}
                        placeholder="Notering"
                        disabled={!editable}
                        className="w-full"
                        onCommit={(v) => staff.updateMember(m.id, { note: v || null })}
                      />
                    </td>
                    <td className="px-2 whitespace-nowrap">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-gray-600">
                        <input
                          type="checkbox"
                          checked={!!m.reviewed_at}
                          disabled={!editable}
                          onChange={(e) => staff.setReviewed(m.id, e.target.checked)}
                          className="w-4 h-4 accent-green-600"
                        />
                        {m.reviewed_at ? 'Klar' : 'Ej klar'}
                      </label>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-gray-50/80 border-t border-gray-100">
                      <td colSpan={periods.length + 8} className="px-3 py-3">
                        <MemberDetails
                          member={m}
                          costRows={rows}
                          periods={periods}
                          scenarioStart={scenarioStart}
                          costCenters={costCenters}
                          ccById={ccById}
                          editable={editable}
                          staff={staff}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold text-gray-800 bg-gray-50">
              <td className="sticky left-0 bg-gray-50 z-10 px-3 py-2">Summa personalkostnad</td>
              <td colSpan={4} />
              {monthTotals.map((v, i) => (
                <td key={i} className="text-right tabular-nums px-2 py-2">{fmt(v)}</td>
              ))}
              <td className="text-right tabular-nums px-3 py-2 border-l border-gray-200">{fmt(total)}</td>
              <td colSpan={2} />
            </tr>
            {prevTotal !== 0 && (
              <tr className="text-gray-400 bg-gray-50">
                <td className="sticky left-0 bg-gray-50 z-10 px-3 pb-2">Utfall att jämföra med</td>
                <td colSpan={4} />
                {prevTotals.map((v, i) => (
                  <td key={i} className="text-right tabular-nums px-2 pb-2">{fmt(v)}</td>
                ))}
                <td className="text-right tabular-nums px-3 pb-2 border-l border-gray-200">{fmt(prevTotal)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {editable && (adding ? (
        <RecruitmentForm
          params={staff.params}
          periods={periods}
          scenarioStart={scenarioStart}
          costCenterId={costCenterId}
          onCancel={() => setAdding(false)}
          onSave={async (r) => {
            if (await staff.addRecruitment(r)) setAdding(false)
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 rounded-md"
        >
          <UserPlus size={14} />
          Lägg till rekrytering
        </button>
      ))}
    </div>
  )
}

type StaffApi = ReturnType<typeof useStaffBudget>

function MemberDetails({
  member: m, costRows, periods, scenarioStart, costCenters, ccById, editable, staff,
}: {
  member: StaffMember
  costRows: Map<string, StaffCostRow> | undefined
  periods: { year: number; month: number }[]
  scenarioStart: string
  costCenters: CostCenter[]
  ccById: Map<number, CostCenter>
  editable: boolean
  staff: StaffApi
}) {
  const periodOptions = periods.map((p) => ({ value: periodDate(p.year, p.month), label: `${MONTHS_SHORT[p.month - 1]} ${p.year}` }))
  const lastPeriod = periodOptions[periodOptions.length - 1]?.value ?? scenarioStart

  const [reason, setReason] = useState(PERIOD_REASONS[0])
  const [from, setFrom] = useState(scenarioStart)
  const [to, setTo] = useState(lastPeriod)
  const [rate, setRate] = useState('0')

  const initialShares = m.staff_allocations.length
    ? m.staff_allocations.map((a) => ({ cost_center_id: a.cost_center_id, share: Number(a.share) }))
    : [{ cost_center_id: m.home_cost_center_id, share: 100 }]
  const [shares, setShares] = useState(initialShares)
  const allocKey = JSON.stringify(initialShares)
  useEffect(() => setShares(JSON.parse(allocKey)), [allocKey])
  const shareSum = shares.reduce((s, a) => s + (a.share || 0), 0)
  const sharesChanged = JSON.stringify(shares) !== allocKey

  const [newCc, setNewCc] = useState<number | ''>('')
  const freeCostCenters = costCenters.filter((c) => !shares.some((s) => s.cost_center_id === c.id))

  return (
    <div className="grid gap-5 lg:grid-cols-3 text-xs">
      {/* Employment */}
      <div className="space-y-2">
        <h4 className="font-semibold text-gray-700">Anställning</h4>
        <div className="grid grid-cols-[110px_1fr] items-center gap-x-2 gap-y-1.5">
          <label className="text-gray-500">Förnamn</label>
          <TextField ariaLabel="Förnamn" value={m.first_name} disabled={!editable}
            onCommit={(v) => staff.updateMember(m.id, { first_name: v })} />
          <label className="text-gray-500">Efternamn</label>
          <TextField ariaLabel="Efternamn" value={m.last_name} disabled={!editable}
            onCommit={(v) => staff.updateMember(m.id, { last_name: v })} />
          <label className="text-gray-500">Befattning</label>
          <TextField ariaLabel="Befattning" value={m.title ?? ''} disabled={!editable}
            onCommit={(v) => staff.updateMember(m.id, { title: v || null })} />
          <label className="text-gray-500">Anställningsform</label>
          <select
            aria-label="Anställningsform"
            value={m.employment_type ?? ''}
            disabled={!editable}
            onChange={(e) => staff.updateMember(m.id, { employment_type: (e.target.value || null) as EmploymentType | null })}
            className={INPUT}
          >
            <option value="">—</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="text-gray-500">Semesterdagar</label>
          <NumberField ariaLabel="Semesterdagar" value={m.vacation_days} min={0} max={60} disabled={!editable}
            className="w-16" onCommit={(v) => staff.updateMember(m.id, { vacation_days: Math.round(v) })} />
          <label className="text-gray-500">Bilförmån / år</label>
          <NumberField ariaLabel="Bilförmån per år" value={Number(m.car_benefit)} min={0} disabled={!editable}
            className="w-24" suffix="kr" onCommit={(v) => staff.updateMember(m.id, { car_benefit: v })} />
        </div>
        {m.is_recruitment && editable && (
          <button
            onClick={() => staff.deleteMember(m.id)}
            className="inline-flex items-center gap-1 mt-2 text-red-600 hover:text-red-800"
          >
            <Trash2 size={12} /> Ta bort rekryteringen
          </button>
        )}
      </div>

      {/* Periods */}
      <div className="space-y-2">
        <h4 className="font-semibold text-gray-700">Perioder under året</h4>
        <p className="text-gray-500">Ledighet, slutdatum eller ändrad grad. Gäller i stället för grundgraden {m.employment_rate} % under perioden.</p>
        {m.staff_periods.length === 0 && <p className="text-gray-400">Inga perioder.</p>}
        <ul className="space-y-1">
          {m.staff_periods.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="px-1.5 rounded-full bg-amber-50 text-amber-800">
                {p.reason ?? 'Period'}
              </span>
              <span className="tabular-nums text-gray-700">
                {periodLabel(p.from_period)}–{periodLabel(p.to_period)} · {p.rate} %
              </span>
              {editable && (
                <button
                  onClick={() => staff.deletePeriod(m.id, p.id)}
                  className="text-gray-400 hover:text-red-600"
                  aria-label="Ta bort perioden"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <select aria-label="Orsak" value={reason} onChange={(e) => {
              setReason(e.target.value)
              if (e.target.value === 'Slutar') { setTo(lastPeriod); setRate('0') }
            }} className={INPUT}>
              {PERIOD_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select aria-label="Från" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT}>
              {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="text-gray-400">–</span>
            <select aria-label="Till" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT}>
              {periodOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input aria-label="Grad under perioden" value={rate} onChange={(e) => setRate(e.target.value)}
              className={cn(INPUT, 'w-12 text-right')} />
            <span className="text-gray-400">%</span>
            <button
              disabled={to < from}
              onClick={async () => {
                const r = parseNum(rate)
                if (r === null || r < 0 || r > 100) return
                await staff.addPeriod(m.id, { from_period: from, to_period: to, rate: r, reason })
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-40"
            >
              <Plus size={12} /> Lägg till
            </button>
          </div>
        )}
      </div>

      {/* Allocation */}
      <div className="space-y-2">
        <h4 className="font-semibold text-gray-700">Fördelning på kostnadsställen</h4>
        <p className="text-gray-500">
          Hem-KS: {ccById.get(m.home_cost_center_id)?.code ?? m.home_cost_center_id}. Andelarna räknas om till 100 % om de inte går jämnt ut.
        </p>
        <ul className="space-y-1">
          {shares.map((s, i) => (
            <li key={s.cost_center_id} className="flex items-center gap-2">
              <span className="w-44 truncate text-gray-700">
                {ccById.get(s.cost_center_id)
                  ? `${ccById.get(s.cost_center_id)!.code} — ${ccById.get(s.cost_center_id)!.name}`
                  : `Kostnadsställe ${s.cost_center_id}`}
              </span>
              <input
                aria-label="Andel"
                value={s.share}
                disabled={!editable}
                onChange={(e) => {
                  const n = parseNum(e.target.value) ?? 0
                  setShares((prev) => prev.map((x, j) => (j === i ? { ...x, share: n } : x)))
                }}
                className={cn(INPUT, 'w-14 text-right tabular-nums')}
              />
              <span className="text-gray-400">%</span>
              {editable && shares.length > 1 && (
                <button
                  onClick={() => setShares((prev) => prev.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600"
                  aria-label="Ta bort kostnadsstället"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className={cn('tabular-nums', Math.abs(shareSum - 100) > 0.01 ? 'text-amber-700' : 'text-gray-500')}>
          Summa {shareSum.toLocaleString('sv-SE')} %
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Lägg till kostnadsställe" value={newCc}
              onChange={(e) => setNewCc(e.target.value ? Number(e.target.value) : '')} className={INPUT}>
              <option value="">Lägg till KS…</option>
              {freeCostCenters.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
            <button
              disabled={newCc === ''}
              onClick={() => {
                if (newCc === '') return
                setShares((prev) => [...prev, { cost_center_id: newCc, share: 0 }])
                setNewCc('')
              }}
              className="px-2 py-1 rounded border border-gray-200 hover:border-gray-400 disabled:opacity-40"
            >
              Lägg till
            </button>
            <button
              disabled={!sharesChanged || shareSum <= 0}
              onClick={() => staff.setAllocations(m.id, shares)}
              className="px-2 py-1 rounded bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-40"
            >
              Spara fördelning
            </button>
          </div>
        )}
      </div>

      {staff.params?.vacation_model === 'liability' && (
        <VacationPlan member={m} costRows={costRows} periods={periods} editable={editable} staff={staff} />
      )}
    </div>
  )
}

/**
 * Vacation days per month. Without an own plan the scenario's default applies —
 * shown greyed, straight from the calculation, so what you see is what is booked.
 * The first edit copies the whole visible plan into the person's own plan; a plan
 * is all months or none, since a missing month in an own plan means zero days.
 */
function VacationPlan({
  member: m, costRows, periods, editable, staff,
}: {
  member: StaffMember
  costRows: Map<string, StaffCostRow> | undefined
  periods: { year: number; month: number }[]
  editable: boolean
  staff: StaffApi
}) {
  const own = useMemo(
    () => new Map(m.staff_vacation_plan.map((d) => [d.period, Number(d.days)])),
    [m.staff_vacation_plan],
  )
  const hasOwn = m.staff_vacation_plan.length > 0

  const effective = periods.map((p) => {
    const period = periodDate(p.year, p.month)
    if (hasOwn) return { period, days: own.get(period) ?? 0 }
    return { period, days: costRows?.get(`${p.year}-${p.month}`)?.vacation_days_taken ?? 0 }
  })
  const planned = effective.reduce((s, d) => s + d.days, 0)
  const earned = (m.vacation_days * periods.length) / 12
  const diff = Math.round((earned - planned) * 10) / 10

  const [drafts, setDrafts] = useState<Record<string, string>>({})

  function commit(period: string) {
    const raw = drafts[period]
    if (raw === undefined) return
    const n = parseNum(raw)
    setDrafts((d) => {
      const next = { ...d }
      delete next[period]
      return next
    })
    if (n === null || n < 0 || n > 31) return
    const current = effective.find((d) => d.period === period)?.days ?? 0
    if (hasOwn && n === current) return
    staff.setVacationPlan(
      m.id,
      effective.map((d) => ({ period: d.period, days: d.period === period ? n : Math.round(d.days * 100) / 100 })),
    )
  }

  return (
    <div className="lg:col-span-3 space-y-2 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-semibold text-gray-700">Semesteruttag</h4>
        <span className={hasOwn ? 'text-gray-600' : 'text-gray-400'}>
          {hasOwn ? 'Egen plan' : 'Standardplan för scenariot'}
        </span>
        <span className="tabular-nums text-gray-600">
          {planned.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} dagar planerade av{' '}
          {earned.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} intjänade
        </span>
        {Math.abs(diff) >= 0.5 && (
          <span className={cn('tabular-nums', diff > 0 ? 'text-amber-700' : 'text-blue-700')}>
            {diff > 0
              ? `${diff.toLocaleString('sv-SE')} dagar sparas — skulden ökar`
              : `${Math.abs(diff).toLocaleString('sv-SE')} dagar mer än intjänat — skulden minskar`}
          </span>
        )}
        {hasOwn && editable && (
          <button
            onClick={() => staff.setVacationPlan(m.id, null)}
            className="ml-auto text-brand-700 hover:underline"
          >
            Använd standardplanen
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {periods.map((p, i) => {
          const d = effective[i]
          const value = drafts[d.period] ?? (d.days ? String(Math.round(d.days * 10) / 10).replace('.', ',') : '')
          return (
            <label key={d.period} className="flex flex-col items-center gap-0.5 text-gray-500">
              <span>{MONTHS_SHORT[p.month - 1]}</span>
              <input
                aria-label={`Semesterdagar ${MONTHS_SHORT[p.month - 1]} ${p.year}`}
                value={value}
                placeholder="0"
                disabled={!editable}
                onChange={(e) => setDrafts((s) => ({ ...s, [d.period]: e.target.value }))}
                onBlur={() => commit(d.period)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className={cn(INPUT, 'w-12 text-right tabular-nums', !hasOwn && 'text-gray-400')}
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}

function RecruitmentForm({
  params, periods, scenarioStart, costCenterId, onCancel, onSave,
}: {
  params: StaffParameters
  periods: { year: number; month: number }[]
  scenarioStart: string
  costCenterId: number
  onCancel: () => void
  onSave: (r: Parameters<StaffApi['addRecruitment']>[0]) => Promise<void>
}) {
  const titles = Object.keys(params.default_salaries ?? {})
  const [title, setTitle] = useState(titles[0] ?? 'Trafiklärare')
  const [type, setType] = useState<EmploymentType>('PRO')
  const [start, setStart] = useState(scenarioStart)
  const [rate, setRate] = useState('100')
  const [salary, setSalary] = useState(String(params.default_salaries?.[titles[0] ?? ''] ?? ''))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const salaryNum = parseNum(salary)
  const rateNum = parseNum(rate)
  const valid = title.trim() !== '' && salaryNum !== null && salaryNum >= 0 && rateNum !== null && rateNum >= 0 && rateNum <= 100

  return (
    <form
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 items-end p-4 rounded-lg border border-violet-200 bg-violet-50/50 text-xs"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        await onSave({
          title: title.trim(),
          employment_type: type,
          home_cost_center_id: costCenterId,
          employment_rate: rateNum!,
          monthly_salary: salaryNum!,
          start_period: start,
          scenario_start: scenarioStart,
          note,
        })
        setBusy(false)
      }}
    >
      <label className="flex flex-col gap-1 text-gray-600">Befattning
        <input list="staff-titles" value={title} onChange={(e) => {
          setTitle(e.target.value)
          const d = params.default_salaries?.[e.target.value]
          if (d !== undefined) setSalary(String(d))
        }} className={INPUT} />
        <datalist id="staff-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 text-gray-600">Anställningsform
        <select value={type} onChange={(e) => setType(e.target.value as EmploymentType)} className={INPUT}>
          {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-gray-600">Startmånad
        <select value={start} onChange={(e) => setStart(e.target.value)} className={INPUT}>
          {periods.map((p) => {
            const v = periodDate(p.year, p.month)
            return <option key={v} value={v}>{MONTHS_SHORT[p.month - 1]} {p.year}</option>
          })}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-gray-600">Grad %
        <input value={rate} onChange={(e) => setRate(e.target.value)} className={cn(INPUT, 'text-right')} />
      </label>
      <label className="flex flex-col gap-1 text-gray-600">Månadslön
        <input value={salary} onChange={(e) => setSalary(e.target.value)} className={cn(INPUT, 'text-right')} />
      </label>
      <label className="flex flex-col gap-1 text-gray-600">Notering
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="t.ex. ersätter någon" className={INPUT} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!valid || busy}
          className="px-3 py-1.5 rounded bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-40">
          {busy ? 'Sparar…' : 'Lägg till'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded border border-gray-200 hover:border-gray-400">
          Avbryt
        </button>
      </div>
    </form>
  )
}
