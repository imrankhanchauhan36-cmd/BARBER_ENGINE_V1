/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/kyc.service.js
 * KYC Business Logic Service — Phase 6A — 10/10 FROZEN
 *
 * v1.1 — CRITICAL BUG FIX in getOrCreateKYC():
 *
 *   Original code:
 *     session.startTransaction()
 *     [kyc] = await KYC.create([{ ownerId, status: KYC_STATUS.DRAFT }], { session })
 *
 *   Because the line above `[kyc] = ...` has no trailing semicolon,
 *   JavaScript's Automatic Semicolon Insertion does NOT insert one
 *   before a line starting with `[` — so this was actually being parsed
 *   as a SINGLE expression:
 *
 *     session.startTransaction()[kyc] = await KYC.create(...)
 *
 *   At that point `kyc` was `null` (from the earlier `findOne` call), so
 *   `[kyc]` became a computed property access using the string "null"
 *   as the key. `session.startTransaction()` returns `undefined`, so
 *   this threw exactly: "Cannot set properties of undefined (setting
 *   'null')" — reproduced verbatim when this code path first ran
 *   against a database with zero existing KYC records (i.e. the very
 *   first time anyone — owner or admin flow — ever needed a NEW KYC
 *   record created, rather than reading an existing one).
 *
 *   Fix: added the missing semicolon and switched to an explicit
 *   `const [created] = await KYC.create(...); kyc = created;` form that
 *   cannot fall victim to this ASI hazard again. No other line in this
 *   function or file changed.
 */

import mongoose from "mongoose";
import {
    APPLICANT_TYPE,
    KYC_EXPIRY_DAYS,
    KYC_STATUS,
    VERIFICATION_ACTION,
    VERIFICATION_SOURCE,
    VERIFICATION_STATUS,
} from "../constants/kyc.constants.js";
import KYC from "../models/KYC.js";
import KYCDocument from "../models/KYCDocument.js";
import VerificationLog from "../models/VerificationLog.js";
import { Errors } from "../../../utils/response.js";
import { syncSalonVisibilityForOwner } from "../../../services/salonVisibilitySync.service.js";

// PHASE C.2 — the only statuses an admin Approve/Reject decision may
// start from. Mirrors fieldAgentApproval.service.js's own
// isTransientConflict/retry idiom for the identical concurrent-admin-
// decision problem — not a new pattern invented for KYC.
const VALID_DECISION_SOURCE_STATUSES = [
  KYC_STATUS.PENDING,
  KYC_STATUS.UNDER_REVIEW,
  KYC_STATUS.PARTIALLY_VERIFIED,
];
const MAX_DECISION_ATTEMPTS = 5;
const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

// ─── Log Helper ───────────────────────────────────────────
const log = async (session, { kycId, ownerId, action, triggeredBy, triggeredByRole, field, requestId, remarks, metadata }) => {
  await VerificationLog.create([{
    kycId, ownerId, action,
    triggeredBy:     triggeredBy     ?? null,
    triggeredByRole: triggeredByRole ?? "ADMIN",
    field:           field           ?? null,
    requestId:       requestId       ?? null,
    remarks:         remarks         ?? null,
    metadata:        metadata        ?? null,
    success: true,
  }], { session })
}

/**
 * Get or create KYC record for owner
 * ✅ v1.1 — fixed ASI bug (see file header)
 *
 * FA-3.1 — added optional `applicantType` (defaults to OWNER, so
 * every existing call site — ownerKyc.service.js's own
 * getOrCreateKYC(ownerId) single-arg calls — is completely unaffected
 * and continues to create OWNER records exactly as before). Only used
 * on first-creation; a pre-existing record's applicantType is never
 * overwritten by a later call with a different value here.
 */
