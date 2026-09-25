/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/commercialTerritory.service.js
 *
 * FA-5.2 — CommercialTerritory + TerritoryAssignment business logic.
 * All geography ancestor refs are re-validated fresh against the live
 * District/City/Area collections on every create/update — never
 * trusted from client input, same discipline proven in
 * areaDiscoveryResolution.controller.js (AREA-2.5.3).
 *
 * Two independent concurrency mechanisms are used, each for a
 * different invariant (see the FA-5.2 hardened plan for the full
 * argument for why a plain read-compare-write is unsound for both):
 *
 *   1. Duplicate-DRAFT prevention (all 3 scope types) — a single
 *      deterministic `scopeKey` plus one partial unique index on
 *      CommercialTerritory{scopeKey, status:"DRAFT"}. Pure DB
 *      insert-time uniqueness, no transaction needed.
 *
 *   2. ACTIVE-vs-ACTIVE overlap prevention — a district-scoped
 *      TerritoryActivationLock document written as the FIRST
 *      operation inside every activation transaction, forcing
 *      same-district activation attempts to genuinely conflict at the
 *      MongoDB storage-engine level (see TerritoryActivationLock.js).
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): this file never reads
 * Booking, never computes a commission amount, never mutates Salon,
 * and never creates a license/agreement record. TerritoryPartnerLicense
 * remains deferred to a later phase.
 *
 * FA-5 LAUNCH BLOCKER FIX — the one deliberate, explicitly-authorized
 * exception to the boundary above: assignPartner() sets
 * FieldAgent.operationalStatus to ACTIVE for a TERRITORY_PARTNER, in
 * the same transaction as the assignment it just created. Before this
 * fix, TERRITORY_PARTNER never reached ACTIVE anywhere in the codebase
 * (commercialModel.service.js#selectCommercialPath only activates
 * ACQUISITION_AGENT — TERRITORY_PARTNER was left PENDING_ACTIVATION
 * pending a License mechanism that was never built), so a Territory
 * Partner could be validly assigned a territory and still never be
 * able to log in operationally — confirmed live via a real 403 "not
 * yet operational". Per explicit product decision: a successful,
 * exclusive territory assignment IS the activation trigger for this
 * path — no License concept is introduced. vacatePartner is
 * deliberately NOT touched — operationalStatus is not reverted on
 * vacate, matching the instruction to keep that behavior unchanged.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { logAdminAction } from "../../../utils/auditLog.js";
import { AUDIT_ACTIONS } from "../../../utils/auditActions.js";
import District from "../../../models/District.js";
import City from "../../../models/City.js";
import Area from "../../../models/Area.js";
import CommercialTerritory from "../models/CommercialTerritory.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import TerritoryActivationLock from "../models/TerritoryActivationLock.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
// FA-10 — additive integration point only. This import creates a new,
// additive TerritoryPartnerTermSnapshot document immediately after
// assignment creation, inside the same transaction; it never reads,
// writes, or otherwise touches TerritoryAssignment/CommercialTerritory's
// own schema, fields, or lifecycle. See the call site inside
// assignPartner below for the exact coupling (mirrors
// acquisitionClaim.service.js's own FA-9 integration exactly).
import { createTerritoryPartnerTermSnapshot } from "./fieldAgentEarning.service.js";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION, AUDIT_ENTITY_TYPE, COMMERCIAL_PATH, FIELD_AGENT_OPERATIONAL_STATUS } from "../constants/fieldAgent.constants.js";
import {
  TERRITORY_SCOPE_TYPE,
  TERRITORY_STATUS,
  VALID_TERRITORY_TRANSITIONS,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_END_REASON,
  TERRITORY_CODE_PREFIX,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  MAX_CODE_ATTEMPTS,
  MAX_ACTIVATION_ATTEMPTS,
  MAX_ASSIGNMENT_ATTEMPTS,
} from "../constants/commercialTerritory.constants.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const safeAuditEvent = (doc) =>
  FieldAgentAuditEvent.create([doc]).catch((err) => {
    console.error("❌ FA-5.2 FieldAgentAuditEvent write failed:", err.message || err);
  });

