import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { describeWriteError } from '@/lib/writes'

interface Props {
  /** Raw Postgres message, or null when nothing failed. */
  message: string | null
  onDismiss: () => void
  title?: string
  className?: string
}

/** One place where a rejected write becomes something a user can act on. */
export default function SaveErrorBanner({ message, onDismiss, title, className }: Props) {
  if (!message) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 px-4 py-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800',
        className,
      )}
    >
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title ?? 'Ändringen sparades inte'}</p>
        <p className="mt-0.5 text-red-700">{describeWriteError(message)}</p>
      </div>
      <button
        onClick={onDismiss}
        title="Stäng"
        className="shrink-0 text-red-400 hover:text-red-700 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  )
}
