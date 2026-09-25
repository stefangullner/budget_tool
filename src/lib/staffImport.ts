import * as XLSX from 'xlsx'
import type { CostCenter, EmploymentType } from '@/types'

/**
 * Reading a staff list exported from the personnel system.
 *
 * Exports rarely have the same column names twice, so columns are recognised by
 * their header text rather than position, and the header row is searched for
 * (the old budget file has it on row 9). One row per person and cost center;
 * several rows with the same employee number are one person split across cost
 * centers — exactly how "Personallista med fördelning" is laid out.
 */

export type StaffField =
  | 'employee_no' | 'last_name' | 'first_name' | 'employment_type' | 'title'
  | 'cost_center' | 'rate' | 'salary' | 'supplement' | 'vacation_days' | 'car_benefit' | 'note'

/**
 * Checked in this order, first match wins per header. Order matters:
 * "Månadslön (exkl tillägg)" must become salary before supplement gets a look.
 */
const FIELD_ALIASES: [StaffField, string[]][] = [
  ['employee_no', ['anstnr', 'anställningsnummer', 'anstallningsnummer', 'personalnummer', 'anstid']],
  ['last_name', ['efternamn']],
  ['first_name', ['förnamn', 'fornamn']],
  ['employment_type', ['anställningsform', 'anstallningsform', 'anstform']],
  ['title', ['befattning', 'titel', 'tjänst']],
  ['cost_center', ['kst', 'kostnadsställe', 'kostnadsstalle', 'kskod']],
  ['rate', ['sysselsättningsgrad', 'sysselsattningsgrad', 'syssel', 'anställningsgrad', 'tjänstgöringsgrad']],
  ['salary', ['månadslön', 'manadslon', 'grundlön']],
  ['supplement', ['tillägg', 'tillagg']],
  ['vacation_days', ['semesterdag']],
  ['car_benefit', ['bilförmån', 'bilforman']],
  ['note', ['kommentar', 'notering']],
]

const REQUIRED: StaffField[] = ['cost_center', 'salary']

export const TEMPLATE_HEADERS = [
  'Anst.nr', 'Efternamn', 'Förnamn', 'Befattning', 'Anställningsform', 'Kst',
  'Sysselsättningsgrad', 'Månadslön', 'Tillägg/månad', 'Semesterdagar', 'Bilförmån (kr/år)', 'Kommentar',
]

function normalise(s: unknown) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9åäö]/g, '')
}

function headerMap(row: unknown[]): Map<StaffField, number> {
  const map = new Map<StaffField, number>()
  row.forEach((cell, idx) => {
    const h = normalise(cell)
    if (!h) return
    for (const [field, aliases] of FIELD_ALIASES) {
      if (map.has(field)) continue
      if (aliases.some((a) => h.includes(a))) {
        map.set(field, idx)
        return
      }
    }
  })
  return map
}

export type SheetScan = {
  sheetName: string
  headerRow: number
  columns: Map<StaffField, number>
  rows: unknown[][]
}

