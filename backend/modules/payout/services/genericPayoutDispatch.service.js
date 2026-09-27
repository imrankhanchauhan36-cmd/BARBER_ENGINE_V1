/**
 * BARBER ENGINE V1
 * backend/modules/payout/services/genericPayoutDispatch.service.js
 *
 * STEP 6.4 — Razorpay Route Settlement Engine.
 *
 * GENERALIZES modules/fieldAgent/services/fieldAgentAutoPayout.service.js's
 * own proven structure (untouched by this step) to all three
 * GenericPayoutRequest entity types (SALON / ACQUISITION_AGENT /
 * TERRITORY_PARTNER) instead of just FIELD_AGENT.
 *
 * STATE MACHINE:
 *   REQUESTED (STEP 6.3 — AVAILABLE already LOCKED)
 *     -> PROCESSING (LOCKED -> PROCESSING, WalletBalanceService.
 *        moveToProcessing, its own transaction) + dispatch to Razorpay
 *        Route (separate step, after that transaction commits — an
 *        async external gateway call must never run inside the same
 *        transaction that just moved the funds, or a transaction abort
 *        after the gateway accepted the transfer would roll back money
 *        that was already sent; same rationale as the Cashfree
 *        precedent's own documented header)
 *       -> PAID   (PROCESSING debited permanently, WalletBalanceService.
 *                  completePayout) on a definitive SUCCESS
 *       -> FAILED (PROCESSING -> AVAILABLE, WalletBalanceService.
 *                  failPayout) on a definitive FAILED
 *       -> stays PROCESSING on an unknown/timeout outcome — resolved
 *          later by the webhook or reconciliation, NEVER guessed at
 *
 * "No admin approval. Auto dispatch after payout request." —
 * dispatchAfterRequest() is called once, right after
 * GenericPayoutRequestService.js#requestGenericPayout's own transaction
 * commits (that file's own one new, additive line) — there is no
 * approval endpoint, no admin gate, anywhere in this module.
 *
 * "Webhook + reconciliation must both call one shared
 * applyTransferOutcome() function" — exactly one function
 * (applyTransferOutcome, below) ever transitions a payout to PAID or
 * FAILED. Both handleGenericPayoutWebhookEvent and
 * reconcileRazorpayRoutePayouts call it and nothing else does.
 *
 * DOES NOT MODIFY: WalletBalanceService (called, never edited), the
 * Refund Engine (never imported here), RevenueSplit/GST (never
 * imported here). Every WalletBalanceService call below is a call to
 * an existing, unmodified method with the exact same idempotencyKey
 * discipline the SALON/FIELD_AGENT flows already use.
 */

import mongoose from "mongoose";
import GenericPayoutRequest from "../models/GenericPayoutRequest.js";
import { resolveDispatchDestinationForEntity } from "./payoutKycResolver.service.js";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import PayoutProviderResolver from "../../../services/settlement/PayoutProviderResolver.js";
import { assertValidProviderResult } from "../../../services/settlement/PayoutProvider.js";
import { SETTLEMENT_STATUS } from "../../../services/settlement/SettlementEnums.js";
import { isRazorpayRoutePayoutConfigured } from "../../../services/settlement/razorpayx/razorpayxPayoutClient.js";
import { GENERIC_PAYOUT_STATUS, GENERIC_PAYOUT_PROVIDER } from "../constants/genericPayoutRequest.constants.js";
import logger from "../../../utils/logger.js";

const isTransientConflict = (err) =>
  err?.hasErrorLabel?.("TransientTransactionError") || err?.code === 112 || err?.codeName === "WriteConflict";

const MAX_ATTEMPTS = 6;
const withTxn = async (fn) => {
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const out = await fn(session);
      await session.commitTransaction();
      return out;
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// Plain (non-transactional) writes can still hit a WriteConflict when
// they race a transaction touching the same document (e.g. a webhook
// arriving mid-dispatch) — same precedent as fieldAgentAutoPayout.
// service.js's own retryOnConflict.
const retryOnConflict = async (fn) => {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!isTransientConflict(err)) throw err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastErr;
};

const walletMove = (payout, extra) => ({
  entityType: payout.entityType,
  entityId: payout.entityId,
  amountInPaise: payout.amountInPaise,
  refType: "WITHDRAWAL",
  refId: payout._id,
  triggeredBy: "SYSTEM",
  ...extra,
});

