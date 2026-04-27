import { useEffect, useState, useCallback } from 'react'
import { Check, X, Pencil, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company, CostCenter } from '@/types'

type CostCenterRow = CostCenter & { region: string | null }

export default function CostCentersPage() {
  const [companies, setCompanies] = useState<Company[]>([])
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
    await supabase.from('cost_centers').update({ is_active: newVal }).eq('id', cc.id)
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
    await supabase
      .from('cost_centers')
      .update({ name: editName.trim(), region: editRegion.trim() || null })
      .eq('id', cc.id)
    setCostCenters(prev =>
      prev.map(c => c.id === cc.id ? { ...c, name: editName.trim(), region: editRegion.trim() || null } : c)
    )
    setEditingId(null)
    setSaving(false)
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

  const activeCount = costCenters.filter(c => c.is_active).length

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kostnadsställen</h1>
          <p className="text-sm text-gray-500 mt-0.5">Aktivera, inaktivera och redigera kostnadsställen</p>
        </div>
        <button
          onClick={() => { setShowNewRow(true); setEditingId(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Plus size={14} /> Nytt KS
        </button>
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
        {activeCount} av {costCenters.length} kostnadsställen aktiva
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
                        <button
                          onClick={() => startEdit(cc)}
                          className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors float-right"
                          title="Redigera"
                        >
                          <Pencil size={14} />
                        </button>
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
    </div>
  )
}
