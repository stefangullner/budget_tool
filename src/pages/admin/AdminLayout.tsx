import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Users, FileText, BookOpen, Building, Calendar, RefreshCw, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

const adminNav = [
  { to: '/admin/users',        label: 'Användare',       icon: Users },
  { to: '/admin/scenarios',    label: 'Scenarier',       icon: FileText },
  { to: '/admin/accounts',     label: 'Konton',          icon: BookOpen },
  { to: '/admin/cost-centers', label: 'Kostnadsställen', icon: Building },
  { to: '/admin/deadlines',    label: 'Deadlines',       icon: Calendar },
  { to: '/admin/sync',         label: 'Synkronisering',  icon: RefreshCw },
  { to: '/admin/export',       label: 'Export',          icon: Download },
]

export default function AdminLayout({ children }: { children: ReactNode }) {
  const location = useLocation()

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex items-center gap-1 -mb-px">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide pr-4 py-4 border-r border-gray-200 mr-2">
            Administration
          </span>
          {adminNav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-2 px-4 py-4 text-sm border-b-2 transition-colors whitespace-nowrap',
                location.pathname.startsWith(to)
                  ? 'border-brand-600 text-brand-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              )}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )
}
