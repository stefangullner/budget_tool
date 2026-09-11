import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet, Loader2 } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Company, CostCenter } from '@/types'

interface Account { id: number; company_id: number; account_number: string; name: string }

interface ParsedRow {
  rowNum: number
  rawCompany: string
  rawAccount: string
  rawKS: string
  rawYear: string
  rawMonth: string
  rawAmount: string
  company: Company | null
  account: Account | null
  costCenter: CostCenter | null
  year: number | null
  month: number | null
  amount: number | null
  errors: string[]
}

const TEMPLATE_HEADERS = ['Bolag', 'Kontonummer', 'KS-kod', 'År', 'Månad', 'Belopp']

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [refDataLoading, setRefDataLoading] = useState(true)

  useEffect(() => {
    // Accounts run past PostgREST's 1000-row cap across all companies, so this
    // takes several round-trips — validation must wait for it (see `rows` below)
    Promise.all([
      supabase.from('companies').select('*').then(({ data }) => setCompanies(data ?? [])),
      fetchAllRows<Account>((from, to) =>
        supabase.from('accounts').select('id, company_id, account_number, name').order('id').range(from, to),
      ).then(setAccounts),
      fetchAllRows<CostCenter>((from, to) =>
        supabase.from('cost_centers').select('id, company_id, code, name, is_active').order('id').range(from, to),
      ).then(setCostCenters),
    ]).finally(() => setRefDataLoading(false))
  }, [])

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS,
      ['Bolagsnamn AB', '3000', '001', 2026, 1, 50000],
      ['Bolagsnamn AB', '3000', '001', 2026, 2, 52000],
    ])
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Utfall')
    XLSX.writeFile(wb, 'utfall_mall.xlsx')
  }

  /**
   * Only reads the cells. Validation happens in `rows` so it re-runs when the
   * lookup tables finish loading — otherwise a file picked during that window
   * validates against empty maps and every row reports a missing account.
   */
  function parseFile(file: File) {
    setResult(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
        setRawRows(raw.slice(1).filter((r: string[]) => r.some((c: string) => String(c).trim() !== '')))
      } catch {
        setResult({ ok: false, message: 'Kunde inte läsa filen. Kontrollera att det är en giltig .xlsx.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Indexed lookups — a linear .find() per row turns a 37k-row file into
  // hundreds of millions of comparisons and freezes the tab
  const companyByKey = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) {
      m.set(c.name.trim().toLowerCase(), c)
      if (c.org_number) m.set(c.org_number.trim(), c)
    }
    return m
  }, [companies])

  const accountByKey = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts) m.set(`${a.company_id}:${a.account_number.trim()}`, a)
    return m
  }, [accounts])

  const costCenterByKey = useMemo(() => {
    const m = new Map<string, CostCenter>()
    for (const k of costCenters) m.set(`${k.company_id}:${k.code.trim()}`, k)
    return m
  }, [costCenters])

  function parseRow(r: string[], rowNum: number): ParsedRow {
    const [rawCompany = '', rawAccount = '', rawKS = '', rawYear = '', rawMonth = '', rawAmount = ''] = r.map(String)
    const errors: string[] = []

    const key = rawCompany.trim()
    const company = companyByKey.get(key.toLowerCase()) ?? companyByKey.get(key) ?? null
    if (!company) errors.push(`Okänt bolag "${key}"`)

    const account = company
      ? accountByKey.get(`${company.id}:${rawAccount.trim()}`) ?? null
      : null
    if (company && !account) errors.push(`Konto "${rawAccount.trim()}" ej funnet för ${company.name}`)

    const costCenter = company
      ? costCenterByKey.get(`${company.id}:${rawKS.trim()}`) ?? null
      : null
    if (company && !costCenter) errors.push(`KS "${rawKS.trim()}" ej funnet för ${company.name}`)

    const year = parseInt(rawYear)
    if (isNaN(year) || year < 2000 || year > 2100) errors.push(`Ogiltigt år "${rawYear}"`)

    const month = parseInt(rawMonth)
    if (isNaN(month) || month < 1 || month > 12) errors.push(`Ogiltig månad "${rawMonth}"`)

    const amountStr = String(rawAmount).replace(/\s/g, '').replace(',', '.')
    const amount = parseFloat(amountStr)
    if (isNaN(amount)) errors.push(`Ogiltigt belopp "${rawAmount}"`)

    return {
      rowNum, rawCompany, rawAccount, rawKS, rawYear, rawMonth, rawAmount,
      company, account, costCenter,
      year: isNaN(year) ? null : year,
      month: isNaN(month) ? null : month,
      amount: isNaN(amount) ? null : amount,
      errors,
    }
  }

  // Derived, not stored — re-validates automatically once the lookup tables land
  const rows = useMemo(
    () => (refDataLoading ? [] : rawRows.map((r, i) => parseRow(r, i + 2))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawRows, refDataLoading, companyByKey, accountByKey, costCenterByKey],
  )

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)

  // Rendering every row of a large file locks up the browser. Show the problem
  // rows first — those are the ones worth acting on.
  const PREVIEW_LIMIT = 300
  const previewRows = [...errorRows, ...validRows].slice(0, PREVIEW_LIMIT)
  const hiddenRowCount = rows.length - previewRows.length

  /** Distinct error messages with a count, so 33 000 rows collapse to a short list. */
  const errorSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of errorRows) {
      for (const e of r.errors) counts.set(e, (counts.get(e) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [errorRows])

  async function doImport() {
    if (validRows.length === 0) return
    setImporting(true)
    setResult(null)

    const toUpsert = validRows.map((r) => ({
      company_id: r.company!.id,
      account_id: r.account!.id,
      cost_center_id: r.costCenter!.id,
      year: r.year!,
      month: r.month!,
      amount: r.amount!,
      synced_at: new Date().toISOString(),
    }))

    const BATCH = 500
    let imported = 0
    for (let i = 0; i < toUpsert.length; i += BATCH) {
      const { error } = await supabase
        .from('actuals')
        .upsert(toUpsert.slice(i, i + BATCH), {
          onConflict: 'company_id,account_id,cost_center_id,year,month',
        })
      if (error) {
        setResult({ ok: false, message: `Fel vid import (rad ${i + 1}–${i + BATCH}): ${error.message}` })
        setProgress(null)
        setImporting(false)
        return
      }
      imported += Math.min(BATCH, toUpsert.length - i)
      setProgress({ done: imported, total: toUpsert.length })
    }

    setResult({ ok: true, message: `${imported} rader importerade (${errorRows.length} rader hoppades över pga fel).` })
    setRawRows([])
    setFileName(null)
    setProgress(null)
    setImporting(false)
  }

  const MONTH_LABELS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Import utfall</h2>
          <p className="text-sm text-gray-500 mt-0.5">Importera faktiskt utfall per bolag, konto, kostnadsställe och månad från Excel</p>
        </div>
        <HelpButton section="admin-import" />
      </div>

      {/* Template download + upload */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-start gap-6">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 mb-1">Mallformat</p>
            <p className="text-xs text-gray-500 mb-3">
              Kolumner: <span className="font-mono text-gray-700">Bolag · Kontonummer · KS-kod · År · Månad · Belopp</span>
            </p>
            <p className="text-xs text-gray-400">
              Bolag matchas på namn eller organisationsnummer. Månad anges som heltal 1–12.
              Befintliga rader med samma bolag/konto/KS/år/månad skrivs över.
            </p>
          </div>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors shrink-0"
          >
            <Download size={13} /> Ladda ner mall
          </button>
        </div>

        <div className="mt-5 border-t border-gray-100 pt-5">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) parseFile(e.target.files[0]) }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors"
          >
            <Upload size={14} /> Välj Excel-fil
          </button>
          {fileName && (
            <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
              <FileSpreadsheet size={13} className="text-green-500" /> {fileName}
            </p>
          )}
          {refDataLoading ? (
            <p className="mt-2 text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" />
              Laddar konton och kostnadsställen — validering startar när de är klara
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-400">
              Validerar mot {accounts.length.toLocaleString('sv-SE')} konton ·{' '}
              {costCenters.length.toLocaleString('sv-SE')} kostnadsställen ·{' '}
              {companies.length} bolag
            </p>
          )}
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className={cn(
          'flex items-start gap-2 px-4 py-3 rounded-lg text-sm mb-5 border',
          result.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800',
        )}>
          {result.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
          {result.message}
        </div>
      )}

      {/* File read, but validation is waiting on the lookup tables */}
      {rawRows.length > 0 && refDataLoading && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm mb-5 border border-gray-200 bg-gray-50 text-gray-500">
          <Loader2 size={15} className="animate-spin shrink-0" />
          {rawRows.length.toLocaleString('sv-SE')} rader inlästa — väntar på konto- och KS-listan innan de valideras.
        </div>
      )}

      {/* Preview */}
      {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-gray-700">Förhandsgranskning</p>
              <span className="text-xs text-green-600 font-medium">
                {validRows.length.toLocaleString('sv-SE')} giltiga
              </span>
              {errorRows.length > 0 && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle size={11} /> {errorRows.length.toLocaleString('sv-SE')} fel
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {progress && (
                <div className="flex items-center gap-2">
                  <div className="w-28 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {progress.done.toLocaleString('sv-SE')} / {progress.total.toLocaleString('sv-SE')}
                  </span>
                </div>
              )}
              <button
                onClick={doImport}
                disabled={importing || validRows.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
              >
                {importing ? 'Importerar...' : `Importera ${validRows.length} rader`}
              </button>
            </div>
          </div>

          {/* Error summary — collapses thousands of rows into distinct causes */}
          {errorSummary.length > 0 && (
            <div className="px-4 py-3 border-b border-gray-100 bg-red-50/50">
              <p className="text-xs font-medium text-red-800 mb-1.5">Felorsaker</p>
              <ul className="space-y-1">
                {errorSummary.slice(0, 15).map(([msg, count]) => (
                  <li key={msg} className="text-xs text-red-700 flex items-baseline gap-2">
                    <span className="tabular-nums font-medium shrink-0 w-14 text-right">
                      {count.toLocaleString('sv-SE')}×
                    </span>
                    <span>{msg}</span>
                  </li>
                ))}
              </ul>
              {errorSummary.length > 15 && (
                <p className="text-xs text-red-600 mt-1.5">
                  …och {errorSummary.length - 15} andra felorsaker
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 w-8">#</th>
                  <th className="px-3 py-2 text-left text-gray-500">Bolag</th>
                  <th className="px-3 py-2 text-left text-gray-500">Konto</th>
                  <th className="px-3 py-2 text-left text-gray-500">KS</th>
                  <th className="px-3 py-2 text-left text-gray-500">Period</th>
                  <th className="px-3 py-2 text-right text-gray-500">Belopp</th>
                  <th className="px-3 py-2 text-left text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map((r) => {
                  const ok = r.errors.length === 0
                  return (
                    <tr key={r.rowNum} className={cn(ok ? 'bg-white' : 'bg-red-50/40')}>
                      <td className="px-3 py-1.5 text-gray-400">{r.rowNum}</td>
                      <td className="px-3 py-1.5 text-gray-700">
                        {r.company ? r.company.name : <span className="text-red-500">{r.rawCompany}</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-700">
                        {r.account ? `${r.account.account_number} ${r.account.name}` : <span className="text-red-500">{r.rawAccount}</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-700">
                        {r.costCenter ? r.costCenter.code : <span className="text-red-500">{r.rawKS}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {r.year && r.month ? `${MONTH_LABELS[r.month - 1]} ${r.year}` : <span className="text-red-500">{r.rawYear}/{r.rawMonth}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {r.amount !== null ? r.amount.toLocaleString('sv-SE') : <span className="text-red-500">{r.rawAmount}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {ok ? (
                          <CheckCircle2 size={13} className="text-green-500" />
                        ) : (
                          <span className="text-red-500">{r.errors.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hiddenRowCount > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-center">
              Visar {previewRows.length} av {rows.length.toLocaleString('sv-SE')} rader — felrader först.
              Alla giltiga rader importeras oavsett vad som visas här.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
