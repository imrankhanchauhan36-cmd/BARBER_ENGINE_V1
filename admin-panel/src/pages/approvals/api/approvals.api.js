//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/approvals/api/approvals.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'
import EP from '../../../api/endpoints'

const ApprovalsAPI = {
  // Salons list with status filter
  getAll:  (params) => apiClient.get(EP.SALONS.LIST, params),
  getById: (id)     => apiClient.get(EP.SALONS.DETAIL(id)),

  // Approve or Reject
  updateStatus: (id, body) => apiClient.patch(EP.SALONS.STATUS(id), body),
}

export default ApprovalsAPI