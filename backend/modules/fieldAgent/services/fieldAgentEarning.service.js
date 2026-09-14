/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentEarning.service.js
 *
 * FA-9 — the earning engine itself: policy resolution, the atomic
 * acquisition cap, the acquisition->territory transition, and every
 * FieldAgentEarningLedger write. Consumed exclusively by
 * fieldAgentEarning.job.js — no HTTP endpoint ever calls into this
 * file (no Field Agent financial write endpoint exists anywhere).
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): never mutates Booking,
 * AcquisitionClaim, CommercialTerritory, TerritoryAssignment,
 * CommercialPolicyVersion, or Salon. Reads them only. The only
 * documents this file ever writes are AcquisitionEarningProgress and
 * FieldAgentEarningLedger.
 *
 * ═══ POLICY RESOLUTION (FA-9 corrected plan §C) ═══════════════════
 * resolveApplicableCommercialPolicyForBooking resolves geography from
 * salon.location.territory (the authoritative source — never
 * AcquisitionClaim's own denormalized stateRef/districtRef, which that
 * model's own header documents as "admin-listing only, never source of
 * truth"). At most one PUBLISHED CommercialPolicyOverride can ever
 * cover a given salon (enforced at publish time by
 * commercialPolicyOverride.service.js's activation lock), so no
 * precedence ranking is needed if one is found — it simply applies.
 * Boundary semantics: completedAt == publishedAt -> applies (<=);
 * completedAt == retiredAt -> does not apply (exclusive). No policy at
 * all -> returns null (caller must fail closed and retry later).
 *
 * ═══ ATOMIC ACQUISITION CAP (FA-9 Issue 1 correction) ═════════════
 * creditAcquisitionProgressAndLedger runs ONE atomic pipeline
 * findOneAndUpdate that computes and PERSISTS the exact delta this
 * operation applies (lastAppliedDelta) inside the same atomic
 * operation that consumes remaining target capacity — never a
 * separate read-then-write. The ledger row's creditedAmountInPaise is
 * populated only from that persisted delta, and both writes share one
 * transaction, so SUM(ledger) === progress.earnedInPaise is structural,
 * not conventional (see AcquisitionEarningProgress.js's own header).
 *
 * ═══ ACQUISITION -> TERRITORY TRANSITION (FA-9 Issue 2 correction) ═
 * processCompletedBooking attempts ACQUISITION first (if an ACTIVE
 * claim exists); a positive credit STOPS there (no split, ever — the
 * excess above remaining target is simply not credited to anyone from
 * that booking). A ZERO_TARGET_REACHED outcome falls through to
 * Territory Partner evaluation for the SAME booking (a different
 * entitlementType, a different ledger row — not a split of the same
 * money). A ZERO_AGENT_INELIGIBLE outcome (suspended/blocked agent)
 * deliberately does NOT fall through — the acquisition entitlement is
 * still active/not-yet-exhausted, just administratively withheld; the
 * FA-9 Business Decision Lock's mutual-exclusivity rule is tied
 * explicitly to TARGET completion, not to agent status, so this
 * booking's opportunity is simply forfeited rather than redirected.
 * This specific interaction was not covered by an explicit lock — the
 * choice is called out in the implementation report for confirmation.
 *
 * Same-claim booking ordering (never process two bookings of the same
 * AcquisitionClaim concurrently, always ascending completedAt/_id) is
 * enforced by the CALLER (fieldAgentEarning.job.js), not here — this
 * file's functions are safe to call concurrently for DIFFERENT claims,
 * but correctness of "which booking reaches the target" depends on the
 * job's own per-claim serialization.
 */

import mongoose from "mongoose";
import Salon from "../../../models/Salon.js";
import Booking from "../../../models/Booking.js";
import User from "../../../models/User.js";
import FieldAgent from "../models/FieldAgent.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../models/FieldAgentEarningPolicyGap.js";
import CommercialPolicyVersion from "../models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../models/CommercialPolicyOverride.js";
import CommercialTerritory from "../models/CommercialTerritory.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import { CLAIM_STATUS } from "../constants/acquisitionClaim.constants.js";
import { COMMERCIAL_POLICY_STATUS } from "../constants/commercialPolicy.constants.js";
import { POLICY_OVERRIDE_SCOPE_TYPE, POLICY_OVERRIDE_STATUS } from "../constants/commercialPolicyOverride.constants.js";
import { TERRITORY_STATUS, TERRITORY_SCOPE_TYPE, ASSIGNMENT_STATUS } from "../constants/commercialTerritory.constants.js";
import {
  EARNING_ENTITLEMENT_TYPE,
  EARNING_CREDIT_OUTCOME,
  POLICY_SOURCE,
  ACQUISITION_PROGRESS_STATUS,
  MAX_EARNING_TRANSACTION_ATTEMPTS,
  EARNING_TRANSACTION_RETRY_BASE_DELAY_MS,
  GAP_TYPE,
  GAP_STATUS,
} from "../constants/fieldAgentEarning.constants.js";

export const PROCESSING_OUTCOME = Object.freeze({
  CREDITED: "CREDITED",
  ZERO_TARGET_REACHED: "ZERO_TARGET_REACHED",
  ZERO_AGENT_INELIGIBLE: "ZERO_AGENT_INELIGIBLE",
  NO_ENTITLEMENT: "NO_ENTITLEMENT",
  PENDING_POLICY_GAP: "PENDING_POLICY_GAP",
  // FA-9 CORRECTIVE (target snapshot architecture) — an ACTIVE claim
  // exists but has no AcquisitionEarningProgress yet (no policy existed
  // at claim-creation time). Distinct from PENDING_POLICY_GAP: this
  // booking's OWN completedAt may well have a valid policy — the block
  // is specifically "the claim's target was never snapshotted."
  PENDING_CLAIM_PROGRESS_GAP: "PENDING_CLAIM_PROGRESS_GAP",
});

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

// FA-9 Business Decision Lock §14 / corrected plan — the existing
// project-wide rounding standard (CommissionService.js's own
// documented rule: round-half-up to the nearest paisa), reused
// verbatim rather than reinvented.
const roundPaise = (amountInPaise, ratePercent) => Math.round((amountInPaise * ratePercent) / 100);

// ═══════════════════════════════════════════════════════════════════
// POLICY RESOLUTION
// ═══════════════════════════════════════════════════════════════════
export const resolveApplicableCommercialPolicyForBooking = async (salon, completedAt) => {
  const territory = salon?.location?.territory || {};
  const { districtRef, cityRef, areaRef } = territory;

  const geoOr = [];
  if (areaRef) geoOr.push({ scopeType: POLICY_OVERRIDE_SCOPE_TYPE.AREA_SET, areaRefs: areaRef });
  if (cityRef) geoOr.push({ scopeType: POLICY_OVERRIDE_SCOPE_TYPE.CITY, cityRef });
  if (districtRef) geoOr.push({ scopeType: POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT, districtRef });

  if (geoOr.length) {
    const override = await CommercialPolicyOverride.findOne({
      status: POLICY_OVERRIDE_STATUS.PUBLISHED,
      publishedAt: { $lte: completedAt },
      $and: [{ $or: geoOr }, { $or: [{ retiredAt: null }, { retiredAt: { $gt: completedAt } }] }],
    }).lean();
    if (override) {
      return {
        policySource: POLICY_SOURCE.AREA_OVERRIDE,
        policy: override,
      };
    }
  }

  const national = await CommercialPolicyVersion.findOne({
    status: COMMERCIAL_POLICY_STATUS.PUBLISHED,
    publishedAt: { $lte: completedAt },
    $or: [{ retiredAt: null }, { retiredAt: { $gt: completedAt } }],
  }).lean();
  if (national) {
    return { policySource: POLICY_SOURCE.NATIONAL, policy: national };
  }

  return null; // fail closed — caller must retry later, never invent a fallback
};

// ═══════════════════════════════════════════════════════════════════
// DURABLE POLICY-GAP TRACKING (FA-9 CORRECTIVE — Finding A-1)
//
// Decouples "has the discovery checkpoint moved past this booking"
// from "has this booking's entitlement actually been resolved." The
// checkpoint is free to advance past a gapped booking — the gap is
// independently tracked and reprocessed here, so nothing is
// permanently lost merely because the global cursor moved forward.
// ═══════════════════════════════════════════════════════════════════
// session is optional but IMPORTANT when called from inside another
// transaction (e.g. acquisitionClaim.service.js#redeemReferral): a
// gap record referencing a claim that itself gets rolled back (a
// bounded-retry conflict, not just outright failure) must roll back
// together with it — otherwise a retry that creates a NEW claim _id
// would leave a stale, permanently-orphaned gap row pointing at the
// old, rolled-back claim.
const recordOrTouchGap = async ({ gapType, referenceKey, bookingRef, acquisitionClaimRef, salonRef, resolutionInstant, lastErrorCode, session = null }) => {
  await FieldAgentEarningPolicyGap.findOneAndUpdate(
    { referenceKey },
    {
      $setOnInsert: {
        gapType,
        referenceKey,
        bookingRef: bookingRef ?? null,
        acquisitionClaimRef: acquisitionClaimRef ?? null,
        salonRef: salonRef ?? null,
        resolutionInstant,
        status: GAP_STATUS.OPEN,
        firstSeenAt: new Date(),
      },
      $set: { lastAttemptAt: new Date(), lastErrorCode: lastErrorCode ?? null },
      $inc: { attemptCount: 1 },
    },
    session ? { upsert: true, session } : { upsert: true }
  );
};

const resolveGapIfOpen = async (referenceKey, session = null) => {
  await FieldAgentEarningPolicyGap.updateOne(
    { referenceKey, status: GAP_STATUS.OPEN },
    { $set: { status: GAP_STATUS.RESOLVED, resolvedAt: new Date() } },
    session ? { session } : {}
  );
};

// ═══════════════════════════════════════════════════════════════════
// ACQUISITION TARGET SNAPSHOT (FA-9 CORRECTIVE — Finding B-2)
//
// The target is an onboarding/acquisition-level configured number —
// resolved from whichever policy was applicable AT claim.createdAt,
// never at first-booking time, and never re-resolved afterward. Once
// this document exists, its targetInPaise is immutable (no code path
// anywhere ever writes to it again — see AcquisitionEarningProgress.js).
//
// Idempotent by construction: the unique {acquisitionClaimRef} index
// on AcquisitionEarningProgress means a second call for the same claim
// either no-ops (E11000, caught below) or is naturally impossible
// under the calling pattern (see acquisitionClaim.service.js's own
// call site, which only ever calls this once per claim, immediately
// after that claim's own creation).
//
// Returns the created document, or null if no policy was applicable
// at claim.createdAt — never invents a target, never defaults to zero,
// never uses a later/future policy. Always durably records/keeps-open
// the CLAIM_PROGRESS_GAP itself when it returns null, so every caller
// (claim creation, gap reconciliation, historical backfill) shares the
// identical gap-tracking behavior rather than duplicating it.
// ═══════════════════════════════════════════════════════════════════
export const createAcquisitionEarningProgressForClaim = async ({ claim, salon, session = null }) => {
  const resolved = await resolveApplicableCommercialPolicyForBooking(salon, claim.createdAt);
  if (!resolved) {
    await recordOrTouchGap({
      gapType: GAP_TYPE.CLAIM_PROGRESS_GAP,
      referenceKey: `gap:claim:${claim._id}`,
      acquisitionClaimRef: claim._id,
      salonRef: claim.salonRef ?? salon._id,
      resolutionInstant: claim.createdAt,
      lastErrorCode: "NO_POLICY_AT_CLAIM_CREATION",
      session,
    });
    return null;
  }

  try {
    const [progress] = await AcquisitionEarningProgress.create(
      [
        {
          acquisitionClaimRef: claim._id,
          salonRef: claim.salonRef ?? salon._id,
          targetInPaise: resolved.policy.acquisitionEarningTargetInPaise,
          earnedInPaise: 0,
          status: ACQUISITION_PROGRESS_STATUS.IN_PROGRESS,
        },
      ],
      session ? { session } : {}
    );
    await resolveGapIfOpen(`gap:claim:${claim._id}`, session);
    return progress;
  } catch (err) {
    if (err.code === 11000) {
      // Already created by a concurrent/prior attempt — idempotent no-op.
      return AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
    }
    throw err;
  }
};

// ═══════════════════════════════════════════════════════════════════
// TERRITORY PARTNER ELIGIBILITY — resolved AS OF completedAt via
// TerritoryAssignment's own time-bounded history (never the "current"
// currentAssignmentRef pointer, which only reflects live state).
// CommercialTerritory itself has no historical-status record (frozen,
// FA-9 must not add one) — geography-to-territory matching therefore
// necessarily uses CURRENT territory documents; only WHO held the
// assignment is resolved historically. This is the best achievable
// correctness without modifying a frozen model.
// ═══════════════════════════════════════════════════════════════════
export const resolveTerritoryPartnerEligibility = async (salon, completedAt) => {
  const territory = salon?.location?.territory || {};
  const { districtRef, cityRef, areaRef } = territory;

  const geoOr = [];
  if (areaRef) geoOr.push({ scopeType: TERRITORY_SCOPE_TYPE.AREA_SET, areaRefs: areaRef });
  if (cityRef) geoOr.push({ scopeType: TERRITORY_SCOPE_TYPE.CITY, cityRef });
  if (districtRef) geoOr.push({ scopeType: TERRITORY_SCOPE_TYPE.DISTRICT, districtRef });
  if (!geoOr.length) return null;

  const commercialTerritory = await CommercialTerritory.findOne({
    status: TERRITORY_STATUS.ACTIVE,
    $or: geoOr,
  }).lean();
  if (!commercialTerritory) return null;

  const assignment = await TerritoryAssignment.findOne({
    territoryRef: commercialTerritory._id,
    effectiveFrom: { $lte: completedAt },
    $or: [{ effectiveUntil: null }, { effectiveUntil: { $gt: completedAt } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean();
  if (!assignment) return null;

  return { territoryAssignmentRef: assignment._id, fieldAgentRef: assignment.fieldAgentRef };
};

// ═══════════════════════════════════════════════════════════════════
// LEDGER IDEMPOTENCY HELPERS
// ═══════════════════════════════════════════════════════════════════
const findExistingLedgerRow = (idempotencyKey) => FieldAgentEarningLedger.findOne({ idempotencyKey }).lean();

// Simple (non-progress-mutating) ledger write — used for
// ZERO_AGENT_INELIGIBLE and TERRITORY_PARTNER CREDITED rows, where
// there is no shared atomic capacity to protect. Idempotency is
// enforced entirely by the unique index; a race is resolved by
// re-fetching the winner, never by erroring out to the caller.
const writeSimpleLedgerRow = async (fields) => {
  try {
    const [row] = await FieldAgentEarningLedger.create([fields]);
    return row;
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.idempotencyKey) {
      const existing = await findExistingLedgerRow(fields.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }
};

// ═══════════════════════════════════════════════════════════════════
// ATOMIC ACQUISITION CAP (FA-9 Issue 1) — single pipeline
// findOneAndUpdate, delta computed AND persisted in the same op.
// ═══════════════════════════════════════════════════════════════════
// lastAppliedDelta being 0 has TWO distinct causes that must never be
// conflated (a real bug caught by this phase's own dedicated test — a
// zero-commission booking was incorrectly treated as "target already
// reached"): (a) remaining capacity was already 0 BEFORE this op — a
// genuine target-reached case, vs (b) remaining capacity was > 0 but
// rawEligibleAmountInPaise itself was 0 (e.g. a zero-commission
// booking) — a legitimate zero CREDIT, not a target-reached zero.
// lastRemainingBeforeCredit (the pre-image remaining) is persisted
// specifically so the caller can distinguish these two cases.
// FA-9 CORRECTIVE (Finding B-2 / target snapshot architecture): this
// pipeline no longer creates or defaults targetInPaise — the
// AcquisitionEarningProgress document MUST already exist (created
// exclusively by createAcquisitionEarningProgressForClaim, snapshotted
// at claim.createdAt) before any booking can be credited against it.
// The caller (attemptAcquisitionCredit) checks existence first; if
// absent, the booking is durably gapped as PENDING_CLAIM_PROGRESS_GAP
// rather than this pipeline silently inventing a target.
const applyAcquisitionCapPipeline = ({ rawEligibleAmountInPaise }) => [
  {
    $set: {
      lastRemainingBeforeCredit: { $max: [0, { $subtract: ["$targetInPaise", "$earnedInPaise"] }] },
    },
  },
  {
    $set: {
      lastAppliedDelta: { $min: ["$lastRemainingBeforeCredit", rawEligibleAmountInPaise] },
    },
  },
  {
    $set: {
      earnedInPaise: { $add: ["$earnedInPaise", "$lastAppliedDelta"] },
      status: {
        $cond: [
          { $gte: [{ $add: ["$earnedInPaise", "$lastAppliedDelta"] }, "$targetInPaise"] },
          ACQUISITION_PROGRESS_STATUS.TARGET_REACHED,
          ACQUISITION_PROGRESS_STATUS.IN_PROGRESS,
        ],
      },
      lastAppliedAt: "$$NOW",
    },
  },
];

// Runs the atomic progress update + immutable ledger insert in ONE
// transaction. If the ledger insert collides (E11000 — a duplicate or
// retried attempt for this exact booking+entitlementType), the WHOLE
// transaction is aborted, rolling back the progress increment too —
// this is what guarantees SUM(ledger)===progress.earnedInPaise never
// drifts under retries/duplicate workers (FA-9 Issue 1, section I).
const creditAcquisitionProgressAndLedger = async ({ booking, claim, resolved, ratePercent, rawEligibleAmountInPaise, idempotencyKey }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_EARNING_TRANSACTION_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // upsert:false deliberately — the progress document must already
      // exist (created only by createAcquisitionEarningProgressForClaim);
      // this function is never the one that snapshots a target.
      const progress = await AcquisitionEarningProgress.findOneAndUpdate(
        { acquisitionClaimRef: claim._id },
        applyAcquisitionCapPipeline({ rawEligibleAmountInPaise }),
        { new: true, upsert: false, session }
      );
      if (!progress) {
        throw Object.assign(new Error("AcquisitionEarningProgress missing at credit time"), { code: "PROGRESS_MISSING" });
      }

      const creditedAmountInPaise = progress.lastAppliedDelta;
      // ZERO_TARGET_REACHED fires only when capacity was ALREADY
      // exhausted before this operation ran — never merely because
      // this booking's own raw eligible amount happened to be 0 (a
      // zero-commission booking is still a normal CREDITED-zero, not
      // a target-reached event — see applyAcquisitionCapPipeline's
      // own header comment for the defect this fixes).
      const wasAlreadyAtTarget = progress.lastRemainingBeforeCredit <= 0;
      const creditOutcome = wasAlreadyAtTarget ? EARNING_CREDIT_OUTCOME.ZERO_TARGET_REACHED : EARNING_CREDIT_OUTCOME.CREDITED;

      const [row] = await FieldAgentEarningLedger.create(
        [
          {
            bookingRef: booking._id,
            entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION,
            idempotencyKey,
            fieldAgentRef: claim.fieldAgentRef,
            acquisitionClaimRef: claim._id,
            territoryAssignmentRef: null,
            policySource: resolved.policySource,
            policyVersionRef: resolved.policy._id,
            appliedRatePercent: ratePercent,
            bookingCommissionAmountInPaise: booking.commissionAmountInPaise,
            rawEligibleAmountInPaise,
            creditedAmountInPaise,
            creditOutcome,
            bookingCompletedAt: booking.completedAt,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return row;
    } catch (err) {
      await session.abortTransaction();
      if (err.code === 11000 && err.keyPattern?.idempotencyKey) {
        // Already processed by a prior successful transaction — the
        // progress increment from THIS attempt was rolled back
        // together with the rejected insert, so no drift occurred.
        const existing = await findExistingLedgerRow(idempotencyKey);
        if (existing) return existing;
      }
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_EARNING_TRANSACTION_ATTEMPTS - 1) {
        // Jittered backoff — under heavy same-document contention
        // (many bookings for one claim completing around the same
        // time), retrying immediately just re-collides; a small
        // randomized delay, growing with attempt count, spreads
        // retries out instead of causing a retry storm.
        const backoffMs = EARNING_TRANSACTION_RETRY_BASE_DELAY_MS * (attempt + 1) * (0.5 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ═══════════════════════════════════════════════════════════════════
// PER-BOOKING ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════
const isFieldAgentActive = async (fieldAgentRef) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentRef).lean();
  const user = fieldAgent ? await User.findById(fieldAgent.userRef).lean() : null;
  return !!user && user.accountStatus === "ACTIVE";
};

const attemptAcquisitionCredit = async ({ booking, claim, resolved }) => {
  const idempotencyKey = `earning:${booking._id}:${EARNING_ENTITLEMENT_TYPE.ACQUISITION}`;
  const existing = await findExistingLedgerRow(idempotencyKey);
  if (existing) {
    return {
      outcome: existing.creditOutcome,
      creditedAmountInPaise: existing.creditedAmountInPaise,
      fallThrough: existing.creditOutcome === EARNING_CREDIT_OUTCOME.ZERO_TARGET_REACHED,
    };
  }

  // FA-9 CORRECTIVE (Finding B-2) — the target must already have been
  // snapshotted at claim-creation time (createAcquisitionEarningProgressForClaim).
  // If it hasn't (no policy existed when the claim was created), this
  // booking cannot be safely evaluated for acquisition at all — durably
  // gap it rather than inventing/defaulting a target.
  const progressExists = await AcquisitionEarningProgress.exists({ acquisitionClaimRef: claim._id });
  if (!progressExists) {
    await recordOrTouchGap({
      gapType: GAP_TYPE.CLAIM_PROGRESS_GAP,
      referenceKey: `gap:claim:${claim._id}`,
      acquisitionClaimRef: claim._id,
      salonRef: claim.salonRef,
      resolutionInstant: claim.createdAt,
      lastErrorCode: "NO_POLICY_AT_CLAIM_CREATION",
    });
    return { outcome: PROCESSING_OUTCOME.PENDING_CLAIM_PROGRESS_GAP, creditedAmountInPaise: 0, fallThrough: false };
  }

  const ratePercent = resolved.policy.acquisitionAgentCommissionPercent;
  const rawEligibleAmountInPaise = roundPaise(booking.commissionAmountInPaise, ratePercent);

  const isAgentActive = await isFieldAgentActive(claim.fieldAgentRef);

  if (!isAgentActive) {
    const row = await writeSimpleLedgerRow({
      bookingRef: booking._id,
      entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION,
      idempotencyKey,
      fieldAgentRef: claim.fieldAgentRef,
      acquisitionClaimRef: claim._id,
      territoryAssignmentRef: null,
      policySource: resolved.policySource,
      policyVersionRef: resolved.policy._id,
      appliedRatePercent: ratePercent,
      bookingCommissionAmountInPaise: booking.commissionAmountInPaise,
      rawEligibleAmountInPaise,
      creditedAmountInPaise: 0,
      creditOutcome: EARNING_CREDIT_OUTCOME.ZERO_AGENT_INELIGIBLE,
      bookingCompletedAt: booking.completedAt,
    });
    // Deliberately fallThrough:false — see file header on why
    // suspension does not hand this booking to Territory Partner.
    return { outcome: row.creditOutcome, creditedAmountInPaise: row.creditedAmountInPaise, fallThrough: false };
  }

  const row = await creditAcquisitionProgressAndLedger({ booking, claim, resolved, ratePercent, rawEligibleAmountInPaise, idempotencyKey });
  return {
    outcome: row.creditOutcome,
    creditedAmountInPaise: row.creditedAmountInPaise,
    fallThrough: row.creditOutcome === EARNING_CREDIT_OUTCOME.ZERO_TARGET_REACHED,
  };
};

const attemptTerritoryPartnerCredit = async ({ booking, salon, resolved }) => {
  const idempotencyKey = `earning:${booking._id}:${EARNING_ENTITLEMENT_TYPE.TERRITORY_PARTNER}`;
  const existing = await findExistingLedgerRow(idempotencyKey);
  if (existing) {
    return { outcome: existing.creditOutcome, creditedAmountInPaise: existing.creditedAmountInPaise };
  }

  const eligibility = await resolveTerritoryPartnerEligibility(salon, booking.completedAt);
  if (!eligibility) {
    return { outcome: PROCESSING_OUTCOME.NO_ENTITLEMENT, creditedAmountInPaise: 0 };
  }

  const ratePercent = resolved.policy.territoryPartnerCommissionPercent;
  const rawEligibleAmountInPaise = roundPaise(booking.commissionAmountInPaise, ratePercent);

  // FA-9 CORRECTIVE (Finding B-1) — the exact same security principle
  // already applied to Acquisition: a suspended/blocked Territory
  // Partner receives no new credit. Checked AFTER eligibility/rate
  // resolution (so the ledger row still records what WOULD have
  // applied) but BEFORE any write — never falls through to another
  // agent, never touches wallet/progress (Territory Partner has no
  // capped-progress document to begin with).
  const isPartnerActive = await isFieldAgentActive(eligibility.fieldAgentRef);
  const creditedAmountInPaise = isPartnerActive ? rawEligibleAmountInPaise : 0;
  const creditOutcome = isPartnerActive ? EARNING_CREDIT_OUTCOME.CREDITED : EARNING_CREDIT_OUTCOME.ZERO_AGENT_INELIGIBLE;

  const row = await writeSimpleLedgerRow({
    bookingRef: booking._id,
    entitlementType: EARNING_ENTITLEMENT_TYPE.TERRITORY_PARTNER,
    idempotencyKey,
    fieldAgentRef: eligibility.fieldAgentRef,
    acquisitionClaimRef: null,
    territoryAssignmentRef: eligibility.territoryAssignmentRef,
    policySource: resolved.policySource,
    policyVersionRef: resolved.policy._id,
    appliedRatePercent: ratePercent,
    bookingCommissionAmountInPaise: booking.commissionAmountInPaise,
    rawEligibleAmountInPaise,
    creditedAmountInPaise,
    creditOutcome,
    bookingCompletedAt: booking.completedAt,
  });
  return { outcome: row.creditOutcome, creditedAmountInPaise: row.creditedAmountInPaise };
};

// Entry point — one completed Booking document (full Mongoose doc or
// lean object with at least _id/salonRef/commissionAmountInPaise/completedAt).
export const processCompletedBooking = async (booking) => {
  const salon = await Salon.findById(booking.salonRef).lean();
  if (!salon) {
    // Defensive only — Salon is soft-deleted (isDeleted), never hard
    // deleted, so this should not occur in practice (FA-9 locked rule:
    // deleted/inactive salons remain processable).
    return { outcome: PROCESSING_OUTCOME.NO_ENTITLEMENT };
  }

  const resolved = await resolveApplicableCommercialPolicyForBooking(salon, booking.completedAt);
  if (!resolved) {
    // FA-9 CORRECTIVE (Finding A-1) — durably record the gap so it can
    // be independently reprocessed once a policy is published, fully
    // decoupled from wherever the discovery checkpoint has moved to.
    await recordOrTouchGap({
      gapType: GAP_TYPE.BOOKING_POLICY_GAP,
      referenceKey: `gap:booking:${booking._id}`,
      bookingRef: booking._id,
      salonRef: booking.salonRef,
      resolutionInstant: booking.completedAt,
      lastErrorCode: "NO_NATIONAL_OR_OVERRIDE_POLICY",
    });
    return { outcome: PROCESSING_OUTCOME.PENDING_POLICY_GAP };
  }
  await resolveGapIfOpen(`gap:booking:${booking._id}`);

  const activeClaim = await AcquisitionClaim.findOne({
    salonRef: booking.salonRef,
    status: CLAIM_STATUS.ACTIVE,
  }).lean();

  if (activeClaim) {
    const acquisitionResult = await attemptAcquisitionCredit({ booking, claim: activeClaim, resolved });
    if (acquisitionResult.creditedAmountInPaise > 0) {
      return acquisitionResult; // positive acquisition credit — stop, no split, no territory evaluation
    }
    if (!acquisitionResult.fallThrough) {
      return acquisitionResult; // ZERO_AGENT_INELIGIBLE — forfeited, no territory fallback
    }
    // ZERO_TARGET_REACHED — this booking is "subsequent" to target completion
  }

  return attemptTerritoryPartnerCredit({ booking, salon, resolved });
};

// ═══════════════════════════════════════════════════════════════════
// GAP RECONCILIATION (FA-9 CORRECTIVE — Finding A-1)
//
// Independently reprocesses OPEN gaps, fully decoupled from the main
// discovery checkpoint's position. Called by fieldAgentEarning.job.js
// in small bounded batches every tick. Reprocessing always reuses the
// SAME deterministic idempotency key / referenceKey — a gap that
// resolves successfully can never produce a duplicate ledger row or a
// second AcquisitionEarningProgress document.
// ═══════════════════════════════════════════════════════════════════
export const reprocessOneGap = async (gap) => {
  if (gap.gapType === GAP_TYPE.BOOKING_POLICY_GAP) {
    const booking = await Booking.findById(gap.bookingRef).select("_id salonRef commissionAmountInPaise completedAt").lean();
    if (!booking) {
      // Booking no longer exists (should not happen — Booking is never
      // hard-deleted) — mark resolved to stop retrying a dead reference.
      await resolveGapIfOpen(gap.referenceKey);
      return { reprocessed: true, outcome: "BOOKING_GONE" };
    }
    const outcome = await processCompletedBooking(booking);
    // processCompletedBooking itself calls resolveGapIfOpen when the
    // policy now resolves — nothing further needed here either way.
    return { reprocessed: true, outcome: outcome.outcome };
  }

  if (gap.gapType === GAP_TYPE.CLAIM_PROGRESS_GAP) {
    const claim = await AcquisitionClaim.findById(gap.acquisitionClaimRef).lean();
    if (!claim) {
      await resolveGapIfOpen(gap.referenceKey);
      return { reprocessed: true, outcome: "CLAIM_GONE" };
    }
    const salon = await Salon.findById(claim.salonRef).lean();
    if (!salon) {
      return { reprocessed: false, outcome: "SALON_MISSING" };
    }
    const progress = await createAcquisitionEarningProgressForClaim({ claim, salon });
    // createAcquisitionEarningProgressForClaim itself calls
    // resolveGapIfOpen on success, and re-touches the OPEN gap (bumping
    // attemptCount/lastAttemptAt) on continued failure — on continued
    // absence of a policy at claim.createdAt it returns null and the
    // gap stays OPEN; this can be a PERMANENT state if no policy ever
    // existed as of that historical instant (see final report).
    if (!progress) {
      return { reprocessed: false, outcome: "STILL_NO_POLICY_AT_CLAIM_CREATION" };
    }
    return { reprocessed: true, outcome: "PROGRESS_CREATED" };
  }

  return { reprocessed: false, outcome: "UNKNOWN_GAP_TYPE" };
};

export const listOpenGaps = (limit) =>
  FieldAgentEarningPolicyGap.find({ status: GAP_STATUS.OPEN }).sort({ lastAttemptAt: 1 }).limit(limit).lean();

// ═══════════════════════════════════════════════════════════════════
// ONE-TIME HISTORICAL BACKFILL (FA-9 CORRECTIVE — real production
// recovery for the checkpoint that already advanced past real
// bookings before this gap-tracking mechanism existed).
//
// Read-only discovery + gap-registration ONLY — never creates a
// ledger row, never touches AcquisitionEarningProgress, never credits
// anything. Bounded, looped batches (never one unbounded query).
// Idempotent: re-running this after it has already run is always safe
// (recordOrTouchGap upserts by referenceKey; a booking that already
// has a ledger row of either entitlement type is skipped entirely).
//
// sinceCompletedAt is optional and exists specifically so a verification
// script can scope this to a narrow fixture-only window — omitting it
// scans the FULL history up to upToCompletedAt, which is exactly what
// the real one-time production repair needs but a test never should.
// ═══════════════════════════════════════════════════════════════════
export const backfillHistoricalBookingGaps = async ({ upToCompletedAt, sinceCompletedAt = null, batchSize = 500 }) => {
  let lastId = new mongoose.Types.ObjectId("000000000000000000000000");
  let scanned = 0;
  let gapsRecorded = 0;

  for (;;) {
    const batch = await Booking.find({
      status: "COMPLETED",
      completedAt: sinceCompletedAt ? { $lte: upToCompletedAt, $gte: sinceCompletedAt } : { $lte: upToCompletedAt },
      _id: { $gt: lastId },
    })
      .select("_id salonRef completedAt")
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!batch.length) break;

    for (const booking of batch) {
      scanned++;
      const hasAnyLedgerRow = await FieldAgentEarningLedger.exists({ bookingRef: booking._id });
      if (hasAnyLedgerRow) continue; // already legitimately resolved — not a gap

      const existingGap = await FieldAgentEarningPolicyGap.exists({ referenceKey: `gap:booking:${booking._id}` });
      if (existingGap) continue; // already tracked

      // Deliberately NO pre-filter on "did this salon ever have a
      // claim" — a booking could still be Territory-Partner-eligible
      // via geography alone with no AcquisitionClaim ever existing, so
      // filtering on claim-existence would silently drop real
      // Territory Partner gaps. This one-time backfill accepts the
      // cost of tracking bookings that ultimately resolve to
      // NO_ENTITLEMENT (harmless — resolveGapIfOpen still marks them
      // RESOLVED once a policy exists) in exchange for never missing a
      // real entitlement.
      await recordOrTouchGap({
        gapType: GAP_TYPE.BOOKING_POLICY_GAP,
        referenceKey: `gap:booking:${booking._id}`,
        bookingRef: booking._id,
        salonRef: booking.salonRef,
        resolutionInstant: booking.completedAt,
        lastErrorCode: "BACKFILLED_PRE_GAP_TRACKING",
      });
      gapsRecorded++;
    }

    lastId = batch[batch.length - 1]._id;
    if (batch.length < batchSize) break;
  }

  return { scanned, gapsRecorded };
};

// Companion one-time backfill: any pre-existing AcquisitionClaim with
// no AcquisitionEarningProgress yet (created before this corrective
// round existed) is durably gapped the same way. Read-only + gap
// registration only — never creates a progress record itself (that
// only ever happens via createAcquisitionEarningProgressForClaim,
// called by reprocessOneGap on the next reconciliation pass).
export const backfillHistoricalClaimProgressGaps = async ({ batchSize = 500 }) => {
  let lastId = new mongoose.Types.ObjectId("000000000000000000000000");
  let scanned = 0;
  let gapsRecorded = 0;

  for (;;) {
    const batch = await AcquisitionClaim.find({ _id: { $gt: lastId } })
      .select("_id salonRef createdAt")
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!batch.length) break;

    for (const claim of batch) {
      scanned++;
      const hasProgress = await AcquisitionEarningProgress.exists({ acquisitionClaimRef: claim._id });
      if (hasProgress) continue;

      const existingGap = await FieldAgentEarningPolicyGap.exists({ referenceKey: `gap:claim:${claim._id}` });
      if (existingGap) continue;

      await recordOrTouchGap({
        gapType: GAP_TYPE.CLAIM_PROGRESS_GAP,
        referenceKey: `gap:claim:${claim._id}`,
        acquisitionClaimRef: claim._id,
        salonRef: claim.salonRef,
        resolutionInstant: claim.createdAt,
        lastErrorCode: "BACKFILLED_PRE_GAP_TRACKING",
      });
      gapsRecorded++;
    }

    lastId = batch[batch.length - 1]._id;
    if (batch.length < batchSize) break;
  }

  return { scanned, gapsRecorded };
};