// ─── OUTCOME (webhook + reconciliation + immediate dispatch response) ──
/**
 * THE one shared function that ever transitions a GenericPayoutRequest
 * to PAID or FAILED. Idempotent (status guard + WalletBalanceService's
 * own idempotency keys) — safe to call more than once for the same
 * payout from any of its three callers (dispatch, webhook, reconcile).
 *
 * @param {"SUCCESS"|"FAILED"} outcome
 * @returns {Promise<{applied:boolean, reason?:string, payout?:object}>}
 */
export const applyTransferOutcome = async ({ payoutId, outcome, utr = null, providerPayoutId = null, providerStatus = null, failureReason = null, providerResponse = null }) => {
  if (!mongoose.isValidObjectId(payoutId)) return { applied: false, reason: "INVALID_ID" };

  return withTxn(async (session) => {
    const payout = await GenericPayoutRequest.findById(payoutId).session(session);
    if (!payout || payout.payoutProvider !== GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE) {
      return { applied: false, reason: "NOT_A_RAZORPAY_ROUTE_PAYOUT" };
    }

    if (outcome === SETTLEMENT_STATUS.SUCCESS) {
      if (payout.status === GENERIC_PAYOUT_STATUS.PAID) return { applied: false, reason: "ALREADY_PAID", payout };
      if (payout.status !== GENERIC_PAYOUT_STATUS.PROCESSING) {
        // e.g. already failed+released and Razorpay now reports success:
        // money left the platform without a wallet debit. Never
        // auto-resolve — flag it for manual review.
        logger.error("[GenericPayoutDispatch] SUCCESS reported for a payout that is not PROCESSING — needs manual review", { payoutId: String(payout._id), status: payout.status });
        return { applied: false, reason: `STATUS_${payout.status}`, payout };
      }
      payout.status = GENERIC_PAYOUT_STATUS.PAID;
      payout.utr = utr || payout.utr;
      payout.isOpen = false;
      payout.providerStatus = providerStatus || "processed";
      if (providerPayoutId) payout.providerPayoutId = providerPayoutId;
      if (providerResponse) payout.providerResponse = providerResponse;
      await payout.save({ session });

      // Successful transfer debits Processing permanently.
      await WalletBalanceService.completePayout(walletMove(payout, {
        idempotencyKey: `generic-payout:complete:${payout._id}`,
        session,
        remarks: utr ? `Razorpay Route UTR: ${utr}` : "Razorpay Route payout confirmed",
      }));
      return { applied: true, payout };
    }

    // outcome FAILED
    if (payout.status === GENERIC_PAYOUT_STATUS.FAILED) return { applied: false, reason: "ALREADY_FAILED", payout };
    if (payout.status !== GENERIC_PAYOUT_STATUS.PROCESSING) {
      logger.error("[GenericPayoutDispatch] FAILED/REVERSED reported for a payout that is not PROCESSING — needs manual review", { payoutId: String(payout._id), status: payout.status });
      return { applied: false, reason: `STATUS_${payout.status}`, payout };
    }
    payout.status = GENERIC_PAYOUT_STATUS.FAILED;
    payout.failureReason = String(failureReason || "Razorpay Route transfer failed").slice(0, 500);
    payout.isOpen = false;
    payout.fundsReleased = true;
    payout.providerStatus = providerStatus || "failed";
    if (providerPayoutId) payout.providerPayoutId = providerPayoutId;
    if (providerResponse) payout.providerResponse = providerResponse;
    await payout.save({ session });

    // Failed transfer returns Processing -> Available.
    await WalletBalanceService.failPayout(walletMove(payout, {
      idempotencyKey: `generic-payout:fail:${payout._id}`,
      session,
      remarks: payout.failureReason,
    }));
    return { applied: true, payout };
  });
};

// ─── DISPATCH (call Razorpay Route for a payout already PROCESSING) ────
/**
 * Beneficiary(contact)/fund-account/payout creation through
 * RazorpayXPayoutProvider. Safe to call repeatedly (deterministic
 * reference_id + the X-Payout-Idempotency header).
 */
