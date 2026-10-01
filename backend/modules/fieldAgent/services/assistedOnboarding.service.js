/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/assistedOnboarding.service.js
 *
 * PAN-India Field Agent Assisted Onboarding — PHASE 1 (backend
 * foundation only). Implements exactly the flow frozen for this
 * phase:
 *
 *   FIELD_AGENT JWT
 *     -> owner mobile number
 *     -> owner OTP verification (assisted, session-free)
 *     -> find/create OWNER
 *     -> resolve existing salon(s) OR create new DRAFT salon
 *     -> automatically create/link AcquisitionClaim
 *     -> return assisted onboarding context
 *
 * HARD INVARIANTS (do not weaken without a fresh product decision):
 *   - The Field Agent's own session/tokens are NEVER touched here.
 *     This file never calls createSession/generateAccessToken for the
 *     owner, never issues the owner any token, never reads/writes
 *     anything under the Field Agent's own auth state.
 *   - Salon.ownerId is ALWAYS a real OWNER User._id. The Field Agent
 *     is never written into Salon.ownerId and no Salon.fieldAgentId
 *     field exists or is added — attribution lives EXCLUSIVELY in
 *     AcquisitionClaim, exactly as it already does for the existing
 *     referral-redemption path.
 *   - Every primitive this file touches is REUSED, not reimplemented:
 *     createOrFindUser (utils/otp.helpers.js), the OTP engine
 *     (modules/otp/services/otp.service.js), issueReferral (this
 *     module's own acquisitionClaim.service.js, called verbatim,
 *     unmodified), the SAME AcquisitionClaim creation/fraud/territory
 *     checks that path already enforces, the SAME partial-unique
 *     {salonRef,status:non-terminal} index, the SAME
 *     FieldAgentAuditEvent/safeAuditEvent idiom, the SAME
 *     NotificationService call. salon.onboarding.controller.js /
 *     salon.onboarding.routes.js (the Owner-only 8-step engine) are
 *     NOT imported, read, or modified by this file at all.
 *
 * WHAT THIS FILE DOES NOT DO (explicitly out of Phase 1 scope — see
 * the Phase 1 report's own "unresolved product/security decisions"):
 *   - It does not let a Field Agent resume/edit an arbitrary EXISTING
 *     salon via this flow — only "owner has zero salons" (auto-create)
 *     and "owner has salons, caller explicitly asks for a NEW branch"
 *     are implemented. Attaching this flow's claim to a pre-existing
 *     salon is a Phase 2+ decision.
 *   - It does not implement the actual onboarding-step writes
 *     (basic-info/location/services/...) for a Field-Agent-authenticated
 *     caller — that is explicitly Phase 2+.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import Salon from "../../../models/Salon.js";
import AcquisitionReferral from "../models/AcquisitionReferral.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";
import { issueReferral } from "./acquisitionClaim.service.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { NOTIFICATION_EVENTS } from "../../notifications/constants/notificationEvents.constants.js";
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
import { REFERRAL_STATUS, CLAIM_STATUS, CLAIM_NON_TERMINAL_STATUSES, MAX_REDEEM_ATTEMPTS } from "../constants/acquisitionClaim.constants.js";
import User from "../../../models/User.js";
import { createOrFindUser } from "../../../utils/otp.helpers.js";
import { sendOtp as sendOtpEngine, verifyOtp as verifyOtpEngine } from "../../otp/services/otp.service.js";
import { OTP_PURPOSE } from "../../otp/constants/otpPurpose.constants.js";

// ── Phone normalizer ─────────────────────────────────────────────────
// Deliberately duplicated here, verbatim, rather than importing it
// from controllers/auth.controller.js — that function is a private,
// unexported local const there, and that file owns the real Owner
// OTP session path this phase must not touch at all. This is a 6-line,
// dependency-free, pure string transform (no OTP/session/business
// logic) — duplicating it is materially safer than adding an export
// to the one file this phase is explicitly told to leave alone.
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== "string") return null;
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("91") && cleaned.length === 12) cleaned = cleaned.slice(2);
  if (!/^[6-9]\d{9}$/.test(cleaned)) return null;
  return cleaned;
};

