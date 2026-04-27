import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import AccountConfigPage from '@/pages/AccountConfigPage'
import BudgetPage from '@/pages/BudgetPage'
import IntercompanyPage from '@/pages/IntercompanyPage'
import Layout from '@/components/Layout'
import AdminGuard from '@/components/AdminGuard'
import AdminLayout from '@/pages/admin/AdminLayout'
import UsersPage from '@/pages/admin/UsersPage'
import ScenariosAdminPage from '@/pages/admin/ScenariosAdminPage'
import AccountsAdminPage from '@/pages/admin/AccountsAdminPage'
import CostCentersPage from '@/pages/admin/CostCentersPage'
import DeadlinesPage from '@/pages/admin/DeadlinesPage'
import SyncPage from '@/pages/admin/SyncPage'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/accounts" element={<AccountConfigPage />} />
        <Route path="/intercompany" element={<IntercompanyPage />} />
        <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        <Route path="/admin/*" element={
          <AdminGuard>
            <AdminLayout>
              <Routes>
                <Route path="users"        element={<UsersPage />} />
                <Route path="scenarios"    element={<ScenariosAdminPage />} />
                <Route path="accounts"     element={<AccountsAdminPage />} />
                <Route path="cost-centers" element={<CostCentersPage />} />
                <Route path="deadlines"    element={<DeadlinesPage />} />
                <Route path="sync"         element={<SyncPage />} />
              </Routes>
            </AdminLayout>
          </AdminGuard>
        } />
      </Routes>
    </Layout>
  )
}
