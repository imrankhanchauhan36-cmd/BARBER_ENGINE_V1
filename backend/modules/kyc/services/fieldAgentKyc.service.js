/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/fieldAgentKyc.service.js
 * Field Agent-Facing KYC Submission Service — FA-3.2
 *
 * Mirrors the transaction + audit-log pattern already used in
 * ownerKyc.service.js, with its own log() helper (truthfully hardcoded
 * to triggeredByRole: "FIELD_AGENT" — NOT imported from ownerKyc's own
 * internal log(), which hardcodes "OWNER" and would misattribute every
 * Field Agent action if reused directly).
 *
 * FA-2 integration: FieldAgentApplication.status transitions are
 * ultimately driven using FA-2's own already-exported
 * setApplicationStatus/assertValidTransition (backend/modules/
 * fieldAgent/services/fieldAgentApplication.service.js) — that file is
 * FROZEN and is never edited; only its exported functions are imported
 * and called (from modules/kyc/jobs/fieldAgentKycSync.job.js — see
 * below).
 *
 * CONSISTENCY LAYER (FA-3.2 approved final revision): the KYC record
 * is created/approved/rejected via FROZEN functions
 * (kyc.service.js::getOrCreateKYC/approveKYC/rejectKYC) that manage
 * their own internal transaction and cannot be modified to accept an
 * external session. Rather than mutating FieldAgentApplication
 * directly and best-effort here (the prior design, which had no
 * recovery path if that secondary write failed), this file now only
 * writes a DURABLE FieldAgentKycSyncEvent row immediately after each
 * frozen call commits. The actual FieldAgentApplication mutation
 * happens later, off the request path, in
 * modules/kyc/jobs/fieldAgentKycSync.job.js's consumer — which is the
 * only code that ever calls FA-2's setApplicationStatus/
 * assertValidTransition for these three transitions. A reconciliation
 * pass in that same job recovers any event this fast path fails to
 * durably record (crash, or exhausted synchronous retries), using
 * durable VerificationLog evidence — never by re-deriving state from
 * FieldAgentApplication.status alone.
 *
 * submitFieldAgentKYC()'s own KYC_REJECTED -> KYC_PENDING transition
 * remains fully atomic and unchanged — it is entirely new code this
 * module owns outright, not chained after a frozen call, so it never
 * needed this outbox treatment.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import logger from "../../../utils/logger.js";
import { APPLICATION_STATUS } from "../../fieldAgent/constants/fieldAgent.constants.js";
import FieldAgentApplication from "../../fieldAgent/models/FieldAgentApplication.js";
import { assertValidTransition, setApplicationStatus } from "../../fieldAgent/services/fieldAgentApplication.service.js";
import {
    APPLICANT_TYPE,
    FIELD_AGENT_DOCUMENT_KEY_MAP,
    FIELD_AGENT_REQUIRED_DOCUMENT_KEYS,
    KYC_STATUS,
    VERIFICATION_ACTION,
} from "../constants/kyc.constants.js";
import FieldAgentKycSyncEvent, {
    FIELD_AGENT_KYC_SYNC_SOURCE,
    FIELD_AGENT_KYC_SYNC_TRANSITION,
} from "../models/FieldAgentKycSyncEvent.js";
import KYCDocument from "../models/KYCDocument.js";
import VerificationLog from "../models/VerificationLog.js";
import { encrypt } from "./encryption.service.js";
import { approveKYC, getOrCreateKYC } from "./kyc.service.js";
import { maskAadhaar, maskAccount, maskPAN } from "./masking.service.js";
import {
    initiateAadhaarOTP,
    verifyAadhaarOTP,
    verifyBank,
    verifyFaceMatch,
    verifyGST,
    verifyLiveness,
    verifyPAN,
} from "./verification.service.js";

