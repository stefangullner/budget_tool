import { useEffect, useState } from 'react'
import { Check, X, Pencil, Trash2, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Company } from '@/types'

const MONTHS = ['Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
                'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December']

type NewCompany = { name: string; org_number: string; fiscal_year_start: string; fabric_key: string }
const EMPTY: NewCompany = { name: '', org_number: '', fiscal_year_start: '1', fabric_key: '' }

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newCompany, setNewCompany] = useState<NewCompany>(EMPTY)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('companies')
      .select('*')
      .order('id')
      .then(({ data }) => setCompanies((data ?? []) as Company[]))
  }, [])

  function startEdit(c: Company) {
    setEditingId(c.id)
    setEditValue(c.fabric_key ?? '')
  }

  async function commitEdit(id: number) {
    const trimmed = editValue.trim() || null
    setSaving(true)
    await supabase.from('companies').update({ fabric_key: trimmed }).eq('id', id)
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, fabric_key: trimmed } : c)))
    setSaving(false)
    setEditingId(null)
  }

  async function handleAdd() {
    if (!newCompany.name.trim() || !newCompany.org_number.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: newCompany.name.trim(),
        org_number: newCompany.org_number.trim(),
        fiscal_year_start: parseInt(newCompany.fiscal_year_start),
        fabric_key: newCompany.fabric_key.trim() || null,
      })
      .select()
      .single()
    if (!error && data) {
      setCompanies((prev) => [...prev, data as Company])
      setNewCompany(EMPTY)
      setShowAdd(false)
    }
    setSaving(false)
  }

  async function handleDelete(id: number) {
    await supabase.from('companies').delete().eq('id', id)
    setCompanies((prev) => prev.filter((c) => c.id !== id))
    setConfirmDeleteId(null)
  }

  const confirmTarget = companies.find((c) => c.id === confirmDeleteId)

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Bolag</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Fabric-nyckeln styr vilken partition i datalagret som budgeten exporteras till.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setNewCompany(EMPTY) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
        >
          <Plus size={14} /> Lägg till bolag
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-8">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Bolagsnamn</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Organisationsnummer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-48">Fabric-nyckel</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {companies.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.id}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.org_number}</td>
                <td className="px-4 py-3">
                  {editingId === c.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(c.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        placeholder="t.ex. bolag1"
                        className="w-32 px-2 py-1 border border-brand-400 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                      <button onClick={() => commitEdit(c.id)} disabled={saving} className="text-green-600 hover:text-green-700 disabled:opacity-50">
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className={c.fabric_key ? 'font-mono text-gray-700' : 'text-gray-300 italic'}>
                      {c.fabric_key ?? 'ej satt'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {editingId !== c.id && (
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(c)} className="text-gray-300 hover:text-gray-600 transition-colors p-1">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setConfirmDeleteId(c.id)} className="text-gray-300 hover:text-red-500 transition-colors p-1">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add dialog */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-4">Lägg till bolag</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Bolagsnamn *</label>
                <input
                  autoFocus
                  value={newCompany.name}
                  onChange={(e) => setNewCompany((p) => ({ ...p, name: e.target.value }))}
                  placeholder="On Via AB"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Organisationsnummer *</label>
                <input
                  value={newCompany.org_number}
                  onChange={(e) => setNewCompany((p) => ({ ...p, org_number: e.target.value }))}
                  placeholder="556000-0000"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Räkenskapsår börjar</label>
                <select
                  value={newCompany.fiscal_year_start}
                  onChange={(e) => setNewCompany((p) => ({ ...p, fiscal_year_start: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Fabric-nyckel</label>
                <input
                  value={newCompany.fabric_key}
                  onChange={(e) => setNewCompany((p) => ({ ...p, fabric_key: e.target.value }))}
                  placeholder="t.ex. bolag5"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Avbryt
              </button>
              <button
                onClick={handleAdd}
                disabled={saving || !newCompany.name.trim() || !newCompany.org_number.trim()}
                className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Ta bort bolag?</h3>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-medium text-gray-700">{confirmTarget?.name}</span> tas bort permanent.
            </p>
            <p className="text-sm text-red-500 mb-5">
              Alla konton, kostnadsställen och scenarier kopplade till bolaget tas bort.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Avbryt
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Ta bort
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
