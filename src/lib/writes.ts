import { useState } from 'react'

/** Anything Supabase returns from a write — only the error matters here. */
type Writable = PromiseLike<{ error: { message: string } | null }>

/** RLS denials come back as raw Postgres text — say what it means instead. */
export function describeWriteError(message: string): string {
  if (/staff_locked_account/i.test(message)) {
    return 'Kontot räknas fram av personalbudgeten och kan inte ändras här.'
  }
  if (/row-level security|permission denied/i.test(message)) {
    return 'Du saknar behörighet att göra den här ändringen. Kontakta en administratör.'
  }
  if (/violates foreign key/i.test(message)) {
    return 'Posten hänger ihop med något som inte finns längre. Ladda om sidan.'
  }
  if (/duplicate key|already exists/i.test(message)) {
    return 'Posten finns redan.'
  }
  return message
}

/**
 * Surfaces failed writes instead of swallowing them.
 *
 * Every mutation in this codebase used to be `await supabase.from(...)` with the
 * `error` ignored, followed by an optimistic state update — so an RLS denial
 * looked like a successful save until the page was reloaded. That hid a real
 * permission bug for days. Wrap writes in `run()` and render `error`.
 *
 * `run()` resolves to true when the write went through, so callers can hold off
 * on updating local state until it did.
 */
export function useWriteGuard() {
  const [error, setError] = useState<string | null>(null)

  async function run(op: Writable): Promise<boolean> {
    const { error: writeError } = await op
    if (writeError) {
      setError(writeError.message)
      return false
    }
    return true
  }

  /** For a sequence where the first failure should stop the rest. */
  async function runAll(ops: Writable[]): Promise<boolean> {
    for (const op of ops) {
      if (!(await run(op))) return false
    }
    return true
  }

  return {
    error,
    setError,
    clearError: () => setError(null),
    run,
    runAll,
  }
}