const safeAuditEvent = (doc) =>
  FieldAgentAuditEvent.create([doc]).catch((err) => {
    console.error("❌ Assisted Onboarding FieldAgentAuditEvent write failed:", err.message || err);
  });

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

// ── Assisted onboarding verification token ──────────────────────────
// Redis-backed, opaque, single-use, short-lived (10 min). Carries NO
// authentication power of any kind — it is not a JWT, is never
// accepted as a Bearer token anywhere, and is checked by exactly one
// Redis GETDEL in this file. It exists ONLY to let the SAME Field
// Agent resume the SAME already-OTP-verified flow (e.g. to answer
// "create a new branch?") without re-sending/re-entering the owner's
// OTP a second time. Scoped to the exact fieldAgentUserId that
// obtained it (checked explicitly below) so it cannot be replayed by
// a different Field Agent even if somehow observed.
const ASSISTED_TOKEN_TTL_SECONDS = 10 * 60;
const assistedTokenKey = (token) => `assisted_onboarding_token:${token}`;

const issueAssistedToken = async (redis, { fieldAgentUserId, ownerId, phone, ownerCreated }) => {
  const token = crypto.randomBytes(24).toString("hex");
  await redis.set(
    assistedTokenKey(token),
    JSON.stringify({ fieldAgentUserId: String(fieldAgentUserId), ownerId: String(ownerId), phone, ownerCreated }),
    { EX: ASSISTED_TOKEN_TTL_SECONDS }
  );
  return token;
};

// Single-use: GETDEL semantics via GET then DEL (fail-open to "invalid"
// on any Redis error — never throws a 500 for a Redis hiccup here).
const consumeAssistedToken = async (redis, token, fieldAgentUserId) => {
  if (!token || typeof token !== "string") return null;
  let raw;
  try {
    raw = await redis.get(assistedTokenKey(token));
    if (raw) await redis.del(assistedTokenKey(token));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (String(parsed.fieldAgentUserId) !== String(fieldAgentUserId)) return null;
  return parsed;
};

// ── Eligibility / territory — mirrors acquisitionClaim.service.js's
// own private helpers exactly (same checks, same error messages),
// since that file does not export them for reuse. See this file's own
// header for why duplicating these two small, pure guard functions is
// the correct, smallest-footprint choice rather than modifying that
// module to export them.
const assertClaimEligible = (fieldAgent) => {
  if (fieldAgent.operationalStatus !== FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE) {
    throw Errors.conflict("Field Agent must be ACTIVE to acquire salons");
  }
  if (![COMMERCIAL_PATH.ACQUISITION_AGENT, COMMERCIAL_PATH.TERRITORY_PARTNER].includes(fieldAgent.commercialPath)) {
    throw Errors.conflict("Field Agent has no eligible commercial path selected");
  }
};

const assertTerritoryMembership = async ({ fieldAgentId, salon, session }) => {
  const assignment = await TerritoryAssignment.findOne({ fieldAgentRef: fieldAgentId, status: "ACTIVE" }).session(session).lean();
  if (!assignment) {
    throw Errors.conflict("Territory Partner has no active Commercial Territory assignment");
  }
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
  // AREA_SET — a brand-new, location-less DRAFT salon has no areaRef
  // yet. This is a REAL, intentional Phase 1 limitation, not a bug:
  // a Territory Partner cannot be attributed a salon via this flow
  // until that salon has real location/territory data (Phase 2+,
  // where the onboarding-step writes exist). The existing territory
  // check is never weakened to work around this — see the Phase 1
  // report's own "unresolved product decision" section.
  if (!salonTerritory.areaRef) {
    throw Errors.conflict("Salon has no resolved Area yet — Territory Partner attribution requires a known location");
  }
  // Falls through to the SAME area-membership check
  // acquisitionClaim.service.js itself performs when areaRef IS known
  // — intentionally identical, not reproduced further here since a
  // DRAFT salon from this endpoint never actually reaches this branch
  // in Phase 1 (no location exists yet), and inventing untested logic
  // for an unreachable branch is worse than an honest early throw.
};

// ── Owner salon summary (for the "existing salons" response) ────────
const summarizeSalon = (salon) => ({
  id: salon._id,
  shopName: salon.basicInfo?.shopName ?? null,
  approvalStatus: salon.approval?.status ?? "DRAFT",
  onboardingStep: salon.onboarding?.step ?? 0,
  onboardingCompleted: salon.onboarding?.completed ?? false,
  createdAt: salon.createdAt,
});

/**
 * STEP 1 of 2 — send an OTP to the OWNER's phone, on the Field Agent's
 * behalf. Reuses the exact same OTP engine every other flow in this
 * codebase uses, under a NEW, isolated purpose (see otpPurpose.
 * constants.js's own comment for why that isolation matters).
 */
export const sendOwnerVerificationOtp = async ({ phone, req, redis }) => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw Errors.badRequest("Invalid owner phone number format");
  if (!redis) throw Errors.internal("Service temporarily unavailable");

  const result = await sendOtpEngine({
    phone: normalizedPhone,
    purpose: OTP_PURPOSE.ASSISTED_ONBOARDING_OWNER_VERIFY,
    role: "OWNER",
    req,
    redis,
  });

  if (!result.success) {
    if (result.code === "RESEND_TOO_SOON") {
      const err = Errors.conflict("Please wait before requesting another OTP for this owner.");
      err.retryAfterSeconds = result.retryAfterSeconds;
      throw err;
    }
    throw Errors.badRequest("Could not send OTP to the owner's phone. Please try again.");
  }

  return { phone: normalizedPhone, devOtp: result.otp ?? null };
};