export const dispatchToGateway = async (payoutId) => {
  const payout = await GenericPayoutRequest.findById(payoutId).lean();
  if (!payout || payout.status !== GENERIC_PAYOUT_STATUS.PROCESSING || payout.payoutProvider !== GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE) {
    return { dispatched: false, reason: "NOT_IN_FLIGHT" };
  }

  const destination = await resolveDispatchDestinationForEntity({ entityType: payout.entityType, entityId: payout.entityId, bankSnapshot: payout.bankSnapshot });
  if (!destination) {
    // Funds are already PROCESSING; the destination can no longer be
    // proven identical to the snapshot. Nothing was sent, so fail safe
    // and return the money.
    const r = await applyTransferOutcome({ payoutId, outcome: SETTLEMENT_STATUS.FAILED, failureReason: "Bank details could not be verified for automatic payout", providerStatus: "NOT_SENT" });
    return { dispatched: false, reason: "DESTINATION_UNAVAILABLE", ...r };
  }

  const result = await PayoutProviderResolver.resolve(GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE).execute({ payout, destination });
  assertValidProviderResult(result);
  const common = { payoutId, providerPayoutId: result.providerPayoutId, providerResponse: result.providerResponse };

  if (result.status === SETTLEMENT_STATUS.SUCCESS) {
    await retryOnConflict(() => GenericPayoutRequest.updateOne({ _id: payoutId }, { $set: {
      providerContactId: result.providerResponse?.contactId || null,
      providerFundAccountId: result.providerResponse?.fundAccountId || null,
    } }));
    return { dispatched: true, ...(await applyTransferOutcome({ ...common, outcome: SETTLEMENT_STATUS.SUCCESS, utr: result.utr, providerStatus: "processed" })) };
  }
  if (result.status === SETTLEMENT_STATUS.FAILED) {
    return { dispatched: true, ...(await applyTransferOutcome({ ...common, outcome: SETTLEMENT_STATUS.FAILED, failureReason: result.failureReason, providerStatus: "failed" })) };
  }

  // PENDING (accepted, or outcome unknown): stays PROCESSING; webhook / reconciliation resolves it.
  await retryOnConflict(() => GenericPayoutRequest.updateOne(
    { _id: payoutId, status: GENERIC_PAYOUT_STATUS.PROCESSING },
    { $set: {
        providerStatus: result.providerResponse?.unknownOutcome ? "unknown" : (result.providerResponse?.status || "queued"),
        ...(result.providerPayoutId ? { providerPayoutId: result.providerPayoutId } : {}),
        providerContactId: result.providerResponse?.contactId || null,
        providerFundAccountId: result.providerResponse?.fundAccountId || null,
        providerResponse: result.providerResponse,
    } }
  ));
  return { dispatched: true, applied: false, reason: "PENDING" };
};

// ─── AUTO DISPATCH (REQUESTED -> PROCESSING, then dispatch) ────────────
/**
 * "No admin approval." Moves a REQUESTED GenericPayoutRequest straight
 * to PROCESSING (LOCKED -> PROCESSING, its own transaction) and then
 * dispatches to Razorpay Route — no human action anywhere in between.
 */
export const dispatchGenericPayout = async (payoutId) => {
  const moved = await withTxn(async (session) => {
    const payout = await GenericPayoutRequest.findById(payoutId).session(session);
    if (!payout || payout.status !== GENERIC_PAYOUT_STATUS.REQUESTED) return null;

    payout.status = GENERIC_PAYOUT_STATUS.PROCESSING;
    payout.payoutProvider = GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE;
    await payout.save({ session });

    await WalletBalanceService.moveToProcessing(walletMove(payout, {
      idempotencyKey: `generic-payout:processing:${payout._id}`,
      session,
      remarks: "Auto-dispatch to Razorpay Route — no admin approval",
    }));
    return payout;
  });

  if (!moved) return { dispatched: false, reason: "NOT_REQUESTED" };
  return dispatchToGateway(moved._id);
};

/** Post-request hook, called once after requestGenericPayout's own transaction commits. Never throws. */
export const dispatchAfterRequest = async (payout) => {
  try {
    return await dispatchGenericPayout(payout._id);
  } catch (err) {
    logger.error("[GenericPayoutDispatch] auto-dispatch failed — payout left for reconciliation", { payoutId: String(payout._id), message: err.message });
    return { dispatched: false, reason: "ERROR", error: err.message };
  }
};

// ─── WEBHOOK ────────────────────────────────────────────────────────
/**
 * Handles an already signature-verified Razorpay payout webhook
 * payload. Always resolves (the route answers 200) — including for
 * events it deliberately ignores — so Razorpay does not retry
 * harmlessly-ignored ones. Funnels into the SAME applyTransferOutcome
 * reconciliation uses.
 */
