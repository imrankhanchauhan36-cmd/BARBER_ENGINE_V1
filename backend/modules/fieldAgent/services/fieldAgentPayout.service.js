/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentPayout.service.js
 *
 * FA-14 — Field Agent Payout / Withdrawal / Disbursement (V1, MANUAL
 * only, no automatic/RazorpayX provider).
 *
 * FINANCIAL ARCHITECTURE (locked Option A): there is no continuously
 * credited Field Agent wallet. Available balance is always computed
 * fresh, inside the same transaction that creates a withdrawal
 * request, as:
 *
 *   SUM(FieldAgentEarningLedger.creditedAmountInPaise WHERE
 *       creditOutcome = CREDITED)                          [FA-9, read-only]
 *   minus
 *   SUM(FieldAgentPayoutRequest.amountInPaise WHERE
 *       status IN FIELD_AGENT_PAYOUT_RESERVING_STATUSES)    [this module]
 *
 * FieldAgentEarningLedger (FA-9) is NEVER written to by this file —
 * confirmed by inspection: every reference below is a read-only
 * aggregate. FA-9's own crediting service/job/models are not imported
 * here at all beyond the ledger model itself.
 *
 * Identity is derived exclusively from the authenticated user's own
 * id (req.user._id, passed in as `userId` by the controller) via
 * FieldAgent.findOne({userRef}) — the same resolution shape
 * fieldAgentProfile.service.js#getFieldAgentByUserId already
 * establishes (that exact read-only helper has no session parameter,
 * so this file queries FieldAgent directly for the session-aware
 * cases, without modifying that service).
 *
 * Bank/KYC data is read-only from modules/kyc/models/KYC.js (frozen,
 * shared, already used by Field Agent KYC per FA-3.2) — never via
 * kyc.service.js#getOrCreateKYC, which has a side effect (creates a
 * DRAFT KYC record if none exists); a missing KYC record here is a
 * hard rejection, never an auto-created one.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { buildPagination, paginatedQuery } from "../../../utils/pagination.js";
import User from "../../../models/User.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import FieldAgentPayoutRequest, {
  FIELD_AGENT_PAYOUT_STATUS,
  FIELD_AGENT_PAYOUT_TRANSITIONS,
  FIELD_AGENT_PAYOUT_RESERVING_STATUSES,
  FIELD_AGENT_PAYOUT_PROVIDER,
} from "../models/FieldAgentPayoutRequest.js";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION, AUDIT_ENTITY_TYPE } from "../constants/fieldAgent.constants.js";
import { EARNING_CREDIT_OUTCOME } from "../constants/fieldAgentEarning.constants.js";
import KYC from "../../kyc/models/KYC.js";
import { APPLICANT_TYPE } from "../../kyc/constants/kyc.constants.js";

const MIN_WITHDRAWAL_PAISE = 10000; // ₹100 — locked V1 rule
const MAX_ATTEMPTS = 3;
const DUPLICATE_KEY_ERROR_CODE = 11000;

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const TERMINAL_STATUSES = new Set([
  FIELD_AGENT_PAYOUT_STATUS.PAID,
  FIELD_AGENT_PAYOUT_STATUS.REJECTED,
  FIELD_AGENT_PAYOUT_STATUS.CANCELLED,
]);

// ─────────────────────────────────────────────────────────────────
// IDENTITY / ELIGIBILITY (read-only)
// ─────────────────────────────────────────────────────────────────

const resolveFieldAgentForPayout = async (userId, session) => {
  const fieldAgent = await FieldAgent.findOne({ userRef: userId }).session(session);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");
  return fieldAgent;
};

/**
 * Eligibility check. The locked V1 rule names FieldAgent.operationalStatus
 * as the gate. FA-9's own established precedent
 * (fieldAgentEarning.service.js's isFieldAgentActive) additionally
 * gates financial eligibility on User.accountStatus — a DIFFERENT
 * field, reflecting current account standing (suspension/block) rather
 * than onboarding completion.
 *
 * Verified against the real middleware chain: User.accountStatus only
 * has 3 possible values (ACTIVE/SUSPENDED/BLOCKED — models/User.js),
 * and middlewares/auth.middleware.js#protect ALREADY rejects every
 * SUSPENDED/BLOCKED account with 403 before any route handler runs.
 * So in this codebase the accountStatus check below can never actually
 * fire — it is a defense-in-depth redundant safety net, not a live
 * gap, and is kept only because it mirrors the exact same
 * "check accountStatus independently, even though another layer
 * already does" philosophy protect() itself documents at its own
 * SECURITY (P0-2) comment. It costs one extra read inside the
 * transaction; disclosed explicitly in the implementation report
 * rather than silently left looking like it does more than it does.
 */
