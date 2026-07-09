//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/staff/api/staff.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  SUMMARY: '/admin/staff/summary',
  LIST:    '/admin/staff',
  DETAIL:  (id) => `/admin/staff/${id}`,
  STATUS:  (id) => `/admin/staff/${id}/status`,
  CHAIR:   (id) => `/admin/staff/${id}/chair`,
  SALON:   (id) => `/admin/staff/${id}/salon`,
}

const StaffAPI = {
  getSummary:   ()           => apiClient.get(EP.SUMMARY),
  getAll:       (params)     => apiClient.get(EP.LIST, params),
  getById:      (id)         => apiClient.get(EP.DETAIL(id)),
  updateStatus: (id, body)   => apiClient.patch(EP.STATUS(id), body),
  assignChair:  (id, body)   => apiClient.patch(EP.CHAIR(id), body),
  transferSalon:(id, body)   => apiClient.patch(EP.SALON(id), body),
}

export default StaffAPI