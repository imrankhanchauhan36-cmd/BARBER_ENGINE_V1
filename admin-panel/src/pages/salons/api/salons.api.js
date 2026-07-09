//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/salons/api/salons.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'
import EP from '../../../api/endpoints'

const SalonsAPI = {
  getAll:        (params)     => apiClient.get(EP.SALONS.LIST, params),
  getById:       (id)         => apiClient.get(EP.SALONS.DETAIL(id)),
  updateStatus:  (id, body)   => apiClient.patch(EP.SALONS.STATUS(id), body),
  setCommission: (id, body)   => apiClient.patch(EP.SALONS.COMMISSION(id), body),
  forceClose:    (id)         => apiClient.patch(EP.SALONS.FORCE_CLOSE(id)),
}

export default SalonsAPI