/**
 * BARBER ENGINE V1
 * backend/utils/onboardingKycGate.js
 *
 * ZEMISH onboarding-gate pass. Deliberately its own tiny, dependency-
 * free module — not defined inline inside
 * controllers/salon.onboarding.controller.js — because that controller
 * file's own import graph (Chair/Salon/SalonMedia/Service/Staff/User
 * models, adminAssign.service.js, geo.service.js, slotEngine.service.js)
 * transitively connects to Redis as a module-load side effect
 * (confirmed: importing that controller file alone opens a real Redis
 * connection, even for a pure function that touches neither Redis nor
 * Mongo). Keeping this predicate here means it — and anything that
 * tests it — can be imported with ZERO network/database side effects.
 *
 * REVISED — this now requires genuine, individual-field VERIFICATION
 * (not merely "submitted"). The previous version of this file
 * (isKycSubmittedForOnboarding) treated any status other than
 * DRAFT/REJECTED as sufficient, which is wrong per the corrected
 * policy: PENDING, UNDER_REVIEW, PARTIALLY_VERIFIED, and Manual Review
 * must NOT satisfy a "mandatory verification completed" requirement —
 * only genuinely verified individual fields do.
 *
 * SCOPE, STATED HONESTLY: for Owner, the only two KYC fields with a
 * real, working verification path today are PAN and Bank (confirmed:
 * Owner now has self-serve verify/pan + verify/bank endpoints, reusing
 * verification.service.js's verifyPAN/verifyBank). Owner's Aadhaar
 * check has no Cashfree/Surepass path at all — it is Manual, admin-
 * only (verifyAadhaar in verification.service.js accepts no
 * actorIsAdmin override and is never called by any Owner-facing
 * route). Requiring Aadhaar in this gate would reintroduce the exact
 * "blocked until an admin manually intervenes" problem this phase
 * exists to avoid for PAN/Bank. This gate therefore covers PAN + Bank
 * only — not the full "PAN, Aadhaar, Face Match, Liveness, Bank" list
 * from the original end-to-end spec, which remains genuinely
 * unachievable for Owner without further, separately-scoped work
 * (either a real self-serve Aadhaar path for Owner, or accepting an
 * admin-in-the-loop step before this gate).
 *
 * DISQUALIFYING STATUSES — a KYC record's individual
 * verification.pan.verified / verification.bank.verified flags are
 * NOT cleared when an admin later rejects the overall application for
 * an unrelated reason (confirmed: rejectKYC in kyc.service.js never
 * touches verification.pan/bank). Without an explicit overall-status
 * check, a REJECTED (or EXPIRED / REVERIFY_REQUIRED) record with
 * stale "verified:true" field flags from a PRIOR cycle would
 * incorrectly pass this gate — exactly the "REJECTED must not
 * accidentally satisfy mandatory verification" failure mode called
 * out explicitly. Both the individual fields AND the overall status
 * are checked together, not either alone.
 */

import { KYC_STATUS } from "../modules/kyc/constants/kyc.constants.js";

const DISQUALIFYING_STATUSES = Object.freeze([
  KYC_STATUS.REJECTED,
  KYC_STATUS.EXPIRED,
  KYC_STATUS.REVERIFY_REQUIRED,
]);

/**
 * @param {{status: string, verification?: {pan?: {verified?: boolean}, bank?: {verified?: boolean}}}|null|undefined} kyc
 *   a KYC document (or a lean projection with at least `.status` and
 *   `.verification.pan.verified` / `.verification.bank.verified`), or
 *   null/undefined if no KYC record exists yet for this owner.
 * @returns {boolean} true only if PAN AND Bank are both genuinely
 *   verified AND the overall record is not in a disqualifying state.
 *   Fails closed in every other case — no KYC record, DRAFT, PENDING,
 *   UNDER_REVIEW, PARTIALLY_VERIFIED (with either field still
 *   unverified), REJECTED, EXPIRED, REVERIFY_REQUIRED, or a malformed/
 *   partial record all return false.
 */
export const isMandatoryOwnerKycVerified = (kyc) =>
  !!kyc
  && !DISQUALIFYING_STATUSES.includes(kyc.status)
  && kyc.verification?.pan?.verified === true
  && kyc.verification?.bank?.verified === true;
