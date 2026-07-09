//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/providers/api/provider.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  SUMMARY: '/admin/providers/summary',
  LIST:    '/admin/providers',
  DETAIL:  (id) => `/admin/providers/${id}`,
  STATUS:  (id) => `/admin/providers/${id}/status`,
}

const ProviderAPI = {
  getSummary:   ()           => apiClient.get(EP.SUMMARY),
  getAll:       (params)     => apiClient.get(EP.LIST, params),
  getById:      (id)         => apiClient.get(EP.DETAIL(id)),
  updateStatus: (id, body)   => apiClient.patch(EP.STATUS(id), body),
}

export default ProviderAPI