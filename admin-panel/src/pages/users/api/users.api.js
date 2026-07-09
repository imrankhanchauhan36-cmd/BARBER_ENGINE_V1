//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/users/api/users.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  LIST:    '/admin/users',
  SUMMARY: '/admin/users/summary',
  DETAIL:  (id) => `/admin/users/${id}`,
  STATUS:  (id) => `/admin/users/${id}/status`,
}

const UsersAPI = {
  getAll:       (params) => apiClient.get(EP.LIST, params),
  getSummary:   ()       => apiClient.get(EP.SUMMARY),
  getById:      (id)     => apiClient.get(EP.DETAIL(id)),
  updateStatus: (id, body) => apiClient.patch(EP.STATUS(id), body),
}

export default UsersAPI