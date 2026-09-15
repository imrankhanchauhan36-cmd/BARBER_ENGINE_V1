/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentPerformance.service.js
 *
 * FA-11.2 — the authoritative, read-only calculation layer that
 * produces a FieldAgentPerformanceSnapshot payload from existing
 * server-side data. Pure calculation is deliberately separated from
 * persistence:
 *
 *   computeFieldAgentPerformanceSnapshotPayload — pure, deterministic
 *   given (fieldAgentRef, cycleKey, now). Never writes anything.
 *
 *   createFieldAgentPerformanceSnapshot — the ONE controlled
 *   persistence path. Calls the pure calculator, then
 *   FieldAgentPerformanceSnapshot.create(...), idempotent on the
 *   (fieldAgentRef, cycleKey) unique index exactly like FA-10's own
 *   createTerritoryPartnerTermSnapshot (create, catch E11000, return
 *   the existing document).
 *
 * FAIL-CLOSED POLICY RESOLUTION (locked): if no PUBLISHED
 * PerformancePolicyVersion exists, this file throws — it never
 * invents a default rolling-window length. The policy is resolved
 * exactly ONCE per call and threaded through the whole computation, so
 * a concurrent publish mid-calculation can never mix rollingWindowDays
 * from one version with policyVersionRef from another.
 *
 * NEVER reads Booking directly. All booking-generated financial/
 * activity attribution comes from FieldAgentEarningLedger, which FA-9
 * already resolved and wrote — re-deriving it from Booking here would
 * duplicate that resolution logic and risk disagreeing with it.
 *
 * NEVER writes to any collection other than FieldAgentPerformanceSnapshot.
 * NEVER mutates FraudSignal, FieldAgentAuditEvent, or any FA-9/FA-10
 * model. Read-only against every authoritative source.
 */

import { Errors } from "../../../utils/response.js";
import PerformancePolicyVersion from "../models/PerformancePolicyVersion.js";
import FieldAgentPerformanceSnapshot from "../models/FieldAgentPerformanceSnapshot.js";
import FieldAgent from "../models/FieldAgent.js";
import User from "../../../models/User.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import TerritoryPartnerTermSnapshot from "../models/TerritoryPartnerTermSnapshot.js";
import FraudSignal from "../models/FraudSignal.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import KYC from "../../kyc/models/KYC.js";
import FieldAgentTraining from "../../fieldAgentTraining/models/FieldAgentTraining.js";
import TestAttempt from "../../fieldAgentTest/models/TestAttempt.js";
import { PERFORMANCE_POLICY_STATUS } from "../constants/performance.constants.js";
import { CLAIM_STATUS } from "../constants/acquisitionClaim.constants.js";
import { ACQUISITION_PROGRESS_STATUS, EARNING_ENTITLEMENT_TYPE, EARNING_CREDIT_OUTCOME } from "../constants/fieldAgentEarning.constants.js";
import { ASSIGNMENT_STATUS, TERRITORY_STATUS } from "../constants/commercialTerritory.constants.js";
import CommercialTerritory from "../models/CommercialTerritory.js";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// UTC-safe by construction — millisecond epoch subtraction has no
// local-timezone ambiguity (unlike calendar-month arithmetic, which is
// why FA-10's addUtcMonths exists as a separate, more careful helper).
const daysBetween = (laterDate, earlierDate) => Math.floor((laterDate.getTime() - earlierDate.getTime()) / MS_PER_DAY);

const resolvePublishedPerformancePolicyOrFailClosed = async () => {
  const policy = await PerformancePolicyVersion.findOne({ status: PERFORMANCE_POLICY_STATUS.PUBLISHED }).lean();
  if (!policy) {
    // Locked: fail closed. No default rolling window is invented here.
    throw Errors.conflict("No PUBLISHED PerformancePolicyVersion exists — cannot compute a Field Agent performance snapshot");
  }
  return policy;
};