const assertFieldAgentEligibleForPayout = async (fieldAgent, session) => {
  if (fieldAgent.operationalStatus !== "ACTIVE") {
    throw Errors.forbidden("Field Agent is not yet operational");
  }
  const user = await User.findById(fieldAgent.userRef).select("accountStatus").session(session).lean();
  if (!user || user.accountStatus !== "ACTIVE") {
    throw Errors.forbidden("Field Agent account is not active");
  }
};

/**
 * Resolves and returns the safe, snapshot-ready bank fields from the
 * Field Agent's own verified KYC record. Throws if KYC/bank/penny-drop
 * is missing or incomplete. Never returns the encrypted account
 * number — only the already-masked value KYC.js itself stores.
 */
const resolveVerifiedBankSnapshot = async (fieldAgent, session) => {
  const kyc = await KYC.findOne({
    ownerId: fieldAgent.userRef,
    applicantType: APPLICANT_TYPE.FIELD_AGENT,
    isDeleted: { $ne: true },
  })
    .select("bank")
    .session(session)
    .lean();

  if (!kyc || !kyc.bank) {
    throw Errors.forbidden("Bank KYC details are not available for this Field Agent");
  }
  if (kyc.bank.pennyDropStatus !== "SUCCESS") {
    throw Errors.forbidden("Bank account is not verified yet");
  }
  if (!kyc.bank.accountHolder || !kyc.bank.maskedAccount || !kyc.bank.ifsc) {
    throw Errors.forbidden("Bank details are incomplete");
  }

  return {
    accountHolder: kyc.bank.accountHolder,
    maskedAccount: kyc.bank.maskedAccount,
    ifsc:          kyc.bank.ifsc,
    bankName:      kyc.bank.bankName || null,
  };
};

// ─────────────────────────────────────────────────────────────────
// AVAILABLE BALANCE (pure, read-only aggregation)
// ─────────────────────────────────────────────────────────────────

/**
 * Reads FieldAgentEarningLedger (FA-9, read-only) and this module's
 * own FieldAgentPayoutRequest collection. Never writes anything.
 * Callable with or without a session — pass a session when called
 * from inside a transaction that needs a consistent read.
 */
export const computeAvailableBalance = async (fieldAgentRef, session = null) => {
  const agentObjectId = new mongoose.Types.ObjectId(fieldAgentRef);

  const creditedAggQuery = FieldAgentEarningLedger.aggregate([
    { $match: { fieldAgentRef: agentObjectId, creditOutcome: EARNING_CREDIT_OUTCOME.CREDITED } },
    { $group: { _id: null, total: { $sum: "$creditedAmountInPaise" } } },
  ]);
  const reservedAggQuery = FieldAgentPayoutRequest.aggregate([
    { $match: { fieldAgentRef: agentObjectId, status: { $in: FIELD_AGENT_PAYOUT_RESERVING_STATUSES } } },
    { $group: { _id: null, total: { $sum: "$amountInPaise" } } },
  ]);
  if (session) {
    creditedAggQuery.session(session);
    reservedAggQuery.session(session);
  }

  const [[creditedAgg], [reservedAgg]] = await Promise.all([creditedAggQuery, reservedAggQuery]);

  const totalCreditedInPaise = creditedAgg?.total || 0;
  const totalReservedInPaise = reservedAgg?.total || 0;
  // Math.max(0, ...) is a defensive floor only — under correct operation
  // reserved can never exceed credited, since every reservation was
  // itself validated against available balance at its own creation time.
  const availableInPaise = Math.max(0, totalCreditedInPaise - totalReservedInPaise);

  return { totalCreditedInPaise, totalReservedInPaise, availableInPaise };
};

export const getMyBalanceSummary = async (userId) => {
  const fieldAgent = await FieldAgent.findOne({ userRef: userId }).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");
  return computeAvailableBalance(fieldAgent._id);
};

// ─────────────────────────────────────────────────────────────────
// CREATE — the critical atomic flow (locked §16, steps 1-11)
// ─────────────────────────────────────────────────────────────────

