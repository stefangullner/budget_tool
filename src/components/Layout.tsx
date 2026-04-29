import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Building2, BookOpen, ShieldCheck, LogOut, ArrowLeftRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import { cn } from '@/lib/utils'
import HelpPanel from '@/components/HelpPanel'

const navItems = [
  { to: '/dashboard',    label: 'Översikt',     icon: LayoutDashboard },
  { to: '/budget',       label: 'Budget',       icon: Building2 },
  { to: '/accounts',     label: 'Konton',       icon: BookOpen },
  { to: '/intercompany', label: 'Intercompany', icon: ArrowLeftRight },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const { isAdmin } = useRole()
  const location = useLocation()

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">On Via</h1>
          <p className="text-xs text-gray-400 mt-0.5">Budget & Prognos</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                location.pathname.startsWith(to)
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Admin</p>
              </div>
              <Link
                to="/admin/users"
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  location.pathname.startsWith('/admin')
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <ShieldCheck size={16} />
                Administration
              </Link>
            </>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-medium text-gray-900 truncate">
              {session?.user.email}
            </p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <LogOut size={16} />
            Logga ut
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>

      <HelpPanel />
    </div>
  )
}