// ═══════════════════════════════════════════════════════════════════
// ACQUISITION
// ═══════════════════════════════════════════════════════════════════
const computeAcquisitionMetrics = async ({ fieldAgentRef, windowStart, now }) => {
  // Uses the existing {fieldAgentRef:1,status:1} index (fieldAgentRef
  // prefix scan) — bounded by this one agent's own claim count, never
  // a collection-wide scan.
  const claims = await AcquisitionClaim.find({ fieldAgentRef }).select("_id status createdAt salonRef").lean();
  const claimIds = claims.map((c) => c._id);

  const claimsIssuedCount = claims.filter((c) => c.createdAt >= windowStart && c.createdAt <= now).length;
  const claimsActiveCount = claims.filter((c) => c.status === CLAIM_STATUS.ACTIVE).length;

  // distinct() over an already fieldAgentRef-scoped set — de-duplicates
  // naturally, so a salon re-claimed by the same agent after an earlier
  // ENDED claim is never double-counted.
  const salonsAcquiredCount = new Set(claims.map((c) => String(c.salonRef))).size;

  // Denominator = number of claims that actually have a progress
  // record (i.e. a target was successfully resolved and snapshotted —
  // see AcquisitionEarningProgress's own header). A claim stuck on an
  // open CLAIM_PROGRESS_GAP has no progress record yet and is
  // correctly excluded from this denominator, not counted as "not
  // completed" against an undefined target.
  const progressRecords = claimIds.length
    ? await AcquisitionEarningProgress.find({ acquisitionClaimRef: { $in: claimIds } }).select("status").lean()
    : [];
  const targetCompletionCount = progressRecords.filter((p) => p.status === ACQUISITION_PROGRESS_STATUS.TARGET_REACHED).length;
  // Locked: never silently divide by zero. Undefined rate is null, not 0.
  const targetCompletionRate = progressRecords.length ? targetCompletionCount / progressRecords.length : null;

  return { claimsIssuedCount, claimsActiveCount, salonsAcquiredCount, targetCompletionCount, targetCompletionRate };
};

// ═══════════════════════════════════════════════════════════════════
// FINANCIAL/BOOKING ACTIVITY — FieldAgentEarningLedger only, never
// Booking directly. windowStart <= bookingCompletedAt <= now (the
// booking's own event time, not the ledger row's write time, so a
// reconciliation-delayed credit is attributed to when the booking
// actually happened, not when it was eventually processed).
// ═══════════════════════════════════════════════════════════════════
const computeLedgerWindowMetrics = async ({ fieldAgentRef, entitlementType, windowStart, now }) => {
  const rows = await FieldAgentEarningLedger.aggregate([
    // Uses the existing {fieldAgentRef:1,createdAt:-1} index as a
    // fieldAgentRef-prefix scan — bounded to this one agent's rows.
    { $match: { fieldAgentRef } },
    {
      $match: {
        entitlementType,
        creditOutcome: EARNING_CREDIT_OUTCOME.CREDITED,
        bookingCompletedAt: { $gte: windowStart, $lte: now },
      },
    },
    { $group: { _id: null, bookingCount: { $sum: 1 }, amountInPaise: { $sum: "$creditedAmountInPaise" } } },
  ]);
  const row = rows[0];
  return { bookingCount: row?.bookingCount ?? 0, amountInPaise: row?.amountInPaise ?? 0 };
};