// ─── CODE GENERATION ────────────────────────────────────────────────
// Date-prefixed, cryptographically random suffix — same shape as
// fieldAgentProfile.service.js#generateAgentCode /
// supportTicket.service.js#generateTicketNumber. No global counter, no
// hot document; bounded retry keyed on the exact duplicate index
// (err.keyPattern.code), not a blanket 11000 catch.
const generateTerritoryCode = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const suffix = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  return `${TERRITORY_CODE_PREFIX}-${y}${m}${d}-${suffix}`;
};

// ─── SCOPE KEY (canonical, deterministic) ───────────────────────────
export const computeScopeKey = ({ scopeType, districtRef, cityRef, areaRefs }) => {
  if (scopeType === TERRITORY_SCOPE_TYPE.DISTRICT) {
    return `DISTRICT:${districtRef}`;
  }
  if (scopeType === TERRITORY_SCOPE_TYPE.CITY) {
    return `CITY:${cityRef}`;
  }
  const sorted = [...new Set((areaRefs || []).map(String))].sort();
  return `AREA_SET:${cityRef}:${sorted.join(",")}`;
};

// ─── FRESH GEOGRAPHY VALIDATION ──────────────────────────────────────
// Re-reads District/City/Area live — never trusts client-supplied
// ancestor chains, even when internally consistent-looking. Returns
// the server-derived {stateRef, cityRef, areaRefs} to actually persist.
const validateGeographyFresh = async ({ scopeType, districtRef, cityRef, areaRefs }) => {
  const district = await District.findById(districtRef).lean();
  if (!district || district.isDeleted || district.isActive === false) {
    throw Errors.badRequest("districtRef does not reference an active District");
  }
  const stateRef = district.stateRef;

  if (scopeType === TERRITORY_SCOPE_TYPE.DISTRICT) {
    return { stateRef, cityRef: null, areaRefs: [] };
  }

  const city = await City.findById(cityRef).lean();
  if (!city || city.isDeleted || city.isActive === false) {
    throw Errors.badRequest("cityRef does not reference an active City");
  }
  if (String(city.districtRef) !== String(districtRef)) {
    throw Errors.badRequest("cityRef does not belong to the given districtRef");
  }

  if (scopeType === TERRITORY_SCOPE_TYPE.CITY) {
    return { stateRef, cityRef: city._id, areaRefs: [] };
  }

  // AREA_SET
  const uniqueAreaRefs = [...new Set((areaRefs || []).map(String))];
  const areas = await Area.find({ _id: { $in: uniqueAreaRefs } }).lean();
  if (areas.length !== uniqueAreaRefs.length) {
    throw Errors.badRequest("One or more areaRefs do not exist");
  }
  for (const area of areas) {
    if (area.isDeleted || area.isActive === false) {
      throw Errors.badRequest(`Area ${area._id} is not active`);
    }
    if (String(area.cityRef) !== String(cityRef) || String(area.districtRef) !== String(districtRef)) {
      throw Errors.badRequest(`Area ${area._id} does not belong to the given city/district`);
    }
  }
  return { stateRef, cityRef: city._id, areaRefs: areas.map((a) => a._id) };
};

// ─── OVERLAP MATRIX (§5, unchanged business rule) ───────────────────
const scopesConflict = (a, b) => {
  if (a.scopeType === TERRITORY_SCOPE_TYPE.DISTRICT || b.scopeType === TERRITORY_SCOPE_TYPE.DISTRICT) {
    return String(a.districtRef) === String(b.districtRef);
  }
  if (a.scopeType === TERRITORY_SCOPE_TYPE.CITY || b.scopeType === TERRITORY_SCOPE_TYPE.CITY) {
    return String(a.cityRef) === String(b.cityRef);
  }
  // both AREA_SET
  if (String(a.cityRef) !== String(b.cityRef)) return false;
  const bSet = new Set((b.areaRefs || []).map(String));
  return (a.areaRefs || []).some((id) => bSet.has(String(id)));
};

