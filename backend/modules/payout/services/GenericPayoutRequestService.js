/**
 * BARBER ENGINE V1
 * backend/modules/payout/services/GenericPayoutRequestService.js
 *
 * STEP 6.3 — Generic PayoutRequest Engine.
 *
 * REUSES, VERBATIM, THE EXACT PATTERN ALREADY PROVEN IN
 * controllers/payout.controller.js#requestWithdrawal (untouched by this
 * step): create the request document FIRST (so it has a real _id), then
 * call WalletBalanceService.hold() with that _id as the idempotency
 * anchor, inside the SAME transaction — if the hold fails (insufficient
 * AVAILABLE balance), the whole transaction aborts and the request
 * document is never persisted. "Move Approved → Locked atomically" is
 * this transaction, not a new mechanism.
 *
 * REUSED, UNMODIFIED: WalletBalanceService (STEP 6.2 — already fully
 * generic across SALON/ACQUISITION_AGENT/TERRITORY_PARTNER) and
 * SalonEarnings (read via WalletBalanceService.getWallet only — this
 * file never queries SalonEarnings directly). Neither file is imported
 * for writing anywhere in this module.
 *
 * SCOPE (LOCKED, per the STEP 6.3 ticket):
 *   - No admin approval — nothing here requires or waits for an admin
 *     action to reach REQUESTED+LOCKED.
 *   - Refund compatibility preserved — this file never touches PENDING
 *     balance or the refund path; debitPending (used by
 *     RefundExecutionService/RazorpayRefundService, both untouched) can
 *     still reverse an entity's PENDING bucket independently of
 *     whatever this file has LOCKED, exactly as it already can for
 *     SALON today.
 *
 * IDEMPOTENT: a pre-check by {entityType, entityId, idempotencyKey}
 * short-circuits a repeat call; GenericPayoutRequest's own unique
 * compound index is the real, race-safe backstop (E11000 → return the
 * existing document, never a duplicate, never a second hold).
 *
 * STEP 6.4 — Razorpay Route Settlement Engine, additive: right after
 * this file's own transaction commits (REQUESTED created, AVAILABLE→
 * LOCKED applied), dispatchAfterRequest() is called once to
 * auto-dispatch to Razorpay Route — no admin approval, no gateway call
 * inside this transaction (see genericPayoutDispatch.service.js's own
 * header for why an async gateway call must never run inside the same
 * transaction as the hold). Wrapped in try/catch so a dispatch failure
 * can NEVER fail the request-creation response the user already sees
 * as successful — the payout simply stays REQUESTED, resolved by the
 * reconciliation job. This file's own create-then-hold logic above is
 * completely unmodified by this addition.
 */

import mongoose from "mongoose";
import GenericPayoutRequest from "../models/GenericPayoutRequest.js";
import { resolveVerifiedBankSnapshotForEntity } from "./payoutKycResolver.service.js";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import { Errors } from "../../../utils/response.js";
import { PAYOUT_ENTITY_TYPE, GENERIC_PAYOUT_STATUS, OPEN_GENERIC_PAYOUT_STATUSES } from "../constants/genericPayoutRequest.constants.js";
import { dispatchAfterRequest } from "./genericPayoutDispatch.service.js"; // STEP 6.4 — additive, see header
import logger from "../../../utils/logger.js";

const DUPLICATE_KEY_ERROR_CODE = 11000;

const integerOrThrow = (amountInPaise) => {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw Errors.badRequest("amountInPaise must be a positive integer");
  }
};

/**
 * "User presses Withdraw." Creates a GenericPayoutRequest and atomically
 * moves the entity's wallet balance AVAILABLE -> LOCKED, in one
 * transaction. Throws (and creates nothing) if:
 *   - entityType is not one of SALON/ACQUISITION_AGENT/TERRITORY_PARTNER
 *   - the entity's bank KYC is missing/unverified/incomplete (see
 *     payoutKycResolver.service.js)
 *   - the entity already has an OPEN GenericPayoutRequest
 *   - amountInPaise is not a positive integer
 *   - the wallet does not have sufficient AVAILABLE balance (raised by
 *     WalletBalanceService.hold's own atomic conditional $inc)
 *
 * @param {{ entityType: string, entityId: import("mongoose").Types.ObjectId|string, amountInPaise: number, idempotencyKey: string, triggeredBy?: string, triggeredById?: import("mongoose").Types.ObjectId|string }} params
 * @returns {Promise<object>} the created (or, on a replayed idempotencyKey, pre-existing) GenericPayoutRequest document
 */