// ═══════════════════════════════════════════════════════════════════
// TERRITORY / TENURE / TERM
// ═══════════════════════════════════════════════════════════════════
const computeTerritoryMetrics = async ({ fieldAgentRef, now }) => {
  // Exact-match on the existing partial-unique {fieldAgentRef:1,status:1}
  // (ACTIVE) index — a single indexed lookup.
  const currentAssignment = await TerritoryAssignment.findOne({ fieldAgentRef, status: ASSIGNMENT_STATUS.ACTIVE }).lean();

  // NOTE (query-plan finding, reported — not silently added): no
  // existing index covers "every TerritoryAssignment for one agent
  // regardless of status." TerritoryAssignment volume is bounded by
  // territory count x turnover (far smaller than Booking/Salon), so a
  // fieldAgentRef-filtered find() is expected to remain cheap at
  // current and foreseeable scale; this is flagged for explicit
  // approval before FA-11.4 makes it a routine per-agent job
  // operation, per the scale lock's "do not add indexes unless the
  // audit proves one is insufficient and explicit approval is
  // obtained" instruction.
  const allAssignments = await TerritoryAssignment.find({ fieldAgentRef }).sort({ effectiveFrom: -1 }).lean();

  const territoryAssignmentHistory = allAssignments.map((a) => ({
    territoryAssignmentRef: a._id,
    territoryRef: a.territoryRef,
    effectiveFrom: a.effectiveFrom,
    effectiveUntil: a.effectiveUntil,
    endReason: a.endReason,
  }));

  let territoryTenureDays = null;
  if (currentAssignment) {
    territoryTenureDays = daysBetween(now, currentAssignment.effectiveFrom);
  } else if (allAssignments.length > 0) {
    const mostRecent = allAssignments[0];
    if (mostRecent.effectiveUntil) {
      territoryTenureDays = daysBetween(mostRecent.effectiveUntil, mostRecent.effectiveFrom);
    }
  }

  let termStatus = { daysRemaining: null, expired: null };
  if (currentAssignment) {
    // Reuses FA-10's own authoritative snapshot — never re-derives
    // term expiry with a separate/incompatible calculation.
    const snapshot = await TerritoryPartnerTermSnapshot.findOne({ territoryAssignmentRef: currentAssignment._id }).lean();
    if (snapshot) {
      // Exact same boundary FA-10's attemptTerritoryPartnerCredit uses:
      // completedAt >= termExpiresAt => expired.
      const expired = now.getTime() >= snapshot.termExpiresAt.getTime();
      const daysRemaining = expired ? 0 : Math.ceil((snapshot.termExpiresAt.getTime() - now.getTime()) / MS_PER_DAY);
      termStatus = { daysRemaining, expired };
    }
    // No snapshot yet (TERM_SNAPSHOT_GAP still open) => stays
    // {null, null} — an honest "not yet known", never a guessed value.
  }

  return { territoryTenureDays, territoryAssignmentHistory, termStatus };
};

// ═══════════════════════════════════════════════════════════════════
// CURRENT STATE — current-instant facts only, never re-interpreted.
// ═══════════════════════════════════════════════════════════════════
const computeCurrentState = async ({ fieldAgent, claimsActiveCount }) => {
  const [user, kyc, training, testAttempt] = await Promise.all([
    User.findById(fieldAgent.userRef).select("accountStatus").lean(),
    // ownerId is globally unique per User (one KYC doc per user,
    // regardless of applicantType) — a single indexed lookup.
    KYC.findOne({ ownerId: fieldAgent.userRef }).select("status").lean(),
    // Latest enrollment for THIS agent's approved application — uses
    // the existing {applicationRef:1} index.
    FieldAgentTraining.findOne({ applicationRef: fieldAgent.applicationRef }).sort({ createdAt: -1 }).select("status").lean(),
    // Latest attempt for THIS agent's approved application — uses the
    // existing {applicationRef:1,attemptNumber:1} index.
    TestAttempt.findOne({ applicationRef: fieldAgent.applicationRef }).sort({ attemptNumber: -1 }).select("status").lean(),
  ]);

  return {
    claimsActiveCount,
    kycStatus: kyc?.status ?? null,
    trainingStatus: training?.status ?? null,
    testStatus: testAttempt?.status ?? null,
    accountStatus: user?.accountStatus ?? null,
    operationalStatus: fieldAgent.operationalStatus,
  };
};

