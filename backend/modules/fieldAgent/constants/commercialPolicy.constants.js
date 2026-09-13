/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/commercialPolicy.constants.js
 *
 * FA-5.1 — CommercialPolicyVersion's own vocabulary. Deliberately a
 * SEPARATE file from the frozen fieldAgent.constants.js (which only
 * gains additive AUDIT_ACTION/AUDIT_ENTITY_TYPE values and the
 * FieldAgent-field enums it already owns) — same "new sub-domain gets
 * its own constants file" precedent fieldAgentTest.constants.js
 * already established relative to fieldAgent.constants.js, even
 * though both live conceptually under "field agent."
 */

// DRAFT -> PUBLISHED -> RETIRED. Published/retired are immutable
// (enforced in commercialPolicy.service.js, never here). At most one
// PUBLISHED version exists at a time — enforced via a partial unique
// index on CommercialPolicyVersion, the exact idiom already proven by
// TestVersion/TrainingVersion.
export const COMMERCIAL_POLICY_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Bounds for the policy's own numeric fields — FA-5 Architecture
// Decision Lock §7/§Correction-5: values must be configurable, never
// hard-coded as business numbers, but the BOUNDS themselves (0-100 for
// a percentage, non-negative for an amount, positive for a term) are
// structural validation, not business policy, and are locked here.
export const ACQUISITION_INCENTIVE_MIN_PAISE = 0;
export const TERRITORY_COMMISSION_PERCENT_MIN = 0;
export const TERRITORY_COMMISSION_PERCENT_MAX = 100;
export const LICENSE_TERM_MONTHS_MIN = 1;
export const CLAIM_EXPIRY_DAYS_MIN = 1;

// obligations/performanceFactors/coverageRules are each a bounded
// array of {key, description} — explicit, validated, structured data,
// never an unrestricted arbitrary Mongo object (FA-5 Architecture
// Decision Lock §7's explicit instruction against query/operator
// injection risk from an unstructured Mixed field).
export const POLICY_ITEM_KEY_MAX_LENGTH = 100;
export const POLICY_ITEM_DESCRIPTION_MAX_LENGTH = 500;
export const MAX_POLICY_ITEMS_PER_LIST = 50;

// Admin query safety — same MAX_LIST_LIMIT idiom as every other
// admin-list endpoint in this codebase.
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;
