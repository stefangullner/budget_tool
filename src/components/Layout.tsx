import { useState, ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Building2, BookOpen, ShieldCheck, LogOut, ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className={cn(
        'bg-white border-r border-gray-200 flex flex-col transition-all duration-200 shrink-0',
        collapsed ? 'w-14' : 'w-60'
      )}>
        {/* Logo / collapse button */}
        <div className={cn(
          'flex items-center border-b border-gray-100 shrink-0',
          collapsed ? 'justify-center px-0 py-5' : 'px-4 py-5 justify-between'
        )}>
          {!collapsed && (
            <div>
              <h1 className="text-base font-semibold text-gray-900">On Via</h1>
              <p className="text-xs text-gray-400 mt-0.5">Budget & Prognos</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expandera meny' : 'Dölj meny'}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-hidden">
          {navItems.map(({ to, label, icon: Icon }) => {
            const active = location.pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={cn(
                  'flex items-center rounded-lg text-sm transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
                  active ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <Icon size={16} className="shrink-0" />
                {!collapsed && label}
              </Link>
            )
          })}

          {isAdmin && (
            <>
              {!collapsed && (
                <div className="pt-3 pb-1 px-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Admin</p>
                </div>
              )}
              {collapsed && <div className="pt-2" />}
              <Link
                to="/admin/users"
                title={collapsed ? 'Administration' : undefined}
                className={cn(
                  'flex items-center rounded-lg text-sm transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
                  location.pathname.startsWith('/admin')
                    ? 'bg-brand-50 text-brand-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <ShieldCheck size={16} className="shrink-0" />
                {!collapsed && 'Administration'}
              </Link>
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-gray-100 shrink-0">
          {!collapsed && (
            <div className="px-3 py-1.5 mb-1">
              <p className="text-xs font-medium text-gray-900 truncate">
                {session?.user.email}
              </p>
            </div>
          )}
          <button
            onClick={signOut}
            title={collapsed ? 'Logga ut' : undefined}
            className={cn(
              'flex items-center w-full rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors py-2',
              collapsed ? 'justify-center px-0' : 'gap-3 px-3'
            )}
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && 'Logga ut'}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>

      <HelpPanel />
    </div>
  )
}
