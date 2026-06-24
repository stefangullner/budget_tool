import { useEffect, useState } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Company } from '@/types'

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

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
    await supabase
      .from('companies')
      .update({ fabric_key: trimmed })
      .eq('id', id)
    setCompanies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, fabric_key: trimmed } : c))
    )
    setSaving(false)
    setEditingId(null)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Bolag</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Fabric-nyckeln styr vilken partition i datalagret som budgeten exporteras till.
        </p>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-8">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Bolagsnamn</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Organisationsnummer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-48">Fabric-nyckel</th>
              <th className="px-4 py-3 w-16" />
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
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        placeholder="t.ex. bolag1"
                        className="w-32 px-2 py-1 border border-brand-400 rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                      <button
                        onClick={() => commitEdit(c.id)}
                        disabled={saving}
                        className="text-green-600 hover:text-green-700 disabled:opacity-50"
                      >
                        <Check size={14} />
                      </button>
                      <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className={c.fabric_key ? 'font-mono text-gray-700' : 'text-gray-300 italic'}>
                      {c.fabric_key ?? 'ej satt'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {editingId !== c.id && (
                    <button
                      onClick={() => startEdit(c)}
                      className="text-gray-300 hover:text-gray-600 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
