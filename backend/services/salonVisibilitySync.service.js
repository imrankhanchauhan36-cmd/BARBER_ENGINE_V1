/**
 * BARBER ENGINE V1
 * backend/services/salonVisibilitySync.service.js
 *
 * ZEMISH Option B — the single, shared helper that keeps
 * Salon.business.isKycVerifiedForDiscovery in sync with the owner's
 * real KYC state. Reuses the existing, unchanged
 * isMandatoryOwnerKycVerified() predicate (utils/onboardingKycGate.js)
 * — the exact same rule already used to gate submission and Admin
 * approval — never a new or looser verification rule.
 *
 * Called from inside the CALLER's own existing MongoDB transaction,
 * before that transaction commits (verifyPAN, verifyBank, approveKYC,
 * rejectKYC, requestReupload — see each function's own call site for
 * the exact insertion point). This file never opens its own session
 * and never calls session.startTransaction()/commitTransaction() —
 * it is a participant in an existing transaction, not an owner of one.
 *
 * FAIL-SAFE BY CONSTRUCTION: this function always recomputes the
 * value fresh from the passed-in `kyc` via the same predicate — it
 * never trusts a previous value, never increments/toggles, and is
 * fully idempotent (calling it twice with the same kyc state produces
 * the same result and the same write). If the underlying
 * Salon.updateMany() call throws for any reason (network blip,
 * replica election, etc.), that rejection is NOT caught here — it
 * propagates straight to the caller, so the caller's own
 * catch/abortTransaction() aborts the WHOLE transaction, including the
 * KYC write itself. This is the deliberate, safe failure direction:
 * if visibility can't be confirmed to have synced, the KYC change
 * that would have unlocked it doesn't commit either — there is no
 * window where a salon could be exposed as KYC-verified without this
 * write having actually succeeded.
 *
 * Scoped to { ownerId, "approval.status": "APPROVED" } only — a
 * DRAFT/PENDING salon's visibility field is irrelevant (discovery
 * will continue to exclude it via the untouched approval.status check
 * once that integration lands in a later phase), so there is nothing
 * to update for those records; Salon.updateMany() against zero
 * matching documents is a normal, successful no-op, not an error.
 *
 * Never writes to KYC, never calls .save() on the kyc argument, never
 * triggers another verification/approval function — there is no
 * recursion path through this file.
 */

import Salon from "../models/Salon.js";
import { isMandatoryOwnerKycVerified } from "../utils/onboardingKycGate.js";

export const syncSalonVisibilityForOwner = async (ownerId, kyc, { session } = {}) => {
  const verified = isMandatoryOwnerKycVerified(kyc);

  await Salon.updateMany(
    { ownerId, "approval.status": "APPROVED" },
    { $set: { "business.isKycVerifiedForDiscovery": verified } },
    { session }
  );

  return verified;
};
