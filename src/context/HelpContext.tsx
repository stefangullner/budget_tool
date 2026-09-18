import { createContext, useContext, useState, ReactNode } from 'react'

export type HelpSection =
  | 'dashboard'
  | 'budget'
  | 'budget-matrix'
  | 'budget-overview'
  | 'budget-account'
  | 'accounts'
  | 'intercompany'
  | 'admin-users'
  | 'admin-access'
  | 'admin-scenarios'
  | 'admin-cost-centers'
  | 'admin-deadlines'
  | 'admin-bulk'
  | 'admin-intercompany'
  | 'admin-sync'
  | 'admin-import'
  | 'admin-export'

interface HelpContextValue {
  openHelp: (section: HelpSection) => void
  closeHelp: () => void
  isOpen: boolean
  section: HelpSection | null
}

const HelpContext = createContext<HelpContextValue | null>(null)

export function HelpProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [section, setSection] = useState<HelpSection | null>(null)

  const openHelp = (s: HelpSection) => {
    setSection(s)
    setIsOpen(true)
  }

  const closeHelp = () => setIsOpen(false)

  return (
    <HelpContext.Provider value={{ openHelp, closeHelp, isOpen, section }}>
      {children}
    </HelpContext.Provider>
  )
}

export function useHelp() {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error('useHelp must be used within HelpProvider')
  return ctx
}