// ═══════════════════════════════════════════════════════════════════
// FRAUD ADVISORY CONTEXT — read-only, display-only. Never a trigger.
// ═══════════════════════════════════════════════════════════════════
const computeFraudSignalCounts = async ({ fieldAgentRef, windowStart, now }) => {
  const rows = await FraudSignal.aggregate([
    // Uses the existing {fieldAgentRef:1,createdAt:-1} index.
    { $match: { fieldAgentRef, createdAt: { $gte: windowStart, $lte: now } } },
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);
  const counts = {};
  for (const row of rows) counts[row._id] = row.count;
  return counts;
};

// ═══════════════════════════════════════════════════════════════════
// ADMIN CONTEXT — contextual evidence only, never scored as positive
// or negative here.
// ═══════════════════════════════════════════════════════════════════
const computeAdminActionCount = async ({ fieldAgentRef, windowStart, now }) =>
  // Uses the existing {entityType:1,entityId:1,createdAt:-1} index.
  FieldAgentAuditEvent.countDocuments({
    entityType: "FIELD_AGENT",
    entityId: fieldAgentRef,
    actorType: "ADMIN",
    createdAt: { $gte: windowStart, $lte: now },
  });

// ═══════════════════════════════════════════════════════════════════
// PURE CALCULATION — deterministic given (fieldAgentRef, cycleKey,
// now). No persistence. Policy resolved exactly once and threaded
// through every sub-computation.
// ═══════════════════════════════════════════════════════════════════
export const computeFieldAgentPerformanceSnapshotPayload = async ({ fieldAgentRef, cycleKey, now = new Date() }) => {
  // Policy is resolved FIRST and unconditionally — "no policy" is a
  // global fail-closed gate that must trip regardless of which agent
  // was asked for, and checking it first avoids an agent lookup we
  // could never use anyway.
  const policy = await resolvePublishedPerformancePolicyOrFailClosed();

  const fieldAgent = await FieldAgent.findById(fieldAgentRef).lean();
  if (!fieldAgent) {
    throw Errors.notFound(`FieldAgent ${fieldAgentRef} not found — cannot compute a performance snapshot for a non-existent agent`);
  }

  const windowStart = new Date(now.getTime() - policy.rollingWindowDays * MS_PER_DAY);

  const [acquisition, acquisitionLedger, territoryLedger, territory, fraudSignalCounts, adminActionCount] = await Promise.all([
    computeAcquisitionMetrics({ fieldAgentRef, windowStart, now }),
    computeLedgerWindowMetrics({ fieldAgentRef, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION, windowStart, now }),
    computeLedgerWindowMetrics({ fieldAgentRef, entitlementType: EARNING_ENTITLEMENT_TYPE.TERRITORY_PARTNER, windowStart, now }),
    computeTerritoryMetrics({ fieldAgentRef, now }),
    computeFraudSignalCounts({ fieldAgentRef, windowStart, now }),
    computeAdminActionCount({ fieldAgentRef, windowStart, now }),
  ]);

  const currentState = await computeCurrentState({ fieldAgent, claimsActiveCount: acquisition.claimsActiveCount });

  return {
    fieldAgentRef,
    commercialPath: fieldAgent.commercialPath,
    cycleKey,
    policyVersionRef: policy._id,
    computedAt: now,
    rollingWindowDays: policy.rollingWindowDays,
    rollingWindow: {
      claimsIssuedCount: acquisition.claimsIssuedCount,
      acquisitionCreditedBookingCount: acquisitionLedger.bookingCount,
      acquisitionCreditedAmountInPaise: acquisitionLedger.amountInPaise,
      territoryCreditedBookingCount: territoryLedger.bookingCount,
      territoryCreditedAmountInPaise: territoryLedger.amountInPaise,
      fraudSignalCounts,
      adminActionCount,
    },
    lifetime: {
      salonsAcquiredCount: acquisition.salonsAcquiredCount,
      targetCompletionCount: acquisition.targetCompletionCount,
      targetCompletionRate: acquisition.targetCompletionRate,
      territoryTenureDays: territory.territoryTenureDays,
      territoryAssignmentHistory: territory.territoryAssignmentHistory,
    },
    currentState: { ...currentState, termStatus: territory.termStatus },
    // unavailable{} intentionally omitted here — the model's own
    // schema defaults supply the two fixed, locked messages. Never
    // computed, never overridden per-agent.
  };
};

// ═══════════════════════════════════════════════════════════════════
// THE ONE CONTROLLED PERSISTENCE PATH — idempotent on
// (fieldAgentRef, cycleKey), mirrors FA-10's own
// createTerritoryPartnerTermSnapshot create-then-catch-E11000 idiom.
// ═══════════════════════════════════════════════════════════════════
export const createFieldAgentPerformanceSnapshot = async ({ fieldAgentRef, cycleKey, now = new Date() }) => {
  const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef, cycleKey, now });
  try {
    return await FieldAgentPerformanceSnapshot.create(payload);
  } catch (err) {
    if (err.code === 11000) {
      // Already created by a concurrent/prior attempt for this exact
      // (fieldAgentRef, cycleKey) — idempotent no-op, return it as-is
      // (never overwritten, per the model's own immutability contract).
      return FieldAgentPerformanceSnapshot.findOne({ fieldAgentRef, cycleKey });
    }
    throw err;
  }
};