export const getOrCreateKYC = async (ownerId, applicantType = APPLICANT_TYPE.OWNER) => {
  let kyc = await KYC.findOne({ ownerId, isDeleted: { $ne: true } })
  if (!kyc) {
    const session = await mongoose.startSession()
    try {
      session.startTransaction();
      const [created] = await KYC.create([{ ownerId, applicantType, status: KYC_STATUS.DRAFT }], { session })
      kyc = created
      await log(session, {
        kycId: kyc._id, ownerId,
        action: VERIFICATION_ACTION.KYC_INITIATED,
        triggeredByRole: "SYSTEM",
      })
      await session.commitTransaction()
    } catch (err) {
      await session.abortTransaction()
      throw err
    } finally {
      session.endSession()
    }
  }
  return kyc
}

/**
 * ✅ Fix 2 — Approve with transaction
 */
export const approveKYC = async ({ kyc, adminId, adminLevel, notes, requestId }) => {
  let lastErr = null
  for (let attempt = 0; attempt < MAX_DECISION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession()
    try {
      session.startTransaction()

      // PHASE C.2 — never trust the caller's already-loaded `kyc` for
      // the actual decision: re-read live state inside THIS
      // transaction's own snapshot, same discipline as
      // fieldAgentApproval.service.js's approveApplication(). The
      // status filter below is what makes this atomic — if another
      // decision already moved the document out of
      // VALID_DECISION_SOURCE_STATUSES, this matches zero documents.
      const current = await KYC.findById(kyc._id).session(session)
      if (!current) throw Errors.notFound("KYC not found")
      if (!VALID_DECISION_SOURCE_STATUSES.includes(current.status)) {
        throw Errors.conflict(`KYC status is ${current.status} — no longer eligible for approval`)
      }

      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + KYC_EXPIRY_DAYS)

      current.status     = KYC_STATUS.VERIFIED
      current.approvedAt = new Date()
      current.expiresAt  = expiresAt

      current.review.reviewedBy   = adminId
      current.review.reviewedAt   = new Date()
      current.review.rejectReason = null
      if (notes) current.review.notes = notes

      current.verification.manualReview.status             = VERIFICATION_STATUS.VERIFIED
      current.verification.manualReview.verified           = true
      current.verification.manualReview.verifiedAt         = new Date()
      current.verification.manualReview.verifiedBy         = adminId
      // ✅ Fix 3 — use constant not magic string
      current.verification.manualReview.verificationSource = VERIFICATION_SOURCE.MANUAL

      await current.save({ session })

      await log(session, {
        kycId: current._id, ownerId: current.ownerId,
        action: VERIFICATION_ACTION.ADMIN_APPROVED,
        triggeredBy: adminId, triggeredByRole: adminLevel,
        requestId, remarks: notes || null,
      })

      // ZEMISH Option B, Phase 1 — same transaction, before commit,
      // same fail-together rationale as verifyPAN/verifyBank. Uses
      // `current` (the re-read-inside-transaction document), never the
      // caller's possibly-stale outer `kyc` argument.
      await syncSalonVisibilityForOwner(current.ownerId, current, { session })

      await session.commitTransaction()
      return current
    } catch (err) {
      await session.abortTransaction()
      lastErr = err
      if (isTransientConflict(err) && attempt < MAX_DECISION_ATTEMPTS - 1) {
        continue // retry the WHOLE transaction, re-reading live state
      }
      throw err
    } finally {
      session.endSession()
    }
  }
  throw lastErr
}

/**
 * ✅ Fix 2 — Reject with transaction
 */
