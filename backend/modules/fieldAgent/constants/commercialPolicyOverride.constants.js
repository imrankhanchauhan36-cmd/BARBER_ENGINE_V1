/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/commercialPolicyOverride.constants.js
 *
 * FA-9 — geography-scoped commercial policy override vocabulary.
 * Deliberately a SEPARATE file from commercialPolicy.constants.js (the
 * FA-8/national policy's own vocabulary) — same "new sub-domain gets
 * its own constants file" precedent already established by
 * commercialTerritory.constants.js relative to commercialPolicy.constants.js.
 *
 * Numeric bounds (percent min/max, paise min) are NOT duplicated here —
 * this model reuses TERRITORY_COMMISSION_PERCENT_MIN/MAX and
 * ACQUISITION_INCENTIVE_MIN_PAISE directly from commercialPolicy.constants.js,
 * exactly as FA-8 itself did for CommercialPolicyVersion's own new fields.
 */

// Mirrors CommercialTerritory's own TERRITORY_SCOPE_TYPE exactly — same
// three values, same meaning — but this is a DIFFERENT, new collection
// (CommercialPolicyOverride answers "what rates apply here", never
// "who commercially operates here"). No STATE/NATIONAL scope: no
// existing ZEMISH commercial-geography concept has ever needed one
// (FA-9 Business Decision Lock report, confirmed evidence-based).
export const POLICY_OVERRIDE_SCOPE_TYPE = Object.freeze({
  DISTRICT: "DISTRICT",
  CITY: "CITY",
  AREA_SET: "AREA_SET",
});

// DRAFT -> PUBLISHED -> RETIRED, same lifecycle discipline as
// CommercialPolicyVersion — immutable once published/retired, enforced
// in commercialPolicyOverride.service.js.
export const POLICY_OVERRIDE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;

// Bounded retry ceilings — same discipline as commercialPolicy.service.js's
// MAX_VERSION_NUMBER_ATTEMPTS/MAX_PUBLISH_ATTEMPTS and
// commercialTerritory.service.js's MAX_ACTIVATION_ATTEMPTS.
export const MAX_VERSION_NUMBER_ATTEMPTS = 5;
export const MAX_PUBLISH_ATTEMPTS = 5;
