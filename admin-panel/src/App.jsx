import { Routes, Route, Navigate } from 'react-router-dom'
import SplashScreen from './pages/auth/SplashScreen'
import LoginPage from './pages/auth/LoginPage'
import MainLayout from './app/layouts/MainLayout'
import DashboardPage from './pages/dashboard/DashboardPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SplashScreen />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<MainLayout />}>
        <Route path="dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
