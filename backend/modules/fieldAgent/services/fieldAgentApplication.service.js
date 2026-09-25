/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentApplication.service.js
 *
 * FA-2 — all Field Agent application business logic lives here; the
 * controllers are thin (DTO shaping only), matching the layering
 * already proven by modules/support/services/supportTicket.service.js.
 *
 * Every function derives identity from an explicit userId parameter
 * that controllers always source from req.user._id — never from any
 * client-supplied body field — matching the codebase-wide ownership-
 * derivation convention confirmed across booking/support/payout
 * controllers.
 */

import Area from "../../../models/Area.js";
import City from "../../../models/City.js";
import District from "../../../models/District.js";
import State from "../../../models/State.js";
import User from "../../../models/User.js";
import { Errors } from "../../../utils/response.js";
import {
  APPLICATION_STATUS,
  AUDIT_ACTION,
  AUDIT_ACTOR_TYPE,
  TERMINAL_APPLICATION_STATUSES,
  VALID_APPLICATION_TRANSITIONS,
  WITHDRAWABLE_APPLICATION_STATUSES,
} from "../constants/fieldAgent.constants.js";
import FieldAgentApplication from "../models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";

//////////////////////////////////////////////////////////////
// AUDIT
//////////////////////////////////////////////////////////////

const writeAuditEvent = async ({ entityId, actorRef, actorType, action, oldValue = null, newValue = null, reason = null }) => {
  await FieldAgentAuditEvent.create({
    entityType: "APPLICATION",
    entityId,
    actorRef,
    actorType,
    action,
    oldValue,
    newValue,
    reason,
  });
};

//////////////////////////////////////////////////////////////
// LOCATION HIERARCHY VALIDATION — read-only against the existing
// Country->State->District->City->Area hierarchy. Never trusts that a
// client-supplied set of ObjectIds is internally consistent; every
// provided ref is fetched and its own parent-chain fields are checked
// against the siblings the client also supplied.
//////////////////////////////////////////////////////////////

export const validateRequestedZone = async (zone) => {
  if (!zone || !zone.stateRef) {
    throw Errors.validation("requestedZone.stateRef is required");
  }

  const state = await State.findById(zone.stateRef).select("_id").lean();
  if (!state) throw Errors.badRequest("Invalid requestedZone.stateRef");

  if (zone.districtRef) {
    const district = await District.findById(zone.districtRef).select("stateRef").lean();
    if (!district || String(district.stateRef) !== String(zone.stateRef)) {
      throw Errors.badRequest("requestedZone.districtRef does not belong to the given state");
    }
  }

  if (zone.cityRef) {
    if (!zone.districtRef) {
      throw Errors.badRequest("requestedZone.districtRef is required when cityRef is provided");
    }
    const city = await City.findById(zone.cityRef).select("stateRef districtRef").lean();
    if (
      !city ||
      String(city.stateRef) !== String(zone.stateRef) ||
      String(city.districtRef) !== String(zone.districtRef)
    ) {
      throw Errors.badRequest("requestedZone.cityRef does not belong to the given state/district");
    }
  }

  if (zone.areaRef) {
    if (!zone.cityRef) {
      throw Errors.badRequest("requestedZone.cityRef is required when areaRef is provided");
    }
    const area = await Area.findById(zone.areaRef).select("stateRef districtRef cityRef").lean();
    if (
      !area ||
      String(area.stateRef) !== String(zone.stateRef) ||
      String(area.districtRef) !== String(zone.districtRef) ||
      String(area.cityRef) !== String(zone.cityRef)
    ) {
      throw Errors.badRequest("requestedZone.areaRef does not belong to the given state/district/city");
    }
  }
};

//////////////////////////////////////////////////////////////
// Keeps the `nonTerminal` flag (see the model's own comment — it
// exists only because MongoDB's partialFilterExpression rejects
// $nin/$not) in permanent lockstep with `status`. Every place in this
// service (or a future FA-3/FA-4 service) that changes `application
// .status` MUST go through this helper instead of assigning `status`
// directly, or the uniqueness index silently stops protecting that
// document.
//////////////////////////////////////////////////////////////

