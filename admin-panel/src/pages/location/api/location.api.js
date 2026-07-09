//////////////////////////////////////////////////////
// BARBER ENGINE V1
// admin-panel/src/pages/location/api/location.api.js
//////////////////////////////////////////////////////

import apiClient from '../../../api/client'

const EP = {
  // States
  STATES:          '/admin/states',
  STATE:           (id) => `/admin/states/${id}`,
  STATE_SUMMARY:   (id) => `/admin/states/${id}/summary`,
  STATE_ANALYTICS: (id) => `/admin/states/${id}/analytics`,
  STATE_RESTORE:   (id) => `/admin/states/${id}/restore`,
  STATE_BACKUP_ADMIN: (id) => `/admin/states/${id}/backup-admin`,

  // Districts
  DISTRICTS:          '/admin/districts',
  DISTRICT:           (id) => `/admin/districts/${id}`,
  DISTRICT_SUMMARY:   (id) => `/admin/districts/${id}/summary`,
  DISTRICT_ANALYTICS: (id) => `/admin/districts/${id}/analytics`,
  DISTRICT_AUDIT:     (id) => `/admin/districts/${id}/audit`,
  DISTRICT_RESTORE:   (id) => `/admin/districts/${id}/restore`,
  DISTRICT_ADMIN:     (id) => `/admin/districts/${id}/admin`,

  // Cities
  CITIES:          '/admin/cities',
  CITY:            (id) => `/admin/cities/${id}`,

  // Areas
  AREAS:           '/admin/areas',
  AREA:            (id) => `/admin/areas/${id}`,
}

const LocationAPI = {
  // ── States ──────────────────────────────────────
  getStates:        (params)      => apiClient.get(EP.STATES, params),
  getStateById:     (id)          => apiClient.get(EP.STATE(id)),
  getStateSummary:  (id)          => apiClient.get(EP.STATE_SUMMARY(id)),
  getStateAnalytics:(id, params)  => apiClient.get(EP.STATE_ANALYTICS(id), params),
  updateState:      (id, body)    => apiClient.patch(EP.STATE(id), body),
  createState:      (body)        => apiClient.post(EP.STATES, body),
  archiveState:     (id)          => apiClient.delete(EP.STATE(id)),
  restoreState:     (id)          => apiClient.patch(EP.STATE_RESTORE(id)),
  assignBackupAdmin:(id, body)    => apiClient.post(EP.STATE_BACKUP_ADMIN(id), body),

  // ── Districts ────────────────────────────────────
  getDistricts:        (params)      => apiClient.get(EP.DISTRICTS, params),
  getDistrictById:     (id)          => apiClient.get(EP.DISTRICT(id)),
  getDistrictSummary:  (id)          => apiClient.get(EP.DISTRICT_SUMMARY(id)),
  getDistrictAnalytics:(id, params)  => apiClient.get(EP.DISTRICT_ANALYTICS(id), params),
  getDistrictAudit:    (id, params)  => apiClient.get(EP.DISTRICT_AUDIT(id), params),
  createDistrict:      (body)        => apiClient.post(EP.DISTRICTS, body),
  updateDistrict:      (id, body)    => apiClient.patch(EP.DISTRICT(id), body),
  archiveDistrict:     (id)          => apiClient.delete(EP.DISTRICT(id)),
  restoreDistrict:     (id)          => apiClient.patch(EP.DISTRICT_RESTORE(id)),
  assignDistrictAdmin: (id, body)    => apiClient.post(EP.DISTRICT_ADMIN(id), body),

  // ── Cities ───────────────────────────────────────
  getCities:      (params)      => apiClient.get(EP.CITIES, params),
  getCityById:    (id)          => apiClient.get(EP.CITY(id)),
  createCity:     (body)        => apiClient.post(EP.CITIES, body),
  updateCity:     (id, body)    => apiClient.patch(EP.CITY(id), body),
  deleteCity:     (id)          => apiClient.delete(EP.CITY(id)),

  // ── Areas ────────────────────────────────────────
  getAreas:       (params)      => apiClient.get(EP.AREAS, params),
  getAreaById:    (id)          => apiClient.get(EP.AREA(id)),
  createArea:     (body)        => apiClient.post(EP.AREAS, body),
  updateArea:     (id, body)    => apiClient.patch(EP.AREA(id), body),
  deleteArea:     (id)          => apiClient.delete(EP.AREA(id)),
}

export default LocationAPI