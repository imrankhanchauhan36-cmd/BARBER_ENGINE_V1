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
    KYC_EXPIRY_DAYS,
    KYC_STATUS,
    VERIFICATION_ACTION,
    VERIFICATION_SOURCE,
    VERIFICATION_STATUS,
} from "../constants/kyc.constants.js";
import KYC from "../models/KYC.js";
import KYCDocument from "../models/KYCDocument.js";
import VerificationLog from "../models/VerificationLog.js";

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
 */
export const getOrCreateKYC = async (ownerId) => {
  let kyc = await KYC.findOne({ ownerId, isDeleted: { $ne: true } })
  if (!kyc) {
    const session = await mongoose.startSession()
    try {
      session.startTransaction();
      const [created] = await KYC.create([{ ownerId, status: KYC_STATUS.DRAFT }], { session })
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
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + KYC_EXPIRY_DAYS)

    kyc.status     = KYC_STATUS.VERIFIED
    kyc.approvedAt = new Date()
    kyc.expiresAt  = expiresAt

    kyc.review.reviewedBy   = adminId
    kyc.review.reviewedAt   = new Date()
    kyc.review.rejectReason = null
    if (notes) kyc.review.notes = notes

    kyc.verification.manualReview.status             = VERIFICATION_STATUS.VERIFIED
    kyc.verification.manualReview.verified           = true
    kyc.verification.manualReview.verifiedAt         = new Date()
    kyc.verification.manualReview.verifiedBy         = adminId
    // ✅ Fix 3 — use constant not magic string
    kyc.verification.manualReview.verificationSource = VERIFICATION_SOURCE.MANUAL

    await kyc.save({ session })

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.ADMIN_APPROVED,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      requestId, remarks: notes || null,
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
 * ✅ Fix 2 — Reject with transaction
 */
export const rejectKYC = async ({ kyc, adminId, adminLevel, reason, requestId }) => {
  const session = await mongoose.startSession()
  try {
    session.startTransaction()

    kyc.status     = KYC_STATUS.REJECTED
    kyc.rejectedAt = new Date()

    kyc.review.reviewedBy   = adminId
    kyc.review.reviewedAt   = new Date()
    kyc.review.rejectReason = reason

    kyc.verification.manualReview.status   = VERIFICATION_STATUS.FAILED
    kyc.verification.manualReview.verified = false
    kyc.verification.manualReview.remarks  = reason

    await kyc.save({ session })

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.ADMIN_REJECTED,
      triggeredBy: adminId, triggeredByRole: adminLevel,
      requestId, remarks: reason,
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