export const setApplicationStatus = (application, newStatus) => {
  application.status = newStatus;
  application.nonTerminal = !TERMINAL_APPLICATION_STATUSES.includes(newStatus);
};

//////////////////////////////////////////////////////////////
// STATE MACHINE — explicit transition map only, never inferred.
// Exported so FA-3/FA-4 can reuse this exact function unmodified once
// their own KYC/training/test/admin services need to drive further
// transitions; FA-2 itself only ever calls it for SUBMITTED/WITHDRAWN.
//////////////////////////////////////////////////////////////

export const assertValidTransition = (fromStatus, toStatus) => {
  const allowed = VALID_APPLICATION_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw Errors.conflict(`Cannot transition application from ${fromStatus} to ${toStatus}`);
  }
};

//////////////////////////////////////////////////////////////
// GET OWN APPLICATION
//////////////////////////////////////////////////////////////

export const getMyApplication = async (userId) => {
  // Most recent application for this user — normally there is at most
  // one non-terminal one (DB-enforced, see the model's partial unique
  // index), but historical REJECTED/WITHDRAWN rows can coexist, so an
  // explicit sort + limit is required rather than assuming findOne
  // returns the "current" one by insertion order alone.
  return FieldAgentApplication.findOne({ userRef: userId })
    .sort({ createdAt: -1 })
    .lean();
};

//////////////////////////////////////////////////////////////
// CREATE (OR IDEMPOTENTLY RETURN) A DRAFT APPLICATION
//////////////////////////////////////////////////////////////

export const createOrGetDraftApplication = async ({ userId, phone }) => {
  const existing = await FieldAgentApplication.findOne({
    userRef: userId,
    status: { $nin: [...TERMINAL_APPLICATION_STATUSES] },
  });
  if (existing) {
    return { application: existing.toObject(), created: false };
  }

  // Callers that already have the phone at hand (OTP verify) pass it
  // directly; callers that only have an authenticated req.user (whose
  // frozen shape from middlewares/auth.middleware.js's `protect` does
  // NOT include phone) omit it, and it's looked up here instead —
  // never assumed present on the caller's side.
  const resolvedPhone = phone || (await User.findById(userId).select("phone").lean())?.phone;
  if (!resolvedPhone) {
    throw Errors.badRequest("User has no phone on record");
  }

  try {
    const created = await FieldAgentApplication.create({
      userRef: userId,
      phone: resolvedPhone,
      status: APPLICATION_STATUS.DRAFT,
    });

    await writeAuditEvent({
      entityId: created._id,
      actorRef: userId,
      actorType: AUDIT_ACTOR_TYPE.APPLICANT,
      action: AUDIT_ACTION.APPLICATION_CREATED,
      newValue: { status: created.status },
    });

    return { application: created.toObject(), created: true };
  } catch (err) {
    // Race: two concurrent requests both saw "no non-terminal
    // application" and both attempted an insert — the DB's partial
    // unique index (not this check) is the real guard. The loser here
    // recovers gracefully by re-reading rather than surfacing a raw
    // duplicate-key error, keeping this endpoint genuinely idempotent
    // under concurrency.
    if (err?.code === 11000) {
      const winner = await FieldAgentApplication.findOne({
        userRef: userId,
        status: { $nin: [...TERMINAL_APPLICATION_STATUSES] },
      }).lean();
      if (winner) return { application: winner, created: false };
    }
    throw err;
  }
};

//////////////////////////////////////////////////////////////
// UPDATE DRAFT (basicProfile / requestedZone) — DRAFT-only
//////////////////////////////////////////////////////////////