export const createWithdrawalRequest = async ({ userId, amountInPaise, idempotencyKey }) => {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw Errors.badRequest("idempotencyKey is required");
  }
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw Errors.badRequest("amountInPaise must be a positive whole number of paise");
  }
  if (amountInPaise < MIN_WITHDRAWAL_PAISE) {
    throw Errors.badRequest(`Minimum withdrawal is ₹${MIN_WITHDRAWAL_PAISE / 100}`);
  }

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // 1-3. Resolve identity + eligibility.
      const fieldAgent = await resolveFieldAgentForPayout(userId, session);
      await assertFieldAgentEligibleForPayout(fieldAgent, session);

      // Idempotency pre-check, inside this transaction's own snapshot —
      // the real backstop is the {fieldAgentRef,idempotencyKey} unique
      // index below; this just lets a genuine repeat return cleanly
      // instead of always hitting the duplicate-key exception path.
      const existing = await FieldAgentPayoutRequest.findOne({
        fieldAgentRef: fieldAgent._id,
        idempotencyKey,
      }).session(session);
      if (existing) {
        await session.commitTransaction();
        return { payout: existing, idempotentReplay: true };
      }

      // 8. Read verified bank details (server-derived only).
      const bankSnapshot = await resolveVerifiedBankSnapshot(fieldAgent, session);

      // 4-7. Compute available balance and validate the requested amount
      // — inside the SAME transaction/session as the create below, so
      // a concurrent second request cannot both read the same
      // available balance before either commits.
      const { availableInPaise } = await computeAvailableBalance(fieldAgent._id, session);
      if (amountInPaise > availableInPaise) {
        throw Errors.badRequest(
          `Requested amount exceeds available balance (₹${Math.round(availableInPaise / 100)} available)`
        );
      }

      // 9-10. Create the request with the bank snapshot + idempotency key.
      const [payout] = await FieldAgentPayoutRequest.create(
        [{
          fieldAgentRef: fieldAgent._id,
          amountInPaise,
          bankSnapshot,
          idempotencyKey,
          status: FIELD_AGENT_PAYOUT_STATUS.REQUESTED,
          isOpen: true,
        }],
        { session }
      );

      await FieldAgentAuditEvent.create(
        [{
          entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
          entityId:   payout._id,
          actorRef:   userId,
          actorType:  AUDIT_ACTOR_TYPE.AGENT,
          action:     AUDIT_ACTION.FIELD_AGENT_PAYOUT_REQUESTED,
          newValue:   { amountInPaise, status: FIELD_AGENT_PAYOUT_STATUS.REQUESTED },
        }],
        { session }
      );

      // 11. Commit.
      await session.commitTransaction();
      return { payout, idempotentReplay: false };
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();

      if (err.code === DUPLICATE_KEY_ERROR_CODE) {
        // Lost a real race against another request from the same agent.
        if (err.keyPattern?.idempotencyKey) {
          // The other request used the SAME idempotency key and won —
          // re-read and return its row (idempotent success, not an error).
          const fieldAgent = await FieldAgent.findOne({ userRef: userId }).select("_id").lean();
          const winner = fieldAgent
            ? await FieldAgentPayoutRequest.findOne({ fieldAgentRef: fieldAgent._id, idempotencyKey }).lean()
            : null;
          session.endSession();
          if (winner) return { payout: winner, idempotentReplay: true };
          throw err;
        }
        // The one-active-withdrawal (isOpen) index was violated — a
        // genuinely different, concurrent withdrawal attempt already
        // has an open request for this agent.
        session.endSession();
        throw Errors.conflict("You already have an active withdrawal request. Please wait for it to be resolved before creating a new one.");
      }

      if (isTransientConflict(err) && attempt < MAX_ATTEMPTS - 1) {
        session.endSession();
        continue;
      }

      session.endSession();
      throw err;
    } finally {
      // Session may already be ended in a branch above; Mongoose's
      // endSession() is a safe no-op if called on an already-ended
      // session, matching the defensive style already used elsewhere
      // in this codebase's own transaction-retry loops.
      if (session.hasEnded !== true) session.endSession();
    }
  }
  throw lastErr;
};

// ─────────────────────────────────────────────────────────────────
// AGENT — read/list/cancel (own records only)
// ─────────────────────────────────────────────────────────────────

const AGENT_SAFE_FIELDS = "fieldAgentRef amountInPaise currency status payoutProvider utr bankSnapshot failureReason approvedAt adminNote cancelledAt createdAt updatedAt";