export const handleGenericPayoutWebhookEvent = async (payload) => {
  const entity = payload?.payload?.payout?.entity || {};
  const referenceId = entity.reference_id || "";

  if (!referenceId || !String(referenceId).startsWith("GPR_")) return { handled: false, reason: "NOT_OUR_PAYOUT" };
  const payoutId = String(referenceId).slice(4);
  if (!mongoose.isValidObjectId(payoutId)) return { handled: false, reason: "BAD_REFERENCE_ID" };

  const rawStatus = String(entity.status || "").toLowerCase();
  const isSuccess = rawStatus === "processed";
  const isFailed = ["reversed", "rejected", "cancelled"].includes(rawStatus);

  if (!isSuccess && !isFailed) {
    // Intermediate (queued/pending/processing) — record and wait for the final event.
    await retryOnConflict(() => GenericPayoutRequest.updateOne(
      { _id: payoutId, status: GENERIC_PAYOUT_STATUS.PROCESSING, payoutProvider: GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE },
      { $set: { providerStatus: rawStatus.slice(0, 60) } }
    ));
    return { handled: true, reason: "INTERMEDIATE" };
  }

  const payout = await GenericPayoutRequest.findById(payoutId).lean();
  if (!payout) return { handled: false, reason: "UNKNOWN_PAYOUT" };

  // Amount cross-check on success: never mark PAID for an amount we did not request.
  if (isSuccess && entity.amount !== undefined && Number(entity.amount) !== payout.amountInPaise) {
    logger.error("[GenericPayoutDispatch] webhook amount mismatch — ignored", { payoutId, expected: payout.amountInPaise, got: entity.amount });
    return { handled: false, reason: "AMOUNT_MISMATCH" };
  }

  const res = await applyTransferOutcome({
    payoutId,
    outcome: isSuccess ? SETTLEMENT_STATUS.SUCCESS : SETTLEMENT_STATUS.FAILED,
    utr: entity.utr || null,
    providerPayoutId: entity.id || null,
    providerStatus: rawStatus.slice(0, 60),
    failureReason: entity.failure_reason || `Razorpay ${rawStatus}`,
  });
  return { handled: true, ...res };
};

// ─── RECONCILIATION ─────────────────────────────────────────────────
/**
 * Resolves in-flight RAZORPAY_ROUTE payouts whose webhook never
 * arrived (or whose create call timed out) by polling Razorpay by our
 * deterministic reference_id. Calls the SAME applyTransferOutcome the
 * webhook and immediate-dispatch path use.
 */
export const reconcileRazorpayRoutePayouts = async ({ olderThanMs = 5 * 60 * 1000, limit = 25 } = {}) => {
  if (!isRazorpayRoutePayoutConfigured()) return { checked: 0, resolved: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await GenericPayoutRequest.find({
    payoutProvider: GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE,
    status: GENERIC_PAYOUT_STATUS.PROCESSING,
    updatedAt: { $lt: cutoff },
  }).sort({ updatedAt: 1 }).limit(limit).select("_id").lean();

  let resolved = 0;
  for (const { _id } of stuck) {
    try {
      const st = await PayoutProviderResolver.resolve(GENERIC_PAYOUT_PROVIDER.RAZORPAY_ROUTE).fetchStatus(_id);
      if (!st.known) continue;
      if (st.notFound) { await dispatchToGateway(_id); continue; } // create never landed — safe to (re)send, reference_id is idempotent
      if (st.status === SETTLEMENT_STATUS.SUCCESS) {
        const r = await applyTransferOutcome({ payoutId: _id, outcome: SETTLEMENT_STATUS.SUCCESS, utr: st.utr, providerPayoutId: st.providerPayoutId, providerStatus: "processed", providerResponse: st.providerResponse });
        if (r.applied) resolved++;
      } else if (st.status === SETTLEMENT_STATUS.FAILED) {
        const r = await applyTransferOutcome({ payoutId: _id, outcome: SETTLEMENT_STATUS.FAILED, failureReason: st.failureReason, providerPayoutId: st.providerPayoutId, providerStatus: "failed", providerResponse: st.providerResponse });
        if (r.applied) resolved++;
      } else {
        await retryOnConflict(() => GenericPayoutRequest.updateOne({ _id }, { $set: { providerStatus: String(st.providerResponse?.status || "pending").slice(0, 60) } }));
      }
    } catch (err) {
      logger.error("[GenericPayoutDispatch] reconcile failed for a payout", { payoutId: String(_id), message: err.message });
    }
  }
  return { checked: stuck.length, resolved };
};
