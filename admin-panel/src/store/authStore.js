//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/store/authStore.js
// Token memory-only — never localStorage
//////////////////////////////////////////////////////

import { create } from 'zustand'

const useAuthStore = create((set, get) => ({

  // ─── State ───────────────────────────────────────
  token:        null,
  admin:        null,
  permissions:  [],
  scope:        null,
  isLoggedIn:   false,
  isLoading:    false,
  isRefreshing: false,
  isHydrated:   false,

  // ─── Computed ────────────────────────────────────
  hasPermission: (permission) => {
    const perms = get().permissions
    if (!perms?.length) return false
    return perms.includes('ALL') || perms.includes(permission)
  },

  canAccess: (module) => {
    const perms = get().permissions
    if (!perms?.length) return false
    if (perms.includes('ALL')) return true
    return perms.some(p => p.startsWith(`${module}.`))
  },

  // ─── Actions ─────────────────────────────────────
  setSession: ({ token, admin, permissions, scope }) => {
    set({
      token,
      admin:       admin ? Object.freeze(admin) : null,          // ✅ FIX #3
      permissions: Array.isArray(permissions) ? permissions : [], // ✅ FIX #1
      scope:       scope || null,
      isLoggedIn:  true,
    })
  },

  setLoading:    (isLoading)    => set({ isLoading }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setHydrated:   ()             => set({ isHydrated: true }),

  updateAdmin: (patch) => {
    const current = get().admin
    if (!current) return
    set({ admin: Object.freeze({ ...current, ...patch }) })
  },

  clearSession: () => {
    set({
      token:        null,
      admin:        null,
      permissions:  [],
      scope:        null,
      isLoggedIn:   false,
      isLoading:    false,
      isRefreshing: false,
    })
  },

  logout: () => get().clearSession(),  // ✅ FIX #2

}))

export default useAuthStore