export const listMyPayouts = async ({ userId, query }) => {
  const fieldAgent = await FieldAgent.findOne({ userRef: userId }).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const pagination = buildPagination(query);
  const filter = { fieldAgentRef: fieldAgent._id };
  if (query?.status && Object.values(FIELD_AGENT_PAYOUT_STATUS).includes(query.status)) {
    filter.status = query.status;
  }

  return paginatedQuery(FieldAgentPayoutRequest, filter, pagination, {
    sort: { createdAt: -1 },
    select: AGENT_SAFE_FIELDS,
  });
};

export const getMyPayoutDetail = async ({ userId, payoutId }) => {
  if (!mongoose.isValidObjectId(payoutId)) throw Errors.notFound("Payout request not found");
  const fieldAgent = await FieldAgent.findOne({ userRef: userId }).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const payout = await FieldAgentPayoutRequest.findById(payoutId).select(AGENT_SAFE_FIELDS).lean();
  if (!payout) throw Errors.notFound("Payout request not found");
  if (payout.fieldAgentRef.toString() !== fieldAgent._id.toString()) {
    throw Errors.forbidden("This payout request does not belong to you");
  }
  return payout;
};

export const cancelMyPayout = async ({ userId, payoutId }) => {
  if (!mongoose.isValidObjectId(payoutId)) throw Errors.notFound("Payout request not found");

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const fieldAgent = await resolveFieldAgentForPayout(userId, session);
    const payout = await FieldAgentPayoutRequest.findById(payoutId).session(session);
    if (!payout) throw Errors.notFound("Payout request not found");
    if (payout.fieldAgentRef.toString() !== fieldAgent._id.toString()) {
      throw Errors.forbidden("This payout request does not belong to you");
    }
    if (payout.status !== FIELD_AGENT_PAYOUT_STATUS.REQUESTED) {
      throw Errors.conflict(`Cannot cancel — current status is ${payout.status}`);
    }

    payout.status      = FIELD_AGENT_PAYOUT_STATUS.CANCELLED;
    payout.cancelledAt = new Date();
    payout.isOpen       = false;
    await payout.save({ session });

    await FieldAgentAuditEvent.create(
      [{
        entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
        entityId:   payout._id,
        actorRef:   userId,
        actorType:  AUDIT_ACTOR_TYPE.AGENT,
        action:     AUDIT_ACTION.FIELD_AGENT_PAYOUT_CANCELLED,
        oldValue:   { status: FIELD_AGENT_PAYOUT_STATUS.REQUESTED },
        newValue:   { status: FIELD_AGENT_PAYOUT_STATUS.CANCELLED },
      }],
      { session }
    );

    await session.commitTransaction();
    return payout;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

// ─────────────────────────────────────────────────────────────────
// ADMIN — scope, list/detail, approve/reject/process/retry
// ─────────────────────────────────────────────────────────────────

/**
 * Territory scope check for admin Field Agent payout actions.
 *
 * V1 = INDIA-ONLY, by explicit product decision (asked and confirmed
 * mid-implementation), NOT the originally locked "INDIA and STATE."
 * Reason: unlike a salon (which always has one authoritative
 * location.territory.stateRef), a Field Agent has no single field that
 * gives every agent one authoritative state —
 *   - FieldAgent.js deliberately excludes all territory fields (see
 *     that model's own header comment);
 *   - FieldAgentApplication.stateRef/districtRef do NOT exist at the
 *     top level — only requestedZone.stateRef/districtRef, which that
 *     sub-object's own comment documents as "the applicant's REQUEST
 *     only... grants no authority over that geography";
 *   - TerritoryAssignment -> CommercialTerritory.stateRef exists only
 *     for the TERRITORY_PARTNER commercial path;
 *   - ACQUISITION_AGENT-path agents have no single-territory record at
 *     all, only a stateRef/districtRef on each individual
 *     AcquisitionClaim (one agent can hold many claims across states).
 * Rather than key a real money-approval boundary off a field the code
 * itself documents as carrying no authority, or an incomplete
 * path-specific split, STATE-level admin approval is deferred to a
 * future phase once a real universal Field Agent territory concept
 * exists. Only INDIA-level admins may act on Field Agent payouts.
 */
export const isFieldAgentWithinPayoutScope = (admin) => admin?.adminLevel === "INDIA";

const resolvePayoutWithScope = async ({ admin, payoutId, session = null }) => {
  if (!mongoose.isValidObjectId(payoutId)) throw Errors.notFound("Payout request not found");
  if (!isFieldAgentWithinPayoutScope(admin)) {
    throw Errors.forbidden("Out of your authorized scope");
  }

  const query = FieldAgentPayoutRequest.findById(payoutId);
  if (session) query.session(session);
  const payout = await query;
  if (!payout) throw Errors.notFound("Payout request not found");
  return payout;
};

// Admin read-only views populate fieldAgentRef (agentCode) and its
// nested userRef (name/phone) — an admin approving a real money
// transfer needs to know WHO they're paying, not a bare ObjectId. Only
// these two read paths populate; resolvePayoutWithScope (used by every
// write action below) stays a plain, unpopulated document, since a
// populated path adds no value to a status-transition write and this
// keeps the write path identical to how it was already verified.
const ADMIN_POPULATE_FIELD_AGENT = {
  path: "fieldAgentRef",
  select: "agentCode operationalStatus commercialPath userRef",
  populate: { path: "userRef", select: "name phone" },
};

export const listPayoutsForAdmin = async ({ admin, query }) => {
  if (!isFieldAgentWithinPayoutScope(admin)) {
    throw Errors.forbidden("Out of your authorized scope");
  }

  const pagination = buildPagination(query);
  const filter = {};
  if (query?.status && Object.values(FIELD_AGENT_PAYOUT_STATUS).includes(query.status)) {
    filter.status = query.status;
  }

  return paginatedQuery(FieldAgentPayoutRequest, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [ADMIN_POPULATE_FIELD_AGENT],
  });
};