/** Finds the sheet and row that look most like a staff list header. */
export function scanWorkbook(data: ArrayBuffer): SheetScan | null {
  const wb = XLSX.read(data, { type: 'array' })
  let best: SheetScan | null = null
  for (const sheetName of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '' })
    for (let r = 0; r < Math.min(raw.length, 30); r++) {
      const columns = headerMap(raw[r])
      if (!REQUIRED.every((f) => columns.has(f))) continue
      if (!best || columns.size > best.columns.size) {
        best = { sheetName, headerRow: r, columns, rows: raw.slice(r + 1) }
      }
    }
  }
  return best
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.').replace('%', '')
  if (s === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function text(v: unknown) {
  return String(v ?? '').trim()
}

export type ImportRow = {
  line: number // 1-based row number in the sheet
  employeeNo: string
  lastName: string
  firstName: string
  title: string
  employmentType: EmploymentType | null
  costCenter: CostCenter | null
  costCenterCode: string
  rate: number
  salary: number | null
  supplement: number
  vacationDays: number | null
  carBenefit: number
  note: string
  errors: string[]
}

export type PlannedMember = {
  key: string
  employee_no: string | null
  first_name: string
  last_name: string
  title: string | null
  employment_type: EmploymentType | null
  is_recruitment: boolean
  home_cost_center_id: number
  employment_rate: number
  monthly_salary: number
  supplement: number
  vacation_days: number
  car_benefit: number
  note: string | null
  /** Empty for people on a single cost center. */
  allocations: { cost_center_id: number; share: number }[]
  lines: number[]
}

export function readRows(scan: SheetScan, costCenters: CostCenter[]): ImportRow[] {
  const byCode = new Map(costCenters.map((c) => [normalise(c.code), c]))
  const col = (row: unknown[], f: StaffField) => {
    const i = scan.columns.get(f)
    return i === undefined ? '' : row[i]
  }

  const rows: ImportRow[] = []
  scan.rows.forEach((row, idx) => {
    const lastName = text(col(row, 'last_name'))
    const firstName = text(col(row, 'first_name'))
    const employeeNo = text(col(row, 'employee_no'))
    const ccCode = text(col(row, 'cost_center'))
    const salaryCell = col(row, 'salary')
    // Blank and summary lines at the bottom of an export
    if (!lastName && !firstName && !employeeNo && !ccCode) return
    if (!ccCode && text(salaryCell) === '') return

    const errors: string[] = []
    const cc = byCode.get(normalise(ccCode)) ?? null
    if (!ccCode) errors.push('Kostnadsställe saknas')
    else if (!cc) errors.push(`Kostnadsställe ${ccCode} finns inte i bolaget`)
    const salary = num(salaryCell)
    if (salary === null || salary < 0) errors.push('Månadslön saknas eller är ogiltig')
    if (!lastName && !firstName && !employeeNo) errors.push('Namn eller anställningsnummer saknas')
    const rate = num(col(row, 'rate'))
    const type = text(col(row, 'employment_type')).toUpperCase()

    rows.push({
      line: scan.headerRow + idx + 2,
      employeeNo,
      lastName,
      firstName,
      title: text(col(row, 'title')),
      employmentType: type === 'TV' || type === 'PRO' || type === 'TID' ? type : null,
      costCenter: cc,
      costCenterCode: ccCode,
      rate: rate ?? (scan.columns.has('rate') ? 0 : 100),
      salary,
      supplement: num(col(row, 'supplement')) ?? 0,
      vacationDays: num(col(row, 'vacation_days')),
      carBenefit: num(col(row, 'car_benefit')) ?? 0,
      note: text(col(row, 'note')),
      errors,
    })
  })

  // Fractions (0.8) or percent (80)? Decided for the whole file — a single "1"
  // means 100 % in a fraction file and 1 % in a percent file.
  const valid = rows.filter((r) => r.errors.length === 0)
  const isFraction = valid.length > 0 && Math.max(...valid.map((r) => r.rate)) <= 1.5
  for (const r of rows) {
    if (isFraction) r.rate = r.rate * 100
    r.rate = Math.round(r.rate * 100) / 100
    if (r.rate < 0 || r.rate > 100) r.errors.push(`Sysselsättningsgrad ${r.rate} % är utanför 0–100`)
  }
  return rows
}

/**
 * Rows → people. The same employee number on several rows is one person split
 * across cost centers: the rates add up to the employment rate and become the
 * shares. Rows without an employee number stay separate people — five
 * "Nyanställning" rows are five recruitments, not one.
 */
export function planMembers(rows: ImportRow[]): PlannedMember[] {
  const groups = new Map<string, ImportRow[]>()
  for (const r of rows) {
    if (r.errors.length > 0) continue
    const key = r.employeeNo ? `no:${r.employeeNo}` : `line:${r.line}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }

  const out: PlannedMember[] = []
  for (const [key, g] of groups) {
    const first = g[0]
    // Same cost center twice in one person: add the rates together
    const byCc = new Map<number, number>()
    for (const r of g) byCc.set(r.costCenter!.id, (byCc.get(r.costCenter!.id) ?? 0) + r.rate)
    const totalRate = [...byCc.values()].reduce((a, b) => a + b, 0)
    const home = [...byCc.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const allocations =
      byCc.size > 1
        ? [...byCc.entries()].map(([cost_center_id, rate]) => ({
            cost_center_id,
            share: totalRate > 0 ? Math.round((rate / totalRate) * 10000) / 100 : Math.round(10000 / byCc.size) / 100,
          }))
        : []
    const isRecruitment = !first.employeeNo && /nyanst|rekryt|vakan/i.test(`${first.lastName} ${first.firstName}`)
    const notes = [...new Set(g.map((r) => r.note).filter(Boolean))]

    out.push({
      key,
      employee_no: first.employeeNo || null,
      first_name: isRecruitment ? '' : first.firstName,
      last_name: isRecruitment ? '' : first.lastName,
      title: first.title || null,
      employment_type: first.employmentType,
      is_recruitment: isRecruitment,
      home_cost_center_id: home,
      employment_rate: Math.min(100, Math.round(totalRate * 100) / 100),
      monthly_salary: first.salary ?? 0,
      supplement: first.supplement,
      vacation_days: Math.round(first.vacationDays ?? 25),
      // The old file repeats the yearly car benefit on every split row — it is per person.
      car_benefit: first.carBenefit,
      note: notes.length ? notes.join(' · ') : null,
      allocations,
      lines: g.map((r) => r.line),
    })
  }
  return out
}

export function downloadStaffTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['101-1', 'Exempel', 'Eva', 'Trafikskolechef', 'TV', '110', 100, 39000, 0, 30, 0, ''],
    ['136-1', 'Exempel', 'Karin', 'Regionchef', 'TV', '110', 14, 56000, 0, 30, 70000, 'Delad på flera KS'],
    ['136-1', 'Exempel', 'Karin', 'Regionchef', 'TV', '111', 86, 56000, 0, 30, 70000, ''],
  ])
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Personal')
  XLSX.writeFile(wb, 'personallista_mall.xlsx')
}