export const rejectKYC = async ({ kyc, adminId, adminLevel, reason, requestId }) => {
  let lastErr = null
  for (let attempt = 0; attempt < MAX_DECISION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession()
    try {
      session.startTransaction()

      // PHASE C.2 — same re-read-inside-transaction discipline as
      // approveKYC above; see that function's comment for the
      // rationale.
      const current = await KYC.findById(kyc._id).session(session)
      if (!current) throw Errors.notFound("KYC not found")
      if (!VALID_DECISION_SOURCE_STATUSES.includes(current.status)) {
        throw Errors.conflict(`KYC status is ${current.status} — no longer eligible for rejection`)
      }

      current.status     = KYC_STATUS.REJECTED
      current.rejectedAt = new Date()
      // PHASE C.2 — explicitly clear approval-side timeline fields so
      // a rejected KYC never carries stale "still approved" timestamps
      // (this transition is now guard-blocked from a VERIFIED source,
      // but these fields are cleared defensively regardless of source
      // status, matching the same "null the opposite side" idiom
      // approveKYC already used for review.rejectReason).
      current.approvedAt = null
      current.expiresAt  = null

      current.review.reviewedBy   = adminId
      current.review.reviewedAt   = new Date()
      current.review.rejectReason = reason

      current.verification.manualReview.status   = VERIFICATION_STATUS.FAILED
      current.verification.manualReview.verified = false
      current.verification.manualReview.remarks  = reason

      await current.save({ session })

      await log(session, {
        kycId: current._id, ownerId: current.ownerId,
        action: VERIFICATION_ACTION.ADMIN_REJECTED,
        triggeredBy: adminId, triggeredByRole: adminLevel,
        requestId, remarks: reason,
      })

      // ZEMISH Option B, Phase 1 — same transaction, before commit.
      // This is the regression case: isMandatoryOwnerKycVerified()
      // will now read status REJECTED (a disqualifying status) and
      // correctly recompute false, revoking visibility for any
      // already-APPROVED salon this owner has — the predicate itself
      // is unchanged, this just keeps the Salon field in sync with it.
      await syncSalonVisibilityForOwner(current.ownerId, current, { session })

      await session.commitTransaction()
      return current
    } catch (err) {
      await session.abortTransaction()
      lastErr = err
      if (isTransientConflict(err) && attempt < MAX_DECISION_ATTEMPTS - 1) {
        continue // retry the WHOLE transaction, re-reading live state
      }
      throw err
    } finally {
      session.endSession()
    }
  }
  throw lastErr
}

/**
 * ✅ Fix 2 — Assign with transaction
 * ✅ Fix 4 — Use ADMIN_ASSIGNED action (add to constants)
 */
export const assignKYC = async ({ kyc, assignToId, adminId, adminLevel, requestId }) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    kyc.status            = KYC_STATUS.UNDER_REVIEW
    kyc.review.assignedTo = assignToId
    kyc.review.assignedAt = new Date()

    await kyc.save({ session })

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      // ✅ Fix 4 — correct audit action for assignment
      action: VERIFICATION_ACTION.KYC_ASSIGNED,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      requestId,
      remarks:  `Assigned to ${assignToId}`,
      metadata: { assignedTo: assignToId },
    })

    await session.commitTransaction()
    return kyc
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}

/**
 * ✅ Fix 1 — Single atomic document update
 * ✅ Fix 2 — Transaction
 */
export const requestReupload = async ({ kyc, documentType, reason, adminId, adminLevel, requestId }) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const currentDocId = kyc.documents?.[documentType]

    // ✅ Fix 1 — one atomic update instead of two
    if (currentDocId) {
      await KYCDocument.findByIdAndUpdate(
        currentDocId,
        {
          status:           "REJECTED",
          rejectedReason:   reason,
          reviewedBy:       adminId,
          reviewedAt:       new Date(),
          isCurrentVersion: false,   // combined in one call
        },
        { session }
      )
    }

    kyc.status = KYC_STATUS.REVERIFY_REQUIRED
    await kyc.save({ session })

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.DOCUMENT_REJECTED,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      field: documentType, requestId, remarks: reason,
    })

    // ZEMISH Option B, Phase 1 — same transaction, before commit.
    // Another regression case: REVERIFY_REQUIRED is a disqualifying
    // status, so this correctly revokes visibility if it was
    // previously granted.
    await syncSalonVisibilityForOwner(kyc.ownerId, kyc, { session })

    await session.commitTransaction()
    return kyc
  } catch (err) {
    await session.abortTransaction()
    throw err
  } finally {
    session.endSession()
  }
}

/**
 * Get KYC audit logs
 */
export const getKYCLogs = async (kycId) => {
  return VerificationLog.find({ kycId })
    .populate("triggeredBy", "name adminLevel")
    .sort({ createdAt: -1 })
    .lean()
}