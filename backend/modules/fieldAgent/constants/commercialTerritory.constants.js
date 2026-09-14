/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/commercialTerritory.constants.js
 *
 * FA-5.2 — CommercialTerritory + TerritoryAssignment vocabulary.
 * Deliberately a SEPARATE file from fieldAgent.constants.js — same
 * "new sub-domain gets its own constants file" precedent already
 * established by commercialPolicy.constants.js (FA-5.1) relative to
 * fieldAgent.constants.js, even though both live conceptually under
 * "field agent."
 */

// A single Commercial Territory never spans multiple districts or
// multiple cities in V1 (locked business decision) — exactly one of
// these three per territory.
export const TERRITORY_SCOPE_TYPE = Object.freeze({
  DISTRICT: "DISTRICT",
  CITY: "CITY",
  AREA_SET: "AREA_SET",
});

export const TERRITORY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  RETIRED: "RETIRED",
});

// Explicit adjacency map — never inferred, same discipline as
// VALID_SERVICEABILITY_TRANSITIONS/VALID_APPLICATION_TRANSITIONS.
// RETIRED is terminal. DRAFT->RETIRED lets an admin cancel an unused
// draft without ever having activated it (a draft protects no
// exclusivity, so this is always safe).
export const VALID_TERRITORY_TRANSITIONS = Object.freeze({
  [TERRITORY_STATUS.DRAFT]: [TERRITORY_STATUS.ACTIVE, TERRITORY_STATUS.RETIRED],
  [TERRITORY_STATUS.ACTIVE]: [TERRITORY_STATUS.SUSPENDED, TERRITORY_STATUS.RETIRED],
  [TERRITORY_STATUS.SUSPENDED]: [TERRITORY_STATUS.ACTIVE, TERRITORY_STATUS.RETIRED],
  [TERRITORY_STATUS.RETIRED]: [],
});

export const ASSIGNMENT_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  ENDED: "ENDED",
});

// TERRITORY_RETIRED is server-only — set exclusively by
// commercialTerritory.service.js#retireTerritory's auto-vacate step,
// never a client-selectable value on the vacate-partner endpoint
// (see adminCommercialTerritory.validator.js's vacatePartnerBody,
// which only permits PARTNER_EXIT/ADMIN_REASSIGNED).
export const ASSIGNMENT_END_REASON = Object.freeze({
  PARTNER_EXIT: "PARTNER_EXIT",
  TERRITORY_RETIRED: "TERRITORY_RETIRED",
  ADMIN_REASSIGNED: "ADMIN_REASSIGNED",
});

export const TERRITORY_CODE_PREFIX = "CT";

// Admin query safety — same MAX_LIST_LIMIT idiom as every other
// admin-list endpoint in this codebase.
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;

// Bounded retry ceilings — same discipline as
// commercialModel.service.js's MAX_SELECTION_ATTEMPTS and
// fieldAgentProfile.service.js's MAX_AGENT_CODE_ATTEMPTS.
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_ACTIVATION_ATTEMPTS = 5;
export const MAX_ASSIGNMENT_ATTEMPTS = 5;
