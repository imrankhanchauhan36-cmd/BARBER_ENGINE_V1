/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/constants/acquisitionClaim.constants.js
 *
 * FA-5.3 — AcquisitionReferral + AcquisitionClaim vocabulary. Deliberately
 * a SEPARATE file from fieldAgent.constants.js and commercialTerritory.constants.js
 * — same "new sub-domain gets its own constants file" precedent already
 * established by commercialPolicy.constants.js/commercialTerritory.constants.js
 * relative to fieldAgent.constants.js.
 */

// A referral represents a Field Agent's acquisition INTENT, issued
// before any Salon exists. It is consumed exactly once, linking it to
// a real Salon at redemption time (see acquisitionClaim.service.js's
// redeemReferral). "Expired" is deliberately NOT a stored status — it
// is derived (status === ISSUED && expiresAt < now), checked only
// inside the atomic redemption/cancellation predicate, mirroring the
// same "derive, never duplicate a status" discipline already proven
// for CommercialTerritory's VACANT concept.
export const REFERRAL_STATUS = Object.freeze({
  ISSUED: "ISSUED",
  CONSUMED: "CONSUMED",
  CANCELLED: "CANCELLED",
});

export const REFERRAL_CODE_PREFIX = "AQ";

// Structural/technical bound, not a CommercialPolicyVersion business
// number (same "structural vs business policy" distinction FA-5.1's
// own header already draws for its min/max bounds) — a future
// incentive/commission phase may reference this or supersede it, but
// FA-5.3 never touches CommercialPolicyVersion.
export const REFERRAL_EXPIRY_DAYS = 30;

// FA-P3-B Step 1 — SUPERSEDES the prior locked decision documented here
// until this phase ("always ACTIVE from birth, no PENDING state").
// AcquisitionClaim is now created PENDING_APPROVAL at redemption; an
// admin action (adminApproveClaim) is the only path to ACTIVE_RECOVERY.
// Reward recovery (AcquisitionEarningProgress creation, and every
// booking-credit lookup in fieldAgentEarning.service.js) is gated
// purely by this rename — a PENDING_APPROVAL claim is never matched by
// any `status: ACTIVE_RECOVERY` query, so no separate approval flag or
// gating check was introduced anywhere else. COMPLETED is added to the
// enum now for lifecycle forward-compatibility (per this phase's own
// instruction); no code in this phase transitions a claim into it —
// AcquisitionEarningProgress reaching TARGET_REACHED still does NOT
// affect AcquisitionClaim.status, exactly as the frozen FA-9 Business
// Decision Lock (§F/§9) requires (preserves the agent's recognized
// salon relationship after financial entitlement ends) — wiring
// ACTIVE_RECOVERY -> COMPLETED is explicitly a later step, not this one.
export const CLAIM_STATUS = Object.freeze({
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE_RECOVERY: "ACTIVE_RECOVERY",
  COMPLETED: "COMPLETED",
  ENDED: "ENDED",
});

// Both non-terminal states — used wherever "not yet ended" needs to be
// checked as a set (the salon-level uniqueness index, withdraw/reject/
// reassign preconditions).
export const CLAIM_NON_TERMINAL_STATUSES = Object.freeze([
  CLAIM_STATUS.PENDING_APPROVAL,
  CLAIM_STATUS.ACTIVE_RECOVERY,
]);

export const CLAIM_END_REASON = Object.freeze({
  ADMIN_REJECTED: "ADMIN_REJECTED",
  ADMIN_REASSIGNED: "ADMIN_REASSIGNED",
  AGENT_WITHDRAWN: "AGENT_WITHDRAWN",
});

// A referral may only be redeemed once the owner's Salon has reached
// at least the location step of onboarding — location.territory.* is
// null before that (see salon.onboarding.controller.js#saveLocation),
// and territory-membership validation for TERRITORY_PARTNER claims
// depends entirely on those fields being populated. Same step-gating
// idiom already used pervasively in that controller
// (`if (salon.onboarding?.step < N) ...`), applied read-only here —
// never duplicated or re-implemented, just checked.
export const MIN_ONBOARDING_STEP_FOR_REDEMPTION = 2;

// Admin query safety — same MAX_LIST_LIMIT idiom as every other
// admin-list endpoint in this codebase.
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;

// Bounded retry ceilings — same discipline as
// commercialTerritory.constants.js's MAX_CODE_ATTEMPTS/MAX_ACTIVATION_ATTEMPTS.
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_REDEEM_ATTEMPTS = 5;