// ═══════════════════════════════════════════════════════════════════
// FA-11.3 — ADMIN READ AUTHORIZATION / SCOPE
//
// LOCKED ARCHITECTURAL DECISION: ACQUISITION_AGENT performance is
// INDIA_ADMIN-only in V1, because Acquisition Agents have no
// authoritative permanent State membership (no geography field on
// FieldAgent; FieldAgentApplication.requestedZone is explicitly
// documented as "the applicant's request only — it grants no
// authority"; an Acquisition Agent's own claims can span any state by
// design — see FA-5 Architecture Decision Lock — so no single
// authoritative state exists to scope by).
//
// TERRITORY_PARTNER performance IS scopeable for STATE_ADMIN, but
// ONLY through the one authoritative chain that already exists:
// TerritoryAssignment (status ACTIVE only — never a historical/ended
// assignment) -> CommercialTerritory.stateRef. No fallback to
// historical claim geography, requestedZone, or any other heuristic
// is used anywhere in this file.
//
// A client-supplied stateRef/geography value is NEVER read here —
// state scope always comes from the authenticated admin's own
// server-populated req.user.stateRef (see auth.middleware.js).
// ═══════════════════════════════════════════════════════════════════

// Resolves whether `admin` (req.user) may view performance data for
// the given `fieldAgent` document. Pure authorization logic — no
// snapshot data is touched here.
const canAdminViewFieldAgentPerformance = async ({ admin, fieldAgent }) => {
  if (admin.adminLevel === "INDIA") return true;
  if (admin.adminLevel !== "STATE") return false; // DISTRICT/others — no performance permission in V1

  // Locked: Acquisition Agent is INDIA-only, unconditionally — no
  // heuristic geography is ever consulted for this path.
  if (fieldAgent.commercialPath !== COMMERCIAL_PATH.TERRITORY_PARTNER) return false;

  // Only the CURRENT (ACTIVE) assignment counts — an ended/retired
  // assignment's historical geography is never used as a fallback.
  const currentAssignment = await TerritoryAssignment.findOne({ fieldAgentRef: fieldAgent._id, status: ASSIGNMENT_STATUS.ACTIVE })
    .select("territoryRef")
    .lean();
  if (!currentAssignment) return false;

  // BLOCKER FIX (B1) — the territory itself must be the admin's
  // authoritative CURRENT State membership, not merely a document that
  // once had that stateRef. A SUSPENDED/RETIRED/DRAFT territory is
  // never authoritative "current" state, exactly the same discipline
  // already applied to TerritoryAssignment.status above — never a
  // fallback to a non-ACTIVE territory.
  const territory = await CommercialTerritory.findOne({ _id: currentAssignment.territoryRef, status: TERRITORY_STATUS.ACTIVE })
    .select("stateRef")
    .lean();
  if (!territory) return false;

  return String(territory.stateRef) === String(admin.stateRef);
};

