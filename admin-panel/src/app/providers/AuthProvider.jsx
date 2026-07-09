//////////////////////////////////////////////////////
// BARBER ENGINE V1
// AuthProvider — App startup refresh call
// Page reload par cookie se session restore karta hai
//////////////////////////////////////////////////////

import { useEffect, useRef } from 'react'
import ENV from '../../config/env'
import useAuthStore from '../../store/authStore'

export default function AuthProvider({ children }) {
  const setSession  = useAuthStore(s => s.setSession)
  const clearSession = useAuthStore(s => s.clearSession)
  const setHydrated = useAuthStore(s => s.setHydrated)
   const ran          = useRef(false)  // ✅ StrictMode double call guard

  useEffect(() => {
      if (ran.current) return   // ✅ second call block karo
      ran.current = true        // ← ADD THIS LINE
    const restoreSession = async () => {
      try {
        const res  = await fetch(`${ENV.API_URL}/api/admin-auth/refresh`, {
          method:      'POST',
          credentials: 'include',  // cookie bhejta hai
        })
        const data = await res.json()

        if (res.ok && data.success && data.data?.accessToken) {
          setSession({
            token:       data.data.accessToken,
            admin:       data.data.admin,
            permissions: Array.isArray(data.data.permissions)
                           ? data.data.permissions : [],
            scope: {
              countryRef:  data.data.admin?.countryRef  || null,
              stateRef:    data.data.admin?.stateRef    || null,
              districtRef: data.data.admin?.districtRef || null,
              cityRef:     data.data.admin?.cityRef     || null,
            },
          })
        } else {
          clearSession()
        }
      } catch {
        clearSession()
      } finally {
        setHydrated() // ← hamesha true hoga — loading screen hategi
      }
    }

    restoreSession()
  }, [setSession, clearSession, setHydrated])

  return children
}