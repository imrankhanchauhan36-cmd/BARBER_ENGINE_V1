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
 * AcquisitionEarningProgress, FieldAgentEarningLedger, and (as of the
 * 2026-10-01 "Acquisition Booking/Commission Aggregation" phase, READ
 * ONLY, two fields) Booking — and reuses fieldAgentPayout.service.js's
 * own computeAvailableBalance() rather than reimplementing it. No
 * model here is ever written to, including Booking. No Cashfree, no
 * wallet debit, no payout creation.
 *
 * BOOKING READ SCOPE (narrow, deliberate): the only Booking field ever
 * read here is `totalAmountInPaise` (the authoritative gross booking
 * value — see models/Booking.js's own header), and only for the exact
 * `bookingRef`s already identified as qualifying by a prior
 * FieldAgentEarningLedger aggregation — this file never independently
 * queries/infers which bookings are "qualifying"; that determination
 * is made exclusively by the existing earning engine's own ledger rows
 * (consistent with fieldAgentEarning.service.js's own locked
 * boundary). No Booking field beyond `totalAmountInPaise` is ever
 * selected — never `userId`/customer/payment-instrument fields, never
 * populated, never joined to User.
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
// PHASE 11G-FINAL — "Approved Salon Gate" (2026-10-02). READ ONLY,
// one field (approval.status) — see listMyAcquisitionRecovery's own
// header for the full rationale. Never written to by this file.
import Salon from "../../../models/Salon.js";
// Phase 2 — "Acquisition Booking/Commission Aggregation" (2026-10-01).
// READ ONLY, one field (totalAmountInPaise) — see this file's own
// header for the full scope/privacy rationale.
import Booking from "../../../models/Booking.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";
import { computeAvailableBalance } from "./fieldAgentPayout.service.js";
import { CLAIM_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";
import { ACQUISITION_PROGRESS_STATUS, EARNING_ENTITLEMENT_TYPE } from "../constants/fieldAgentEarning.constants.js";

// UPDATED 2026-10-01 — "My Acquired Salons Owner Grouping" fix.
// Minimal, additive, read-only projection change: the frontend needs
// ownerId (to group claims by owner) and the owner's phone/name (for
// the group header) — neither was previously selected. Nothing else
// about this query changes: same filter, same pagination, same sort,
// same claim/progress logic. Salon.ownerId already exists on the
// frozen Salon schema (ref: "User", required: true) — this only adds
// a second, nested populate hop to read it, exactly like every other
// read-only populate already in this file.
// UPDATED again 2026-10-01 — "Field Agent Salon Delete" feature. Also
// adds approval.status: the frontend's Delete action must decide
// eligibility from the server's own real-time salon status (never
// guessed/derived client-side — this endpoint is the only place the
// Recovery screen reads salon state from), and that field genuinely
// was not selected before now either. Same additive-only discipline
// as the ownerId addition above: no filter/pagination/sort change.
const SALON_POPULATE_OPTIONS = {
  path: "salonRef",
  select: "basicInfo.shopName location.address ownerId approval.status",
  populate: { path: "ownerId", select: "phone name" },
};

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
//
// PHASE 11G — "Fix My Acquired Salons Visibility" (2026-10-02,
// implementing Option 2 of the approved audit). This endpoint is now
// EXCLUSIVELY an acquisition-RECOVERY view — never an application/
// onboarding view. That is listMyApplications's own, separate,
// completely unchanged responsibility (Salon.approval.status-driven:
// DRAFT/PENDING/APPROVED/REJECTED). A claim still sitting at
// PENDING_APPROVAL (including one attached to a salon abandoned
// mid-onboarding, never submitted — the exact live case the audit
// found) represents an APPLICATION, not yet an ACQUISITION, and must
// never appear here.
//
// The base filter below is UNCONDITIONALLY restricted to
// `status: CLAIM_STATUS.ACTIVE_RECOVERY` — regardless of whatever
// `status` query value a caller supplies. This is the actual server-
// side enforcement the approved audit asked for ("do not use
// frontend filtering as the primary security/business control"): the
// frontend's own tabs are cosmetic on top of this, never the control
// itself. PENDING_APPROVAL and ENDED claims are structurally
// impossible to return from this function now, for any `status`
// value, including an unrecognized or malicious one.
//
// Nothing here deletes, ends, or mutates any claim — an abandoned
// PENDING_APPROVAL claim remains exactly as-is in the database for
// audit/attribution history; it simply never appears in THIS read.
// fieldAgentRef isolation, pagination, sorting, salon population
// (owner-grouping data included), and the recovery-progress/₹200
// target computation below are all otherwise byte-for-byte unchanged
// from before this phase.
//
// PHASE 11G-FINAL — "Approved Salon Gate" (2026-10-02). The Phase
// 11G-Followup audit proved, from the actual code (not assumed),
// that AcquisitionClaim.status === ACTIVE_RECOVERY is NOT by itself
// sufficient evidence the Salon has passed its own, completely
// separate approval workflow — adminApproveClaim() only ever checks
// claim.status, never Salon.approval.status, so a claim can
// structurally reach ACTIVE_RECOVERY while its salon is still DRAFT/
// PENDING/REJECTED. "My Acquired Salons" must require BOTH an
// ACTIVE_RECOVERY claim AND an APPROVED salon. This is a READ-SIDE
// filter only — adminApproveClaim(), the Salon approval workflow, and
// everything else named in this phase's own "Do NOT change" list are
// completely untouched; a claim that fails this new gate is not
// ended, not mutated, simply not returned by this one read.
export const listMyAcquisitionRecovery = async ({ userId, status, page, limit }) => {
  const fieldAgent = await requireMyFieldAgent(userId);
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, limit || DEFAULT_LIST_LIMIT));

  // Step 1 — every ACTIVE_RECOVERY claim this agent holds, with just
  // enough fields to resolve the next step (same "resolve IDs first,
  // then intersect" idiom this file already used for the reached/
  // not-reached split below).
  const myActiveClaims = await AcquisitionClaim.find({
    fieldAgentRef: fieldAgent._id,
    status: CLAIM_STATUS.ACTIVE_RECOVERY,
  }).select("_id salonRef").lean();

  // Step 2 — of THOSE claims' salons, which are actually APPROVED.
  // This is the new gate: an ACTIVE_RECOVERY claim whose salon never
  // passed its own separate approval workflow is excluded here, never
  // further downstream, and never by mutating the claim itself.
  const approvedSalonIds = new Set(
    (await Salon.distinct("_id", {
      _id: { $in: myActiveClaims.map((c) => c.salonRef) },
      "approval.status": "APPROVED",
    })).map(String)
  );
  const eligibleClaimIds = myActiveClaims
    .filter((c) => approvedSalonIds.has(String(c.salonRef)))
    .map((c) => c._id);

  // Step 3 — FA-P4-B Step 3's own established split, preserved
  // verbatim, now scoped to the already-gated eligible set: "completed"
  // means AcquisitionEarningProgress.TARGET_REACHED (no claim ever
  // transitions to a literal CLAIM_STATUS.COMPLETED value — it stays
  // ACTIVE_RECOVERY at the DB level even after its target is reached),
  // and a claim that reached its target no longer belongs under the
  // "still actively recovering" bucket.
  const reachedIds = await AcquisitionEarningProgress.distinct("acquisitionClaimRef", {
    acquisitionClaimRef: { $in: eligibleClaimIds },
    status: ACQUISITION_PROGRESS_STATUS.TARGET_REACHED,
  });
  const reachedIdSet = new Set(reachedIds.map(String));
  const notReachedIds = eligibleClaimIds.filter((id) => !reachedIdSet.has(String(id)));

  const filter = { fieldAgentRef: fieldAgent._id, status: CLAIM_STATUS.ACTIVE_RECOVERY };
  if (status === "COMPLETED") {
    filter._id = { $in: reachedIds };
  } else {
    // Default bucket — covers status === CLAIM_STATUS.ACTIVE_RECOVERY,
    // an omitted status, AND any disallowed/unrecognized value
    // (including a stale client still sending "PENDING_APPROVAL") —
    // all resolve to the one correct "still actively recovering,
    // salon-approved" result set, never an error, never the
    // disallowed data.
    filter._id = { $in: notReachedIds };
  }

  const [claims, total] = await Promise.all([
    AcquisitionClaim.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate(SALON_POPULATE_OPTIONS)
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

// ─── BOOKING/COMMISSION AGGREGATION (Phase 2, 2026-10-01) ────────────
// Claim-scoped, read-only. "Qualifying booking" is deliberately NOT
// redefined here — it is exactly "any FieldAgentEarningLedger row with
// entitlementType:ACQUISITION for this claim," full stop, regardless
// of creditOutcome. This is the existing earning engine's own
// authoritative record of which COMPLETED bookings it actually
// evaluated against this claim (CREDITED, ZERO_TARGET_REACHED, and
// ZERO_AGENT_INELIGIBLE all represent a real, evaluated, qualifying
// booking — only the credited AMOUNT differs, never the "did this
// booking count" question). In particular, ZERO_TARGET_REACHED rows
// (written after the ₹200 cap is already full) are deliberately
// INCLUDED in count/booking-value/commission — excluding them would
// make a Field Agent's own transaction history look shorter than it
// actually is, even though their earning from those rows is
// correctly ₹0.
//
// fieldAgentEarningInPaise is SUM(ledger.creditedAmountInPaise) — the
// engine's own already-capped, already-persisted actual credit. This
// is NEVER recomputed as commission×rate here (that would risk
// showing a theoretical figure above the real ₹200 cap) — by the
// codebase's own structural invariant (AcquisitionEarningProgress.js's
// header: "SUM(ledger.creditedAmountInPaise) === earnedInPaise"),
// this sum is mathematically guaranteed to equal `recoveredAmount`
// above, which remains the single authoritative progress figure,
// never redefined or replaced.
//
// totalBookingValueInPaise is the ONE figure the ledger itself cannot
// supply (it only ever stored the commission portion, never the full
// booking total) — bounded strictly to the exact bookingRefs already
// identified as qualifying by the aggregation above, via Booking's
// own authoritative `totalAmountInPaise` field (models/Booking.js's
// own header: "the authoritative amount used by finance engine").
// Still zero customer exposure: only `_id`/`totalAmountInPaise` are
// ever touched on Booking, no populate, no join.
//
// Indexing: FieldAgentEarningLedger already has a sparse
// {acquisitionClaimRef:1, createdAt:-1} index (see that model's own
// index list) — the $match below is claim-scoped and uses it; no new
// index added or needed (confirmed: per-claim ledger rows are small
// and structurally bounded by the ₹200 target, never an unbounded
// scan). The Booking $match is by `_id` (always indexed), bounded to
// the same small qualifying set.
const buildBookingRecoverySummary = async (claimId) => {
  const [ledgerTotals] = await FieldAgentEarningLedger.aggregate([
    { $match: { acquisitionClaimRef: claimId, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION } },
    {
      $group: {
        _id: null,
        qualifyingBookingCount: { $sum: 1 },
        totalPlatformCommissionInPaise: { $sum: "$bookingCommissionAmountInPaise" },
        fieldAgentEarningInPaise: { $sum: "$creditedAmountInPaise" },
        bookingRefs: { $push: "$bookingRef" },
      },
    },
  ]);

  if (!ledgerTotals) {
    // No ledger rows at all for this claim yet — explicit zeros, never
    // null/undefined (per the required zero-data contract).
    return {
      qualifyingBookingCount: 0,
      totalBookingValueInPaise: 0,
      totalPlatformCommissionInPaise: 0,
      fieldAgentEarningInPaise: 0,
    };
  }

  const [bookingValueTotal] = await Booking.aggregate([
    { $match: { _id: { $in: ledgerTotals.bookingRefs } } },
    { $group: { _id: null, totalBookingValueInPaise: { $sum: "$totalAmountInPaise" } } },
  ]);

  return {
    qualifyingBookingCount: ledgerTotals.qualifyingBookingCount,
    totalBookingValueInPaise: bookingValueTotal?.totalBookingValueInPaise ?? 0,
    totalPlatformCommissionInPaise: ledgerTotals.totalPlatformCommissionInPaise,
    fieldAgentEarningInPaise: ledgerTotals.fieldAgentEarningInPaise,
  };
};

// ─── GET /acquisition/recovery/:claimId ─────────────────────────────
export const getMyAcquisitionRecoveryDetail = async ({ userId, claimId }) => {
  const fieldAgent = await requireMyFieldAgent(userId);

  // Scoped to the caller's own FieldAgent — same "404, no leak" idiom
  // as withdrawMyClaim/cancelMyReferral for another agent's resource.
  const claim = await AcquisitionClaim.findOne({ _id: claimId, fieldAgentRef: fieldAgent._id })
    .populate(SALON_POPULATE_OPTIONS)
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

  const bookingRecoverySummary = await buildBookingRecoverySummary(claim._id);

  return {
    salon: claim.salonRef || null,
    status: claim.status,
    targetAmount,
    recoveredAmount,
    remainingAmount: Math.max(0, targetAmount - recoveredAmount), // derived, never stored
    progressPercent: progressPercentOf(progress),
    bookingRecoveryLedger,
    bookingRecoverySummary,
  };
};
