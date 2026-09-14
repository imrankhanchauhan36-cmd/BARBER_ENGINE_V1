/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/acquisitionClaim.service.js
 *
 * FA-5.3 — AcquisitionReferral + AcquisitionClaim business logic.
 *
 * CONTROLLED WORKFLOW (locked decision): there is exactly ONE path
 * that creates an AcquisitionClaim — redeemReferral, called only from
 * the owner-facing /api/acquisition/redeem endpoint. No function here
 * ever accepts a client-supplied salonRef or fieldAgentRef as an
 * authoritative identity input; salonRef is always resolved from the
 * authenticated owner's own session, fieldAgentRef always from the
 * authenticated agent's own session (via getFieldAgentByUserId, the
 * existing FA-4.1 helper) or from the referral being redeemed.
 *
 * AUDIT ACTOR MAPPING (a deliberate choice, not a default): actorType
 * reflects who actually authenticated and called the endpoint — same
 * meaning it already has for every existing FieldAgentAuditEvent
 * write (APPLICANT for FA-2 self-service, ADMIN for admin actions).
 * Referral issuance/cancellation and self-withdrawal of a claim are
 * genuinely agent-initiated -> actorType AGENT. Redemption is
 * genuinely OWNER-initiated (the Salon Owner calls /redeem, not the
 * agent) -> actorType SYSTEM, actorRef set to the owner's User._id for
 * traceability. There is no OWNER value in AUDIT_ACTOR_TYPE and this
 * phase does not invent one; SYSTEM (declared since FA-2, never used
 * until now) is the correct existing value for "an action mechanically
 * triggered by an actor outside the FieldAgent domain's own modeled
 * actor set."
 *
 * TWO independent concurrency mechanisms, no lock document, no Redis,
 * no in-memory correctness reliance:
 *   1. AcquisitionReferral{code} unique index + an atomic conditional
 *      findOneAndUpdate(status:"ISSUED"->"CONSUMED") — the race
 *      authority for "this code redeems exactly once."
 *   2. AcquisitionClaim{salonRef,status:"ACTIVE"} partial unique index
 *      — the race authority for "at most one ACTIVE claim per salon."
 * A transaction wraps referral-consumption + claim-creation for
 * atomicity between the two writes (mirrors assignPartner's own exact
 * precedent in commercialTerritory.service.js) — the transaction is
 * NOT what provides race-safety (the indexes above already are, on
 * their own); it only prevents an orphaned "spent referral, no claim"
 * state.
 *
 * FA-5.2 BOUNDARY: CommercialTerritory/TerritoryAssignment are READ
 * ONLY here (assertTerritoryMembership), always freshly re-read inside
 * the same transaction — never cached, never written.
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): this file never reads
 * Booking, never computes an incentive/commission amount, never
 * creates a ledger/payout entry, never touches Salon, never touches
 * FieldAgent.operationalStatus.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import Salon from "../../../models/Salon.js";
import AcquisitionReferral from "../models/AcquisitionReferral.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";
// FA-5.2 — read-only imports. Never written by this file.
import CommercialTerritory from "../models/CommercialTerritory.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import { TERRITORY_SCOPE_TYPE, TERRITORY_STATUS } from "../constants/commercialTerritory.constants.js";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_ACTION,
  AUDIT_ENTITY_TYPE,
  COMMERCIAL_PATH,
  FIELD_AGENT_OPERATIONAL_STATUS,
} from "../constants/fieldAgent.constants.js";
import {
  REFERRAL_STATUS,
  REFERRAL_CODE_PREFIX,
  REFERRAL_EXPIRY_DAYS,
  MIN_ONBOARDING_STEP_FOR_REDEMPTION,
  CLAIM_STATUS,
  CLAIM_END_REASON,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  MAX_CODE_ATTEMPTS,
  MAX_REDEEM_ATTEMPTS,
} from "../constants/acquisitionClaim.constants.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const safeAuditEvent = (doc) =>
  FieldAgentAuditEvent.create([doc]).catch((err) => {
    console.error("❌ FA-5.3 FieldAgentAuditEvent write failed:", err.message || err);
  });

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
const clampPage = (page) => Math.max(1, Number(page) || 1);

// ─── ELIGIBILITY ────────────────────────────────────────────────────
const assertClaimEligible = (fieldAgent) => {
  if (fieldAgent.operationalStatus !== FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE) {
    throw Errors.conflict("Field Agent must be ACTIVE to acquire salons");
  }
  if (![COMMERCIAL_PATH.ACQUISITION_AGENT, COMMERCIAL_PATH.TERRITORY_PARTNER].includes(fieldAgent.commercialPath)) {
    throw Errors.conflict("Field Agent has no eligible commercial path selected");
  }
};

