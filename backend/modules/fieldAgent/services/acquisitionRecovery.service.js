/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/acquisitionRecovery.service.js
 *
 * FA-P3-B Step 2 — Field-Agent-facing Recovery Dashboard, READ ONLY.
 * A genuinely NEW, additive file — deliberately NOT added to either
 * acquisitionClaim.service.js (whose own header locks it to "never
 * reads Booking/ledger, never computes an incentive amount") or
 * fieldAgentEarning.service.js (whose own header locks it to "consumed
 * exclusively by fieldAgentEarning.job.js — no HTTP endpoint ever
 * calls into this file"). This file only ever READS AcquisitionClaim,
 * AcquisitionEarningProgress, and FieldAgentEarningLedger, and reuses
 * fieldAgentPayout.service.js's own computeAvailableBalance() rather
 * than reimplementing it. No model here is ever written to. No
 * Cashfree, no wallet debit, no payout creation.
 *
 * TERMINOLOGY (this phase's own interpretation — the ticket did not
 * define these two dashboard figures precisely, so they are
 * documented explicitly here for correction if wrong):
 *  - availablePayout: the agent's current withdrawable balance —
 *    IDENTICAL to computeAvailableBalance(fieldAgentRef).availableInPaise,
 *    the same figure already shown at GET /field-agent/payouts/balance.
 *    Not recomputed independently.
 *  - zemishPending: SUM(targetInPaise - earnedInPaise) across every
 *    AcquisitionEarningProgress still IN_PROGRESS for this agent — the
 *    total acquisition-incentive amount still to be earned from future
 *    completed bookings before recovery finishes on those claims.
 *  - remainingAmount (per claim): targetInPaise - earnedInPaise for
 *    that claim's own AcquisitionEarningProgress — DERIVED on every
 *    read, never stored on any model.
 */

import { Errors } from "../../../utils/response.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";
import { computeAvailableBalance } from "./fieldAgentPayout.service.js";
import { CLAIM_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";
import { ACQUISITION_PROGRESS_STATUS, EARNING_ENTITLEMENT_TYPE } from "../constants/fieldAgentEarning.constants.js";

const SALON_POPULATE_FIELDS = "basicInfo.shopName location.address";

const requireMyFieldAgent = async (userId) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");
  return fieldAgent;
};

const progressPercentOf = (progress) => {
  if (!progress || !progress.targetInPaise) return 0;
  const pct = (progress.earnedInPaise / progress.targetInPaise) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
};

// ─── GET /acquisition/dashboard ─────────────────────────────────────
export const getMyAcquisitionDashboard = async ({ userId }) => {
  const fieldAgent = await requireMyFieldAgent(userId);

  const [pendingApprovalCount, balance, claimIds] = await Promise.all([
    AcquisitionClaim.countDocuments({ fieldAgentRef: fieldAgent._id, status: CLAIM_STATUS.PENDING_APPROVAL }),
    computeAvailableBalance(fieldAgent._id),
    AcquisitionClaim.distinct("_id", { fieldAgentRef: fieldAgent._id }),
  ]);

  // FA-P4-B Step 3 — Active Recovery / Completed are counted from
  // AcquisitionEarningProgress.status, the real recovery state. The
  // previous claim.status counts were wrong: no code ever moves a claim
  // to CLAIM_STATUS.COMPLETED, so Completed read 0 forever, and a claim
  // whose target was reached stayed ACTIVE_RECOVERY.
  const [activeRecoveryCount, completedCount] = await Promise.all([
    AcquisitionEarningProgress.countDocuments({
      acquisitionClaimRef: { $in: claimIds },
      status: ACQUISITION_PROGRESS_STATUS.IN_PROGRESS,
    }),
    AcquisitionEarningProgress.countDocuments({
      acquisitionClaimRef: { $in: claimIds },
      status: ACQUISITION_PROGRESS_STATUS.TARGET_REACHED,
    }),
  ]);

  const [zemishPendingAgg] = await AcquisitionEarningProgress.aggregate([
    { $match: { acquisitionClaimRef: { $in: claimIds }, status: ACQUISITION_PROGRESS_STATUS.IN_PROGRESS } },
    { $group: { _id: null, total: { $sum: { $subtract: ["$targetInPaise", "$earnedInPaise"] } } } },
  ]);

  return {
    availablePayout: balance.availableInPaise,
    zemishPending: zemishPendingAgg?.total || 0,
    pendingApprovalCount,
    activeRecoveryCount,
    completedCount,
  };
};

// ─── GET /acquisition/recovery?status=&page=&limit= ─────────────────
export const listMyAcquisitionRecovery = async ({ userId, status, page, limit }) => {
  const fieldAgent = await requireMyFieldAgent(userId);
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, limit || DEFAULT_LIST_LIMIT));

  const filter = { fieldAgentRef: fieldAgent._id };
  if (status === "COMPLETED" || status === CLAIM_STATUS.ACTIVE_RECOVERY) {
    // FA-P4-B Step 3 — keep these two tabs consistent with the dashboard
    // counts: "completed" means AcquisitionEarningProgress.TARGET_REACHED
    // (no claim ever reaches CLAIM_STATUS.COMPLETED), and a claim that
    // reached its target no longer belongs under Active.
    const myClaimIds = await AcquisitionClaim.distinct("_id", { fieldAgentRef: fieldAgent._id });
    const reachedIds = await AcquisitionEarningProgress.distinct("acquisitionClaimRef", {
      acquisitionClaimRef: { $in: myClaimIds },
      status: ACQUISITION_PROGRESS_STATUS.TARGET_REACHED,
    });
    if (status === "COMPLETED") {
      filter._id = { $in: reachedIds };
    } else {
      filter.status = CLAIM_STATUS.ACTIVE_RECOVERY;
      filter._id = { $nin: reachedIds };
    }
  } else if (status) {
    filter.status = status;
  }

  const [claims, total] = await Promise.all([
    AcquisitionClaim.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("salonRef", SALON_POPULATE_FIELDS)
      .lean(),
    AcquisitionClaim.countDocuments(filter),
  ]);

  const claimIds = claims.map((c) => c._id);
  const progressRows = await AcquisitionEarningProgress.find({ acquisitionClaimRef: { $in: claimIds } }).lean();
  const progressByClaimId = new Map(progressRows.map((p) => [String(p.acquisitionClaimRef), p]));

  const items = claims.map((claim) => {
    const progress = progressByClaimId.get(String(claim._id)) || null;
    const targetAmount = progress?.targetInPaise ?? 0;
    const recoveredAmount = progress?.earnedInPaise ?? 0;
    const reached = progress?.status === ACQUISITION_PROGRESS_STATUS.TARGET_REACHED;
    return {
      claimId: claim._id,
      status: reached ? "COMPLETED" : claim.status, // display status derived from progress
      salon: claim.salonRef || null,
      createdAt: claim.createdAt,
      targetAmount,
      recoveredAmount,
      remainingAmount: Math.max(0, targetAmount - recoveredAmount), // derived, never stored
      progressPercent: progressPercentOf(progress),
    };
  });

  return { items, total, page: safePage, limit: safeLimit };
};

