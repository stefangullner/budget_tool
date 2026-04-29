import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, Clock, Play } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

type SyncLogRow = {
  id: number
  sync_type: string
  triggered_by: string
  status: string
  details: Record<string, unknown>
  synced_at: string
}

const TYPE_LABELS: Record<string, string> = {
  accounts: 'Konton — sammanfattning',
  accounts_init: 'Konton — init',
  accounts_read: 'Konton — läsning',
  accounts_filter: 'Konton — filtrering',
  accounts_upsert: 'Konton — upsert',
  accounts_configs: 'Kontokonfiguration',
  accounts_trigger: 'Manuell synk-trigger',
  export: 'Export',
  test: 'Test',
}

function typeLabel(t: string) {
  return TYPE_LABELS[t] ?? t
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function detailSummary(row: SyncLogRow): string {
  const d = row.details
  if (row.sync_type === 'accounts' && d.synced_per_company) {
    const perCo = d.synced_per_company as Record<string, number>
    return Object.entries(perCo).map(([k, v]) => `bolag${k}: ${v}`).join(' · ')
  }
  if (typeof d.msg === 'string') return d.msg.slice(0, 120)
  return '—'
}

export default function SyncPage() {
  const [log, setLog] = useState<SyncLogRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)

  const fetchLog = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)
    const { data } = await supabase
      .from('sync_log')
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(20)
    setLog((data ?? []) as SyncLogRow[])
    if (showRefreshing) setRefreshing(false)
    else setLoading(false)
  }, [])

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => setCompanies(data ?? []))
    fetchLog()
  }, [fetchLog])

  async function triggerSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/fabric-trigger`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'sync-accounts' }),
      })
      const data = await res.json()
      if (res.ok) {
        setSyncResult({ ok: true, message: `Synk startad i Fabric (jobb-ID: ${data.jobId ?? '—'})` })
        await fetchLog(true)
      } else {
        setSyncResult({ ok: false, message: data.error ?? `Fel ${res.status}` })
      }
    } catch (err) {
      setSyncResult({ ok: false, message: String(err) })
    } finally {
      setSyncing(false)
    }
  }

  const lastAccountSync = log.find(r => r.sync_type === 'accounts')
  const perCompany = lastAccountSync?.details?.synced_per_company as Record<string, number> | undefined

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Synkronisering</h2>
          <p className="text-sm text-gray-500 mt-0.5">Kontosynk från Fortnox via Fabric — körs automatiskt dagligen kl. 10:00</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton section="admin-sync" />
          <button
            onClick={() => fetchLog(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            Uppdatera
          </button>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
          >
            <Play size={14} className={cn(syncing && 'animate-pulse')} />
            {syncing ? 'Startar...' : 'Synka konton nu'}
          </button>
        </div>
      </div>

      {/* Synk-resultat */}
      {syncResult && (
        <div className={cn(
          'flex items-start gap-2 px-4 py-3 rounded-lg text-sm mb-5 border',
          syncResult.ok
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        )}>
          {syncResult.ok
            ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            : <XCircle size={15} className="mt-0.5 shrink-0" />}
          {syncResult.message}
        </div>
      )}

      {/* Senaste synk-kort */}
      {lastAccountSync && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-gray-700">Senaste kontosynk</p>
            <div className="flex items-center gap-1.5">
              {lastAccountSync.status === 'success'
                ? <CheckCircle2 size={14} className="text-green-500" />
                : <XCircle size={14} className="text-red-500" />}
              <span className={cn(
                'text-xs font-medium',
                lastAccountSync.status === 'success' ? 'text-green-600' : 'text-red-600'
              )}>
                {lastAccountSync.status === 'success' ? 'Lyckades' : 'Misslyckades'}
              </span>
            </div>
          </div>

          {perCompany && companies.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {companies.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-xs text-gray-400 truncate">{c.name}</p>
                  <p className="text-lg font-semibold text-gray-800 tabular-nums">
                    {(perCompany[String(c.id)] ?? 0).toLocaleString('sv-SE')}
                  </p>
                  <p className="text-xs text-gray-400">konton</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Clock size={12} />
            {formatDate(lastAccountSync.synced_at)}
            <span className="mx-1">·</span>
            {lastAccountSync.triggered_by}
          </div>
        </div>
      )}

      {/* Synklogg */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-700">Synklogg</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-brand-600" />
          </div>
        ) : log.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Ingen synkhistorik hittades</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-40">Tid</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Typ</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-28">Källa</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-24">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Detaljer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {log.map((row, i) => (
                <tr key={row.id} className={cn('text-xs', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}>
                  <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{formatDate(row.synced_at)}</td>
                  <td className="px-4 py-2.5 text-gray-700">{typeLabel(row.sync_type)}</td>
                  <td className="px-4 py-2.5 text-gray-400">{row.triggered_by}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                      row.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    )}>
                      {row.status === 'success' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono truncate max-w-xs">{detailSummary(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