// ─── TERRITORY PARTNER MEMBERSHIP (FA-5.2 read-only) ────────────────
const assertTerritoryMembership = async ({ fieldAgentId, salon, session }) => {
  const assignment = await TerritoryAssignment.findOne({ fieldAgentRef: fieldAgentId, status: "ACTIVE" })
    .session(session)
    .lean();
  if (!assignment) {
    throw Errors.conflict("Territory Partner has no active Commercial Territory assignment");
  }

  // Fresh, independent re-read — an ACTIVE TerritoryAssignment can
  // coexist with a SUSPENDED CommercialTerritory (suspendTerritory
  // never touches the assignment), so the territory's own status must
  // be checked separately, never inferred from the assignment alone.
  const territory = await CommercialTerritory.findById(assignment.territoryRef).session(session).lean();
  if (!territory || territory.status !== TERRITORY_STATUS.ACTIVE) {
    throw Errors.conflict("Territory Partner's assigned Commercial Territory is not currently ACTIVE");
  }

  const salonTerritory = salon.location?.territory || {};

  if (territory.scopeType === TERRITORY_SCOPE_TYPE.DISTRICT) {
    if (!salonTerritory.districtRef || String(salonTerritory.districtRef) !== String(territory.districtRef)) {
      throw Errors.conflict("Salon is outside your assigned Commercial Territory");
    }
    return;
  }

  if (territory.scopeType === TERRITORY_SCOPE_TYPE.CITY) {
    if (!salonTerritory.cityRef || String(salonTerritory.cityRef) !== String(territory.cityRef)) {
      throw Errors.conflict("Salon is outside your assigned Commercial Territory");
    }
    return;
  }

  // AREA_SET — do NOT bypass, do NOT fall back to city/district, do
  // NOT infer an Area. A null areaRef means "cannot claim yet" — the
  // remedy is the existing, separate, unmodified AREA-2.5.3 admin
  // resolution flow, never triggered from here.
  if (!salonTerritory.areaRef) {
    throw Errors.conflict(
      "Salon has no Area assignment yet — cannot validate an AREA_SET-scoped Commercial Territory claim"
    );
  }
  const belongs = (territory.areaRefs || []).some((a) => String(a) === String(salonTerritory.areaRef));
  if (!belongs) {
    throw Errors.conflict("Salon is outside your assigned Commercial Territory");
  }
};

// ─── REFERRAL CODE GENERATION ────────────────────────────────────────
const generateReferralCode = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const suffix = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  return `${REFERRAL_CODE_PREFIX}-${y}${m}${d}-${suffix}`;
};

// ─── ISSUE REFERRAL ───────────────────────────────────────────────────
export const issueReferral = async ({ userId }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");
  assertClaimEligible(fieldAgent);

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    try {
      const referral = await AcquisitionReferral.create({
        code,
        fieldAgentRef: fieldAgent._id,
        status: REFERRAL_STATUS.ISSUED,
        expiresAt: new Date(Date.now() + REFERRAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      });

      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_REFERRAL,
        entityId: referral._id,
        actorRef: userId,
        actorType: AUDIT_ACTOR_TYPE.AGENT,
        action: AUDIT_ACTION.ACQUISITION_REFERRAL_CREATED,
        newValue: { code: referral.code },
      });

      return referral;
    } catch (err) {
      lastErr = err;
      const isDuplicateCode = err.code === 11000 && err.keyPattern?.code;
      if (isDuplicateCode && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue; // regenerate and retry, bounded — astronomically rare
      }
      throw err;
    }
  }
  throw lastErr;
};

// ─── LIST / CANCEL — MY REFERRALS ─────────────────────────────────────
export const listMyReferrals = async ({ userId, page, limit }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);
  const filter = { fieldAgentRef: fieldAgent._id };

  const [items, total] = await Promise.all([
    AcquisitionReferral.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    AcquisitionReferral.countDocuments(filter),
  ]);
  return { items, total, page: safePage, limit: safeLimit };
};

