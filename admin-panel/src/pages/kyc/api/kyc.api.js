//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/kyc/api/kyc.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  SUMMARY:         '/admin/kyc/summary',
  LIST:            '/admin/kyc',
  DETAIL:          (id) => `/admin/kyc/${id}`,
  APPROVE:         (id) => `/admin/kyc/${id}/approve`,
  REJECT:          (id) => `/admin/kyc/${id}/reject`,
  ASSIGN:          (id) => `/admin/kyc/${id}/assign`,
  REQUEST_REUPLOAD:(id) => `/admin/kyc/${id}/request-reupload`,
  VERIFY_PAN:      (id) => `/admin/kyc/${id}/verify-pan`,
  VERIFY_AADHAAR:  (id) => `/admin/kyc/${id}/verify-aadhaar`,
  VERIFY_BANK:     (id) => `/admin/kyc/${id}/verify-bank`,
}

const KYCAPI = {
  getSummary:       ()           => apiClient.get(EP.SUMMARY),
  getAll:           (params)     => apiClient.get(EP.LIST, params),
  getById:          (id)         => apiClient.get(EP.DETAIL(id)),
  approve:          (id, body)   => apiClient.patch(EP.APPROVE(id), body),
  reject:           (id, body)   => apiClient.patch(EP.REJECT(id), body),
  assign:           (id, body)   => apiClient.patch(EP.ASSIGN(id), body),
  requestReupload:  (id, body)   => apiClient.patch(EP.REQUEST_REUPLOAD(id), body),
  verifyPAN:        (id, body)   => apiClient.patch(EP.VERIFY_PAN(id), body),
  verifyAadhaar:    (id, body)   => apiClient.patch(EP.VERIFY_AADHAAR(id), body),
  verifyBank:       (id, body)   => apiClient.patch(EP.VERIFY_BANK(id), body),
}

export default KYCAPI