// For LIST: resolves the bounded set of fieldAgentRef values a
// STATE_ADMIN is authorized to see — exclusively TERRITORY_PARTNER
// agents with a CURRENT ACTIVE assignment to a CommercialTerritory in
// the admin's own state. Uses the existing {stateRef:1,status:1}
// index on CommercialTerritory and the existing partial-unique
// {territoryRef:1,status:1} index on TerritoryAssignment — no new
// index required.
const resolveStateAdminAuthorizedFieldAgentIds = async (stateRef) => {
  // BLOCKER FIX (B1) — same discipline as canAdminViewFieldAgentPerformance
  // above: only an ACTIVE CommercialTerritory is authoritative current
  // State membership. A SUSPENDED/RETIRED/DRAFT territory in this state
  // must never contribute an agent to the authorized set.
  const territoriesInState = await CommercialTerritory.find({ stateRef, status: TERRITORY_STATUS.ACTIVE }).select("_id").lean();
  if (!territoriesInState.length) return [];
  const territoryIds = territoriesInState.map((t) => t._id);

  const activeAssignments = await TerritoryAssignment.find({ territoryRef: { $in: territoryIds }, status: ASSIGNMENT_STATUS.ACTIVE })
    .select("fieldAgentRef")
    .lean();
  return activeAssignments.map((a) => a.fieldAgentRef);
};

// Explicit whitelist DTO — never a raw Mongo/Mongoose document. Only
// the fields the FA-11.3 lock approved for API exposure.
export const toPerformanceSnapshotDTO = (snapshot) => ({
  id: snapshot._id,
  fieldAgentRef: snapshot.fieldAgentRef,
  commercialPath: snapshot.commercialPath,
  cycleKey: snapshot.cycleKey,
  policyVersionRef: snapshot.policyVersionRef,
  computedAt: snapshot.computedAt,
  rollingWindowDays: snapshot.rollingWindowDays,
  rollingWindow: {
    claimsIssuedCount: snapshot.rollingWindow.claimsIssuedCount,
    acquisitionCreditedBookingCount: snapshot.rollingWindow.acquisitionCreditedBookingCount,
    acquisitionCreditedAmountInPaise: snapshot.rollingWindow.acquisitionCreditedAmountInPaise,
    territoryCreditedBookingCount: snapshot.rollingWindow.territoryCreditedBookingCount,
    territoryCreditedAmountInPaise: snapshot.rollingWindow.territoryCreditedAmountInPaise,
    // Defensive: .lean() already returns a plain object for a Map-typed
    // path (verified against a real Mongo round-trip), but this guards
    // against ever accidentally reading a hydrated (non-lean) document.
    fraudSignalCounts:
      snapshot.rollingWindow.fraudSignalCounts instanceof Map
        ? Object.fromEntries(snapshot.rollingWindow.fraudSignalCounts)
        : { ...(snapshot.rollingWindow.fraudSignalCounts || {}) },
    adminActionCount: snapshot.rollingWindow.adminActionCount,
  },
  lifetime: {
    salonsAcquiredCount: snapshot.lifetime.salonsAcquiredCount,
    targetCompletionCount: snapshot.lifetime.targetCompletionCount,
    targetCompletionRate: snapshot.lifetime.targetCompletionRate,
    territoryTenureDays: snapshot.lifetime.territoryTenureDays,
    territoryAssignmentHistory: (snapshot.lifetime.territoryAssignmentHistory || []).map((h) => ({
      territoryAssignmentRef: h.territoryAssignmentRef,
      territoryRef: h.territoryRef,
      effectiveFrom: h.effectiveFrom,
      effectiveUntil: h.effectiveUntil,
      endReason: h.endReason,
    })),
  },
  currentState: {
    claimsActiveCount: snapshot.currentState.claimsActiveCount,
    termStatus: {
      daysRemaining: snapshot.currentState.termStatus?.daysRemaining ?? null,
      expired: snapshot.currentState.termStatus?.expired ?? null,
    },
    kycStatus: snapshot.currentState.kycStatus,
    trainingStatus: snapshot.currentState.trainingStatus,
    testStatus: snapshot.currentState.testStatus,
    accountStatus: snapshot.currentState.accountStatus,
    operationalStatus: snapshot.currentState.operationalStatus,
  },
  unavailable: {
    supportRelationshipEvidence: snapshot.unavailable?.supportRelationshipEvidence,
    complaintEvidence: snapshot.unavailable?.complaintEvidence,
  },
});

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || 50, 100));
const clampPage = (page) => Math.max(1, Number(page) || 1);

