// BARBER ENGINE V1
// backend/utils/auditActions.js
//
// Central registry of every valid AdminAuditLog `action` value.
// Controllers must import from here rather than writing string
// literals — keeps filtering/analytics on the audit collection
// reliable as more modules start logging.

export const AUDIT_ACTIONS = {
  // District
  DISTRICT_CREATED:        "DISTRICT_CREATED",
  DISTRICT_UPDATED:        "DISTRICT_UPDATED",
  DISTRICT_ARCHIVED:       "DISTRICT_ARCHIVED",
  DISTRICT_RESTORED:       "DISTRICT_RESTORED",
  DISTRICT_ADMIN_ASSIGNED: "DISTRICT_ADMIN_ASSIGNED",

  // State (for future alignment — not wired yet)
  STATE_CREATED:  "STATE_CREATED",
  STATE_UPDATED:  "STATE_UPDATED",
  STATE_ARCHIVED: "STATE_ARCHIVED",
  STATE_RESTORED: "STATE_RESTORED",

  // Salon (for future alignment — not wired yet)
  SALON_APPROVED: "SALON_APPROVED",
  SALON_REJECTED: "SALON_REJECTED",

  // Area (AREA-2.1 — createArea hardening)
  AREA_CREATED: "AREA_CREATED",

  // Area Serviceability (AREA-2.4.1)
  AREA_SERVICEABILITY_STATUS_CHANGED: "AREA_SERVICEABILITY_STATUS_CHANGED",

  // Area Discovery Candidate (AREA-2.5.1)
  AREA_DISCOVERY_CANDIDATE_OBSERVED: "AREA_DISCOVERY_CANDIDATE_OBSERVED",
  AREA_DISCOVERY_CANDIDATE_REVIEWED: "AREA_DISCOVERY_CANDIDATE_REVIEWED",

  // Area Discovery Resolution (AREA-2.5.3)
  SALON_AREA_RESOLVED: "SALON_AREA_RESOLVED",
};