// ─── Editable Guard — Field Agent-specific, NOT imported from
// ownerKyc.service.js ─────────────────────────────────────────────
// ownerKyc.service.js's own assertKYCEditable only allows DRAFT/
// REJECTED, which is correct for Owner (verification always happens
// admin-side, AFTER the owner's own /submit call). Field Agent's
// self-serve automatic PAN verification (verifyFieldAgentPAN, below)
// can legitimately run BEFORE /submit and, on success, moves
// kyc.status to PARTIALLY_VERIFIED via the existing, unmodified
// calcKYCStatus() in verification.service.js. Reusing Owner's
// DRAFT/REJECTED-only guard here would strand the Field Agent — unable
// to submit bank/documents/final submission the moment their first
// automatic verification succeeds — directly violating the locked
// "must be able to continue, never get stuck" rule. PARTIALLY_VERIFIED
// is therefore also editable for Field Agent; Owner's own guard and
// behavior are completely untouched by this.
const FIELD_AGENT_EDITABLE_STATUSES = [KYC_STATUS.DRAFT, KYC_STATUS.PARTIALLY_VERIFIED, KYC_STATUS.REJECTED];
const assertFieldAgentKYCEditable = (kyc) => {
  if (!FIELD_AGENT_EDITABLE_STATUSES.includes(kyc.status)) {
    const err = new Error(`KYC cannot be edited while status is ${kyc.status}`);
    err.status = 400;
    throw err;
  }
};

// ─── Log Helper — mirrors ownerKyc.service.js's own log(), but with a
// truthful triggeredByRole for this actor type ────────────────────
const log = async (session, { kycId, ownerId, action, triggeredBy, field, requestId, remarks, metadata }) => {
  await VerificationLog.create([{
    kycId, ownerId, action,
    triggeredBy:     triggeredBy ?? null,
    triggeredByRole: "FIELD_AGENT",
    field:           field   ?? null,
    requestId:       requestId ?? null,
    remarks:         remarks  ?? null,
    metadata:        metadata ?? null,
    success: true,
  }], { session });
};

// ─── Durable event creation — FAST PATH (see file header) ──────────
// Bounded, immediate, synchronous retries only (no setTimeout, no
// in-memory-only retry) — 3 attempts. If all 3 fail, this is logged
// loudly and NOT retried further here: the reconciliation half of
// modules/kyc/jobs/fieldAgentKycSync.job.js recovers from this
// identically to a full process crash, using durable VerificationLog
// evidence. Never throws — a transient failure here must never
// overturn the KYC decision that already committed.

const createFirstTouchSyncEvent = async (kyc) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await FieldAgentKycSyncEvent.updateOne(
        { kycRef: kyc._id, transitionType: FIELD_AGENT_KYC_SYNC_TRANSITION.FIRST_TOUCH_TO_KYC_PENDING },
        {
          $setOnInsert: {
            userRef: kyc.ownerId,
            expectedFromStatus: APPLICATION_STATUS.SUBMITTED,
            toStatus: APPLICATION_STATUS.KYC_PENDING,
            source: FIELD_AGENT_KYC_SYNC_SOURCE.FAST_PATH,
          },
        },
        { upsert: true }
      );
      return;
    } catch (err) {
      if (attempt === 3) {
        console.error(`❌ FA-3.2 first-touch sync event insert failed after 3 attempts for kyc ${kyc._id}:`, err.message || err);
        return;
      }
    }
  }
};

// Approval/rejection identity is sourceLogId ALONE (see
// FieldAgentKycSyncEvent.js's header) — the frozen approveKYC/
// rejectKYC never return the VerificationLog row they just wrote, so
// it is read back here (read-only, existing {kycId,createdAt} index).
const createDecisionSyncEvent = async ({ kyc, logAction, transitionType, toStatus }) => {
  const logRow = await VerificationLog.findOne({ kycId: kyc._id, action: logAction })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

  if (!logRow) {
    console.error(`❌ FA-3.2: expected VerificationLog(${logAction}) not found for kyc ${kyc._id} — cannot create durable sync event via fast path`);
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await FieldAgentKycSyncEvent.updateOne(
        { sourceLogId: logRow._id },
        {
          $setOnInsert: {
            kycRef: kyc._id,
            userRef: kyc.ownerId,
            transitionType,
            expectedFromStatus: APPLICATION_STATUS.KYC_PENDING,
            toStatus,
            source: FIELD_AGENT_KYC_SYNC_SOURCE.FAST_PATH,
          },
        },
        { upsert: true }
      );
      return;
    } catch (err) {
      if (attempt === 3) {
        console.error(`❌ FA-3.2 ${transitionType} sync event insert failed after 3 attempts for kyc ${kyc._id}:`, err.message || err);
        return;
      }
    }
  }
};

