//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/components/shared/ProtectedRoute.jsx
// Memory-only token — no localStorage hydration needed
//////////////////////////////////////////////////////

import { Navigate, useLocation } from 'react-router-dom'
import useAuthStore from '../../store/authStore'

export default function ProtectedRoute({ children }) {
  const token      = useAuthStore(s => s.token)
  const isHydrated = useAuthStore(s => s.isHydrated)
  const location   = useLocation()

  // Agar refresh call chal rahi hai — wait karo
  if (!isHydrated) {
    return (
      <div style={{
        minHeight:   '100vh',
        background:  '#F0EAE0',
        display:     'flex',
        alignItems:  'center',
        justifyContent: 'center',
        fontFamily:  'Inter, sans-serif',
        color:       '#9E8E6E',
        fontSize:    '14px',
        letterSpacing: '0.5px',
      }}>
        Loading...
      </div>
    )
  }

  // Hydrated — token nahi hai → login
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}