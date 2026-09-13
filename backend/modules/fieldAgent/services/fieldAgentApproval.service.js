/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentApproval.service.js
 *
 * FA-4.2 — Admin approval/rejection of a Field Agent application.
 * Reuses FA-2's frozen assertValidTransition/setApplicationStatus
 * unmodified (no new transition is added to VALID_APPLICATION_TRANSITIONS
 * — ADMIN_REVIEW -> APPROVED and ADMIN_REVIEW -> REJECTED already exist
 * in that frozen map) and FA-4.1's proven createFieldAgentProfile
 * (called WITH this service's own transaction session so the FA-2
 * status transition and the profile creation commit or abort
 * together — see fieldAgentProfile.service.js's own header for the
 * additive `session` parameter this required).
 *
 * RESUBMISSION — deliberately NOT implemented here. REJECTED is (and
 * remains) a terminal status in FA-2's frozen VALID_APPLICATION_TRANSITIONS
 * map (`REJECTED: []`). The existing, unmodified
 * fieldAgentApplication.service.js#createOrGetDraftApplication already
 * lets the same user start a genuinely new DRAFT application once
 * their prior one is terminal (its own query explicitly excludes
 * TERMINAL_APPLICATION_STATUSES) — that fresh application starts with
 * null kycRef/trainingRef/testAttemptRef, which structurally forces
 * KYC, training, and the mandatory test to be redone before it can
 * ever reach ADMIN_REVIEW again. This is the complete, already-correct
 * "resubmission" path; adding a narrow REJECTED->ADMIN_REVIEW
 * transition on the SAME document would instead let an applicant skip
 * every upstream gate, which is exactly what this phase must not do.
 * See the module's own deliverable notes for the live proof of this.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentApplication from "../models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import { assertValidTransition, setApplicationStatus } from "./fieldAgentApplication.service.js";