// LIST — reads persisted snapshots only. Never recalculates.
export const adminListFieldAgentPerformanceSnapshots = async ({ admin, page, limit, fieldAgentRef, commercialPath, cycleKey, policyVersionRef }) => {
  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);

  const filter = {};

  if (admin.adminLevel === "STATE") {
    const authorizedIds = await resolveStateAdminAuthorizedFieldAgentIds(admin.stateRef);
    if (fieldAgentRef) {
      // Client asked for one specific agent — honor it ONLY if that
      // exact agent is itself within the authorized set. Never fall
      // back to "show the authorized set instead" and never expand
      // authorization based on the client's own input.
      const isAuthorized = authorizedIds.some((id) => String(id) === String(fieldAgentRef));
      // No real snapshot ever has a null fieldAgentRef (required
      // field) — this deterministically matches zero documents
      // without needing a sentinel/fake ObjectId.
      filter.fieldAgentRef = isAuthorized ? fieldAgentRef : null;
    } else {
      filter.fieldAgentRef = { $in: authorizedIds };
    }
  } else if (admin.adminLevel === "INDIA") {
    if (fieldAgentRef) filter.fieldAgentRef = fieldAgentRef;
  } else {
    // requireAdminLevel at the route layer should already prevent
    // this, but fail closed here too rather than trust the caller.
    return { items: [], total: 0, page: safePage, limit: safeLimit };
  }

  if (commercialPath) filter.commercialPath = commercialPath;
  if (cycleKey) filter.cycleKey = cycleKey;
  if (policyVersionRef) filter.policyVersionRef = policyVersionRef;

  const [items, total] = await Promise.all([
    FieldAgentPerformanceSnapshot.find(filter)
      .sort({ computedAt: -1, _id: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgentPerformanceSnapshot.countDocuments(filter),
  ]);

  return { items: items.map(toPerformanceSnapshotDTO), total, page: safePage, limit: safeLimit };
};

// DETAIL — the LATEST persisted snapshot for one Field Agent. Never
// recalculates. Mirrors adminGetClaimDetail's own precedent exactly:
// FieldAgent not found -> 404; found but out of authorized scope ->
// 403 (this codebase's own existing convention does not use a
// scope-safe 404 — see adminAcquisitionClaim's own identical 403
// behavior); found + authorized but no snapshot yet -> 404.
export const adminGetLatestFieldAgentPerformanceSnapshot = async ({ admin, fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const authorized = await canAdminViewFieldAgentPerformance({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Outside your authorized scope");

  const snapshot = await FieldAgentPerformanceSnapshot.findOne({ fieldAgentRef: fieldAgentId })
    .sort({ computedAt: -1, _id: -1 })
    .lean();
  if (!snapshot) throw Errors.notFound("No performance snapshot found for this Field Agent");

  return toPerformanceSnapshotDTO(snapshot);
};
