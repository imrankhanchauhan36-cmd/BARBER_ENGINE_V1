import { Navigate, Route, Routes } from 'react-router-dom'
import MainLayout from './app/layouts/MainLayout'
import ProtectedRoute from './components/shared/ProtectedRoute'

// Auth
import LoginPage from './pages/auth/LoginPage'
import SplashScreen from './pages/auth/SplashScreen'

// Dashboard
import DashboardPage from './pages/dashboard/DashboardPage'

// Approvals
import ApprovalDetailPage from './pages/approvals/ApprovalDetailPage'
import ApprovalsPage from './pages/approvals/ApprovalsPage'

// Salons
import SalonAnalyticsPage from './pages/salons/SalonAnalyticsPage'
import SalonDetailPage from './pages/salons/SalonDetailPage'
import SalonEditPage from './pages/salons/SalonEditPage'
import SalonsPage from './pages/salons/SalonsPage'

// Bookings
import BookingAnalyticsPage from './pages/bookings/BookingAnalyticsPage'
import BookingDetailPage from './pages/bookings/BookingDetailPage'
import BookingsPage from './pages/bookings/BookingsPage'

// Finance
import FinanceAnalyticsPage from './pages/finance/FinanceAnalyticsPage'
import PayoutsPage from './pages/finance/payouts/PayoutsPage'
import TransactionDetailPage from './pages/finance/transactions/TransactionDetailPage'
import TransactionsPage from './pages/finance/transactions/TransactionsPage'
import WalletDetailPage from './pages/finance/wallets/WalletDetailPage'
import WalletsPage from './pages/finance/wallets/WalletsPage'



// Users
import UserDetailPage from './pages/users/UserDetailPage'
import UsersPage from './pages/users/UsersPage'

// Providers
import ProviderDetailPage from './pages/providers/ProviderDetailPage'
import ProvidersPage from './pages/providers/ProvidersPage'

// Staff
import StaffDetailPage from './pages/staff/StaffDetailPage'
import StaffPage from './pages/staff/StaffPage'


// KYC
import KYCDetailPage from './pages/kyc/KYCDetailPage'
import KYCPage from './pages/kyc/KYCPage'

// Disputes
import DisputeDetailPage from './pages/disputes/DisputeDetailPage'
import DisputesPage from './pages/disputes/DisputesPage'

// Employees
import EmployeeDetailPage from './pages/employees/EmployeeDetailPage'
import EmployeesPage from './pages/employees/EmployeesPage'

// Roles + Permissions + Audit
import AuditLogsPage from './pages/audit/AuditLogsPage'
import PermissionsPage from './pages/permissions/PermissionsPage'
import RolesPage from './pages/roles/RolesPage'

// Communication
import NotificationsPage from './pages/notifications/NotificationsPage'

// System
import SettingsPage from './pages/settings/SettingsPage'

// Location — States
import StateDashboardPage from './pages/location/states/StateDashboardPage'
import StateDetailPage from './pages/location/states/StateDetailPage'
import StateEditPage from './pages/location/states/StateEditPage'
import StatesPage from './pages/location/states/StatesPage'

// Location — Districts
import DistrictDashboardPage from './pages/location/districts/DistrictDashboardPage'
import DistrictDetailPage from './pages/location/districts/DistrictDetailPage'
import DistrictEditPage from './pages/location/districts/DistrictEditPage'
import DistrictsPage from './pages/location/districts/DistrictsPage'

// Location — Districts
import CitiesPage from './pages/location/cities/CitiesPage'


// Location — Areas
import AreaDashboardPage from './pages/location/areas/AreaDashboardPage'
import AreaDetailPage from './pages/location/areas/AreaDetailPage'
import AreaEditPage from './pages/location/areas/AreaEditPage'
import AreasPage from './pages/location/areas/AreasListPage'

// Location — Territory
import AdminAssignmentPage from './pages/location/territory/AdminAssignmentPage'
import TerritoryControlPage from './pages/location/territory/TerritoryControlPage'
import TerritoryDashboard from './pages/location/territory/TerritoryDashboard'

const ComingSoon = ({ title }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'60vh', fontFamily:'Inter, sans-serif' }}>
    <div style={{ fontSize:'48px', marginBottom:'16px' }}>🚧</div>
    <h2 style={{ fontSize:'20px', fontWeight:700, color:'#1A1A2E', margin:'0 0 8px' }}>{title}</h2>
    <p style={{ color:'#9E8E6E', fontSize:'14px' }}>Module Under Development</p>
  </div>
)

