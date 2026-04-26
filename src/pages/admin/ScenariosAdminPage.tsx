import { useEffect, useState } from 'react'
import {
  CheckCircle2, Circle, ChevronDown, ChevronRight,
  Pencil, Check, X, Trash2, Plus, Lock
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAdminScenarios, type LockDetail } from '@/hooks/useAdminScenarios'
import NewScenarioDialog from '@/components/NewScenarioDialog'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatPeriod(startYear: number, startMonth: number, endYear: number, endMonth: number) {
  return `${MONTHS[startMonth - 1]} ${startYear} – ${MONTHS[endMonth - 1]} ${endYear}`
}

function StatusBadge({ lockedKs, totalKs, approved }: { lockedKs: number; totalKs: number; approved: boolean }) {
  if (approved) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
      <CheckCircle2 size={11} /> Godkänd
    </span>
  )
  if (lockedKs === 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
      <Circle size={11} /> Öppen
    </span>
  )
  if (lockedKs === totalKs) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
      <Lock size={11} /> Alla KS låsta
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
      <Lock size={11} /> {lockedKs}/{totalKs} KS låsta
    </span>
  )
}

export default function ScenariosAdminPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [userId, setUserId] = useState('')
  const [showNewScenario, setShowNewScenario] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [lockDetails, setLockDetails] = useState<Map<number, LockDetail[]>>(new Map())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const { scenarios, loading, refetch, renameScenario, toggleApprove, deleteScenario, loadLockDetails } =
    useAdminScenarios(selectedCompanyId)

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      if (data) { setCompanies(data as Company[]); setSelectedCompanyId(data[0]?.id ?? null) }
    })
    supabase.auth.getUser().then(({ data }) => { if (data.user) setUserId(data.user.id) })
  }, [])

  async function handleExpand(scenarioId: number) {
    if (expandedId === scenarioId) { setExpandedId(null); return }
    setExpandedId(scenarioId)
    if (!lockDetails.has(scenarioId)) {
      const details = await loadLockDetails(scenarioId)
      setLockDetails((prev) => new Map(prev).set(scenarioId, details))
    }
  }

  function startEdit(id: number, name: string) {
    setEditingId(id)
    setEditName(name)
  }

  async function commitEdit(id: number) {
    if (editName.trim()) await renameScenario(id, editName.trim())
    setEditingId(null)
  }

  async function handleCreateScenario(
    name: string, startYear: number, startMonth: number,
    endYear: number, endMonth: number, copyFromId?: number,
  ) {
    if (!selectedCompanyId) return
    const { data } = await supabase
      .from('scenarios')
      .insert({
        company_id: selectedCompanyId,
        name, start_year: startYear, start_month: startMonth,
        end_year: endYear, end_month: endMonth,
        is_approved: false, created_by: userId,
      })
      .select()
      .single()

    if (data && copyFromId) {
      const { data: sourceEntries } = await supabase
        .from('budget_entries').select('*').eq('scenario_id', copyFromId)
      if (sourceEntries?.length) {
        await supabase.from('budget_entries').insert(
          sourceEntries.map((e) => ({
            scenario_id: data.id, account_id: e.account_id,
            cost_center_id: e.cost_center_id, year: e.year,
            month: e.month, amount: e.amount, updated_by: userId,
          }))
        )
      }
    }
    setShowNewScenario(false)
    refetch()
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Scenarier</h2>
          <p className="text-sm text-gray-500 mt-0.5">Hantera scenarier per bolag</p>
        </div>
        <button
          onClick={() => setShowNewScenario(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
        >
          <Plus size={14} /> Nytt scenario
        </button>
      </div>

      {/* Company tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {companies.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCompanyId(c.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              selectedCompanyId === c.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : scenarios.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
          Inga scenarier för detta bolag. Skapa ett nytt med knappen ovan.
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.map((s) => (
            <div key={s.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Row */}
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Expand toggle */}
                <button
                  onClick={() => handleExpand(s.id)}
                  className="text-gray-400 hover:text-gray-600 shrink-0"
                >
                  {expandedId === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  {editingId === s.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(s.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 px-2 py-1 border border-brand-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                      <button onClick={() => commitEdit(s.id)} className="text-green-600 hover:text-green-700">
                        <Check size={15} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 text-sm truncate">{s.name}</span>
                      {!s.is_approved && (
                        <button
                          onClick={() => startEdit(s.id, s.name)}
                          className="text-gray-300 hover:text-gray-500 shrink-0"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatPeriod(s.start_year, s.start_month, s.end_year, s.end_month)}
                  </p>
                </div>

                {/* Lock progress */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-32">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>KS låsta</span>
                      <span>{s.locked_ks}/{s.total_ks}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          s.is_approved ? 'bg-green-500' :
                          s.locked_ks === s.total_ks ? 'bg-amber-400' : 'bg-brand-400'
                        )}
                        style={{ width: s.total_ks > 0 ? `${(s.locked_ks / s.total_ks) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>

                  <StatusBadge lockedKs={s.locked_ks} totalKs={s.total_ks} approved={s.is_approved} />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleApprove(s.id, s.is_approved)}
                    title={s.is_approved ? 'Ångra godkännande' : 'Godkänn scenario'}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      s.is_approved
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                  >
                    <CheckCircle2 size={13} />
                    {s.is_approved ? 'Godkänd' : 'Godkänn'}
                  </button>

                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                    title="Ta bort scenario"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded KS lock details */}
              {expandedId === s.id && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                  {(() => {
                    const details = lockDetails.get(s.id)
                    if (!details) return (
                      <div className="flex justify-center py-4">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-600" />
                      </div>
                    )
                    if (details.length === 0) return (
                      <p className="text-xs text-gray-400 text-center py-2">Inga låsta kostnadsställen</p>
                    )
                    return (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-gray-500 mb-2">Låsta kostnadsställen</p>
                        {details.map((d) => (
                          <div key={d.cost_center_id} className="flex items-center justify-between text-xs py-1">
                            <span className="text-gray-700">
                              <span className="font-mono text-gray-400 mr-2">{d.cost_center.code}</span>
                              {d.cost_center.name}
                            </span>
                            <span className="text-gray-400">
                              Låst av {d.locked_by_name} · {new Date(d.locked_at).toLocaleString('sv-SE')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Ta bort scenario?</h3>
            <p className="text-sm text-gray-500 mb-5">
              Alla budgeterade belopp och lås kopplade till scenariot tas bort permanent.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Avbryt
              </button>
              <button
                onClick={async () => {
                  await deleteScenario(confirmDeleteId)
                  setConfirmDeleteId(null)
                }}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Ta bort
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewScenario && (
        <NewScenarioDialog
          scenarios={scenarios}
          onClose={() => setShowNewScenario(false)}
          onCreate={handleCreateScenario}
        />
      )}
    </div>
  )
}