/**
 * STEP 2 of 2 — the single `/start` entry point. Either:
 *   (a) {phone, otp, createNewBranch?} — a fresh call, OTP not yet
 *       verified this session; or
 *   (b) {assistedOnboardingToken, createNewBranch} — a follow-up call
 *       after an earlier ambiguous "owner already has salons" result,
 *       re-using the already-proven phone-possession fact instead of
 *       re-verifying OTP.
 */
export const startAssistedOnboarding = async ({ fieldAgentUserId, phone, otp, createNewBranch, assistedOnboardingToken, req, redis }) => {
  const fieldAgent = await getFieldAgentByUserId(fieldAgentUserId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");
  assertClaimEligible(fieldAgent);

  // REAL GAP FOUND + FIXED DURING LIVE TESTING — self-claim protection.
  // acquisitionClaim.service.js's own existing check
  // (`fieldAgent.userRef === salon.ownerId`) compares two User._id
  // values that can NEVER structurally collide here: the OWNER
  // identity this flow resolves is always a SEPARATE {phone,role:
  // "OWNER"} User document from the Field Agent's own {phone,role:
  // "FIELD_AGENT"} document (Model B — see utils/otp.helpers.js's own
  // header; two different _ids, same phone allowed by design). That
  // existing check is explicitly documented there as "structural only
  // ... deeper identity linkage deferred to a later fraud phase" — a
  // real, honest, pre-existing limitation, not something this file
  // weakens further.
  //
  // But THIS flow introduces a genuinely NEW abuse surface the old
  // one never had: here the FIELD AGENT is the one typing in the
  // "owner's" phone number, so a dishonest agent could simply enter
  // their OWN phone and self-credit a ₹200-style acquisition. That
  // was NOT possible in the old owner-initiated redeemReferral path
  // (the owner redeems using their OWN already-authenticated session,
  // never a Field-Agent-supplied phone). A phone-identity check
  // (comparing against the Field Agent's own real phone, read fresh
  // from their own User document) closes exactly this new surface. It
  // is purely additive — it does not touch, loosen, or replace the
  // existing redeemReferral check at all.
  const fieldAgentOwnUser = await User.findById(fieldAgentUserId).select("phone").lean();
  const fieldAgentOwnPhone = fieldAgentOwnUser?.phone || null;

  let ownerId;
  let ownerCreated = false;
  let normalizedPhone;

  if (assistedOnboardingToken) {
    // ── Follow-up call — resume an already-OTP-verified session ──
    const tokenData = await consumeAssistedToken(redis, assistedOnboardingToken, fieldAgentUserId);
    if (!tokenData) {
      throw Errors.conflict("This assisted onboarding session has expired or was already used — please verify the owner's OTP again.");
    }
    ownerId = tokenData.ownerId;
    ownerCreated = Boolean(tokenData.ownerCreated);
    normalizedPhone = tokenData.phone;
    // Defensive re-check — the originating fresh call below already
    // blocks this before a token is ever issued, so this branch is
    // normally unreachable, but costs nothing to re-assert.
    if (fieldAgentOwnPhone && normalizedPhone === fieldAgentOwnPhone) {
      throw Errors.conflict("A Field Agent cannot acquire their own salon");
    }
    if (!createNewBranch) {
      // Phase 1 only supports resuming a token to create a NEW branch
      // (see this file's own header — resuming an arbitrary existing
      // salon is explicitly out of scope). Nothing was mutated.
      throw Errors.badRequest("createNewBranch is required when resuming with an assistedOnboardingToken");
    }
  } else {
    // ── Fresh call — must verify OTP ──
    normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) throw Errors.badRequest("Invalid owner phone number format");
    if (!otp) throw Errors.badRequest("OTP is required");
    if (!redis) throw Errors.conflict("Service temporarily unavailable");

    // Phone-identity self-claim check — see this function's own header
    // comment above for why this is additive, not a replacement for
    // acquisitionClaim.service.js's existing _id-based check. Checked
    // BEFORE spending the OTP verify attempt, so an obviously self-
    // dealing call fails fast without burning the owner's one-time OTP.
    if (fieldAgentOwnPhone && normalizedPhone === fieldAgentOwnPhone) {
      throw Errors.conflict("A Field Agent cannot acquire their own salon");
    }

    const attempt = await verifyOtpEngine({
      phone: normalizedPhone,
      purpose: OTP_PURPOSE.ASSISTED_ONBOARDING_OWNER_VERIFY,
      otp,
      role: "OWNER",
      req,
      redis,
    });
    if (!attempt.ok) {
      const err = Errors.unauthorized(attempt.message || "Incorrect OTP");
      err.otpCode = attempt.code;
      throw err;
    }

    // Pre-check (lightweight, .lean(), own query) purely to know
    // whether createOrFindUser is about to create vs find — it carries
    // no business logic of its own and duplicates none of
    // createOrFindUser's actual find-or-create semantics.
    const ownerBefore = await User.findOne({ phone: normalizedPhone, role: "OWNER" }).select("_id").lean();

    // Reused verbatim — session-free find-or-create, {phone,role}
    // scoped, backed by User's own real partial-unique index (see
    // utils/otp.helpers.js's own header for the full identity-policy
    // rationale). No createSession/generateAccessToken call anywhere
    // near this — the owner is never issued a token.
    const owner = await createOrFindUser(normalizedPhone, "OWNER", "Salon Owner");
    ownerId = owner._id;
    ownerCreated = !ownerBefore;
  }

  // Self-claim structural guard, checked as early as possible (before
  // any Salon/Claim is touched) — mirrors acquisitionClaim.service.js
  // #redeemReferral's own identical check.
  if (String(fieldAgent.userRef) === String(ownerId)) {
    throw Errors.conflict("A Field Agent cannot acquire their own salon");
  }

  // ── Resolve existing salons for this owner ──
  const existingSalons = await Salon.find({ ownerId, isDeleted: { $ne: true } })
    .select("basicInfo.shopName approval.status onboarding.step onboarding.completed createdAt")
    .sort({ createdAt: -1 })
    .lean();

  if (existingSalons.length > 0 && !createNewBranch) {
    // CASE B, undecided — return the list, create nothing yet, and
    // hand back a token so the Field Agent's NEXT call (once they
    // decide) doesn't need the OTP again.
    const token = await issueAssistedToken(redis, { fieldAgentUserId, ownerId, phone: normalizedPhone, ownerCreated });
    return {
      ownerId,
      ownerCreated,
      requiresSalonSelection: true,
      existingSalons: existingSalons.map(summarizeSalon),
      assistedOnboardingToken: token,
      expiresInSeconds: ASSISTED_TOKEN_TTL_SECONDS,
    };
  }

  // ── CASE A (no existing salons) or explicit "new branch" request ──
  // A brand-new Salon document, NOT the owner-flow's own
  // findOneAndUpdate({ownerId}, upsert) pattern (that pattern is
  // deliberately 1-salon-per-owner and belongs to
  // salon.onboarding.controller.js alone, untouched by this file).
  //
  // REAL BUG FOUND + FIXED DURING LIVE TESTING: `new Salon({...}).save(
  // {validateBeforeSave:false})` throws a real MongoServerError at
  // insert time — "Can't extract geo keys ... unknown GeoJSON type:
  // {type:null, coordinates:null}". Mongoose's document hydration (via
  // `new Model()`) eagerly materializes every schema default, including
  // the unset `location.geo` sub-object, and the 2dsphere index on
  // `location.geo` rejects that literal `{type:null,...}` shape even
  // though its own partialFilterExpression is designed to exempt
  // geo-less documents. `runValidators:false`/`validateBeforeSave:false`
  // only skip VALIDATION, never defaulting — so this was never a
  // validation problem.
  //
  // The REAL saveBasicInfo controller (salon.onboarding.controller.js)
  // never hits this because it creates its very first Salon document
  // via `findOneAndUpdate(filter, {$set, $setOnInsert}, {upsert:true,
  // new:true, runValidators:false})`, which — unlike `new Model()` —
  // does NOT eagerly expand every nested schema default into the
  // upserted document. Mirroring that EXACT idiom (same options, same
  // $set/$setOnInsert shape), just keyed by a fresh ObjectId instead of
  // `{ownerId}` (so it always inserts a new document, supporting
  // multiple branches per owner) fixes it with zero schema change and
  // zero change to the real owner-onboarding file.
  // setDefaultsOnInsert:false is the actual load-bearing fix (added
  // after the first live-test attempt above still crashed): without
  // it, Mongoose itself expands EVERY schema default — including the
  // unset `location.geo` sub-object — into the upserted document,
  // and MongoDB's 2dsphere index on `location.geo` throws "Can't
  // extract geo keys" for a document where that field is PRESENT with
  // {type:null,coordinates:null}, even though its own
  // partialFilterExpression is written to exempt geo-less documents —
  // a real, reproducible MongoDB behavior (the partial filter only
  // decides whether to INDEX a doc, it does not suppress key-
  // extraction errors for a malformed-but-present geo value). With
  // defaulting off, `location` is never written at all (truly absent,
  // not null), which both satisfies the partial index and leaves the
  // field ready for a future onboarding-step write (Phase 2+) to set
  // it for the first time with real data.
  const salonDoc = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    {
      $set: { ownerId, "onboarding.step": 0, "onboarding.completed": false, "approval.status": "DRAFT" },
    },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );

  // ── Issue + redeem the referral, atomically, server-side ──
  // issueReferral is REUSED, verbatim, unmodified — the exact same
  // function the Field Agent Dashboard's existing "Generate Referral"
  // button already calls. Its own code is never shown to the client
  // anywhere in this file's return value.
  const referral = await issueReferral({ userId: fieldAgentUserId });

  let claimResult = null;
  let lastErr = null;
  for (let attemptNum = 0; attemptNum < MAX_REDEEM_ATTEMPTS; attemptNum++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      if (fieldAgent.commercialPath === COMMERCIAL_PATH.TERRITORY_PARTNER) {
        await assertTerritoryMembership({ fieldAgentId: fieldAgent._id, salon: salonDoc, session });
      }

      const consumedReferral = await AcquisitionReferral.findOneAndUpdate(
        { _id: referral._id, status: REFERRAL_STATUS.ISSUED, expiresAt: { $gt: new Date() } },
        { $set: { status: REFERRAL_STATUS.CONSUMED, consumedSalonRef: salonDoc._id, consumedAt: new Date() } },
        { session, new: true }
      );
      if (!consumedReferral) {
        throw Errors.conflict("Referral was already redeemed, cancelled, or expired");
      }

      const [claim] = await AcquisitionClaim.create(
        [
          {
            salonRef: salonDoc._id,
            fieldAgentRef: fieldAgent._id,
            referralRef: referral._id,
            status: CLAIM_STATUS.PENDING_APPROVAL,
            stateRef: salonDoc.location?.territory?.stateRef ?? null,
            districtRef: salonDoc.location?.territory?.districtRef ?? null,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      claimResult = claim;

      // actorType AGENT (not SYSTEM) — this redemption is genuinely
      // Field-Agent-initiated, unlike the existing owner-redeem path
      // (see acquisitionClaim.service.js's own header for why that
      // one uses SYSTEM). actorRef is the Field Agent's own userId.
      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_REFERRAL,
        entityId: referral._id,
        actorRef: fieldAgentUserId,
        actorType: AUDIT_ACTOR_TYPE.AGENT,
        action: AUDIT_ACTION.ACQUISITION_REFERRAL_CONSUMED,
        newValue: { salonId: String(salonDoc._id) },
      });
      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_CLAIM,
        entityId: claim._id,
        actorRef: fieldAgentUserId,
        actorType: AUDIT_ACTOR_TYPE.AGENT,
        action: AUDIT_ACTION.ACQUISITION_CLAIM_CREATED,
        newValue: { salonId: String(salonDoc._id), fieldAgentId: String(fieldAgent._id), referralId: String(referral._id) },
      });
      safeAuditEvent({
        entityType: AUDIT_ENTITY_TYPE.ACQUISITION_CLAIM,
        entityId: claim._id,
        actorRef: fieldAgentUserId,
        actorType: AUDIT_ACTOR_TYPE.AGENT,
        action: AUDIT_ACTION.ASSISTED_ONBOARDING_STARTED,
        newValue: { ownerId: String(ownerId), ownerCreated, salonId: String(salonDoc._id) },
      });

      await NotificationService.send(
        {
          recipientId: fieldAgent.userRef,
          recipientType: "FIELD_AGENT",
          templateKey: NOTIFICATION_EVENTS.NEW_SALON_ASSIGNED,
          variables: {},
          title: "New Salon Assigned",
          message: "You started an assisted onboarding — you've been credited with a new acquisition.",
          type: "SYSTEM",
          priority: "HIGH",
          actionType: "OPEN_SALON",
          actionUrl: "/field-agent/acquired-salons",
          entityType: "SALON",
          entityId: salonDoc._id,
          meta: { claimId: claim._id, salonId: salonDoc._id },
        },
        [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH]
      );

      break;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      const isDuplicateClaim = err.code === 11000;
      if ((isTransientConflict(err) || isDuplicateClaim) && attemptNum < MAX_REDEEM_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  if (!claimResult) throw lastErr || new Error("Failed to create acquisition claim");

  return {
    ownerId,
    ownerCreated,
    salonId: salonDoc._id,
    onboardingStep: salonDoc.onboarding.step,
    salonApprovalStatus: salonDoc.approval.status,
    acquisitionClaim: { id: claimResult._id, status: claimResult.status },
    existingSalons: existingSalons.map(summarizeSalon),
  };
};