import { createFieldAgentProfile } from "./fieldAgentProfile.service.js";
import {
  APPLICATION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgent.constants.js";

// Reuses FieldAgentApplication.rejectionReason's own existing schema
// bound (maxlength: 500) — no new constant invented, same cap the
// model already enforces.
const REJECTION_REASON_MAX_LENGTH = 500;

const MAX_APPROVAL_ATTEMPTS = 5;
const MAX_REJECTION_ATTEMPTS = 5;

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

// ─── APPROVAL ───────────────────────────────────────────────────────
// ADMIN_REVIEW -> APPROVED, FieldAgent profile creation, and the
// FIELD_AGENT_APPROVED audit event are ONE Mongo transaction — all
// three commit or none do. Idempotent: an already-APPROVED application
// is a safe no-op returning the existing profile, never a second
// profile or a second agentCode. A data inconsistency (a FieldAgent
// profile already existing while the application is still
// ADMIN_REVIEW — structurally impossible in the intended flow, since
// profile creation only ever happens as part of this same function)
// is treated as a hard stop for manual review, never silently reused
// or overwritten.
export const approveApplication = async ({ applicationId, adminId }) => {
  if (!adminId) throw Errors.badRequest("adminId is required to approve a Field Agent application");

  const snapshot = await FieldAgentApplication.findById(applicationId).lean();
  if (!snapshot) throw Errors.notFound("Field Agent application not found");

  if (snapshot.status === APPLICATION_STATUS.APPROVED) {
    const profile = await FieldAgent.findOne({ applicationRef: applicationId }).lean();
    return { application: snapshot, profile, alreadyApproved: true };
  }
  if (snapshot.status !== APPLICATION_STATUS.ADMIN_REVIEW) {
    throw Errors.conflict(`Application status ${snapshot.status} is not eligible for approval`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_APPROVAL_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Always re-read live state inside this transaction's own
      // snapshot — never trust the outer `snapshot` for the actual
      // decision (same discipline proven in fieldAgentTest.service.js's
      // startTestAttempt after its own real concurrency defect).
      const application = await FieldAgentApplication.findById(applicationId).session(session);
      if (!application) throw Errors.notFound("Field Agent application not found");

      if (application.status === APPLICATION_STATUS.APPROVED) {
        // A concurrent racer already won — idempotent recovery, no
        // new writes on this attempt.
        await session.abortTransaction();
        const profile = await FieldAgent.findOne({ applicationRef: applicationId }).lean();
        return { application: application.toObject(), profile, alreadyApproved: true };
      }
      if (application.status !== APPLICATION_STATUS.ADMIN_REVIEW) {
        // Includes the "someone rejected it first" race — one
        // terminal decision wins, the loser gets an accurate conflict,
        // never a silent overwrite.
        throw Errors.conflict(`Application status is ${application.status}, no longer eligible for approval`);
      }

      const preExistingProfile = await FieldAgent.findOne({ applicationRef: application._id }).session(session);
      if (preExistingProfile) {
        // Structurally should be impossible — profile creation only
        // ever happens inside this same transaction below. Stop for
        // manual review rather than silently reusing or overwriting
        // production data.
        throw Errors.internal(
          `Data inconsistency: FieldAgent profile ${preExistingProfile._id} already exists for application ${application._id} while it was still ADMIN_REVIEW — requires manual review, not automatic approval`
        );
      }

      assertValidTransition(application.status, APPLICATION_STATUS.APPROVED);
      setApplicationStatus(application, APPLICATION_STATUS.APPROVED);
      application.reviewedBy = adminId;
      application.reviewedAt = new Date();
      await application.save({ session });

      const profile = await createFieldAgentProfile({ applicationId: application._id, adminId, session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.APPLICATION,
            entityId: application._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.FIELD_AGENT_APPROVED,
            newValue: { fieldAgentRef: profile._id, agentCode: profile.agentCode },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return { application: application.toObject(), profile, alreadyApproved: false };
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;

      const isDuplicateProfile =
        err.code === 11000 && (err.keyPattern?.userRef || err.keyPattern?.applicationRef || err.keyPattern?.agentCode);
      if ((isDuplicateProfile || isTransientConflict(err)) && attempt < MAX_APPROVAL_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }

      throw err;
    } finally {
      session.endSession();
    }
  }

  throw lastErr;
};

// ─── REJECTION ──────────────────────────────────────────────────────
// ADMIN_REVIEW -> REJECTED + rejectionReason + the FIELD_AGENT_REJECTED
// audit event, one transaction. No FieldAgent profile is ever created
// here — rejection never reaches createFieldAgentProfile at all.
export const rejectApplication = async ({ applicationId, adminId, reason }) => {
  if (!adminId) throw Errors.badRequest("adminId is required to reject a Field Agent application");

  if (typeof reason !== "string" || !reason.trim()) {
    throw Errors.badRequest("A rejection reason is required");
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length > REJECTION_REASON_MAX_LENGTH) {
    throw Errors.badRequest(`Rejection reason must be ${REJECTION_REASON_MAX_LENGTH} characters or fewer`);
  }

  const snapshot = await FieldAgentApplication.findById(applicationId).lean();
  if (!snapshot) throw Errors.notFound("Field Agent application not found");

  if (snapshot.status === APPLICATION_STATUS.REJECTED) {
    return snapshot; // idempotent — already rejected, no new write
  }
  if (snapshot.status !== APPLICATION_STATUS.ADMIN_REVIEW) {
    throw Errors.conflict(`Application status ${snapshot.status} is not eligible for rejection`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_REJECTION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const application = await FieldAgentApplication.findById(applicationId).session(session);
      if (!application) throw Errors.notFound("Field Agent application not found");

      if (application.status === APPLICATION_STATUS.REJECTED) {
        await session.abortTransaction();
        return application.toObject();
      }
      if (application.status !== APPLICATION_STATUS.ADMIN_REVIEW) {
        // Includes the "someone approved it first" race.
        throw Errors.conflict(`Application status is ${application.status}, no longer eligible for rejection`);
      }

      assertValidTransition(application.status, APPLICATION_STATUS.REJECTED);
      setApplicationStatus(application, APPLICATION_STATUS.REJECTED);
      application.reviewedBy = adminId;
      application.reviewedAt = new Date();
      application.rejectionReason = trimmedReason;
      await application.save({ session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.APPLICATION,
            entityId: application._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.FIELD_AGENT_REJECTED,
            reason: trimmedReason,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return application.toObject();
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;

      if (isTransientConflict(err) && attempt < MAX_REJECTION_ATTEMPTS - 1) {
        continue;
      }

      throw err;
    } finally {
      session.endSession();
    }
  }

  throw lastErr;
};

// FA-4.3 — the minimal review queue/detail functions that used to
// live here (listApplicationsInReview/getApplicationForReview) have
// moved to fieldAgentReview.service.js, which supersedes them with
// the full-featured, production-grade versions (filtering, search,
// deterministic pagination, KYC/training/test/profile aggregation,
// decision readiness). approveApplication/rejectApplication above are
// completely untouched.
