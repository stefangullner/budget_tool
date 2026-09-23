import { Fragment, useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import SaveErrorBanner from '@/components/SaveErrorBanner'
import { supabase } from '@/lib/supabase'
import { useWriteGuard } from '@/lib/writes'
import { sortSections } from '@/hooks/useSectionOrder'
import { useRoles } from '@/hooks/useRoles'
import { cn } from '@/lib/utils'
import type { RoleDefinition } from '@/types'

type PermMap = Map<string, { can_view: boolean; can_edit: boolean }>

interface PermRow {
  role: string
  section_name: string
  can_view: boolean
  can_edit: boolean
}

const SCOPE_LABELS: Record<RoleDefinition['scope_type'], string> = {
  global: 'Global',
  company: 'Per bolag',
  cost_center: 'Per KS',
  region: 'Per region',
}

export default function RoleSectionPermissions() {
  const { roles, createRole, deleteRole } = useRoles()
  const { error: writeError, clearError: clearWriteError, run } = useWriteGuard()
  const [sections, setSections] = useState<string[]>([])
  const [permsByRole, setPermsByRole] = useState<Map<string, PermMap>>(new Map())
  const [saving, setSaving] = useState<Set<string>>(new Set())

  const [showCreate, setShowCreate] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newScope, setNewScope] = useState<RoleDefinition['scope_type']>('cost_center')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const configurableRoles = roles.filter((r) => r.name !== 'admin')

  useEffect(() => {
    async function loadSections() {
      const { data } = await supabase.from('section_configs').select('name, display_order')
      const oMap = new Map<string, number>()
      for (const s of data ?? []) oMap.set(s.name, s.display_order)
      setSections(sortSections((data ?? []).map((s) => s.name), oMap))
    }
    loadSections()
  }, [])

  useEffect(() => {
    async function loadPerms() {
      const { data } = await supabase
        .from('role_section_permissions')
        .select('role, section_name, can_view, can_edit')
      const map = new Map<string, PermMap>()
      for (const p of (data ?? []) as PermRow[]) {
        if (!map.has(p.role)) map.set(p.role, new Map())
        map.get(p.role)!.set(p.section_name, { can_view: p.can_view, can_edit: p.can_edit })
      }
      setPermsByRole(map)
    }
    loadPerms()
  }, [roles])

  function getPerm(role: string, section: string, field: 'can_view' | 'can_edit'): boolean {
    return permsByRole.get(role)?.get(section)?.[field] ?? false
  }

  async function toggle(role: string, section: string, field: 'can_view' | 'can_edit') {
    const current = permsByRole.get(role)?.get(section) ?? { can_view: false, can_edit: false }
    let updated = { ...current, [field]: !current[field] }
    if (field === 'can_edit' && updated.can_edit) updated.can_view = true
    if (field === 'can_view' && !updated.can_view) updated.can_edit = false

    const key = `${role}:${section}`
    setSaving((prev) => new Set(prev).add(key))

    const ok = await run(
      !updated.can_view && !updated.can_edit
        ? supabase
            .from('role_section_permissions')
            .delete()
            .eq('role', role)
            .eq('section_name', section)
        : supabase.from('role_section_permissions').upsert(
            { role, section_name: section, can_view: updated.can_view, can_edit: updated.can_edit },
            { onConflict: 'role,section_name' },
          ),
    )
    if (!ok) {
      setSaving((prev) => { const next = new Set(prev); next.delete(key); return next })
      return
    }

    setPermsByRole((prev) => {
      const next = new Map(prev)
      if (!next.has(role)) next.set(role, new Map())
      const roleMap = new Map(next.get(role)!)
      if (!updated.can_view && !updated.can_edit) {
        roleMap.delete(section)
      } else {
        roleMap.set(section, updated)
      }
      next.set(role, roleMap)
      return next
    })

    setSaving((prev) => { const n = new Set(prev); n.delete(key); return n })
  }

  async function handleCreate() {
    if (!newLabel.trim()) return
    setCreating(true)
    setCreateError(null)
    const ok = await createRole(newLabel, newScope)
    if (!ok) {
      setCreateError('Kunde inte skapa roll. Kontrollera att namnet är unikt.')
    } else {
      setNewLabel('')
      setShowCreate(false)
    }
    setCreating(false)
  }

  async function handleDelete(name: string) {
    await deleteRole(name)
    setDeleteTarget(null)
  }

  if (sections.length === 0) return null

  return (
    <div className="mt-10 pt-8 border-t border-gray-200">
      <SaveErrorBanner message={writeError} onDismiss={clearWriteError} className="mb-4" />
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Sektionsbehörigheter per roll</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Styr vilka kontosektioner varje roll kan se och editera. Admin har alltid full tillgång.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateError(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Plus size={14} /> Ny roll
        </button>
      </div>

      {/* Create role dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Skapa ny roll</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rollnamn</label>
                <input
                  autoFocus
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="t.ex. Trafikinstruktör"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Scope</label>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as RoleDefinition['scope_type'])}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="cost_center">Per kostnadsställe</option>
                  <option value="region">Per region</option>
                  <option value="company">Per bolag</option>
                  <option value="global">Global (inget scope)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Avgör vad som väljs när rollen tilldelas en användare.
                </p>
              </div>
              {createError && <p className="text-xs text-red-600">{createError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Avbryt
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newLabel.trim()}
                className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40"
              >
                {creating ? 'Skapar...' : 'Skapa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Ta bort roll?</h3>
            <p className="text-sm text-gray-500 mb-4">
              Rollen och alla dess sektionsbehörigheter tas bort. Användare med rollen behåller sin
              bolag/KS-koppling men förlorar rollbehörigheten.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Avbryt
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Ta bort
              </button>
            </div>
          </div>
        </div>
      )}

      {configurableRoles.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Inga roller konfigurerade — skapa en ny roll ovan.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="text-xs w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-56">Sektion</th>
                {configurableRoles.map((r) => (
                  <th key={r.name} colSpan={2} className="px-3 py-3 text-center border-l border-gray-200 min-w-[9rem]">
                    <div className="flex items-center justify-center gap-1.5">
                      <div>
                        <div className="font-medium text-gray-700">{r.label}</div>
                        <div className="text-[10px] text-gray-400 font-normal">{SCOPE_LABELS[r.scope_type]}</div>
                      </div>
                      {!r.is_system && (
                        <button
                          onClick={() => setDeleteTarget(r.name)}
                          className="ml-1 text-gray-300 hover:text-red-500 transition-colors"
                          title="Ta bort roll"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-1.5 text-left">
                  <span className="text-gray-400 font-normal text-[11px]">Alla sektioner</span>
                </th>
                {configurableRoles.map((r) => (
                  <Fragment key={r.name}>
                    <th className="px-3 py-1.5 text-center border-l border-gray-200 w-20">
                      <button
                        onClick={() => {
                          const allOn = sections.every((s) => getPerm(r.name, s, 'can_view'))
                          sections.forEach((s) => { if (getPerm(r.name, s, 'can_view') === allOn) toggle(r.name, s, 'can_view') })
                        }}
                        className="text-gray-400 hover:text-brand-600 text-[11px] underline decoration-dotted"
                      >
                        {sections.every((s) => getPerm(r.name, s, 'can_view')) ? 'Avmarkera' : 'Markera'} alla
                      </button>
                    </th>
                    <th className="px-3 py-1.5 text-center w-20">
                      <button
                        onClick={() => {
                          const allOn = sections.every((s) => getPerm(r.name, s, 'can_edit'))
                          sections.forEach((s) => { if (getPerm(r.name, s, 'can_edit') === allOn) toggle(r.name, s, 'can_edit') })
                        }}
                        className="text-gray-400 hover:text-brand-600 text-[11px] underline decoration-dotted"
                      >
                        {sections.every((s) => getPerm(r.name, s, 'can_edit')) ? 'Avmarkera' : 'Markera'} alla
                      </button>
                    </th>
                  </Fragment>
                ))}
              </tr>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-1.5" />
                {configurableRoles.map((r) => (
                  <Fragment key={r.name}>
                    <th className="px-3 py-1.5 text-center text-gray-400 font-normal border-l border-gray-200 w-20">Se</th>
                    <th className="px-3 py-1.5 text-center text-gray-400 font-normal w-20">Editera</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sections.map((section) => (
                <tr key={section} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-700">{section}</td>
                  {configurableRoles.map((r) => {
                    const isSaving = saving.has(`${r.name}:${section}`)
                    const cv = getPerm(r.name, section, 'can_view')
                    const ce = getPerm(r.name, section, 'can_edit')
                    return (
                      <Fragment key={r.name}>
                        <td className="px-3 py-2 text-center border-l border-gray-100">
                          <Toggle checked={cv} disabled={isSaving} onChange={() => toggle(r.name, section, 'can_view')} color="blue" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Toggle
                            checked={ce}
                            disabled={isSaving || !cv}
                            onChange={() => toggle(r.name, section, 'can_edit')}
                            color="green"
                            title={!cv ? 'Kräver att Se är aktivt' : undefined}
                          />
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, disabled, color, title }: {
  checked: boolean; onChange: () => void; disabled?: boolean; color: 'blue' | 'green'; title?: string
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
        checked ? (color === 'blue' ? 'bg-blue-500' : 'bg-green-500') : 'bg-gray-200',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0.5',
      )} />
    </button>
  )
}
