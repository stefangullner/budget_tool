import { Fragment, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sortSections } from '@/hooks/useSectionOrder'
import { cn } from '@/lib/utils'

const ROLES = [
  { key: 'company_manager', label: 'Bolagsansvarig' },
  { key: 'cost_center_manager', label: 'KS-ansvarig' },
] as const

type RoleKey = typeof ROLES[number]['key']

interface PermRow {
  role: RoleKey
  section_name: string
  can_view: boolean
  can_edit: boolean
}

type PermMap = Map<string, { can_view: boolean; can_edit: boolean }>

export default function RoleSectionPermissions() {
  const [sections, setSections] = useState<string[]>([])
  const [permsByRole, setPermsByRole] = useState<Record<RoleKey, PermMap>>({
    company_manager: new Map(),
    cost_center_manager: new Map(),
  })
  const [saving, setSaving] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const [{ data: sectionData }, { data: permData }] = await Promise.all([
        supabase.from('section_configs').select('name, display_order'),
        supabase.from('role_section_permissions').select('role, section_name, can_view, can_edit'),
      ])

      const oMap = new Map<string, number>()
      for (const s of sectionData ?? []) oMap.set(s.name, s.display_order)

      setSections(sortSections((sectionData ?? []).map((s) => s.name), oMap))

      const maps: Record<RoleKey, PermMap> = {
        company_manager: new Map(),
        cost_center_manager: new Map(),
      }
      for (const p of (permData ?? []) as PermRow[]) {
        maps[p.role].set(p.section_name, { can_view: p.can_view, can_edit: p.can_edit })
      }
      setPermsByRole(maps)
    }
    load()
  }, [])

  function getPerm(role: RoleKey, section: string, field: 'can_view' | 'can_edit'): boolean {
    return permsByRole[role].get(section)?.[field] ?? false
  }

  async function toggle(role: RoleKey, section: string, field: 'can_view' | 'can_edit') {
    const current = permsByRole[role].get(section) ?? { can_view: false, can_edit: false }
    let updated = { ...current, [field]: !current[field] }

    if (field === 'can_edit' && updated.can_edit) updated.can_view = true
    if (field === 'can_view' && !updated.can_view) updated.can_edit = false

    const key = `${role}:${section}`
    setSaving((prev) => new Set(prev).add(key))

    if (!updated.can_view && !updated.can_edit) {
      await supabase
        .from('role_section_permissions')
        .delete()
        .eq('role', role)
        .eq('section_name', section)
    } else {
      await supabase.from('role_section_permissions').upsert(
        { role, section_name: section, can_view: updated.can_view, can_edit: updated.can_edit },
        { onConflict: 'role,section_name' },
      )
    }

    setPermsByRole((prev) => {
      const next = { ...prev, [role]: new Map(prev[role]) }
      if (!updated.can_view && !updated.can_edit) {
        next[role].delete(section)
      } else {
        next[role].set(section, updated)
      }
      return next
    })

    setSaving((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  if (sections.length === 0) return null

  return (
    <div className="mt-10 pt-8 border-t border-gray-200">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Sektionsbehörigheter per roll</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Styr vilka kontosektioner varje roll kan se och editera. Admin har alltid full tillgång.
          Sektioner utan behörighet är dolda i budgetvyn.
        </p>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500 w-64">Sektion</th>
              {ROLES.map((r) => (
                <th key={r.key} colSpan={2} className="px-4 py-3 text-center font-medium text-gray-600 border-l border-gray-200 min-w-[10rem]">
                  {r.label}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left">
                <span className="text-gray-400 font-normal text-[11px]">Alla sektioner</span>
              </th>
              {ROLES.map((r) => (
                <Fragment key={r.key}>
                  <th className="px-3 py-2 text-center border-l border-gray-200 w-20">
                    <button
                      onClick={() => {
                        const allChecked = sections.every((s) => getPerm(r.key, s, 'can_view'))
                        sections.forEach((s) => {
                          if (getPerm(r.key, s, 'can_view') === allChecked) toggle(r.key, s, 'can_view')
                        })
                      }}
                      className="text-gray-400 hover:text-brand-600 text-[11px] underline decoration-dotted"
                    >
                      {sections.every((s) => getPerm(r.key, s, 'can_view')) ? 'Avmarkera alla' : 'Markera alla'}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-center w-20">
                    <button
                      onClick={() => {
                        const allChecked = sections.every((s) => getPerm(r.key, s, 'can_edit'))
                        sections.forEach((s) => {
                          if (getPerm(r.key, s, 'can_edit') === allChecked) toggle(r.key, s, 'can_edit')
                        })
                      }}
                      className="text-gray-400 hover:text-brand-600 text-[11px] underline decoration-dotted"
                    >
                      {sections.every((s) => getPerm(r.key, s, 'can_edit')) ? 'Avmarkera alla' : 'Markera alla'}
                    </button>
                  </th>
                </Fragment>
              ))}
            </tr>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-1.5" />
              {ROLES.map((r) => (
                <Fragment key={r.key}>
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
                {ROLES.map((r) => {
                  const isSaving = saving.has(`${r.key}:${section}`)
                  const cv = getPerm(r.key, section, 'can_view')
                  const ce = getPerm(r.key, section, 'can_edit')
                  return (
                    <Fragment key={r.key}>
                      <td className="px-3 py-2 text-center border-l border-gray-100">
                        <Toggle
                          checked={cv}
                          disabled={isSaving}
                          onChange={() => toggle(r.key, section, 'can_view')}
                          color="blue"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Toggle
                          checked={ce}
                          disabled={isSaving || !cv}
                          onChange={() => toggle(r.key, section, 'can_edit')}
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
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled,
  color,
  title,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  color: 'blue' | 'green'
  title?: string
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
        checked
          ? color === 'blue' ? 'bg-blue-500' : 'bg-green-500'
          : 'bg-gray-200',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && 'cursor-pointer hover:opacity-80',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