// ─── GET /acquisition/recovery/:claimId ─────────────────────────────
export const getMyAcquisitionRecoveryDetail = async ({ userId, claimId }) => {
  const fieldAgent = await requireMyFieldAgent(userId);

  // Scoped to the caller's own FieldAgent — same "404, no leak" idiom
  // as withdrawMyClaim/cancelMyReferral for another agent's resource.
  const claim = await AcquisitionClaim.findOne({ _id: claimId, fieldAgentRef: fieldAgent._id })
    .populate("salonRef", SALON_POPULATE_FIELDS)
    .lean();
  if (!claim) throw Errors.notFound("Acquisition claim not found");

  const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
  const targetAmount = progress?.targetInPaise ?? 0;
  const recoveredAmount = progress?.earnedInPaise ?? 0;

  const bookingRecoveryLedger = await FieldAgentEarningLedger.find({
    acquisitionClaimRef: claim._id,
    entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION,
  })
    .sort({ bookingCompletedAt: 1 })
    .select("bookingRef creditedAmountInPaise creditOutcome bookingCompletedAt createdAt")
    .lean();

  return {
    salon: claim.salonRef || null,
    status: claim.status,
    targetAmount,
    recoveredAmount,
    remainingAmount: Math.max(0, targetAmount - recoveredAmount), // derived, never stored
    progressPercent: progressPercentOf(progress),
    bookingRecoveryLedger,
  };
};
