import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import HelpButton from '@/components/HelpButton'
import { supabase } from '@/lib/supabase'
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
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('companies').select('*').then(({ data }) => setCompanies(data ?? []))
    supabase.from('accounts').select('id, company_id, account_number, name').then(({ data }) => setAccounts((data ?? []) as Account[]))
    supabase.from('cost_centers').select('id, company_id, code, name, is_active').then(({ data }) => setCostCenters((data ?? []) as CostCenter[]))
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

  function parseFile(file: File) {
    setResult(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
        const dataRows = raw.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''))
        const parsed = dataRows.map((r, i) => parseRow(r, i + 2))
        setRows(parsed)
      } catch {
        setResult({ ok: false, message: 'Kunde inte läsa filen. Kontrollera att det är en giltig .xlsx.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function parseRow(r: string[], rowNum: number): ParsedRow {
    const [rawCompany = '', rawAccount = '', rawKS = '', rawYear = '', rawMonth = '', rawAmount = ''] = r.map(String)
    const errors: string[] = []

    const company = companies.find(
      (c) => c.name.toLowerCase() === rawCompany.trim().toLowerCase()
        || c.org_number === rawCompany.trim()
    ) ?? null
    if (!company) errors.push(`Okänt bolag "${rawCompany.trim()}"`)

    const account = company
      ? accounts.find((a) => a.company_id === company.id && a.account_number === rawAccount.trim()) ?? null
      : null
    if (company && !account) errors.push(`Konto "${rawAccount.trim()}" ej funnet för ${company.name}`)

    const costCenter = company
      ? costCenters.find((k) => k.company_id === company.id && k.code === rawKS.trim()) ?? null
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

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)

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
        setImporting(false)
        return
      }
      imported += Math.min(BATCH, toUpsert.length - i)
    }

    setResult({ ok: true, message: `${imported} rader importerade (${errorRows.length} rader hoppades över pga fel).` })
    setRows([])
    setFileName(null)
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

      {/* Preview */}
      {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-gray-700">Förhandsgranskning</p>
              <span className="text-xs text-green-600 font-medium">{validRows.length} giltiga</span>
              {errorRows.length > 0 && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle size={11} /> {errorRows.length} fel
                </span>
              )}
            </div>
            <button
              onClick={doImport}
              disabled={importing || validRows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
            >
              {importing ? 'Importerar...' : `Importera ${validRows.length} rader`}
            </button>
          </div>

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
                {rows.map((r) => {
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
        </div>
      )}
    </div>
  )
}