// kycRef is a denormalized, informational pointer only — FA-2 never
// reads or writes it, and no logic depends on it — so it stays a
// simple best-effort direct write, unlike the status transitions
// above, which cannot tolerate silent loss.
const linkKycRefIfMissing = async (userId, kycId) => {
  try {
    await FieldAgentApplication.updateOne(
      { userRef: userId, kycRef: null },
      { $set: { kycRef: kycId } }
    );
  } catch (err) {
    console.error(`❌ FA-3.2 kycRef link failed for user ${userId}:`, err.message || err);
  }
};

/**
 * Lazy-create the Field Agent's KYC record and durably record the
 * FIRST_TOUCH sync event. The actual FieldAgentApplication transition
 * happens later, in modules/kyc/jobs/fieldAgentKycSync.job.js.
 */
export const getOrCreateFieldAgentKYC = async (userId) => {
  const kyc = await getOrCreateKYC(userId, APPLICANT_TYPE.FIELD_AGENT);
  await linkKycRefIfMissing(userId, kyc._id);
  await createFirstTouchSyncEvent(kyc);
  return kyc;
};

/**
 * Called from adminKyc.controller.js after a FIELD_AGENT KYC is
 * approved — durably records the decision occurrence; does not mutate
 * FieldAgentApplication directly.
 */
export const syncFieldAgentApplicationOnApproval = (kyc) =>
  createDecisionSyncEvent({
    kyc,
    logAction: "ADMIN_APPROVED",
    transitionType: FIELD_AGENT_KYC_SYNC_TRANSITION.APPROVAL_TO_TRAINING_PENDING,
    toStatus: APPLICATION_STATUS.TRAINING_PENDING,
  });

/**
 * Called from adminKyc.controller.js after a FIELD_AGENT KYC is
 * rejected — durably records the decision occurrence; does not mutate
 * FieldAgentApplication directly.
 */
export const syncFieldAgentApplicationOnRejection = (kyc) =>
  createDecisionSyncEvent({
    kyc,
    logAction: "ADMIN_REJECTED",
    transitionType: FIELD_AGENT_KYC_SYNC_TRANSITION.REJECTION_TO_KYC_REJECTED,
    toStatus: APPLICATION_STATUS.KYC_REJECTED,
  });

/**
 * ─── AUTO KYC ENGINE — Phase 7A (Cashfree Secure ID) ───────────────
 * Mandatory checklist for Field Agent auto-approval. GST is
 * deliberately excluded — optional, never gates progression (locked
 * business rule). Documents (panCard/aadhaarFront/aadhaarBack/selfie)
 * are not re-checked here as a separate item: Face Match cannot
 * succeed without a selfie already uploaded, so a passing Face Match
 * already implies the selfie exists — no double-count needed.
 */
const MANDATORY_AUTO_VERIFY_FIELDS = ["pan", "aadhaar", "bank", "face", "liveness"];

const allMandatoryVerified = (kyc) =>
  MANDATORY_AUTO_VERIFY_FIELDS.every((field) => kyc.verification?.[field]?.verified === true);

