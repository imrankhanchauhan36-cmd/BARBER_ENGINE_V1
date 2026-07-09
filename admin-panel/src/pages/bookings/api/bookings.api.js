//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/bookings/api/bookings.api.js
//////////////////////////////////////////////////////
//
// CHANGE LOG (this file):
//   + Added ANALYTICS endpoint + getAnalytics() method.
//   Nothing else touched — LIST, SUMMARY, DETAIL, CANCEL, STATUS
//   are byte-for-byte identical to the frozen version.
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  LIST:      '/admin/bookings',
  SUMMARY:   '/admin/bookings/summary',
  ANALYTICS: '/admin/bookings/analytics',   // ← NEW
  DETAIL:    (id) => `/admin/bookings/${id}`,
  CANCEL:    (id) => `/admin/bookings/${id}/cancel`,
  STATUS:    (id) => `/admin/bookings/${id}/status`,
}

const BookingsAPI = {
  getAll:       (params)     => apiClient.get(EP.LIST,   params),
  getSummary:   ()           => apiClient.get(EP.SUMMARY),
  getAnalytics: (params)     => apiClient.get(EP.ANALYTICS, params),   // ← NEW — params: { range: '30d'|'3m'|'6m'|'1y' }
  getById:      (id)         => apiClient.get(EP.DETAIL(id)),
  cancel:       (id, body)   => apiClient.patch(EP.CANCEL(id), body),
  updateStatus: (id, body)   => apiClient.patch(EP.STATUS(id), body),
}

export default BookingsAPI