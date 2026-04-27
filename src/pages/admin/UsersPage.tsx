import { useEffect, useState, useCallback } from 'react'
import { Trash2, Plus, X, UserPlus, Shield, Building2, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company, CostCenter } from '@/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

type UserRole = {
  id: number
  user_id: string
  role: 'admin' | 'company_manager' | 'cost_center_manager'
  company_id: number | null
  cost_center_id: number | null
}

type UserData = {
  id: string
  email: string
  display_name: string
  created_at: string
  last_sign_in_at: string | null
  roles: UserRole[]
}

const ROLE_LABELS = {
  admin: 'Admin',
  company_manager: 'Bolagsansvarig',
  cost_center_manager: 'KS-ansvarig',
}

function RoleBadge({ role, label }: { role: UserRole['role']; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      role === 'admin' && 'bg-purple-50 text-purple-700',
      role === 'company_manager' && 'bg-blue-50 text-blue-700',
      role === 'cost_center_manager' && 'bg-green-50 text-green-700',
    )}>
      {role === 'admin' && <Shield size={10} />}
      {role === 'company_manager' && <Building2 size={10} />}
      {role === 'cost_center_manager' && <MapPin size={10} />}
      {label}
    </span>
  )
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingUser, setEditingUser] = useState<UserData | null>(null)
  const [newRole, setNewRole] = useState<UserRole['role']>('company_manager')
  const [newCompanyId, setNewCompanyId] = useState<number | ''>('')
  const [newCostCenterId, setNewCostCenterId] = useState<number | ''>('')
  const [addingRole, setAddingRole] = useState(false)

  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const [deleteUserId, setDeleteUserId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) { setError('Kunde inte hämta användare'); setLoading(false); return }
    const data = await res.json()
    setUsers(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
    supabase.from('companies').select('*').order('id').then(({ data }) => setCompanies(data ?? []))
    supabase.from('cost_centers').select('*').order('code').then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
  }, [fetchUsers])

  function roleScopeLabel(r: UserRole): string {
    if (r.role === 'admin') return 'Admin'
    if (r.role === 'company_manager') {
      const c = companies.find(c => c.id === r.company_id)
      return c ? `${ROLE_LABELS.company_manager} — ${c.name}` : ROLE_LABELS.company_manager
    }
    const ks = costCenters.find(k => k.id === r.cost_center_id)
    return ks ? `${ROLE_LABELS.cost_center_manager} — ${ks.code} ${ks.name}` : ROLE_LABELS.cost_center_manager
  }

  async function addRole() {
    if (!editingUser) return
    if (newRole === 'company_manager' && !newCompanyId) return
    if (newRole === 'cost_center_manager' && !newCostCenterId) return
    setAddingRole(true)
    const { data } = await supabase.from('user_roles').insert({
      user_id: editingUser.id,
      role: newRole,
      company_id: newRole === 'company_manager' ? newCompanyId || null : null,
      cost_center_id: newRole === 'cost_center_manager' ? newCostCenterId || null : null,
    }).select().single()
    if (data) {
      const updated = { ...editingUser, roles: [...editingUser.roles, data as UserRole] }
      setEditingUser(updated)
      setUsers(prev => prev.map(u => u.id === editingUser.id ? updated : u))
      setNewCompanyId('')
      setNewCostCenterId('')
    }
    setAddingRole(false)
  }

  async function removeRole(roleId: number) {
    if (!editingUser) return
    await supabase.from('user_roles').delete().eq('id', roleId)
    const updated = { ...editingUser, roles: editingUser.roles.filter(r => r.id !== roleId) }
    setEditingUser(updated)
    setUsers(prev => prev.map(u => u.id === editingUser.id ? updated : u))
  }

  async function inviteUser() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-users/invite`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setInviteError(err.error ?? 'Inbjudan misslyckades')
    } else {
      setInviteEmail('')
      setShowInvite(false)
      await fetchUsers()
    }
    setInviting(false)
  }

  async function deleteUser() {
    if (!deleteUserId) return
    setDeleting(true)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${SUPABASE_URL}/functions/v1/admin-users/${deleteUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    setUsers(prev => prev.filter(u => u.id !== deleteUserId))
    setDeleteUserId(null)
    setDeleting(false)
  }

  const ksForCompany = newRole === 'cost_center_manager' && newCompanyId
    ? costCenters.filter(k => k.company_id === newCompanyId)
    : costCenters

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Användare</h1>
          <p className="text-sm text-gray-500 mt-0.5">Hantera användare, roller och behörigheter</p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteError(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors"
        >
          <UserPlus size={14} /> Bjud in
        </button>
      </div>

      {/* Invite dialog */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Bjud in användare</h2>
            <input
              autoFocus
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && inviteUser()}
              placeholder="epost@exempel.se"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 mb-3"
            />
            {inviteError && <p className="text-xs text-red-600 mb-3">{inviteError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowInvite(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={inviteUser}
                disabled={inviting || !inviteEmail.trim()}
                className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
              >
                {inviting ? 'Skickar...' : 'Skicka inbjudan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Ta bort användare?</h2>
            <p className="text-sm text-gray-500 mb-5">
              Användaren och all tillhörande data tas bort permanent. Åtgärden kan inte ångras.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteUserId(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={deleteUser}
                disabled={deleting}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40"
              >
                {deleting ? 'Tar bort...' : 'Ta bort'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role edit modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{editingUser.display_name}</h2>
                <p className="text-xs text-gray-400">{editingUser.email}</p>
              </div>
              <button onClick={() => setEditingUser(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            {/* Current roles */}
            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Tilldelade roller</p>
              {editingUser.roles.length === 0 ? (
                <p className="text-sm text-gray-400">Inga roller tilldelade</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {editingUser.roles.map(r => (
                    <div key={r.id} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                      <RoleBadge role={r.role} label={roleScopeLabel(r)} />
                      <button
                        onClick={() => removeRole(r.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add role */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Lägg till roll</p>
              <div className="flex flex-col gap-2">
                <select
                  value={newRole}
                  onChange={e => { setNewRole(e.target.value as UserRole['role']); setNewCompanyId(''); setNewCostCenterId('') }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="admin">Admin</option>
                  <option value="company_manager">Bolagsansvarig</option>
                  <option value="cost_center_manager">KS-ansvarig</option>
                </select>

                {newRole === 'company_manager' && (
                  <select
                    value={newCompanyId}
                    onChange={e => setNewCompanyId(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="">Välj bolag...</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}

                {newRole === 'cost_center_manager' && (
                  <>
                    <select
                      value={newCompanyId}
                      onChange={e => { setNewCompanyId(Number(e.target.value)); setNewCostCenterId('') }}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">Filtrera på bolag (valfritt)</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select
                      value={newCostCenterId}
                      onChange={e => setNewCostCenterId(Number(e.target.value))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">Välj kostnadsställe...</option>
                      {ksForCompany.map(k => <option key={k.id} value={k.id}>{k.code} — {k.name}</option>)}
                    </select>
                  </>
                )}

                <button
                  onClick={addRole}
                  disabled={
                    addingRole ||
                    (newRole === 'company_manager' && !newCompanyId) ||
                    (newRole === 'cost_center_manager' && !newCostCenterId)
                  }
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
                >
                  <Plus size={14} /> Lägg till
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error} — Edge Function behöver deployas först (se instruktioner nedan).
          <pre className="mt-2 text-xs bg-red-100 rounded p-2">supabase functions deploy admin-users --project-ref sjzhrxzyrbtbryypcpor</pre>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Namn</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">E-post</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Roller</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-32">Senast inloggad</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.display_name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <span className="text-xs text-gray-300">Ingen roll</span>
                      ) : (
                        u.roles.map(r => (
                          <RoleBadge key={r.id} role={r.role} label={roleScopeLabel(r)} />
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString('sv-SE')
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => { setEditingUser(u); setNewRole('company_manager'); setNewCompanyId(''); setNewCostCenterId('') }}
                        className="px-2 py-1 text-xs text-brand-600 border border-brand-200 rounded hover:bg-brand-50 transition-colors"
                      >
                        Roller
                      </button>
                      <button
                        onClick={() => setDeleteUserId(u.id)}
                        className="p-1.5 text-gray-300 hover:text-red-500 transition-colors rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