export const cancelMyReferral = async ({ userId, referralId }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  // Ownership is enforced by including fieldAgentRef in the query
  // itself — a foreign referral simply never matches, so the fallback
  // lookup below (also scoped to this agent) returns nothing and the
  // caller sees a plain 404, never leaking whether the ID exists.
  const referral = await AcquisitionReferral.findOneAndUpdate(
    { _id: referralId, fieldAgentRef: fieldAgent._id, status: REFERRAL_STATUS.ISSUED },
    { $set: { status: REFERRAL_STATUS.CANCELLED, cancelledAt: new Date() } },
    { new: true }
  );
  if (!referral) {
    const existing = await AcquisitionReferral.findOne({ _id: referralId, fieldAgentRef: fieldAgent._id }).lean();
    if (!existing) throw Errors.notFound("Referral not found");
    throw Errors.conflict(`Referral is ${existing.status} — cannot cancel`);
  }

  safeAuditEvent({
    entityType: AUDIT_ENTITY_TYPE.ACQUISITION_REFERRAL,
    entityId: referral._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.AGENT,
    action: AUDIT_ACTION.ACQUISITION_REFERRAL_CANCELLED,
    newValue: {},
  });

  return referral;
};

// ─── LIST / WITHDRAW — MY CLAIMS ──────────────────────────────────────
export const listMyClaims = async ({ userId, page, limit }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);
  const filter = { fieldAgentRef: fieldAgent._id };

  const [items, total] = await Promise.all([
    AcquisitionClaim.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    AcquisitionClaim.countDocuments(filter),
  ]);
  return { items, total, page: safePage, limit: safeLimit };
};

