/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentGeography.controller.js
 *
 * Field Agent Geography Phase B — thin controllers only, calling the
 * frozen Phase A service (fieldAgentGeography.service.js) exactly as
 * it exists today. Reuses the existing FieldAgentAuditEvent model —
 * no new audit infrastructure. adminId is always req.user._id, same
 * convention as adminAcquisitionClaim.controller.js.
 *
 * Phase A's service has no session/transaction support (verified by
 * reading it fresh before writing this file) — this is accepted as-is
 * per the Phase B instruction to not modify Phase A absent a real
 * defect. Audit events are therefore written fire-and-forget, AFTER
 * the service call resolves successfully, mirroring the exact
 * safeAuditEvent pattern already used by acquisitionClaim.service.js/
 * commercialTerritory.service.js.
 */

import {
  assignFieldAgentGeography,
  endFieldAgentGeography,
  getActiveFieldAgentGeography,
  getFieldAgentGeographyHistory,
} from "../services/fieldAgentGeography.service.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentApplication from "../models/FieldAgentApplication.js";
import { AUDIT_ACTION, AUDIT_ACTOR_TYPE, AUDIT_ENTITY_TYPE } from "../constants/fieldAgent.constants.js";
import { Errors, successResponse } from "../../../utils/response.js";

const safeAuditEvent = (doc) =>
  FieldAgentAuditEvent.create([doc]).catch((err) => {
    console.error("❌ Field Agent Geography — FieldAgentAuditEvent write failed:", err.message || err);
  });

/**
 * Field Agent Geography Phase D — read-only "suggestion" surfaced only
 * when the agent is currently unassigned. Sourced exclusively from
 * FieldAgentApplication.requestedZone, which that model's own header
 * documents as "the APPLICANT'S REQUEST only — it grants no
 * authority" (per the Phase D audit's own locked rule). This value is
 * NEVER used for authorization and NEVER written anywhere — it only
 * informs what the admin sees before they make their own explicit
 * choice in the assign dialog. Returns null whenever no application
 * resolves or it carries no requestedZone.stateRef.
 */
const resolveSuggestedGeography = async (fieldAgentId) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).select("applicationRef").lean();
  if (!fieldAgent?.applicationRef) return null;

  const application = await FieldAgentApplication.findById(fieldAgent.applicationRef)
    .select("requestedZone")
    .lean();
  if (!application?.requestedZone?.stateRef) return null;

  return {
    stateRef: application.requestedZone.stateRef,
    districtRef: application.requestedZone.districtRef || null,
    source: "APPLICATION_REQUESTED_ZONE",
  };
};

export const getGeographyHandler = async (req, res, next) => {
  try {
    const geography = await getActiveFieldAgentGeography(req.params.id);
    const suggestedGeography = geography ? null : await resolveSuggestedGeography(req.params.id);
    return successResponse(res, { message: "Field Agent geography fetched", data: { geography, suggestedGeography } });
  } catch (err) {
    return next(err);
  }
};

export const getGeographyHistoryHandler = async (req, res, next) => {
  try {
    const history = await getFieldAgentGeographyHistory(req.params.id);
    return successResponse(res, { message: "Field Agent geography history fetched", data: { history } });
  } catch (err) {
    return next(err);
  }
};

export const assignGeographyHandler = async (req, res, next) => {
  try {
    const { stateRef, districtRef } = req.body;
    const assignment = await assignFieldAgentGeography({
      fieldAgentRef: req.params.id,
      stateRef,
      districtRef: districtRef || null,
      assignedBy: req.user._id,
    });

    safeAuditEvent({
      entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT,
      entityId: req.params.id,
      actorRef: req.user._id,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ASSIGNED,
      newValue: { assignmentId: assignment._id, stateRef, districtRef: districtRef || null },
    });

    return successResponse(res, { message: "Field Agent geography assigned", data: { assignment } });
  } catch (err) {
    return next(err);
  }
};

export const endGeographyHandler = async (req, res, next) => {
  try {
    // Phase A's endFieldAgentGeography takes an assignmentId, not a
    // fieldAgentRef — resolving it via the agent's own active
    // assignment (rather than trusting a client-supplied assignmentId)
    // both gets the right id AND guarantees the assignment being
    // ended actually belongs to this :id.
    const active = await getActiveFieldAgentGeography(req.params.id);
    if (!active) {
      return next(Errors.notFound("No active geography assignment found for this Field Agent"));
    }

    const { endReason } = req.body;
    const ended = await endFieldAgentGeography({
      assignmentId: active._id,
      endedBy: req.user._id,
      endReason: endReason || null,
    });

    safeAuditEvent({
      entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT,
      entityId: req.params.id,
      actorRef: req.user._id,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.FIELD_AGENT_GEOGRAPHY_ENDED,
      newValue: { assignmentId: ended._id, endReason: endReason || null },
    });

    return successResponse(res, { message: "Field Agent geography assignment ended", data: { assignment: ended } });
  } catch (err) {
    return next(err);
  }
};
