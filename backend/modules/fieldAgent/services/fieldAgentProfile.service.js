/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentProfile.service.js
 *
 * FA-4.1 — FieldAgent operational profile creation foundation.
 * Service-layer only: no HTTP controller/route exists in FA-4.1 (no
 * public API is needed for this phase — see the module's own
 * deliverable notes). FA-4.2 will call createFieldAgentProfile from
 * the real admin-approval transaction; this phase builds and proves
 * that function complete and correct on its own, the same way
 * fieldAgentTest.service.js's startTestAttempt/submitTestAttempt were
 * built complete before any controller wired them up.
 *
 * agentCode generation reuses, verbatim in shape, the already-proven
 * production pattern from
 * modules/support/services/supportTicket.service.js#generateTicketNumber:
 * a date-prefixed, cryptographically random suffix (crypto.randomInt),
 * no global counter, no hot document, wrapped in a bounded
 * (MAX_AGENT_CODE_ATTEMPTS) retry loop keyed on the exact duplicate
 * index (err.keyPattern), not a blanket 11000 catch.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentApplication from "../models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import {
  APPLICATION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY_TYPE,
  FIELD_AGENT_OPERATIONAL_STATUS,
} from "../constants/fieldAgent.constants.js";

// An application must have reached admin review (or already be
// approved — covers a caller that composes this function AFTER its
// own ADMIN_REVIEW->APPROVED transition) to be eligible for profile
// creation. Every earlier state (DRAFT..TEST_FAILED) and every
// terminal-rejected state (KYC_REJECTED as a standalone terminal is
// not applicable here since it's non-terminal per FA-2's own map, but
// REJECTED/WITHDRAWN are) is refused — an applicant cannot receive an
// operational profile without having actually passed the full
// FA-2->FA-3.1->FA-3.2->FA-3.3->FA-3.4 pipeline, which is the only way
// to legitimately reach ADMIN_REVIEW in the first place.
const PROFILE_ELIGIBLE_APPLICATION_STATUSES = [APPLICATION_STATUS.ADMIN_REVIEW, APPLICATION_STATUS.APPROVED];

const AGENT_CODE_PREFIX = "FA";

// Bounded retry ceiling for the whole creation transaction — covers
// two DISTINCT, independently-bounded reasons a retry may be needed
// (same two-reason split proven in fieldAgentTest.service.js's own
// startTestAttempt): (1) a duplicate agentCode, astronomically rare at
// 900,000 possible suffixes/calendar day (mirrors
// MAX_TICKET_NUMBER_ATTEMPTS's exact rationale), and (2) a real
// MongoDB TransientTransactionError/WriteConflict under genuine
// concurrent load — the documented, expected behavior of
// multi-document transactions under concurrency, not a bug; an
// unhandled instance of it is what crashed this function's own first
// concurrent-creation test run (see FA-4.1 deliverable notes).
const MAX_AGENT_CODE_ATTEMPTS = 5;

// FA-YYYYMMDD-NNNNNN — date-prefixed for human readability/sortability,
// a 6-digit cryptographically random (crypto.randomInt) suffix for
// uniqueness. Deliberately carries zero personal/application data
// (no phone/Aadhaar/PAN/applicationId/district/zone) — an agent code
// must remain valid and meaningless-on-its-own even if a territory or
// personal detail later changes.
const generateAgentCode = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = crypto.randomInt(100000, 999999);
  return `${AGENT_CODE_PREFIX}-${y}${m}${d}-${rand}`;
};

const findExistingProfile = (userRef, applicationRef) =>
  FieldAgent.findOne({ $or: [{ userRef }, { applicationRef }] });

