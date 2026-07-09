//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/api/endpoints.js
// All API URLs — single source of truth
//////////////////////////////////////////////////////

const EP = {
  // ── Auth ──────────────────────────────────────────
  AUTH: {
    LOGIN:   '/admin-auth/login',
    LOGOUT:  '/admin-auth/logout',
    REFRESH: '/admin-auth/refresh',
    ME:      '/admin-auth/me',
  },

  // ── Dashboard ─────────────────────────────────────
  DASHBOARD: {
    STATS: '/admin/dashboard',
  },

  // ── Salons ────────────────────────────────────────
  SALONS: {
    LIST:         '/admin/salons',
    DETAIL:       (id) => `/admin/salons/${id}`,
    STATUS:       (id) => `/admin/salons/${id}/status`,
    COMMISSION:   (id) => `/admin/salons/${id}/commission`,
    FORCE_CLOSE:  (id) => `/admin/salons/${id}/force-close`,
  },

  // ── Approvals ─────────────────────────────────────
  APPROVALS: {
    LIST:    '/admin/approvals',
    DETAIL:  (id) => `/admin/approvals/${id}`,
    APPROVE: (id) => `/admin/approvals/${id}/approve`,
    REJECT:  (id) => `/admin/approvals/${id}/reject`,
  },

  // ── Users ─────────────────────────────────────────
  USERS: {
    LIST:   '/admin/users',
    DETAIL: (id) => `/admin/users/${id}`,
    STATUS: (id) => `/admin/users/${id}/status`,
  },

  // ── Providers ─────────────────────────────────────
  PROVIDERS: {
    LIST:   '/admin/providers',
    DETAIL: (id) => `/admin/providers/${id}`,
  },

  // ── Bookings ──────────────────────────────────────
  BOOKINGS: {
    LIST:   '/admin/bookings',
    DETAIL: (id) => `/admin/bookings/${id}`,
  },

  // ── KYC ───────────────────────────────────────────
  KYC: {
    LIST:    '/admin/kyc',
    DETAIL:  (id) => `/admin/kyc/${id}`,
    APPROVE: (id) => `/admin/kyc/${id}/approve`,
    REJECT:  (id) => `/admin/kyc/${id}/reject`,
  },

  // ── Disputes ──────────────────────────────────────
  DISPUTES: {
    LIST:    '/admin/disputes',
    DETAIL:  (id) => `/admin/disputes/${id}`,
    ASSIGN:  (id) => `/admin/disputes/${id}/assign`,
    RESOLVE: (id) => `/admin/disputes/${id}/resolve`,
  },

  // ── Finance — Wallets ─────────────────────────────
  WALLETS: {
    LIST:            '/admin/wallets',
    DETAIL:          (id) => `/admin/wallets/${id}`,
    ADJUST:          (id) => `/admin/wallets/${id}/adjust`,
    FREEZE:          (id) => `/admin/wallets/${id}/freeze`,
    UNFREEZE:        (id) => `/admin/wallets/${id}/unfreeze`,
  },

  // ── Finance — Transactions ────────────────────────
  TRANSACTIONS: {
    LIST:   '/admin/transactions',
    DETAIL: (id) => `/admin/transactions/${id}`,
    EXPORT: '/admin/transactions/export',
  },

  // ── Finance — Payouts ─────────────────────────────
  PAYOUTS: {
    LIST:    '/admin/payouts',
    DETAIL:  (id) => `/admin/payouts/${id}`,
    APPROVE: (id) => `/admin/payouts/${id}/approve`,
    REJECT:  (id) => `/admin/payouts/${id}/reject`,
  },

  // ── Location ──────────────────────────────────────
  STATES: {
    LIST:   '/admin/states',
    CREATE: '/admin/states',
    DETAIL: (id) => `/admin/states/${id}`,
    EDIT:   (id) => `/admin/states/${id}`,
  },

  DISTRICTS: {
    LIST:   '/admin/districts',
    CREATE: '/admin/districts',
    DETAIL: (id) => `/admin/districts/${id}`,
    EDIT:   (id) => `/admin/districts/${id}`,
  },

  AREAS: {
    LIST:   '/admin/areas',
    CREATE: '/admin/areas',
    DETAIL: (id) => `/admin/areas/${id}`,
    EDIT:   (id) => `/admin/areas/${id}`,
  },

  // ── Employees ─────────────────────────────────────
  EMPLOYEES: {
    LIST:   '/admin/employees',
    CREATE: '/admin/employees',
    DETAIL: (id) => `/admin/employees/${id}`,
    EDIT:   (id) => `/admin/employees/${id}`,
    DELETE: (id) => `/admin/employees/${id}`,
  },

  // ── Notifications ─────────────────────────────────
  NOTIFICATIONS: {
    LIST:   '/notifications',
    READ:   (id) => `/notifications/${id}/read`,
    CLEAR:  '/notifications/clear',
  },

  // ── Settings ──────────────────────────────────────
  SETTINGS: {
    GET:    '/admin/settings',
    UPDATE: '/admin/settings',
  },

  // ── Audit ─────────────────────────────────────────
  AUDIT: {
    LIST: '/admin/audit',
  },
}

export default EP