export const getPayoutDetailForAdmin = async ({ admin, payoutId }) => {
  if (!mongoose.isValidObjectId(payoutId)) throw Errors.notFound("Payout request not found");
  if (!isFieldAgentWithinPayoutScope(admin)) {
    throw Errors.forbidden("Out of your authorized scope");
  }
  const payout = await FieldAgentPayoutRequest.findById(payoutId).populate(ADMIN_POPULATE_FIELD_AGENT).lean();
  if (!payout) throw Errors.notFound("Payout request not found");
  return payout;
};

export const approvePayout = async ({ admin, payoutId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await resolvePayoutWithScope({ admin, payoutId, session });
    // Deliberately a direct equality check, NOT a
    // FIELD_AGENT_PAYOUT_TRANSITIONS[...] membership check — PROCESSING
    // is reachable from BOTH REQUESTED (approve) and FAILED (retry) in
    // that table, so a membership check here would wrongly also accept
    // a FAILED payout through this endpoint (a real defect found and
    // fixed in the FA-14 final audit). Approve is REQUESTED-only, full
    // stop; FAILED->PROCESSING exists exclusively via retryFailedPayout
    // below, mirroring that function's own already-correct direct
    // `!== FAILED` check.
    if (payout.status !== FIELD_AGENT_PAYOUT_STATUS.REQUESTED) {
      throw Errors.conflict(`Cannot approve — current status is ${payout.status}`);
    }

    const fromStatus = payout.status;
    payout.status     = FIELD_AGENT_PAYOUT_STATUS.PROCESSING;
    payout.approvedBy = admin._id;
    payout.approvedAt = new Date();
    await payout.save({ session });

    await FieldAgentAuditEvent.create(
      [{
        entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
        entityId:   payout._id,
        actorRef:   admin._id,
        actorType:  AUDIT_ACTOR_TYPE.ADMIN,
        action:     AUDIT_ACTION.FIELD_AGENT_PAYOUT_APPROVED,
        oldValue:   { status: fromStatus },
        newValue:   { status: FIELD_AGENT_PAYOUT_STATUS.PROCESSING },
      }],
      { session }
    );

    await session.commitTransaction();
    return payout;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const rejectPayout = async ({ admin, payoutId, reason }) => {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw Errors.badRequest("A rejection reason is required");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await resolvePayoutWithScope({ admin, payoutId, session });
    if (!FIELD_AGENT_PAYOUT_TRANSITIONS[payout.status]?.includes(FIELD_AGENT_PAYOUT_STATUS.REJECTED)) {
      throw Errors.conflict(`Cannot reject — current status is ${payout.status}`);
    }

    const fromStatus = payout.status;
    payout.status    = FIELD_AGENT_PAYOUT_STATUS.REJECTED;
    payout.adminNote = reason.trim();
    payout.isOpen     = false;
    await payout.save({ session });

    await FieldAgentAuditEvent.create(
      [{
        entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
        entityId:   payout._id,
        actorRef:   admin._id,
        actorType:  AUDIT_ACTOR_TYPE.ADMIN,
        action:     AUDIT_ACTION.FIELD_AGENT_PAYOUT_REJECTED,
        oldValue:   { status: fromStatus },
        newValue:   { status: FIELD_AGENT_PAYOUT_STATUS.REJECTED, reason: reason.trim() },
        reason:     reason.trim(),
      }],
      { session }
    );

    await session.commitTransaction();
    return payout;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Records the result of a MANUAL payout the admin actually performed
 * outside this system (bank transfer). Never claims a provider
 * succeeded on its own initiative — the admin explicitly reports
 * success or failure, matching the locked V1 rule that this file must
 * never pretend an external provider was called when none was.
 */
export const recordManualPayoutResult = async ({ admin, payoutId, success, utr, failureReason }) => {
  if (success && (typeof utr !== "string" || utr.trim().length === 0)) {
    throw Errors.badRequest("UTR/reference is required to record a successful manual payout");
  }
  if (!success && (typeof failureReason !== "string" || failureReason.trim().length === 0)) {
    throw Errors.badRequest("A failure reason is required to record a failed manual payout");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await resolvePayoutWithScope({ admin, payoutId, session });
    const targetStatus = success ? FIELD_AGENT_PAYOUT_STATUS.PAID : FIELD_AGENT_PAYOUT_STATUS.FAILED;
    if (!FIELD_AGENT_PAYOUT_TRANSITIONS[payout.status]?.includes(targetStatus)) {
      throw Errors.conflict(`Cannot record ${targetStatus} — current status is ${payout.status}`);
    }

    const fromStatus = payout.status;
    payout.status         = targetStatus;
    payout.payoutProvider = FIELD_AGENT_PAYOUT_PROVIDER.MANUAL;
    if (success) {
      payout.utr = utr.trim();
      payout.isOpen = false; // PAID is genuinely resolved — releases the "open" slot
    } else {
      payout.failureReason = failureReason.trim();
      // Deliberately NOT setting isOpen=false here — a FAILED manual
      // attempt is meant to be explicitly retried (locked V1 rule),
      // so it keeps blocking a second new withdrawal until an admin
      // resolves it (either a successful retry, or a separate reject
      // is not modeled in V1 — FAILED can only go back to PROCESSING).
    }
    await payout.save({ session });

    await FieldAgentAuditEvent.create(
      [{
        entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
        entityId:   payout._id,
        actorRef:   admin._id,
        actorType:  AUDIT_ACTOR_TYPE.ADMIN,
        action:     success ? AUDIT_ACTION.FIELD_AGENT_PAYOUT_PAID : AUDIT_ACTION.FIELD_AGENT_PAYOUT_FAILED,
        oldValue:   { status: fromStatus },
        newValue:   { status: targetStatus, utr: payout.utr, failureReason: payout.failureReason },
      }],
      { session }
    );

    await session.commitTransaction();
    return payout;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Explicit admin retry of a FAILED manual payout — FAILED -> PROCESSING
 * only. Idempotent: retrying a payout that is no longer FAILED (e.g.
 * a concurrent retry already moved it to PROCESSING) is rejected with
 * a clean conflict, never silently re-processed twice.
 */
export const retryFailedPayout = async ({ admin, payoutId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await resolvePayoutWithScope({ admin, payoutId, session });
    if (payout.status !== FIELD_AGENT_PAYOUT_STATUS.FAILED) {
      throw Errors.conflict(`Cannot retry — current status is ${payout.status}, not FAILED`);
    }

    payout.status        = FIELD_AGENT_PAYOUT_STATUS.PROCESSING;
    payout.failureReason = null;
    await payout.save({ session });

    await FieldAgentAuditEvent.create(
      [{
        entityType: AUDIT_ENTITY_TYPE.FIELD_AGENT_PAYOUT_REQUEST,
        entityId:   payout._id,
        actorRef:   admin._id,
        actorType:  AUDIT_ACTOR_TYPE.ADMIN,
        action:     AUDIT_ACTION.FIELD_AGENT_PAYOUT_RETRIED,
        oldValue:   { status: FIELD_AGENT_PAYOUT_STATUS.FAILED },
        newValue:   { status: FIELD_AGENT_PAYOUT_STATUS.PROCESSING },
      }],
      { session }
    );

    await session.commitTransaction();
    return payout;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};