/**
 * Called after EVERY successful Field Agent verification step (PAN,
 * Aadhaar OTP, Bank, Face Match, Liveness). Reuses the EXISTING,
 * unmodified approveKYC() + syncFieldAgentApplicationOnApproval() —
 * the same two calls adminKyc.controller.js's approveKYCHandler already
 * makes for a human admin decision — from a new, SYSTEM-triggered call
 * site. No new lifecycle state, no new sync-job code: KYC.status still
 * only ever becomes VERIFIED via approveKYC(), and TRAINING_PENDING is
 * still only ever reached via the same durable FieldAgentKycSyncEvent
 * the existing consumer job already knows how to apply.
 *
 * adminId is passed as `null` deliberately — every ref field this
 * touches (kyc.review.reviewedBy, verification.manualReview.verifiedBy,
 * VerificationLog.triggeredBy) already defaults to null in its own
 * schema, and VerificationLog.triggeredByRole's own comment already
 * documents "ADMIN / SYSTEM / PROVIDER" as valid values — "SYSTEM" is
 * not a new concept, just a value nothing has written until now. No
 * synthetic admin User document is created or needed.
 *
 * Idempotent by construction: approveKYC() is only ever called here
 * once — after the status guard below confirms the record has not
 * already been (auto-)approved — mirroring approveKYCHandler's own
 * `if (kyc.status === VERIFIED) return badRequest(...)` guard, which
 * lives in the controller layer and is therefore replicated here since
 * this call site bypasses that controller entirely.
 */
export const attemptFieldAgentAutoApproval = async (kyc) => {
  if (kyc.applicantType !== APPLICANT_TYPE.FIELD_AGENT) return null;
  if (kyc.status === KYC_STATUS.VERIFIED) return null;
  if (!allMandatoryVerified(kyc)) return null;

  const updated = await approveKYC({
    kyc,
    adminId:    null,
    adminLevel: "SYSTEM",
    notes:      "Auto-verified — all mandatory Cashfree Secure ID checks passed (PAN, Aadhaar, Bank, Face Match, Liveness)",
    requestId:  null,
  });

  await VerificationLog.create({
    kycId: updated._id, ownerId: updated.ownerId,
    action: VERIFICATION_ACTION.AUTO_VERIFIED,
    triggeredByRole: "SYSTEM",
    success: true,
    remarks: "All mandatory checks passed — auto-approved without admin action",
  }).catch((err) => {
    // Non-fatal — the approval itself already committed and is already
    // durably logged via approveKYC()'s own ADMIN_APPROVED entry; this
    // second, human-readable AUTO_VERIFIED marker is a convenience, not
    // load-bearing for the sync job (which keys off ADMIN_APPROVED).
    logger.warn("Failed to write AUTO_VERIFIED convenience log", { kycId: updated._id, message: err.message });
  });

  await syncFieldAgentApplicationOnApproval(updated);
  return updated;
};

/**
 * ─── SUBMIT IDENTITY (PAN / Aadhaar) — no GST for Field Agent ──────
 */
export const submitFieldAgentIdentity = async ({ userId, panNumber, nameOnPAN, aadhaarNumber, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertFieldAgentKYCEditable(kyc);

  const changed = !!(panNumber?.trim() || aadhaarNumber?.trim());
  if (!changed) return kyc;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    if (panNumber) {
      kyc.identity.pan.encryptedNumber = encrypt(panNumber);
      kyc.identity.pan.maskedNumber    = maskPAN(panNumber);
    }
    if (aadhaarNumber) {
      kyc.identity.aadhaar.encryptedNumber = encrypt(aadhaarNumber);
      kyc.identity.aadhaar.maskedNumber    = maskAadhaar(aadhaarNumber);
    }

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.IDENTITY_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Field Agent submitted identity details",
      metadata: {
        panSubmitted:     !!panNumber,
        aadhaarSubmitted: !!aadhaarNumber,
        nameOnPAN:        nameOnPAN || null,
      },
    });

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── SUBMIT BANK DETAILS ─────────────────────────────────────────
 */