// ─── CREATE ──────────────────────────────────────────────────────────
export const createDraftTerritory = async ({ adminId, name, scopeType, districtRef, cityRef, areaRefs }) => {
  if (!isValidId(districtRef)) throw Errors.badRequest("Invalid districtRef");
  if (scopeType !== TERRITORY_SCOPE_TYPE.DISTRICT && !isValidId(cityRef)) throw Errors.badRequest("Invalid cityRef");

  const resolved = await validateGeographyFresh({ scopeType, districtRef, cityRef, areaRefs: areaRefs ?? [] });
  const scopeKey = computeScopeKey({
    scopeType,
    districtRef,
    cityRef: resolved.cityRef,
    areaRefs: resolved.areaRefs,
  });

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateTerritoryCode();
    try {
      const territory = await CommercialTerritory.create({
        name,
        scopeType,
        scopeKey,
        stateRef: resolved.stateRef,
        districtRef,
        cityRef: resolved.cityRef,
        areaRefs: resolved.areaRefs,
        code,
        status: TERRITORY_STATUS.DRAFT,
        createdBy: adminId,
        updatedBy: adminId,
      });

      logAdminAction({
        adminId,
        action: AUDIT_ACTIONS.TERRITORY_CREATED,
        targetType: "COMMERCIAL_TERRITORY",
        targetId: territory._id,
        meta: { code: territory.code, scopeType },
      });

      return territory;
    } catch (err) {
      lastErr = err;
      const isDuplicateScopeKey = err.code === 11000 && err.keyPattern?.scopeKey;
      if (isDuplicateScopeKey) {
        throw Errors.conflict("An identical DRAFT Commercial Territory already exists");
      }
      const isDuplicateCode = err.code === 11000 && err.keyPattern?.code;
      if (isDuplicateCode && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue; // regenerate code and retry, bounded — astronomically rare
      }
      throw err;
    }
  }
  throw lastErr;
};

// ─── READ ────────────────────────────────────────────────────────────
const applyAdminScope = (filter, admin) => {
  if (admin.adminLevel === "STATE") filter.stateRef = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") filter.districtRef = admin.districtRef;
  return filter;
};

