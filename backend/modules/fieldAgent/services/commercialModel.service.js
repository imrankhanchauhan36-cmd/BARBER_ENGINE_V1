/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/commercialModel.service.js
 *
 * FA-5.1 — the minimal additive FA-4 extension: setting
 * FieldAgent.commercialPath exactly once, per the FA-5 Architecture
 * Decision Lock §5/§12.
 *
 * Deliberately a SEPARATE file from fieldAgentApproval.service.js/
 * fieldAgentProfile.service.js — both remain byte-for-byte untouched
 * by FA-5.1 (this function is called from a NEW route, never inserted
 * into the approval transaction itself; commercial-path selection is
 * a distinct admin decision made AFTER a profile already exists, not
 * part of approving the application).
 *
 * ONE-TIME ONLY: commercialPath must be null on the live document at
 * the moment of the write, enforced by re-reading live state inside
 * the transaction (never the outer pre-check alone) — the same
 * discipline proven in fieldAgentApproval.service.js#approveApplication.
 * There is no code path anywhere that changes an already-set
 * commercialPath; that is a deliberate FA-5.1 boundary, not an
 * oversight — a future correction mechanism (if ever needed) is an
 * explicit later-phase decision, not silently allowed here.
 *
 * ACQUISITION_AGENT reaches operationalStatus ACTIVE immediately, in
 * this same transaction — per the FA-5 Architecture Decision Lock
 * §12, this creates zero future-phase dependency (no License, no
 * Territory, no further commercial gate exists for that path in V1).
 * TERRITORY_PARTNER deliberately does NOT touch operationalStatus —
 * it stays PENDING_ACTIVATION, since Territory Partner activation
 * requires a License + exclusive Territory Assignment, neither of
 * which exists until a later FA-5 phase.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import {
  COMMERCIAL_PATH,
  FIELD_AGENT_OPERATIONAL_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgent.constants.js";

const MAX_SELECTION_ATTEMPTS = 5;

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

export const selectCommercialPath = async ({ fieldAgentId, adminId, commercialPath }) => {
  if (!adminId) throw Errors.badRequest("adminId is required to select a commercial path");
  if (!Object.values(COMMERCIAL_PATH).includes(commercialPath)) {
    throw Errors.badRequest(`commercialPath must be one of: ${Object.values(COMMERCIAL_PATH).join(", ")}`);
  }

  const snapshot = await FieldAgent.findById(fieldAgentId).lean();
  if (!snapshot) throw Errors.notFound("Field Agent not found");
  if (snapshot.commercialPath !== null) {
    throw Errors.conflict(
      `Field Agent already has commercialPath ${snapshot.commercialPath} — it is one-time-only and cannot be changed`
    );
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Re-read live state inside this transaction's own snapshot —
      // never trust the outer pre-check for the actual decision (same
      // discipline proven in fieldAgentApproval.service.js's own
      // approveApplication after its real concurrency defects).
      const fieldAgent = await FieldAgent.findById(fieldAgentId).session(session);
      if (!fieldAgent) throw Errors.notFound("Field Agent not found");
      if (fieldAgent.commercialPath !== null) {
        throw Errors.conflict(
          `Field Agent already has commercialPath ${fieldAgent.commercialPath} — it is one-time-only and cannot be changed`
        );
      }

      fieldAgent.commercialPath = commercialPath;
      if (commercialPath === COMMERCIAL_PATH.ACQUISITION_AGENT) {
        fieldAgent.operationalStatus = FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE;
      }
      await fieldAgent.save({ session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT,
            entityId: fieldAgent._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.COMMERCIAL_MODEL_SELECTED,
            newValue: { commercialPath, operationalStatus: fieldAgent.operationalStatus },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return fieldAgent;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_SELECTION_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

export const getFieldAgentById = (fieldAgentId) => FieldAgent.findById(fieldAgentId).lean();