export const updateDraftApplication = async ({ userId, updates }) => {
  const application = await FieldAgentApplication.findOne({ userRef: userId }).sort({ createdAt: -1 });
  if (!application) throw Errors.notFound("No application found");

  if (application.status !== APPLICATION_STATUS.DRAFT) {
    throw Errors.conflict("Application can only be edited while in DRAFT status");
  }

  const oldValue = {
    basicProfile: application.basicProfile,
    requestedZone: application.requestedZone,
    requestedCommercialPath: application.requestedCommercialPath,
  };

  if (updates.requestedZone) {
    await validateRequestedZone(updates.requestedZone);
    application.requestedZone = updates.requestedZone;
  }

  if (updates.basicProfile) {
    application.basicProfile = {
      ...application.basicProfile?.toObject?.() ?? application.basicProfile,
      ...updates.basicProfile,
    };
  }

  if (updates.requestedCommercialPath) {
    application.requestedCommercialPath = updates.requestedCommercialPath;
  }

  await application.save();

  await writeAuditEvent({
    entityId: application._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.APPLICANT,
    action: AUDIT_ACTION.APPLICATION_UPDATED,
    oldValue,
    newValue: {
      basicProfile: application.basicProfile,
      requestedZone: application.requestedZone,
      requestedCommercialPath: application.requestedCommercialPath,
    },
  });

  return application.toObject();
};

//////////////////////////////////////////////////////////////
// SUBMIT — DRAFT -> SUBMITTED
//////////////////////////////////////////////////////////////

export const submitApplication = async ({ userId }) => {
  const application = await FieldAgentApplication.findOne({ userRef: userId }).sort({ createdAt: -1 });
  if (!application) throw Errors.notFound("No application found");

  assertValidTransition(application.status, APPLICATION_STATUS.SUBMITTED);

  if (!application.basicProfile?.name || !application.requestedZone?.stateRef) {
    throw Errors.validation("basicProfile.name and requestedZone.stateRef are required before submission");
  }

  const fromStatus = application.status;
  setApplicationStatus(application, APPLICATION_STATUS.SUBMITTED);
  await application.save();

  await writeAuditEvent({
    entityId: application._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.APPLICANT,
    action: AUDIT_ACTION.APPLICATION_SUBMITTED,
    oldValue: { status: fromStatus },
    newValue: { status: application.status },
  });

  // Phase 2 (KYC Defer) — immediately advance past SUBMITTED into
  // TRAINING_PENDING within this same call, so Training no longer waits
  // on KYC approval. KYC itself (routes/controllers/services/Cashfree)
  // is completely untouched — it simply no longer sits in this
  // applicant's path; it becomes reachable again later from the
  // Dashboard (a separate, not-yet-built entry point). SUBMITTED is
  // still written and audited above first, preserving its place in the
  // history, before this second hop.
  assertValidTransition(application.status, APPLICATION_STATUS.TRAINING_PENDING);
  const fromSubmitted = application.status;
  setApplicationStatus(application, APPLICATION_STATUS.TRAINING_PENDING);
  await application.save();

  await writeAuditEvent({
    entityId: application._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.APPLICANT,
    action: AUDIT_ACTION.KYC_DEFERRED_TO_TRAINING,
    oldValue: { status: fromSubmitted },
    newValue: { status: application.status },
  });

  return application.toObject();
};

//////////////////////////////////////////////////////////////
// WITHDRAW — any WITHDRAWABLE_APPLICATION_STATUSES -> WITHDRAWN
//////////////////////////////////////////////////////////////

export const withdrawApplication = async ({ userId, reason }) => {
  const application = await FieldAgentApplication.findOne({ userRef: userId }).sort({ createdAt: -1 });
  if (!application) throw Errors.notFound("No application found");

  if (!WITHDRAWABLE_APPLICATION_STATUSES.includes(application.status)) {
    throw Errors.conflict(`Application in status ${application.status} cannot be withdrawn`);
  }
  assertValidTransition(application.status, APPLICATION_STATUS.WITHDRAWN);

  const fromStatus = application.status;
  setApplicationStatus(application, APPLICATION_STATUS.WITHDRAWN);
  application.withdrawnAt = new Date();
  await application.save();

  await writeAuditEvent({
    entityId: application._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.APPLICANT,
    action: AUDIT_ACTION.APPLICATION_WITHDRAWN,
    oldValue: { status: fromStatus },
    newValue: { status: application.status },
    reason: reason || null,
  });

  return application.toObject();
};
