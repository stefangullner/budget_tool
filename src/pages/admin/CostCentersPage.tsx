import { useEffect, useState, useCallback } from 'react'
import { Check, X, Pencil, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import SaveErrorBanner from '@/components/SaveErrorBanner'
import { supabase } from '@/lib/supabase'
import { useWriteGuard } from '@/lib/writes'
import { cn } from '@/lib/utils'
import type { Company, CostCenter } from '@/types'

type CostCenterRow = CostCenter & { region: string | null }

export default function CostCentersPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const { error: writeError, clearError: clearWriteError, run } = useWriteGuard()
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editRegion, setEditRegion] = useState('')
  const [showNewRow, setShowNewRow] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newRegion, setNewRegion] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete flow — a cost centre carries budget and actuals, so the dialog counts
  // what would be destroyed before letting the user through
  const [deleteTarget, setDeleteTarget] = useState<CostCenterRow | null>(null)
  const [deleteCounts, setDeleteCounts] = useState<{ budget: number; actuals: number; locks: number } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => {
      if (data) {
        setCompanies(data)
        setSelectedCompanyId(data[0]?.id ?? null)
      }
    })
  }, [])

  const load = useCallback(async (companyId: number) => {
    setLoading(true)
    const { data } = await supabase
      .from('cost_centers')
      .select('*')
      .eq('company_id', companyId)
      .order('code')
    setCostCenters((data ?? []) as CostCenterRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedCompanyId) load(selectedCompanyId)
  }, [selectedCompanyId, load])

  async function toggleActive(cc: CostCenterRow) {
    const newVal = !cc.is_active
    const ok = await run(
      supabase.from('cost_centers').update({ is_active: newVal }).eq('id', cc.id),
    )
    if (!ok) return
    setCostCenters(prev => prev.map(c => c.id === cc.id ? { ...c, is_active: newVal } : c))
  }

  function startEdit(cc: CostCenterRow) {
    setEditingId(cc.id)
    setEditName(cc.name)
    setEditRegion(cc.region ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(cc: CostCenterRow) {
    setSaving(true)
    const ok = await run(
      supabase
        .from('cost_centers')
        .update({ name: editName.trim(), region: editRegion.trim() || null })
        .eq('id', cc.id),
    )
    setSaving(false)
    if (!ok) return
    setCostCenters(prev =>
      prev.map(c => c.id === cc.id ? { ...c, name: editName.trim(), region: editRegion.trim() || null } : c)
    )
    setEditingId(null)
  }

  async function createCostCenter() {
    if (!newCode.trim() || !newName.trim() || !selectedCompanyId) return
    setSaving(true)
    const { data } = await supabase
      .from('cost_centers')
      .insert({
        company_id: selectedCompanyId,
        code: newCode.trim(),
        name: newName.trim(),
        region: newRegion.trim() || null,
        is_active: true,
      })
      .select()
      .single()
    if (data) setCostCenters(prev => [...prev, data as CostCenterRow].sort((a, b) => a.code.localeCompare(b.code)))
    setNewCode('')
    setNewName('')
    setNewRegion('')
    setShowNewRow(false)
    setSaving(false)
  }

  async function openDelete(cc: CostCenterRow) {
    setDeleteTarget(cc)
    setDeleteCounts(null)
    setDeleteConfirmText('')
    setDeleteError(null)
    const [budget, actuals, locks] = await Promise.all([
      supabase.from('budget_entries').select('*', { count: 'exact', head: true }).eq('cost_center_id', cc.id),
      supabase.from('actuals').select('*', { count: 'exact', head: true }).eq('cost_center_id', cc.id),
      supabase.from('scenario_locks').select('*', { count: 'exact', head: true }).eq('cost_center_id', cc.id),
    ])
    setDeleteCounts({
      budget: budget.count ?? 0,
      actuals: actuals.count ?? 0,
      locks: locks.count ?? 0,
    })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('cost_centers').delete().eq('id', deleteTarget.id)
    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }
    setCostCenters(prev => prev.filter(c => c.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleting(false)
  }

  // Budget entries block the delete outright (the FK is NO ACTION — the work is
  // hand-entered and cannot be recreated). Actuals cascade away, since they can
  // be re-imported, but they still warrant a typed confirmation.
  const deleteBlocked = (deleteCounts?.budget ?? 0) > 0
  const deleteCascades = (deleteCounts?.actuals ?? 0) + (deleteCounts?.locks ?? 0)
  const deleteNeedsTyping = deleteCascades > 0
  const canDelete =
    deleteCounts !== null &&
    !deleting &&
    !deleteBlocked &&
    (!deleteNeedsTyping || deleteConfirmText.trim() === deleteTarget?.code)

  const activeCount = costCenters.filter(c => c.is_active).length
  const inactiveCount = costCenters.length - activeCount

  return (
    <div className="p-8 max-w-4xl">
      <SaveErrorBanner message={writeError} onDismiss={clearWriteError} className="mb-5" />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kostnadsställen</h1>
          <p className="text-sm text-gray-500 mt-0.5">Aktivera, inaktivera och redigera kostnadsställen</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton section="admin-cost-centers" />
          <button
            onClick={() => { setShowNewRow(true); setEditingId(null) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors"
          >
            <Plus size={14} /> Nytt KS
          </button>
        </div>
      </div>

      {/* Company tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {companies.map(c => (
          <button
            key={c.id}
            onClick={() => { setSelectedCompanyId(c.id); setEditingId(null); setShowNewRow(false) }}
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

      <div className="mb-3 text-xs text-gray-400">
        {activeCount} aktiva · {inactiveCount} inaktiva · {costCenters.length} totalt
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-24">Kod</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Namn</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-36">Region</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 w-20">Aktiv</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {costCenters.map(cc => (
                <tr
                  key={cc.id}
                  className={cn('transition-colors', cc.is_active ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60 hover:opacity-80')}
                >
                  <td className="px-4 py-2.5 font-mono text-gray-700">{cc.code}</td>

                  {editingId === cc.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(cc); if (e.key === 'Escape') cancelEdit() }}
                          className="w-full px-2 py-1 border border-brand-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={editRegion}
                          onChange={e => setEditRegion(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(cc); if (e.key === 'Escape') cancelEdit() }}
                          placeholder="Region..."
                          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleActive(cc)}
                          className={cn(
                            'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                            cc.is_active ? 'bg-brand-100 text-brand-700 hover:bg-brand-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
                          )}
                        >
                          {cc.is_active ? <Check size={14} /> : <X size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => saveEdit(cc)}
                            disabled={saving}
                            className="p-1.5 rounded text-brand-600 hover:bg-brand-50 transition-colors"
                            title="Spara"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded text-gray-400 hover:bg-gray-100 transition-colors"
                            title="Avbryt"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-gray-900">{cc.name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{cc.region ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => toggleActive(cc)}
                          className={cn(
                            'inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                            cc.is_active ? 'bg-brand-100 text-brand-700 hover:bg-brand-200' : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
                          )}
                        >
                          {cc.is_active ? <Check size={14} /> : <X size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => startEdit(cc)}
                            className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title="Redigera"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => openDelete(cc)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Ta bort"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}

              {showNewRow && (
                <tr className="bg-brand-50 border-t-2 border-brand-100">
                  <td className="px-4 py-2">
                    <input
                      autoFocus
                      value={newCode}
                      onChange={e => setNewCode(e.target.value)}
                      placeholder="Kod"
                      className="w-full px-2 py-1 border border-brand-300 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createCostCenter(); if (e.key === 'Escape') setShowNewRow(false) }}
                      placeholder="Namn"
                      className="w-full px-2 py-1 border border-brand-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      value={newRegion}
                      onChange={e => setNewRegion(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createCostCenter(); if (e.key === 'Escape') setShowNewRow(false) }}
                      placeholder="Region"
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-brand-100 text-brand-700">
                      <Check size={14} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={createCostCenter}
                        disabled={saving || !newCode.trim() || !newName.trim()}
                        className="p-1.5 rounded text-brand-600 hover:bg-brand-100 transition-colors disabled:opacity-40"
                        title="Skapa"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setShowNewRow(false)}
                        className="p-1.5 rounded text-gray-400 hover:bg-gray-100 transition-colors"
                        title="Avbryt"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {costCenters.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-400 text-sm">
              Inga kostnadsställen för detta bolag
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-50 text-red-600 shrink-0">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">Ta bort kostnadsställe?</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-mono text-gray-700">{deleteTarget.code}</span> — {deleteTarget.name}
                </p>
              </div>
            </div>

            {deleteCounts === null ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                <Loader2 size={14} className="animate-spin" />
                Kontrollerar kopplad data…
              </div>
            ) : deleteBlocked ? (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
                  <p className="text-sm font-medium text-amber-900">
                    {deleteCounts.budget.toLocaleString('sv-SE')} budgetposter hindrar borttaget
                  </p>
                  <p className="text-sm text-amber-800 mt-1">
                    Budget matas in för hand och kan inte återskapas, så databasen tillåter inte att
                    kostnadsstället tas bort så länge den finns kvar.
                  </p>
                </div>
                <p className="text-sm text-gray-500 mb-5">
                  Stäng av <strong>Aktiv</strong> för att dölja kostnadsstället i budgetvyn — all data behålls
                  och det går att ångra. Ska det verkligen bort måste budgeten först nollställas i matrisen.
                </p>
              </>
            ) : deleteCascades === 0 ? (
              <p className="text-sm text-gray-600 mb-5">
                Kostnadsstället har ingen budget eller utfall kopplat. Det går att ta bort utan att något data
                förloras.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  Följande tas bort tillsammans med kostnadsstället:
                </p>
                <ul className="text-sm rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100 mb-4">
                  {deleteCounts.actuals > 0 && (
                    <li className="flex justify-between px-3 py-2 text-red-800">
                      <span>Utfallsrader</span>
                      <span className="font-medium tabular-nums">{deleteCounts.actuals.toLocaleString('sv-SE')}</span>
                    </li>
                  )}
                  {deleteCounts.locks > 0 && (
                    <li className="flex justify-between px-3 py-2 text-red-800">
                      <span>Scenariolås</span>
                      <span className="font-medium tabular-nums">{deleteCounts.locks.toLocaleString('sv-SE')}</span>
                    </li>
                  )}
                </ul>
                <p className="text-sm text-gray-500 mb-4">
                  Utfall kan importeras om från Fortnox eller Excel. Vill du bara dölja kostnadsstället i
                  budgetvyn — stäng av <strong>Aktiv</strong> istället.
                </p>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Skriv <span className="font-mono text-gray-900">{deleteTarget.code}</span> för att bekräfta
                </label>
                <input
                  autoFocus
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && canDelete) confirmDelete() }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                />
              </>
            )}

            {deleteError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
                Kunde inte ta bort: {deleteError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                Avbryt
              </button>
              <button
                onClick={confirmDelete}
                disabled={!canDelete}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Tar bort…' : 'Ta bort'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