export default function App() {
  return (
    <Routes>
      <Route path="/"      element={<SplashScreen />} />
      <Route path="/login" element={<LoginPage />} />

      <Route path="/app" element={
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />

        {/* ── Salons ── */}
        <Route path="salons"               element={<SalonsPage />} />
        <Route path="salons/:id"           element={<SalonDetailPage />} />
        <Route path="salons/:id/edit"      element={<SalonEditPage />} />
        <Route path="salons/:id/analytics" element={<SalonAnalyticsPage />} />

        {/* ── Users ── */}
        <Route path="users"     element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />

        {/* ── Providers ── */}
        <Route path="providers"     element={<ProvidersPage />} />
        <Route path="providers/:id" element={<ProviderDetailPage />} />

        {/* ── Staff ── */}
        <Route path="staff"     element={<StaffPage />} />
        <Route path="staff/:id" element={<StaffDetailPage />} />


        {/* ── Approvals ── */}
        <Route path="approvals"     element={<ApprovalsPage />} />
        <Route path="approvals/:id" element={<ApprovalDetailPage />} />

        {/* ── KYC ── */}
        <Route path="kyc"     element={<KYCPage />} />
        <Route path="kyc/:id" element={<KYCDetailPage />} />

        {/* ── Disputes ── */}
        <Route path="disputes"     element={<DisputesPage />} />
        <Route path="disputes/:id" element={<DisputeDetailPage />} />

        {/* ── Bookings ── */}
        <Route path="bookings/analytics" element={<BookingAnalyticsPage />} />
        <Route path="bookings"           element={<BookingsPage />} />
        <Route path="bookings/:id"       element={<BookingDetailPage />} />

        {/* ── Finance ── */}
        <Route path="finance/analytics"        element={<FinanceAnalyticsPage />} />
        <Route path="finance/wallets"          element={<WalletsPage />} />
        <Route path="finance/wallets/:id"      element={<WalletDetailPage />} />
        <Route path="finance/transactions"     element={<TransactionsPage />} />
        <Route path="finance/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="finance/payouts"          element={<PayoutsPage title="Payouts" />} />

        {/* ── Location — States ── */}
        <Route path="location/states"                  element={<StatesPage />} />
        <Route path="location/states/:id"              element={<StateDetailPage />} />
        <Route path="location/states/:id/edit"         element={<StateEditPage />} />
        <Route path="location/states/:id/dashboard"    element={<StateDashboardPage />} />

        {/* ── Location — Districts ── */}
        <Route path="location/districts"               element={<DistrictsPage />} />
        <Route path="location/districts/:id"           element={<DistrictDetailPage />} />
        <Route path="location/districts/:id/edit"      element={<DistrictEditPage />} />
        <Route path="location/districts/:id/dashboard" element={<DistrictDashboardPage />} />

        {/* ── Location — Cities── */}
        <Route path="location/cities" element={<CitiesPage />} />

        {/* ── Location — Areas ── */}
        <Route path="location/areas"               element={<AreasPage />} />
        <Route path="location/areas/:id"           element={<AreaDetailPage />} />
        <Route path="location/areas/:id/edit"      element={<AreaEditPage />} />
        <Route path="location/areas/:id/dashboard" element={<AreaDashboardPage />} />

        {/* ── Location — Territory ── */}
        <Route path="location/dashboard"        element={<TerritoryDashboard />} />
        <Route path="location/admin-assignment" element={<AdminAssignmentPage />} />
        <Route path="location/control"          element={<TerritoryControlPage />} />
        <Route path="location/cities"           element={<CitiesPage title="Cities" />} />

        {/* ── Security ── */}
        <Route path="employees"        element={<EmployeesPage />} />
        <Route path="employees/create" element={<ComingSoon title="Add Employee" />} />
        <Route path="employees/:id"    element={<EmployeeDetailPage />} />
        <Route path="roles"            element={<RolesPage />} />
        <Route path="permissions"      element={<PermissionsPage />} />
        <Route path="audit"            element={<AuditLogsPage />} />

        {/* ── Communication ── */}
        <Route path="notifications" element={<NotificationsPage />} />

        {/* ── System ── */}
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}