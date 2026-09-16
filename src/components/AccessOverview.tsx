import { useMemo, useState } from 'react'
import { Pencil, Eye, Minus, Check, X, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessOverview } from '@/hooks/useAccessOverview'
import type { Company, CostCenter } from '@/types'

type UserRoleLite = {
  role: string
  company_id: number | null
  cost_center_id: number | null
  region: string | null
}

type UserLite = {
  id: string
  email: string
  display_name: string
  roles: UserRoleLite[]
}

interface Props {
  users: UserLite[]
  companies: Company[]
  costCenters: CostCenter[]
  /** Maps role name to its human label, so badges read the same as elsewhere. */
  roleLabel: (name: string) => string
}

type Tab = 'users' | 'costcenters' | 'warnings'

const KS_PREVIEW = 4

export default function AccessOverview({ users, companies, costCenters, roleLabel }: Props) {
  const { matrix, sections, allSections, loading, error } = useAccessOverview()
  const [tab, setTab] = useState<Tab>('users')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedCompany, setExpandedCompany] = useState<Set<number>>(new Set())
  const [orphansOnly, setOrphansOnly] = useState(false)

  const selected = users.find((u) => u.id === selectedId) ?? users[0] ?? null

  /** Users who can reach a cost centre without being an administrator. */
  const nonAdminReach = useMemo(() => {
    const byCc = new Map<number, UserLite[]>()
    for (const u of users) {
      if (u.roles.some((r) => r.role === 'admin')) continue
      for (const ccId of matrix.get(u.id)?.keys() ?? []) {
        const list = byCc.get(ccId)
        if (list) list.push(u)
        else byCc.set(ccId, [u])
      }
    }
    return byCc
  }, [users, matrix])

  const warnings = useMemo(() => {
    const out: { severity: 'critical' | 'warning'; title: string; why: string; items: string[] }[] = []

    const orphans = costCenters.filter((cc) => !nonAdminReach.has(cc.id))
    if (orphans.length > 0) {
      out.push({
        severity: 'critical',
        title: 'Kostnadsställen utan någon som kan budgetera dem',
        why: 'Bara administratörer når dessa. Ingen KS-ansvarig eller regionchef är tilldelad, så de kommer inte att fyllas i till deadline.',
        items: orphans.map((cc) => `${cc.code} ${cc.name}`),
      })
    }

    const existingRegions = new Set(
      costCenters.map((cc) => cc.region).filter((r): r is string => r !== null),
    )
    const deadRegions: string[] = []
    for (const u of users) {
      for (const r of u.roles) {
        if (r.region && !existingRegions.has(r.region)) {
          deadRegions.push(`${u.display_name || u.email} — region ”${r.region}”`)
        }
      }
    }
    if (deadRegions.length > 0) {
      out.push({
        severity: 'critical',
        title: 'Roller vars region inte matchar något kostnadsställe',
        why: 'Regionen jämförs som exakt sträng. Stavning och versaler måste stämma med cost_centers.region — ”väst” är inte ”Väst”.',
        items: deadRegions,
      })
    }

    const roleless = users.filter((u) => u.roles.length === 0)
    if (roleless.length > 0) {
      out.push({
        severity: 'warning',
        title: 'Användare utan roller',
        why: 'Kan logga in men ser ingenting, och får inget begripligt besked om varför.',
        items: roleless.map((u) => `${u.display_name || u.email} · ${u.email}`),
      })
    }

    const noRegion = costCenters.filter((cc) => cc.region === null)
    if (noRegion.length > 0) {
      out.push({
        severity: 'warning',
        title: 'Kostnadsställen utan region',
        why: 'Osynliga för alla regionchefer, eftersom NULL aldrig matchar en region. Avsiktligt för gemensamma kostnadsställen — annars saknas en region.',
        items: noRegion.map((cc) => `${cc.code} ${cc.name}`),
      })
    }

    return out
  }, [users, costCenters, nonAdminReach])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Läser behörigheter…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Kunde inte läsa behörigheterna</p>
          <p className="mt-0.5 text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'users', label: 'Per användare' },
    { id: 'costcenters', label: 'Per kostnadsställe' },
    { id: 'warnings', label: 'Varningar', badge: warnings.length },
  ]

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              tab === t.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
          {/* User list */}
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
            {users.map((u) => {
              const reach = matrix.get(u.id)?.size ?? 0
              const blocked = u.roles.length === 0 || reach === 0
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className={cn(
                    'w-full text-left px-3.5 py-2.5 border-b border-gray-100 last:border-b-0 border-l-2 transition-colors',
                    selected?.id === u.id
                      ? 'bg-brand-50 border-l-brand-600'
                      : 'border-l-transparent hover:bg-gray-50',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                    {blocked && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                    {u.display_name || u.email}
                  </span>
                  <span className="text-xs text-gray-500">
                    {u.roles.length === 0
                      ? 'Inga roller'
                      : `${reach} kostnadsställen`}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Detail */}
          {selected && (
            <UserDetail
              user={selected}
              companies={companies}
              costCenters={costCenters}
              reach={matrix.get(selected.id) ?? new Map()}
              perms={sections.get(selected.id) ?? new Map()}
              allSections={allSections}
              roleLabel={roleLabel}
              expandedCompany={expandedCompany}
              onToggleCompany={(id) =>
                setExpandedCompany((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
            />
          )}
        </div>
      )}

      {tab === 'costcenters' && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 flex-wrap">
            <button
              onClick={() => setOrphansOnly((v) => !v)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                orphansOnly
                  ? 'bg-brand-50 border-brand-200 text-brand-700'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50',
              )}
            >
              Visa bara utan ansvarig
            </button>
            <span className="text-xs text-gray-400">
              {costCenters.filter((cc) => !nonAdminReach.has(cc.id)).length} av {costCenters.length} kostnadsställen
              har ingen som kan budgetera dem
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-20">KS</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Kostnadsställe</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-36">Region</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Kan budgetera</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {costCenters
                  .filter((cc) => !orphansOnly || !nonAdminReach.has(cc.id))
                  .map((cc) => {
                    const who = nonAdminReach.get(cc.id) ?? []
                    const company = companies.find((c) => c.id === cc.company_id)
                    return (
                      <tr key={cc.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{cc.code}</td>
                        <td className="px-4 py-2.5">
                          <div className="text-gray-900">{cc.name}</div>
                          <div className="text-xs text-gray-400">{company?.name}</div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{cc.region ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {who.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {who.map((u) => (
                                <span
                                  key={u.id}
                                  className="px-2 py-0.5 rounded text-xs bg-gray-50 border border-gray-200 text-gray-600"
                                >
                                  {u.display_name || u.email}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
                              <X size={12} /> Ingen
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'warnings' && (
        <div className="flex flex-col gap-3">
          {warnings.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-green-50 border border-green-200 text-green-800">
              <Check size={15} /> Inga behörighetsproblem hittades.
            </div>
          )}
          {warnings.map((w) => (
            <div
              key={w.title}
              className="border border-gray-200 rounded-xl bg-white overflow-hidden grid grid-cols-[3px_minmax(0,1fr)]"
            >
              <div className={w.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'} />
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{w.title}</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-semibold border tabular-nums',
                      w.severity === 'critical'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200',
                    )}
                  >
                    {w.items.length}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 max-w-[74ch]">{w.why}</p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {w.items.slice(0, 12).map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded text-xs bg-gray-50 border border-gray-200 text-gray-600"
                    >
                      {t}
                    </span>
                  ))}
                  {w.items.length > 12 && (
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-50 border border-gray-200 text-gray-400">
                      +{w.items.length - 12} till
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UserDetail({
  user, companies, costCenters, reach, perms, allSections, roleLabel,
  expandedCompany, onToggleCompany,
}: {
  user: UserLite
  companies: Company[]
  costCenters: CostCenter[]
  reach: Map<number, string[]>
  perms: Map<string, { canView: boolean; canEdit: boolean; via: string | null }>
  allSections: string[]
  roleLabel: (name: string) => string
  expandedCompany: Set<number>
  onToggleCompany: (id: number) => void
}) {
  const perCompany = companies.map((c) => {
    const all = costCenters.filter((cc) => cc.company_id === c.id)
    const mine = all.filter((cc) => reach.has(cc.id))
    const via = [...new Set(mine.flatMap((cc) => reach.get(cc.id) ?? []))]
    return { company: c, all, mine, via }
  })

  const totalReach = reach.size
  const editable = allSections.filter((s) => perms.get(s)?.canEdit)
  const viewable = allSections.filter((s) => perms.get(s)?.canView && !perms.get(s)?.canEdit)
  const canBudget = totalReach > 0 && editable.length > 0

  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <div className="p-4 border-b border-gray-100">
        <div className="text-base font-semibold text-gray-900">{user.display_name || user.email}</div>
        <div className="text-sm text-gray-500 font-mono">{user.email}</div>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {user.roles.length === 0 ? (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
              Inga roller tilldelade
            </span>
          ) : (
            user.roles.map((r, i) => {
              const scope = r.region
                ? ` — ${r.region}`
                : r.company_id
                  ? ` — ${companies.find((c) => c.id === r.company_id)?.name ?? r.company_id}`
                  : r.cost_center_id
                    ? ` — KS ${costCenters.find((cc) => cc.id === r.cost_center_id)?.code ?? r.cost_center_id}`
                    : ''
              return (
                <span
                  key={i}
                  className={cn(
                    'px-2.5 py-0.5 rounded-full text-xs font-medium border',
                    r.region
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-brand-50 text-brand-700 border-brand-200',
                  )}
                >
                  {roleLabel(r.role)}{scope}
                </span>
              )
            })
          )}
        </div>
      </div>

      {/* Reach */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <span className="text-xs font-semibold tracking-wide uppercase text-gray-400">Räckvidd</span>
          <span className="text-xs text-gray-500 tabular-nums">
            {totalReach} av {costCenters.length} kostnadsställen
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {perCompany.map(({ company, all, mine, via }) => {
            const open = expandedCompany.has(company.id)
            const shown = open ? mine : mine.slice(0, KS_PREVIEW)
            return (
              <div
                key={company.id}
                className={cn('px-2.5 py-2 rounded-lg', mine.length > 0 && 'bg-gray-50')}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-800">{company.name}</span>
                  <span className="text-sm text-gray-500 tabular-nums whitespace-nowrap">
                    <b className="text-gray-900 font-semibold">{mine.length}</b> av {all.length} KS
                  </span>
                </div>
                <div className="h-1 rounded-full bg-gray-200 overflow-hidden mt-1.5">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: all.length ? `${Math.round((mine.length / all.length) * 100)}%` : '0%' }}
                  />
                </div>
                {via.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1.5">via {via.join(', ')}</div>
                )}
                {mine.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {shown.map((cc) => (
                      <span
                        key={cc.id}
                        className="px-2 py-0.5 rounded text-xs bg-white border border-gray-200 text-gray-500"
                      >
                        <span className="font-mono text-gray-700">{cc.code}</span> {cc.name}
                      </span>
                    ))}
                    {mine.length > KS_PREVIEW && (
                      <button
                        onClick={() => onToggleCompany(company.id)}
                        className="text-xs text-brand-700 underline underline-offset-2"
                      >
                        {open ? 'visa färre' : `visa alla ${mine.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Sections */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
          <span className="text-xs font-semibold tracking-wide uppercase text-gray-400">Sektioner</span>
          <span className="text-xs text-gray-500 tabular-nums">
            {editable.length} editerbara · {viewable.length} läsbara
          </span>
        </div>
        <div className="flex flex-col">
          {allSections.map((s) => {
            const p = perms.get(s)
            const level = p?.canEdit ? 'edit' : p?.canView ? 'view' : 'none'
            return (
              <div
                key={s}
                className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-2.5 items-center py-1.5 border-b border-gray-100 last:border-b-0"
              >
                {level === 'edit' ? <Pencil size={14} className="text-brand-600" />
                  : level === 'view' ? <Eye size={14} className="text-gray-400" />
                  : <Minus size={14} className="text-gray-300" />}
                <span className={cn('text-sm', level === 'none' ? 'text-gray-400' : 'text-gray-800')}>{s}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {p?.via ? `via ${p.via}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="p-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="text-xs font-semibold tracking-wide uppercase text-gray-400">I praktiken</span>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5 flex flex-col gap-2">
          <div className={cn('flex gap-2.5 text-sm', canBudget ? 'text-gray-700' : 'text-red-700')}>
            {canBudget
              ? <Check size={15} className="text-green-600 shrink-0 mt-0.5" />
              : <X size={15} className="text-red-600 shrink-0 mt-0.5" />}
            <span>
              {canBudget ? (
                <>Kan spara budget på <b className="tabular-nums">{totalReach}</b> kostnadsställen i{' '}
                  <b className="tabular-nums">{editable.length}</b> sektioner.</>
              ) : (
                <>
                  <b>Kan inte spara budget någonstans.</b>{' '}
                  {totalReach === 0
                    ? 'Ingen roll matchar något kostnadsställe.'
                    : 'Ingen sektion är skrivbar.'}
                </>
              )}
            </span>
          </div>
          <div className="flex gap-2.5 text-sm text-gray-700">
            <Eye size={15} className="text-gray-400 shrink-0 mt-0.5" />
            <span>
              Ser budget och utfall för samma <b className="tabular-nums">{totalReach}</b> kostnadsställen
              {viewable.length > 0 && (
                <>, plus <b className="tabular-nums">{viewable.length}</b> sektioner som bara är läsbara</>
              )}.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