export const submitFieldAgentBank = async ({ userId, accountHolder, accountNumber, ifsc, bankName, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertFieldAgentKYCEditable(kyc);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    kyc.bank.accountHolder    = accountHolder;
    kyc.bank.encryptedAccount = encrypt(accountNumber);
    kyc.bank.maskedAccount    = maskAccount(accountNumber);
    kyc.bank.ifsc             = ifsc;
    kyc.bank.bankName         = bankName;
    kyc.bank.pennyDropStatus  = "NOT_INITIATED";

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.BANK_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Field Agent submitted bank details",
      metadata: { maskedAccount: kyc.bank.maskedAccount },
    });

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── ATTACH DOCUMENT (after Cloudinary upload) ────────────────────
 * Same versioning/hashing pattern as ownerKyc.service.js::attachDocument.
 */
export const attachFieldAgentDocument = async ({ userId, documentKey, cloudinaryUrl, mimeType, sizeBytes, fileBuffer, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertFieldAgentKYCEditable(kyc);

  const documentType = FIELD_AGENT_DOCUMENT_KEY_MAP[documentKey];
  if (!documentType) {
    const err = new Error(`Unknown document key: ${documentKey}`);
    err.status = 400;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const previousDocId = kyc.documents?.[documentKey] ?? null;
    const previousDoc    = previousDocId
      ? await KYCDocument.findById(previousDocId).session(session)
      : null;

    const sha256Hash = fileBuffer
      ? crypto.createHash("sha256").update(fileBuffer).digest("hex")
      : null;

    const [newDoc] = await KYCDocument.create([{
      ownerId:          kyc.ownerId,
      kycId:            kyc._id,
      documentType,
      originalUrl:      cloudinaryUrl,
      mimeType:         mimeType ?? null,
      sizeBytes:        sizeBytes ?? 0,
      sha256Hash,
      status:           "UPLOADED",
      version:          previousDoc ? previousDoc.version + 1 : 1,
      isCurrentVersion: true,
      uploadedBy:       kyc.ownerId,
    }], { session });

    if (previousDoc) {
      previousDoc.isCurrentVersion = false;
      previousDoc.replacedBy       = newDoc._id;
      previousDoc.replacedAt       = new Date();
      await previousDoc.save({ session });
    }

    kyc.documents[documentKey] = newDoc._id;
    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.DOCUMENT_UPLOADED,
      triggeredBy: kyc.ownerId,
      field: documentKey,
      requestId,
      remarks: `Document uploaded: ${documentKey} (v${newDoc.version})`,
      metadata: { documentId: newDoc._id, version: newDoc.version },
    });

    await session.commitTransaction();
    return { kyc, document: newDoc };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * ─── SELF-SERVE AUTOMATIC PAN VERIFICATION (Option B) ─────────────
 * Reuses verification.service.js::verifyPAN's real Surepass/manual
 * provider-selection logic completely unmodified — only the actor-
 * attribution parameters differ from an admin-triggered call.
 * Ownership + applicantType is enforced HERE (verifyPAN itself has no
 * role check, by design — it's a shared service function).
 *
 * No assertKYCEditable() guard here — deliberately matching admin's
 * own verifyPANHandler, which never checks editability either.
 * Verification is a status-changing action (calcKYCStatus inside
 * verifyPAN can move status out of DRAFT), not a pre-submission edit,
 * so gating it on "still DRAFT/REJECTED" would incorrectly block a
 * second verification attempt the moment the first one succeeds.
 */
export const verifyFieldAgentPAN = async ({ userId, panNumber, nameOnPAN, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  const outcome = await verifyPAN({
    kyc, panNumber, nameOnPAN, requestId,
    actorId:      userId,
    actorRole:    "FIELD_AGENT",
    actorIsAdmin: false,
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

// ─── Ownership guard, factored out of verifyFieldAgentPAN so every new
// self-serve verify function below enforces the identical check ──────
const assertOwnsFieldAgentKYC = (kyc, userId) => {
  const kycOwnerId = kyc.ownerId?._id?.toString() || kyc.ownerId?.toString();
  if (kycOwnerId !== userId.toString() || kyc.applicantType !== APPLICANT_TYPE.FIELD_AGENT) {
    const err = new Error("Not authorized to verify this KYC record");
    err.status = 403;
    throw err;
  }
};

// ─── AADHAAR OTP (2-step) — self-serve ─────────────────────────────
// Phase 2B — the pending session now lives on the KYC document itself
// (kyc.aadhaar.*, see KYC.js's own header), not in Redis. The client
// still only ever sends the OTP back on the verify call — refId is
// recovered server-side from the KYC document, never trusted from the
// client.
export const verifyFieldAgentAadhaarInitiate = async ({ userId, aadhaarNumber, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);
  assertFieldAgentKYCEditable(kyc);

  return initiateAadhaarOTP({ kyc, aadhaarNumber, requestId, actorId: userId, actorRole: "FIELD_AGENT" });
};

export const verifyFieldAgentAadhaarComplete = async ({ userId, otp, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  // Idempotent pending-session guard — identical behavior to the prior
  // Redis-key-exists check: a session is single-use, so a repeat call
  // after this one already resolved (VERIFIED or FAILED) correctly
  // hits this same error, requiring a fresh /aadhaar/initiate.
  if (kyc.aadhaar?.sessionStatus !== "OTP_SENT" || !kyc.aadhaar?.refId) {
    const err = new Error("No pending Aadhaar OTP request found, or it has expired — please generate a new OTP");
    err.status = 400;
    throw err;
  }

  const outcome = await verifyAadhaarOTP({
    kyc, refId: kyc.aadhaar.refId, otp, requestId,
    actorId: userId, actorRole: "FIELD_AGENT", actorIsAdmin: false,
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

// ─── BANK — self-serve ──────────────────────────────────────────────
export const verifyFieldAgentBank = async ({ userId, accountHolder, accountNumber, ifsc, bankName, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  const outcome = await verifyBank({
    kyc, accountNumber, ifsc, bankName, accountHolder, requestId,
    actorId: userId, actorRole: "FIELD_AGENT", actorIsAdmin: false,
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

// ─── FACE MATCH — self-serve ────────────────────────────────────────
// Requires the selfie document to already be uploaded (POST
// /documents/selfie). Reference image is the PAN card upload when
// present (best available government-photo-ID on file for this
// applicant type — Field Agent has no separate photo-ID document type).
export const verifyFieldAgentFaceMatch = async ({ userId, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  // Phase 2C — confirmed via live audit: Cashfree's Face Match requires
  // the verification_id from the existing Aadhaar OTP session
  // (kyc.aadhaar.verificationId, Phase 2B) — no second session is
  // created here. Rejected immediately, before even checking the
  // selfie, exactly as specified.
  if (!kyc.aadhaar?.verificationId) {
    const err = new Error("Complete Aadhaar verification first.");
    err.status = 400;
    throw err;
  }

  await kyc.populate({ path: "documents.selfie", select: "originalUrl" });
  const selfieDoc = kyc.documents?.selfie;
  if (!selfieDoc?.originalUrl) {
    const err = new Error("Upload a selfie before requesting face match");
    err.status = 400;
    throw err;
  }

  const outcome = await verifyFaceMatch({
    kyc, selfieUrl: selfieDoc.originalUrl, requestId,
    actorId: userId, actorRole: "FIELD_AGENT", actorIsAdmin: false,
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

// ─── LIVENESS — self-serve ──────────────────────────────────────────
export const verifyFieldAgentLiveness = async ({ userId, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  // Phase 2D — same precondition as Face Match: Cashfree's Liveness
  // requires the verification_id from the existing Aadhaar OTP session
  // (kyc.aadhaar.verificationId, Phase 2B) — no second session created.
  if (!kyc.aadhaar?.verificationId) {
    const err = new Error("Complete Aadhaar verification first.");
    err.status = 400;
    throw err;
  }

  await kyc.populate({ path: "documents.selfie", select: "originalUrl" });
  const selfieDoc = kyc.documents?.selfie;
  if (!selfieDoc?.originalUrl) {
    const err = new Error("Upload a selfie before requesting a liveness check");
    err.status = 400;
    throw err;
  }

  const outcome = await verifyLiveness({
    kyc, selfieUrl: selfieDoc.originalUrl, requestId,
    actorId: userId, actorRole: "FIELD_AGENT", actorIsAdmin: false,
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

// ─── GST — self-serve, OPTIONAL ─────────────────────────────────────
// Never gates auto-approval and is excluded from
// MANDATORY_AUTO_VERIFY_FIELDS above — attemptFieldAgentAutoApproval is
// still called after a successful GST verify purely for consistency
// (a no-op if the other 5 mandatory checks weren't already done; a
// legitimate trigger if GST happened to be the LAST of the checks the
// applicant completed after all 5 mandatory ones already passed).
export const verifyFieldAgentGST = async ({ userId, gstNumber, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertOwnsFieldAgentKYC(kyc, userId);

  const outcome = await verifyGST({
    kyc, gstNumber, requestId,
    actorId: userId, actorRole: "FIELD_AGENT",
  });

  if (outcome.success) await attemptFieldAgentAutoApproval(outcome.kyc);
  return outcome;
};

/**
 * ─── SUBMIT KYC (DRAFT/REJECTED -> PENDING) ───────────────────────
 * Gated on FIELD_AGENT_REQUIRED_DOCUMENT_KEYS + identity + bank
 * completeness (no GST, no cancelled cheque). Fully atomic with the
 * KYC_REJECTED -> KYC_PENDING FA-2 transition, since both writes are
 * orchestrated by this function's own transaction (unlike the three
 * best-effort sync points above, which chain after a frozen
 * function's own internal transaction — see file header).
 */
export const submitFieldAgentKYC = async ({ userId, requestId }) => {
  const kyc = await getOrCreateFieldAgentKYC(userId);
  assertFieldAgentKYCEditable(kyc);

  const missingDocs = FIELD_AGENT_REQUIRED_DOCUMENT_KEYS.filter((key) => !kyc.documents?.[key]);
  const missingFields = [];
  if (!kyc.identity?.pan?.maskedNumber)     missingFields.push("identity.pan");
  if (!kyc.identity?.aadhaar?.maskedNumber) missingFields.push("identity.aadhaar");
  if (!kyc.bank?.accountHolder) missingFields.push("bank.accountHolder");
  if (!kyc.bank?.maskedAccount) missingFields.push("bank.maskedAccount");
  if (!kyc.bank?.ifsc)          missingFields.push("bank.ifsc");

  if (missingDocs.length || missingFields.length) {
    const err = new Error(
      `KYC incomplete. Missing documents: ${missingDocs.join(", ") || "none"}. ` +
      `Missing fields: ${missingFields.join(", ") || "none"}.`
    );
    err.status = 400;
    err.details = { missingDocs, missingFields };
    throw err;
  }

  const wasRejected = kyc.status === KYC_STATUS.REJECTED;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    kyc.status      = KYC_STATUS.PENDING;
    kyc.submittedAt = kyc.submittedAt || new Date();
    kyc.review.rejectReason = null;

    await kyc.save({ session });

    await log(session, {
      kycId: kyc._id, ownerId: kyc.ownerId,
      action: VERIFICATION_ACTION.KYC_SUBMITTED,
      triggeredBy: kyc.ownerId,
      requestId,
      remarks: "Field Agent submitted KYC for review",
    });

    if (wasRejected) {
      const application = await FieldAgentApplication.findOne({ userRef: userId })
        .sort({ createdAt: -1 })
        .session(session);
      if (application && application.status === APPLICATION_STATUS.KYC_REJECTED) {
        assertValidTransition(application.status, APPLICATION_STATUS.KYC_PENDING);
        setApplicationStatus(application, APPLICATION_STATUS.KYC_PENDING);
        await application.save({ session });
      }
    }

    await session.commitTransaction();
    return kyc;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};