export const withdrawMyClaim = async ({ userId, claimId }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const claim = await AcquisitionClaim.findOneAndUpdate(
    { _id: claimId, fieldAgentRef: fieldAgent._id, status: CLAIM_STATUS.ACTIVE },
    {
      $set: {
        status: CLAIM_STATUS.ENDED,
        endedReason: CLAIM_END_REASON.AGENT_WITHDRAWN,
        endedBy: userId,
        endedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!claim) {
    const existing = await AcquisitionClaim.findOne({ _id: claimId, fieldAgentRef: fieldAgent._id }).lean();
    if (!existing) throw Errors.notFound("Claim not found");
    throw Errors.conflict(`Claim is ${existing.status} — cannot withdraw`);
  }

  safeAuditEvent({
    entityType: AUDIT_ENTITY_TYPE.ACQUISITION_CLAIM,
    entityId: claim._id,
    actorRef: userId,
    actorType: AUDIT_ACTOR_TYPE.AGENT,
    action: AUDIT_ACTION.ACQUISITION_CLAIM_ENDED,
    newValue: { endedReason: CLAIM_END_REASON.AGENT_WITHDRAWN },
  });

  return claim;
};

// ─── REDEEM (the ONLY claim-creation path) ───────────────────────────
export const redeemReferral = async ({ ownerId, referralCode }) => {
  if (!referralCode || typeof referralCode !== "string") {
    throw Errors.badRequest("referralCode is required");
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_REDEEM_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // salonRef is ALWAYS resolved server-side from the authenticated
      // owner's own session — never client-supplied (locked decision).
      const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).session(session);
      if (!salon) throw Errors.notFound("No Salon found for this account — complete onboarding first");

      const onboardingStep = salon.onboarding?.step ?? 0;
      if (onboardingStep < MIN_ONBOARDING_STEP_FOR_REDEMPTION || !salon.location?.territory?.districtRef) {
        throw Errors.conflict("Complete the location step of onboarding before redeeming a referral");
      }

      const referral = await AcquisitionReferral.findOne({ code: referralCode }).session(session);
      if (!referral) throw Errors.notFound("Referral code not found");
      if (referral.status !== REFERRAL_STATUS.ISSUED) {
        throw Errors.conflict(`Referral is ${referral.status} — cannot redeem`);
      }
      if (referral.expiresAt <= new Date()) {
        throw Errors.conflict("Referral has expired");
      }

      // fieldAgentRef is resolved from the referral, never from the
      // client — re-checked fresh, never trusted from issuance time.
      const fieldAgent = await FieldAgent.findById(referral.fieldAgentRef).session(session).lean();
      if (!fieldAgent) throw Errors.notFound("Referring Field Agent not found");
      assertClaimEligible(fieldAgent);

      // Structural self-claim prevention only — deeper identity
      // linkage (same person, different accounts) is deferred to the
      // later fraud phase, per locked decision.
      if (String(fieldAgent.userRef) === String(salon.ownerId)) {
        throw Errors.conflict("A Field Agent cannot acquire their own salon");
      }

      if (fieldAgent.commercialPath === COMMERCIAL_PATH.TERRITORY_PARTNER) {
        await assertTerritoryMembership({ fieldAgentId: fieldAgent._id, salon, session });
      }
      // ACQUISITION_AGENT: no further geography check — V1 permits
      // India-wide valid Salon acquisition (locked decision; no
      // geography policy table exists or is invented here).

      // Atomic conditional consume — the race authority for "this
      // code redeems exactly once."
      const consumedReferral = await AcquisitionReferral.findOneAndUpdate(
        { _id: referral._id, status: REFERRAL_STATUS.ISSUED, expiresAt: { $gt: new Date() } },
        { $set: { status: REFERRAL_STATUS.CONSUMED, consumedSalonRef: salon._id, consumedAt: new Date() } },
        { session, new: true }
      );
      if (!consumedReferral) {
        throw Errors.conflict("Referral was already redeemed, cancelled, or expired");
      }

      // Partial unique index on {salonRef,status:"ACTIVE"} is the sole
      // correctness authority for "at most one ACTIVE claim per
      // salon" — this insert either succeeds once or throws 11000.
      const [claim] = await AcquisitionClaim.create(
        [
          {
            salonRef: salon._id,
            fieldAgentRef: fieldAgent._id,
            referralRef: referral._id,
            status: CLAIM_STATUS.ACTIVE,
            stateRef: salon.location?.territory?.stateRef ?? null,
            districtRef: salon.location?.territory?.districtRef ?? null,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      // See file header — redemption is owner-initiated, actorType
      // SYSTEM with the owner's own User._id for traceability.
      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_REFERRAL,
        entityId: referral._id,
        actorRef: ownerId,
        actorType: AUDIT_ACTOR_TYPE.SYSTEM,
        action: AUDIT_ACTION.ACQUISITION_REFERRAL_CONSUMED,
        newValue: { salonId: String(salon._id) },
      });
      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_CLAIM,
        entityId: claim._id,
        actorRef: ownerId,
        actorType: AUDIT_ACTOR_TYPE.SYSTEM,
        action: AUDIT_ACTION.ACQUISITION_CLAIM_CREATED,
        newValue: { salonId: String(salon._id), fieldAgentId: String(fieldAgent._id), referralId: String(referral._id) },
      });

      return { claim, salon };
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      const isDuplicateClaim = err.code === 11000;
      if ((isTransientConflict(err) || isDuplicateClaim) && attempt < MAX_REDEEM_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── ADMIN ────────────────────────────────────────────────────────────
const applyAdminScope = (filter, admin) => {
  if (admin.adminLevel === "STATE") filter.stateRef = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") filter.districtRef = admin.districtRef;
  return filter;
};

export const adminListClaims = async ({ admin, page, limit, status }) => {
  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);
  const filter = {};
  if (status) filter.status = status;
  applyAdminScope(filter, admin);

  const [items, total] = await Promise.all([
    AcquisitionClaim.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    AcquisitionClaim.countDocuments(filter),
  ]);
  return { items, total, page: safePage, limit: safeLimit };
};

export const adminGetClaimDetail = async ({ admin, claimId }) => {
  const claim = await AcquisitionClaim.findById(claimId).lean();
  if (!claim) throw Errors.notFound("Claim not found");

  if (admin.adminLevel === "STATE" && String(claim.stateRef) !== String(admin.stateRef)) {
    throw Errors.forbidden("Outside your authorized state scope");
  }
  if (admin.adminLevel === "DISTRICT" && String(claim.districtRef) !== String(admin.districtRef)) {
    throw Errors.forbidden("Outside your authorized district scope");
  }

  return claim;
};

const adminEndClaim = async ({ adminId, claimId, reason }) => {
  const claim = await AcquisitionClaim.findOneAndUpdate(
    { _id: claimId, status: CLAIM_STATUS.ACTIVE },
    { $set: { status: CLAIM_STATUS.ENDED, endedReason: reason, endedBy: adminId, endedAt: new Date() } },
    { new: true }
  );
  if (!claim) {
    const existing = await AcquisitionClaim.findById(claimId).lean();
    if (!existing) throw Errors.notFound("Claim not found");
    throw Errors.conflict(`Claim is ${existing.status} — cannot end`);
  }

  safeAuditEvent({
    entityType: AUDIT_ENTITY_TYPE.ACQUISITION_CLAIM,
    entityId: claim._id,
    actorRef: adminId,
    actorType: AUDIT_ACTOR_TYPE.ADMIN,
    action: AUDIT_ACTION.ACQUISITION_CLAIM_ENDED,
    newValue: { endedReason: reason },
  });

  return claim;
};

export const adminRejectClaim = ({ adminId, claimId }) =>
  adminEndClaim({ adminId, claimId, reason: CLAIM_END_REASON.ADMIN_REJECTED });

export const adminReassignClaim = ({ adminId, claimId }) =>
  adminEndClaim({ adminId, claimId, reason: CLAIM_END_REASON.ADMIN_REASSIGNED });