// The single writer of FieldAgent documents. Idempotent and
// concurrency-safe by design (PLAN discipline already proven
// throughout FA-3.4): a duplicate-key race on {userRef}/
// {applicationRef} converges to the SAME profile for every racing
// caller, never a duplicate; a duplicate-key race on {agentCode}
// (vanishingly rare) regenerates and retries, bounded.
//
// FA-4.2 addition (additive, backward-compatible): an optional
// `session` lets a caller (the real admin-approval transaction) fold
// profile creation into ITS OWN larger transaction, so the FA-2
// status transition and the profile creation commit or abort
// together — the atomicity FA-4.2's approval flow requires. When
// `session` is omitted (every FA-4.1 caller, unchanged), this
// function behaves EXACTLY as it always did: self-managed
// transaction, full bounded retry, identical return shape. When
// `session` IS provided, this function does a SINGLE attempt only,
// using the caller's transaction — a write conflict or duplicate key
// in that mode must abort the CALLER's whole transaction (this
// function cannot safely retry on the caller's behalf inside an
// already-active external transaction), so the caller is responsible
// for its own outer retry loop, exactly like startTestAttempt's own
// pattern of re-reading live state on each outer retry.
export const createFieldAgentProfile = async ({ applicationId, adminId, session: externalSession = null }) => {
  if (!adminId) {
    throw Errors.badRequest("adminId is required to create a Field Agent profile");
  }

  const application = await FieldAgentApplication.findById(applicationId).session(externalSession);
  if (!application) throw Errors.notFound("Field Agent application not found");

  if (!PROFILE_ELIGIBLE_APPLICATION_STATUSES.includes(application.status)) {
    throw Errors.conflict(
      `Application status ${application.status} is not eligible for Field Agent profile creation`
    );
  }

  // Idempotent pre-check — defense-in-depth ahead of the unique
  // indexes, same convention as every other creation flow in this
  // codebase (e.g. FA-2's own createOrGetDraftApplication).
  const existing = await findExistingProfile(application.userRef, application._id).session(externalSession);
  if (existing) return existing;

  if (externalSession) {
    const agentCode = generateAgentCode();
    const created = await FieldAgent.create(
      [
        {
          userRef: application.userRef,
          applicationRef: application._id,
          agentCode,
          operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.PENDING_ACTIVATION,
          approvedBy: adminId,
          approvedAt: new Date(),
        },
      ],
      { session: externalSession }
    );

    await FieldAgentAuditEvent.create(
      [
        {
          entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT,
          entityId: created[0]._id,
          actorRef: adminId,
          actorType: AUDIT_ACTOR_TYPE.ADMIN,
          action: AUDIT_ACTION.FIELD_AGENT_PROFILE_CREATED,
          newValue: {
            userRef: application.userRef,
            applicationRef: application._id,
            agentCode,
          },
        },
      ],
      { session: externalSession }
    );

    return created[0];
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_AGENT_CODE_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const agentCode = generateAgentCode();
      const created = await FieldAgent.create(
        [
          {
            userRef: application.userRef,
            applicationRef: application._id,
            agentCode,
            operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.PENDING_ACTIVATION,
            approvedBy: adminId,
            approvedAt: new Date(),
          },
        ],
        { session }
      );

      // FIELD_AGENT_PROFILE_CREATED — same transaction as the profile
      // itself, so both commit or both abort together. Reached ONLY
      // on an actual new document being created, never on the
      // idempotent "existing profile" recovery paths above/below.
      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT,
            entityId: created[0]._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.FIELD_AGENT_PROFILE_CREATED,
            newValue: {
              userRef: application.userRef,
              applicationRef: application._id,
              agentCode,
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return created[0];
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;

      const isDuplicateAgentCode = err.code === 11000 && err.keyPattern?.agentCode;
      if (isDuplicateAgentCode && attempt < MAX_AGENT_CODE_ATTEMPTS - 1) {
        continue; // regenerate a fresh code and retry, bounded
      }

      const isDuplicateProfile =
        err.code === 11000 && (err.keyPattern?.userRef || err.keyPattern?.applicationRef);
      if (isDuplicateProfile) {
        // Lost a concurrent creation race for this exact user/
        // application — idempotent recovery, never an error, for the
        // loser of a legitimate race.
        const race = await findExistingProfile(application.userRef, application._id);
        if (race) return race;
        // Duplicate key but no committed profile visible yet (the
        // winner's own commit hasn't landed this instant) — retry;
        // it will be visible within a retry or two.
        if (attempt < MAX_AGENT_CODE_ATTEMPTS - 1) continue;
      }

      const isTransientConflict =
        err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";
      if (isTransientConflict && attempt < MAX_AGENT_CODE_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, not just the commit
      }

      throw err;
    } finally {
      session.endSession();
    }
  }

  throw lastErr;
};

// ─── READ-ONLY FOUNDATION HELPERS ──────────────────────────────────
// Small, additive lookups — no HTTP surface in FA-4.1, but genuinely
// useful for FA-4.2/4.3/4.4 (and this phase's own targeted tests)
// without requiring any redesign later.

export const getFieldAgentByUserId = (userId) => FieldAgent.findOne({ userRef: userId }).lean();

export const getFieldAgentByApplicationId = (applicationId) =>
  FieldAgent.findOne({ applicationRef: applicationId }).lean();