export const listTerritories = async ({ admin, page = 1, limit = DEFAULT_LIST_LIMIT, status }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
  const safePage = Math.max(1, Number(page) || 1);

  const filter = {};
  if (status) filter.status = status;
  applyAdminScope(filter, admin);

  const [items, total] = await Promise.all([
    CommercialTerritory.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    CommercialTerritory.countDocuments(filter),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
};

export const getTerritoryDetail = async ({ territoryId, admin }) => {
  const territory = await CommercialTerritory.findById(territoryId).lean();
  if (!territory) throw Errors.notFound("Commercial Territory not found");

  if (admin.adminLevel === "STATE" && String(territory.stateRef) !== String(admin.stateRef)) {
    throw Errors.forbidden("Outside your authorized state scope");
  }
  if (admin.adminLevel === "DISTRICT" && String(territory.districtRef) !== String(admin.districtRef)) {
    throw Errors.forbidden("Outside your authorized district scope");
  }

  // Bounded recent-history list, folded into the detail response
  // rather than a separate endpoint — territory/assignment volumes
  // are small (see the FA-5.2 audit's own API-surface justification).
  const assignmentHistory = await TerritoryAssignment.find({ territoryRef: territoryId })
    .sort({ effectiveFrom: -1 })
    .limit(20)
    .lean();

  return { ...territory, assignmentHistory };
};

// ─── UPDATE (DRAFT-only) ─────────────────────────────────────────────
export const updateDraftTerritory = async ({ territoryId, adminId, name, scopeType, districtRef, cityRef, areaRefs }) => {
  const territory = await CommercialTerritory.findById(territoryId);
  if (!territory) throw Errors.notFound("Commercial Territory not found");
  if (territory.status !== TERRITORY_STATUS.DRAFT) {
    throw Errors.conflict(`Territory is ${territory.status} — geography/name can only be edited while DRAFT`);
  }

  const nextScopeType = scopeType ?? territory.scopeType;
  const nextDistrictRef = districtRef ?? territory.districtRef;
  const nextCityRef = cityRef ?? territory.cityRef;
  const nextAreaRefs = areaRefs ?? territory.areaRefs;

  const resolved = await validateGeographyFresh({
    scopeType: nextScopeType,
    districtRef: nextDistrictRef,
    cityRef: nextCityRef,
    areaRefs: nextAreaRefs,
  });
  const scopeKey = computeScopeKey({
    scopeType: nextScopeType,
    districtRef: nextDistrictRef,
    cityRef: resolved.cityRef,
    areaRefs: resolved.areaRefs,
  });

  territory.name = name ?? territory.name;
  territory.scopeType = nextScopeType;
  territory.stateRef = resolved.stateRef;
  territory.districtRef = nextDistrictRef;
  territory.cityRef = resolved.cityRef;
  territory.areaRefs = resolved.areaRefs;
  territory.scopeKey = scopeKey;
  territory.updatedBy = adminId;

  try {
    await territory.save();
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.scopeKey) {
      throw Errors.conflict("An identical DRAFT Commercial Territory already exists");
    }
    throw err;
  }

  logAdminAction({
    adminId,
    action: AUDIT_ACTIONS.TERRITORY_UPDATED,
    targetType: "COMMERCIAL_TERRITORY",
    targetId: territory._id,
    meta: { code: territory.code },
  });

  return territory;
};

// ─── ACTIVATE (district-scoped serialized overlap check, §A) ────────
export const activateTerritory = async ({ territoryId, adminId }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ACTIVATION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const territory = await CommercialTerritory.findById(territoryId).session(session);
      if (!territory) throw Errors.notFound("Commercial Territory not found");
      if (!VALID_TERRITORY_TRANSITIONS[territory.status]?.includes(TERRITORY_STATUS.ACTIVE)) {
        throw Errors.conflict(`Territory is ${territory.status} — cannot transition to ACTIVE`);
      }

      // Step 1 — district-scoped serialization anchor. MUST be the
      // first write inside this transaction, before reading any
      // candidate CommercialTerritory documents (see
      // TerritoryActivationLock.js for the full correctness argument).
      await TerritoryActivationLock.findOneAndUpdate(
        { districtRef: territory.districtRef },
        { $set: { updatedAt: new Date() } },
        { upsert: true, session }
      );

      // Step 2 — re-read all ACTIVE territories sharing this district,
      // now inside the serialized section — never a pre-transaction
      // snapshot.
      const candidates = await CommercialTerritory.find({
        status: TERRITORY_STATUS.ACTIVE,
        districtRef: territory.districtRef,
        _id: { $ne: territory._id },
      })
        .session(session)
        .lean();

      const conflict = candidates.find((c) => scopesConflict(territory, c));
      if (conflict) {
        throw Errors.conflict(
          `Activation blocked — conflicts with ACTIVE territory ${conflict.code} (${conflict.scopeType})`
        );
      }

      territory.status = TERRITORY_STATUS.ACTIVE;
      territory.updatedBy = adminId;
      await territory.save({ session });

      await session.commitTransaction();

      logAdminAction({
        adminId,
        action: AUDIT_ACTIONS.TERRITORY_ACTIVATED,
        targetType: "COMMERCIAL_TERRITORY",
        targetId: territory._id,
        meta: { code: territory.code },
      });

      return territory;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_ACTIVATION_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── SUSPEND (no overlap check — only (re)activation runs it) ───────
export const suspendTerritory = async ({ territoryId, adminId }) => {
  const territory = await CommercialTerritory.findOneAndUpdate(
    { _id: territoryId, status: TERRITORY_STATUS.ACTIVE },
    { $set: { status: TERRITORY_STATUS.SUSPENDED, updatedBy: adminId } },
    { new: true }
  );
  if (!territory) {
    const existing = await CommercialTerritory.findById(territoryId).lean();
    if (!existing) throw Errors.notFound("Commercial Territory not found");
    throw Errors.conflict(`Territory is ${existing.status} — cannot suspend (must be ACTIVE)`);
  }

  logAdminAction({
    adminId,
    action: AUDIT_ACTIONS.TERRITORY_SUSPENDED,
    targetType: "COMMERCIAL_TERRITORY",
    targetId: territory._id,
    meta: { code: territory.code },
  });

  return territory;
};

// ─── RETIRE (auto-vacates a live assignment, same transaction) ──────
export const retireTerritory = async ({ territoryId, adminId }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const territory = await CommercialTerritory.findById(territoryId).session(session);
      if (!territory) throw Errors.notFound("Commercial Territory not found");
      if (!VALID_TERRITORY_TRANSITIONS[territory.status]?.includes(TERRITORY_STATUS.RETIRED)) {
        throw Errors.conflict(`Territory is already ${territory.status} — cannot retire`);
      }

      let endedAssignmentId = null;
      if (territory.currentAssignmentRef) {
        const assignment = await TerritoryAssignment.findOne({
          _id: territory.currentAssignmentRef,
          status: ASSIGNMENT_STATUS.ACTIVE,
        }).session(session);
        if (assignment) {
          assignment.status = ASSIGNMENT_STATUS.ENDED;
          assignment.effectiveUntil = new Date();
          assignment.endReason = ASSIGNMENT_END_REASON.TERRITORY_RETIRED;
          assignment.endedBy = adminId;
          await assignment.save({ session });
          endedAssignmentId = assignment._id;
        }
        territory.currentAssignmentRef = null;
      }

      territory.status = TERRITORY_STATUS.RETIRED;
      territory.updatedBy = adminId;
      await territory.save({ session });

      await session.commitTransaction();

      logAdminAction({
        adminId,
        action: AUDIT_ACTIONS.TERRITORY_RETIRED,
        targetType: "COMMERCIAL_TERRITORY",
        targetId: territory._id,
        meta: { code: territory.code, endedAssignmentId: endedAssignmentId ? String(endedAssignmentId) : null },
      });

      if (endedAssignmentId) {
        safeAuditEvent({
          entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_TERRITORY,
          entityId: territory._id,
          actorRef: adminId,
          actorType: AUDIT_ACTOR_TYPE.ADMIN,
          action: AUDIT_ACTION.TERRITORY_PARTNER_VACATED,
          newValue: { assignmentId: String(endedAssignmentId), endReason: ASSIGNMENT_END_REASON.TERRITORY_RETIRED },
        });
      }

      return territory;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_ASSIGNMENT_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── ASSIGN PARTNER ───────────────────────────────────────────────────
export const assignPartner = async ({ territoryId, fieldAgentId, adminId }) => {
  if (!isValidId(fieldAgentId)) throw Errors.badRequest("Invalid fieldAgentId");

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const territory = await CommercialTerritory.findById(territoryId).session(session);
      if (!territory) throw Errors.notFound("Commercial Territory not found");
      if (territory.status !== TERRITORY_STATUS.ACTIVE) {
        throw Errors.conflict(`Territory is ${territory.status} — must be ACTIVE to assign a partner`);
      }
      if (territory.currentAssignmentRef) {
        throw Errors.conflict("Territory already has an active partner assignment");
      }

      // Fresh FieldAgent eligibility — never trusted from a prior
      // read. USER and ACQUISITION_AGENT can never be assigned.
      const fieldAgent = await FieldAgent.findById(fieldAgentId).session(session).lean();
      if (!fieldAgent) throw Errors.notFound("Field Agent not found");
      if (fieldAgent.commercialPath !== COMMERCIAL_PATH.TERRITORY_PARTNER) {
        throw Errors.conflict("Field Agent's commercialPath is not TERRITORY_PARTNER — cannot be assigned a Commercial Territory");
      }

      const existingActive = await TerritoryAssignment.findOne({
        fieldAgentRef: fieldAgentId,
        status: ASSIGNMENT_STATUS.ACTIVE,
      }).session(session).lean();
      if (existingActive) {
        throw Errors.conflict("Field Agent already holds an ACTIVE Commercial Territory assignment");
      }

      const [assignment] = await TerritoryAssignment.create(
        [
          {
            territoryRef: territory._id,
            fieldAgentRef: fieldAgentId,
            status: ASSIGNMENT_STATUS.ACTIVE,
            effectiveFrom: new Date(),
            assignedBy: adminId,
          },
        ],
        { session }
      );

      territory.currentAssignmentRef = assignment._id;
      territory.updatedBy = adminId;
      await territory.save({ session });

      // FA-5 LAUNCH BLOCKER FIX — activation happens only here, after
      // the assignment above has actually been created and the
      // territory saved in this SAME transaction; if anything earlier
      // in this function throws, the transaction aborts and this never
      // runs (see the catch block below). fieldAgent was fetched
      // .lean() above purely for the eligibility check, so this is an
      // atomic update, not a save() on that snapshot — and it only
      // writes when not already ACTIVE, so a reassignment after a
      // vacate (which never reverts operationalStatus — unchanged, see
      // vacatePartner below) is a no-op here, not a redundant write.
      await FieldAgent.updateOne(
        { _id: fieldAgentId, operationalStatus: { $ne: FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE } },
        { $set: { operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE } },
        { session }
      );

      // FA-10 — additive only, does not modify TerritoryAssignment's
      // own fields/lifecycle. Attempts to snapshot the 3-year term from
      // whichever national commercial policy is applicable AT this
      // exact assignment-creation instant, inside the SAME transaction
      // (so assignment + term snapshot are atomically coupled when a
      // policy exists). If no policy exists yet, this deliberately does
      // NOT fail the assignment — the assignPartner flow is unchanged,
      // frozen, and fully independent of commercial-policy state
      // (exactly as it always has been). The absence is instead
      // durably recorded as an auditable TERM_SNAPSHOT_GAP (reusing
      // FA-9's own gap mechanism) for later reconciliation once a
      // policy is published.
      const termSnapshot = await createTerritoryPartnerTermSnapshot({ assignment, session });

      await session.commitTransaction();

      if (!termSnapshot) {
        console.warn(
          `⚠️ FA-10 TERM_SNAPSHOT_GAP: TerritoryAssignment ${assignment._id} created with no applicable national commercial policy at ${assignment.effectiveFrom.toISOString()} — 3-year term not yet snapshotted. Durably tracked in FieldAgentEarningPolicyGap; will resolve automatically once a CommercialPolicyVersion applicable at assignment-creation time is published.`
        );
      }

      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_TERRITORY,
        entityId: territory._id,
        actorRef: adminId,
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        action: AUDIT_ACTION.TERRITORY_PARTNER_ASSIGNED,
        newValue: { fieldAgentId: String(fieldAgentId), assignmentId: String(assignment._id) },
      });

      return { territory, assignment };
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      // The two partial unique indexes on TerritoryAssignment are the
      // DB-level backstop for the two exclusivity rules even if this
      // pre-check had a bug — a duplicate-key here is also retried
      // like any other transient conflict, since it means a
      // concurrent winner just committed and this attempt should
      // re-evaluate fresh state, not fail outright.
      const isDuplicateAssignment = err.code === 11000;
      if ((isTransientConflict(err) || isDuplicateAssignment) && attempt < MAX_ASSIGNMENT_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── VACATE PARTNER ───────────────────────────────────────────────────
// endReason is restricted at the validator layer to
// PARTNER_EXIT/ADMIN_REASSIGNED — TERRITORY_RETIRED is server-only,
// set exclusively by retireTerritory's auto-vacate step.
export const vacatePartner = async ({ territoryId, adminId, endReason }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const territory = await CommercialTerritory.findById(territoryId).session(session);
      if (!territory) throw Errors.notFound("Commercial Territory not found");
      if (!territory.currentAssignmentRef) {
        throw Errors.conflict("Territory has no active partner assignment to vacate");
      }

      const assignment = await TerritoryAssignment.findOne({
        _id: territory.currentAssignmentRef,
        status: ASSIGNMENT_STATUS.ACTIVE,
      }).session(session);
      if (!assignment) {
        throw Errors.conflict("No ACTIVE assignment found for this territory's currentAssignmentRef");
      }

      assignment.status = ASSIGNMENT_STATUS.ENDED;
      assignment.effectiveUntil = new Date();
      assignment.endReason = endReason;
      assignment.endedBy = adminId;
      await assignment.save({ session });

      territory.currentAssignmentRef = null;
      territory.updatedBy = adminId;
      await territory.save({ session });

      await session.commitTransaction();

      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_TERRITORY,
        entityId: territory._id,
        actorRef: adminId,
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        action: AUDIT_ACTION.TERRITORY_PARTNER_VACATED,
        newValue: { assignmentId: String(assignment._id), endReason },
      });

      return { territory, assignment };
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_ASSIGNMENT_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};
