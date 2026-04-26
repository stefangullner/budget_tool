import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AccountRow } from '@/hooks/useBudget'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

interface Props {
  sourceAccount: AccountRow
  accounts: AccountRow[]
  futurePeriods: { year: number; month: number }[]
  entries: Map<string, number>
  scenarioStartYear: number
  onCopy: (targetAccountId: number, amounts: { year: number; month: number; amount: number }[]) => void
  onClose: () => void
}

function fmt(n: number) {
  if (n === 0) return '0'
  return n.toLocaleString('sv-SE', { maximumFractionDigits: 0 })
}

function periodKey(year: number, month: number) {
  return `${year}-${month}`
}

export default function CopyRowDialog({
  sourceAccount,
  accounts,
  futurePeriods,
  entries,
  scenarioStartYear,
  onCopy,
  onClose,
}: Props) {
  const [targetId, setTargetId] = useState<number | null>(null)
  const [overwrite, setOverwrite] = useState(true)

  const targetAccounts = accounts.filter((a) => a.id !== sourceAccount.id)

  const sourceAmounts = futurePeriods.map((p) => ({
    ...p,
    amount: entries.get(periodKey(p.year, p.month) + ':' + sourceAccount.id) ?? 0,
  }))

  const nonZeroCount = sourceAmounts.filter((p) => p.amount !== 0).length

  function handleConfirm() {
    if (targetId === null) return

    let amounts = sourceAmounts
    if (!overwrite) {
      amounts = sourceAmounts.filter(
        (p) => (entries.get(periodKey(p.year, p.month) + ':' + targetId) ?? 0) === 0,
      )
    }

    onCopy(targetId, amounts)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Kopiera rad</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Från{' '}
              <span className="font-mono">{sourceAccount.account_number}</span>{' '}
              {sourceAccount.name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4 mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Target account */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Målkonto</label>
            <select
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">Välj konto…</option>
              {targetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_number} — {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Overwrite option */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Hantera befintliga värden</p>
            {[
              [true, 'Skriv över alla värden', 'Ersätter allt på målkontot'],
              [false, 'Fyll bara tomma celler', 'Hoppar över månader som redan har ett värde'],
            ].map(([val, label, desc]) => (
              <label key={String(val)} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="overwrite"
                  checked={overwrite === val}
                  onChange={() => setOverwrite(val as boolean)}
                  className="mt-0.5 accent-brand-600"
                />
                <span className="text-xs">
                  <span className="font-medium text-gray-800">{label as string}</span>
                  <span className="text-gray-500 ml-1">— {desc as string}</span>
                </span>
              </label>
            ))}
          </div>

          {/* Source preview */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">
              Värden som kopieras ({nonZeroCount} av {futurePeriods.length} månader har belopp)
            </p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Månad</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Belopp</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceAmounts.map(({ year, month, amount }, i) => (
                    <tr
                      key={`${year}-${month}`}
                      className={cn(
                        'border-t border-gray-100',
                        i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50',
                        amount === 0 && 'opacity-40',
                      )}
                    >
                      <td className="px-3 py-1.5 text-gray-600">
                        {MONTH_LABELS[month - 1]}{year !== scenarioStartYear ? ` ${year}` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-gray-800">{fmt(amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={handleConfirm}
            disabled={targetId === null}
            className="px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Kopiera
          </button>
        </div>
      </div>
    </div>
  )
}
