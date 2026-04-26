import { Navigate } from 'react-router-dom'
import { useRole } from '@/hooks/useRole'

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useRole()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
