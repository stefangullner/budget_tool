import { useEffect, useState } from 'react'
import { Download, CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company } from '@/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

type ScenarioRow = {
  id: number
  name: string
  company_id: number
  start_year: number
  start_month: number
  end_year: number
  end_month: number
}

type ExportLogRow = {
  id: number
  triggered_by: string
  status: string
  details: { scenario_name?: string; rows?: number; file?: string; error?: string }
  synced_at: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export default function ExportPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | ''>('')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [exportLog, setExportLog] = useState<ExportLogRow[]>([])

  useEffect(() => {
    supabase.from('companies').select('*').order('id').then(({ data }) => setCompanies(data ?? []))
    supabase
      .from('scenarios')
      .select('id, name, company_id, start_year, start_month, end_year, end_month')
      .order('name')
      .then(({ data }) => {
        const rows = (data ?? []) as ScenarioRow[]
        setScenarios(rows)
        if (rows.length > 0) setSelectedScenarioId(rows[0].id)
      })
    fetchExportLog()
  }, [])

  async function fetchExportLog() {
    const { data } = await supabase
      .from('sync_log')
      .select('*')
      .eq('sync_type', 'export')
      .order('synced_at', { ascending: false })
      .limit(10)
    setExportLog((data ?? []) as ExportLogRow[])
  }

  async function doExport() {
    if (!selectedScenarioId) return
    setExporting(true)
    setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/fabric-trigger`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'export-scenario', scenarioId: selectedScenarioId }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, message: `${data.rows} rader exporterade → ${data.file}` })
        await fetchExportLog()
      } else {
        setResult({ ok: false, message: data.error ?? `Fel ${res.status}` })
      }
    } catch (err) {
      setResult({ ok: false, message: String(err) })
    } finally {
      setExporting(false)
    }
  }

  function companyName(id: number) {
    return companies.find(c => c.id === id)?.name ?? `Bolag ${id}`
  }

  function scenarioPeriod(s: ScenarioRow) {
    return `${MONTHS[s.start_month - 1]} ${s.start_year} – ${MONTHS[s.end_month - 1]} ${s.end_year}`
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId)

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Export</h2>
        <p className="text-sm text-gray-500 mt-0.5">Exportera budget-scenario till Fabric (lh_silver/Files/exports/)</p>
      </div>

      {/* Export-formulär */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="mb-5">
          <label className="text-xs font-medium text-gray-500 block mb-1.5">Scenario</label>
          <select
            value={selectedScenarioId}
            onChange={e => setSelectedScenarioId(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {companyName(s.company_id)} ({scenarioPeriod(s)})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 space-y-1">
          <p><span className="font-medium text-gray-700">Format:</span> CSV</p>
          <p><span className="font-medium text-gray-700">Destination:</span> lh_silver/Files/exports/</p>
          {selectedScenario && (
            <p>
              <span className="font-medium text-gray-700">Filnamn:</span>{' '}
              {selectedScenario.name.replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '_')}_{new Date().toISOString().slice(0, 10)}.csv
            </p>
          )}
          <p><span className="font-medium text-gray-700">Kolumner:</span> scenario, bolag, konto, kostnadsställe, år, månad, belopp</p>
        </div>

        {result && (
          <div className={cn(
            'flex items-start gap-2 px-4 py-3 rounded-lg text-sm mb-4 border',
            result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'
          )}>
            {result.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
            {result.message}
          </div>
        )}

        <button
          onClick={doExport}
          disabled={exporting || !selectedScenarioId}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-40"
        >
          <Download size={14} className={cn(exporting && 'animate-bounce')} />
          {exporting ? 'Exporterar...' : 'Exportera till Fabric'}
        </button>
      </div>

      {/* Exporthistorik */}
      {exportLog.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-700">Exporthistorik</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 w-40">Tid</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">Scenario</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 w-20">Rader</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 w-20">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">Fil</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exportLog.map((row, i) => (
                <tr key={row.id} className={cn(i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}>
                  <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{formatDate(row.synced_at)}</td>
                  <td className="px-4 py-2.5 text-gray-700">{row.details.scenario_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 tabular-nums">{row.details.rows ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium',
                      row.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    )}>
                      {row.status === 'success' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 font-mono truncate max-w-xs">
                    {row.details.file ? row.details.file.split('/').pop() : '—'}
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
