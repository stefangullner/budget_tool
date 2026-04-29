import { HelpCircle } from 'lucide-react'
import { useHelp, HelpSection } from '@/context/HelpContext'

interface Props {
  section: HelpSection
}

export default function HelpButton({ section }: Props) {
  const { openHelp } = useHelp()
  return (
    <button
      onClick={() => openHelp(section)}
      title="Hjälp"
      className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
    >
      <HelpCircle size={16} />
    </button>
  )
}