export const requestGenericPayout = async ({ entityType, entityId, amountInPaise, idempotencyKey, triggeredBy = "SYSTEM", triggeredById = null }) => {
  if (!Object.values(PAYOUT_ENTITY_TYPE).includes(entityType)) {
    throw Errors.badRequest(`Unknown payout entityType: ${entityType}`);
  }
  if (!entityId) throw Errors.badRequest("entityId is required");
  if (!idempotencyKey) throw Errors.badRequest("idempotencyKey is required");
  integerOrThrow(amountInPaise);

  // Idempotency pre-check — the unique compound index on
  // {entityType, entityId, idempotencyKey} is the real, race-safe
  // backstop; this just avoids redundant work on the common
  // (non-racing) repeat call.
  const existing = await GenericPayoutRequest.findOne({ entityType, entityId, idempotencyKey }).lean();
  if (existing) return existing;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Universal KYC resolver — throws Errors.forbidden if not
    // verified/incomplete, aborting before anything is created.
    const bankSnapshot = await resolveVerifiedBankSnapshotForEntity({ entityType, entityId, session });

    // "One open payout request per entity" — pre-check (the partial
    // unique index on {entityType, entityId, isOpen:true} is the real
    // DB-level backstop against a concurrent duplicate).
    const openExisting = await GenericPayoutRequest.findOne({
      entityType,
      entityId,
      status: { $in: OPEN_GENERIC_PAYOUT_STATUSES },
    }).session(session).lean();
    if (openExisting) {
      throw Errors.conflict("A withdrawal request is already pending for this account. Cancel or resolve it first.");
    }

    // Create the request FIRST — same order as the proven
    // payout.controller.js#requestWithdrawal precedent — so the
    // subsequent hold() has a real _id to anchor its idempotency key
    // and refId to.
    const [request] = await GenericPayoutRequest.create(
      [{
        entityType,
        entityId,
        amountInPaise,
        status: GENERIC_PAYOUT_STATUS.REQUESTED,
        bankSnapshot,
        idempotencyKey,
        isOpen: true,
        triggeredBy,
        triggeredById,
      }],
      { session }
    );

    // Approved -> Locked, atomically, inside this same transaction. If
    // this throws (insufficient AVAILABLE balance), the request created
    // above is rolled back with it — never left in a REQUESTED-but-
    // unfunded state.
    await WalletBalanceService.hold({
      entityType,
      entityId,
      amountInPaise,
      refType: "WITHDRAWAL",
      refId: request._id,
      idempotencyKey: `generic-payout:hold:${request._id}`,
      session,
      triggeredBy,
      triggeredById,
      remarks: `Withdrawal request — ${entityType} — ₹${(amountInPaise / 100).toFixed(2)}`,
    });

    await session.commitTransaction();

    // STEP 6.4 — auto dispatch, no admin approval. Never blocks or
    // fails this function's own success — see this file's own header.
    try {
      await dispatchAfterRequest(request);
    } catch (dispatchErr) {
      logger.error("[GenericPayoutRequestService] auto-dispatch failed (request itself succeeded; unaffected)", { requestId: String(request._id), message: dispatchErr?.message });
    }

    return request;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err?.code === DUPLICATE_KEY_ERROR_CODE) {
      // Lost a real race against another call for the same
      // (entityType, entityId, idempotencyKey) — return the winner's
      // row rather than throwing.
      const winner = await GenericPayoutRequest.findOne({ entityType, entityId, idempotencyKey }).lean();
      if (winner) return winner;
    }
    throw err;
  } finally {
    session.endSession();
  }
};

/** Read-only — the entity's currently open (if any) GenericPayoutRequest. */
export const getOpenGenericPayoutRequest = (entityType, entityId) =>
  GenericPayoutRequest.findOne({ entityType, entityId, status: { $in: OPEN_GENERIC_PAYOUT_STATUSES } }).lean();
