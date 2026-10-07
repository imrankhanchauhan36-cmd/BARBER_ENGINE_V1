/**
 * BARBER ENGINE V1
 * backend/services/settlement/payoutRequestDispatch.service.js
 *
 * FINANCE-P0-1 — Canonical Salon Payout merge. The Razorpay Route
 * dispatch/webhook/reconciliation counterpart of
 * modules/payout/services/genericPayoutDispatch.service.js, adapted for
 * the canonical PayoutRequest model instead of GenericPayoutRequest.
 *
 * WHY A SEPARATE FILE RATHER THAN REPOINTING THE EXISTING ONE: that
 * file's own machinery is still the live, unmodified dispatch path for
 * GenericPayoutRequest's two OTHER entity types (ACQUISITION_AGENT /
 * TERRITORY_PARTNER, Field-Agent-owned wallets) — explicitly out of
 * scope for this ticket ("Field Agent payout remains completely
 * separate... Do not modify... Acquisition Reward... Territory
 * Partner"). Repointing its model import would silently break those
 * two still-live paths. This file instead MIRRORS its proven structure
 * 1:1 — the exact same precedent genericPayoutDispatch.service.js
 * itself already set by mirroring modules/fieldAgent/services/
 * fieldAgentAutoPayout.service.js's own structure for a new model
 * rather than repointing that one. No Razorpay provider code is
 * duplicated: PayoutProviderResolver, RazorpayXPayoutProvider, and
 * razorpayxPayoutClient.js are all imported and reused completely
 * unmodified — only the "which Mongoose model do I read/write" layer
 * is parallel, which is unavoidable given the explicit scope boundary.
 *
 * REFERENCE-ID SHARING: RazorpayXPayoutProvider's own
 * buildPayoutReferenceId() always prefixes "GPR_" (unchanged, not
 * edited here) — a PayoutRequest-sourced dispatch therefore sends
 * Razorpay a reference_id of "GPR_<payoutRequestId>", identical in
 * SHAPE to a GenericPayoutRequest one. This is safe and requires no
 * provider/client change: a MongoDB ObjectId is unique regardless of
 * which collection it names, so the webhook route (see
 * modules/payout/routes/genericPayoutWebhook.routes.js) disambiguates
 * by trying GenericPayoutRequest first, then PayoutRequest, by that
 * same unique _id — never by the prefix label itself.
 *
 * STATE MACHINE (differs from GenericPayoutRequest's by design — see
 * the FINANCE-P0-1 blueprint): REQUESTED -> APPROVED (admin decision,
 * durable, funds still LOCKED) -> PROCESSING (LOCKED -> PROCESSING,
 * dispatch begins) -> PAID | FAILED. Nothing in this file ever moves a
 * payout out of REQUESTED directly — dispatchApprovedPayout() below
 * only accepts a payout already APPROVED, enforcing "no gateway
 * dispatch without admin approval" at the data level, not just by
 * caller convention.
 *
 * "Webhook + reconciliation must both call one shared
 * applyPayoutTransferOutcome() function" — exactly one function ever
 * transitions a PayoutRequest to PAID or FAILED via this gateway path.
 */

import mongoose from "mongoose";
import PayoutRequest, { PAYOUT_STATUS, PAYOUT_PROVIDER } from "../../models/PayoutRequest.js";
import { resolveDispatchDestinationForEntity } from "../../modules/payout/services/payoutKycResolver.service.js";
import WalletBalanceService from "../WalletBalanceService.js";
import PayoutProviderResolver from "./PayoutProviderResolver.js";
import { assertValidProviderResult } from "./PayoutProvider.js";
import { SETTLEMENT_STATUS } from "./SettlementEnums.js";
import { isRazorpayRoutePayoutConfigured } from "./razorpayx/razorpayxPayoutClient.js";
import NotificationService from "../NotificationService.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/constants/notificationEvents.constants.js";
import logger from "../../utils/logger.js";

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

const p2 = (v) => Math.round(v ?? 0) / 100;

// RazorpayXPayoutProvider.execute()/fetchStatus() only ever read
// {_id, entityType, entityId, amountInPaise} off whatever object is
// passed as `payout` — a thin adapter, never the raw document, so no
// provider code needs to know PayoutRequest's own field names.
const toProviderShape = (payout) => ({
  _id: payout._id,
  entityType: "SALON",
  entityId: payout.salonId,
  amountInPaise: payout.amountInPaise,
});

const walletMove = (payout, extra) => ({
  salonId: payout.salonId,
  amountInPaise: payout.amountInPaise,
  refType: "WITHDRAWAL",
  refId: payout._id,
  triggeredBy: "SYSTEM",
  ...extra,
});

const notify = (payout, templateKey, title, message, extra = {}) =>
  NotificationService.send({
    recipientId: payout.salonId,
    recipientType: "SALON",
    templateKey,
    variables: { amount: p2(payout.amountInPaise) },
    title,
    message,
    type: "PAYMENT",
    priority: "HIGH",
    actionType: "OPEN_WALLET",
    actionUrl: "/wallet",
    meta: { payoutId: payout._id, amountInPaise: payout.amountInPaise, ...extra },
  }).catch((err) => logger.warn("[PayoutRequestDispatch] notification failed (non-blocking)", { payoutId: String(payout._id), message: err?.message }));

// ─── OUTCOME (webhook + reconciliation + immediate dispatch response) ──
/**
 * THE one shared function that ever transitions a PayoutRequest to PAID
 * or FAILED via the Razorpay Route path. Idempotent (status guard +
 * WalletBalanceService's own idempotency keys) — safe to call more
 * than once for the same payout from any of its three callers
 * (dispatch, webhook, reconcile).
 */
export const applyPayoutTransferOutcome = async ({ payoutId, outcome, utr = null, providerPayoutId = null, providerStatus = null, failureReason = null, providerResponse = null }) => {
  if (!mongoose.isValidObjectId(payoutId)) return { applied: false, reason: "INVALID_ID" };

  const out = await withTxn(async (session) => {
    const payout = await PayoutRequest.findById(payoutId).session(session);
    if (!payout || payout.payoutProvider !== PAYOUT_PROVIDER.RAZORPAY_ROUTE) {
      return { applied: false, reason: "NOT_A_RAZORPAY_ROUTE_PAYOUT" };
    }

    if (outcome === SETTLEMENT_STATUS.SUCCESS) {
      if (payout.status === PAYOUT_STATUS.PAID) return { applied: false, reason: "ALREADY_PAID", payout };
      if (payout.status !== PAYOUT_STATUS.PROCESSING) {
        logger.error("[PayoutRequestDispatch] SUCCESS reported for a payout that is not PROCESSING — needs manual review", { payoutId: String(payout._id), status: payout.status });
        return { applied: false, reason: `STATUS_${payout.status}`, payout };
      }
      payout.status = PAYOUT_STATUS.PAID;
      payout.utr = utr || payout.utr;
      payout.providerStatus = providerStatus || "processed";
      if (providerPayoutId) payout.providerPayoutId = providerPayoutId;
      if (providerResponse) payout.providerResponse = providerResponse;
      await payout.save({ session });

      await WalletBalanceService.completePayout(walletMove(payout, {
        idempotencyKey: `payout:complete:${payout._id}`,
        session,
        remarks: utr ? `Razorpay Route UTR: ${utr}` : "Razorpay Route payout confirmed",
      }));
      return { applied: true, payout };
    }

    // outcome FAILED
    if (payout.status === PAYOUT_STATUS.FAILED) return { applied: false, reason: "ALREADY_FAILED", payout };
    if (payout.status !== PAYOUT_STATUS.PROCESSING) {
      logger.error("[PayoutRequestDispatch] FAILED/REVERSED reported for a payout that is not PROCESSING — needs manual review", { payoutId: String(payout._id), status: payout.status });
      return { applied: false, reason: `STATUS_${payout.status}`, payout };
    }
    payout.status = PAYOUT_STATUS.FAILED;
    payout.failureReason = String(failureReason || "Razorpay Route transfer failed").slice(0, 500);
    payout.providerStatus = providerStatus || "failed";
    if (providerPayoutId) payout.providerPayoutId = providerPayoutId;
    if (providerResponse) payout.providerResponse = providerResponse;
    await payout.save({ session });

    await WalletBalanceService.failPayout(walletMove(payout, {
      idempotencyKey: `payout:fail:${payout._id}`,
      session,
      remarks: payout.failureReason,
    }));
    return { applied: true, payout };
  });

  // Notifications fire only on a genuine, newly-applied transition —
  // never on an idempotent replay (applied:false) — see §12 "Do not
  // send duplicate notifications on repeated webhook/retry."
  if (out.applied && out.payout) {
    if (outcome === SETTLEMENT_STATUS.SUCCESS) {
      await notify(out.payout, NOTIFICATION_EVENTS.WITHDRAW_PAID, "Withdrawal Paid ✅", `Your withdrawal of ₹${p2(out.payout.amountInPaise)} has been paid.`, { utr: out.payout.utr });
    } else {
      await notify(out.payout, NOTIFICATION_EVENTS.WITHDRAW_FAILED, "Withdrawal Failed", `Your withdrawal of ₹${p2(out.payout.amountInPaise)} could not be completed. ${out.payout.failureReason || ""}`.trim());
    }
  }
  return out;
};

// ─── DISPATCH (call Razorpay Route for a payout already PROCESSING) ───
export const dispatchToPayoutGateway = async (payoutId) => {
  const payout = await PayoutRequest.findById(payoutId).lean();
  if (!payout || payout.status !== PAYOUT_STATUS.PROCESSING || payout.payoutProvider !== PAYOUT_PROVIDER.RAZORPAY_ROUTE) {
    return { dispatched: false, reason: "NOT_IN_FLIGHT" };
  }

  const destination = await resolveDispatchDestinationForEntity({ entityType: "SALON", entityId: payout.salonId, bankSnapshot: payout.bankSnapshot });
  if (!destination) {
    const r = await applyPayoutTransferOutcome({ payoutId, outcome: SETTLEMENT_STATUS.FAILED, failureReason: "Bank details could not be verified for automatic payout", providerStatus: "NOT_SENT" });
    return { dispatched: false, reason: "DESTINATION_UNAVAILABLE", ...r };
  }

  const result = await PayoutProviderResolver.resolve(PAYOUT_PROVIDER.RAZORPAY_ROUTE).execute({ payout: toProviderShape(payout), destination });
  assertValidProviderResult(result);
  const common = { payoutId, providerPayoutId: result.providerPayoutId, providerResponse: result.providerResponse };

  if (result.status === SETTLEMENT_STATUS.SUCCESS) {
    await retryOnConflict(() => PayoutRequest.updateOne({ _id: payoutId }, { $set: {
      providerContactId: result.providerResponse?.contactId || null,
      providerFundAccountId: result.providerResponse?.fundAccountId || null,
    } }));
    return { dispatched: true, ...(await applyPayoutTransferOutcome({ ...common, outcome: SETTLEMENT_STATUS.SUCCESS, utr: result.utr, providerStatus: "processed" })) };
  }
  if (result.status === SETTLEMENT_STATUS.FAILED) {
    return { dispatched: true, ...(await applyPayoutTransferOutcome({ ...common, outcome: SETTLEMENT_STATUS.FAILED, failureReason: result.failureReason, providerStatus: "failed" })) };
  }

  // PENDING (accepted, or outcome unknown): stays PROCESSING; webhook / reconciliation resolves it.
  await retryOnConflict(() => PayoutRequest.updateOne(
    { _id: payoutId, status: PAYOUT_STATUS.PROCESSING },
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

// ─── APPROVED -> PROCESSING, then dispatch ─────────────────────────────
/**
 * Only ever called from adminPayout.controller.js#approvePayout, AFTER
 * that controller's own REQUESTED->APPROVED transaction has already
 * committed (see §8 crash-safety: APPROVED is a durable, recoverable
 * checkpoint — this function may be re-invoked against the same
 * APPROVED or already-PROCESSING payout safely, see the guards below).
 */
export const dispatchApprovedPayout = async (payoutId) => {
  const moved = await withTxn(async (session) => {
    const payout = await PayoutRequest.findById(payoutId).session(session);
    if (!payout) return null;
    if (payout.status === PAYOUT_STATUS.PROCESSING) return payout; // already moved — resume dispatch, don't re-move
    if (payout.status !== PAYOUT_STATUS.APPROVED) return null; // not safe to dispatch from any other state

    payout.status = PAYOUT_STATUS.PROCESSING;
    payout.processingAt = new Date();
    await payout.save({ session });

    await WalletBalanceService.moveToProcessing(walletMove(payout, {
      idempotencyKey: `payout:processing:${payout._id}`,
      session,
      remarks: "Admin-approved — dispatching to Razorpay Route",
    }));
    return payout;
  });

  if (!moved) return { dispatched: false, reason: "NOT_APPROVED" };
  return dispatchToPayoutGateway(moved._id);
};

// ─── WEBHOOK ────────────────────────────────────────────────────────────
/**
 * Mirrors genericPayoutDispatch.service.js#handleGenericPayoutWebhookEvent
 * exactly, resolving a PayoutRequest instead. See file header for why
 * the reference_id prefix ("GPR_", unchanged) is shared and why that is
 * safe — disambiguation happens by the webhook ROUTE trying
 * GenericPayoutRequest first, this function second, keyed by the same
 * underlying unique _id either way.
 */
export const handlePayoutRequestWebhookEvent = async (payload) => {
  const entity = payload?.payload?.payout?.entity || {};
  const referenceId = entity.reference_id || "";

  if (!referenceId || !String(referenceId).startsWith("GPR_")) return { handled: false, reason: "NOT_OUR_PAYOUT" };
  const payoutId = String(referenceId).slice(4);
  if (!mongoose.isValidObjectId(payoutId)) return { handled: false, reason: "BAD_REFERENCE_ID" };

  const rawStatus = String(entity.status || "").toLowerCase();
  const isSuccess = rawStatus === "processed";
  const isFailed = ["reversed", "rejected", "cancelled"].includes(rawStatus);

  if (!isSuccess && !isFailed) {
    await retryOnConflict(() => PayoutRequest.updateOne(
      { _id: payoutId, status: PAYOUT_STATUS.PROCESSING, payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE },
      { $set: { providerStatus: rawStatus.slice(0, 60) } }
    ));
    return { handled: true, reason: "INTERMEDIATE" };
  }

  const payout = await PayoutRequest.findById(payoutId).lean();
  if (!payout) return { handled: false, reason: "UNKNOWN_PAYOUT" };

  if (isSuccess && entity.amount !== undefined && Number(entity.amount) !== payout.amountInPaise) {
    logger.error("[PayoutRequestDispatch] webhook amount mismatch — ignored", { payoutId, expected: payout.amountInPaise, got: entity.amount });
    return { handled: false, reason: "AMOUNT_MISMATCH" };
  }

  const res = await applyPayoutTransferOutcome({
    payoutId,
    outcome: isSuccess ? SETTLEMENT_STATUS.SUCCESS : SETTLEMENT_STATUS.FAILED,
    utr: entity.utr || null,
    providerPayoutId: entity.id || null,
    providerStatus: rawStatus.slice(0, 60),
    failureReason: entity.failure_reason || `Razorpay ${rawStatus}`,
  });
  return { handled: true, ...res };
};

// ─── RECONCILIATION ─────────────────────────────────────────────────────
export const reconcilePayoutRequests = async ({ olderThanMs = 5 * 60 * 1000, limit = 25 } = {}) => {
  if (!isRazorpayRoutePayoutConfigured()) return { checked: 0, resolved: 0 };
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await PayoutRequest.find({
    payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE,
    status: PAYOUT_STATUS.PROCESSING,
    updatedAt: { $lt: cutoff },
  }).sort({ updatedAt: 1 }).limit(limit).select("_id").lean();

  let resolved = 0;
  for (const { _id } of stuck) {
    try {
      const st = await PayoutProviderResolver.resolve(PAYOUT_PROVIDER.RAZORPAY_ROUTE).fetchStatus(_id);
      if (!st.known) continue;
      if (st.notFound) { await dispatchToPayoutGateway(_id); continue; }
      if (st.status === SETTLEMENT_STATUS.SUCCESS) {
        const r = await applyPayoutTransferOutcome({ payoutId: _id, outcome: SETTLEMENT_STATUS.SUCCESS, utr: st.utr, providerPayoutId: st.providerPayoutId, providerStatus: "processed", providerResponse: st.providerResponse });
        if (r.applied) resolved++;
      } else if (st.status === SETTLEMENT_STATUS.FAILED) {
        const r = await applyPayoutTransferOutcome({ payoutId: _id, outcome: SETTLEMENT_STATUS.FAILED, failureReason: st.failureReason, providerPayoutId: st.providerPayoutId, providerStatus: "failed", providerResponse: st.providerResponse });
        if (r.applied) resolved++;
      } else {
        await retryOnConflict(() => PayoutRequest.updateOne({ _id }, { $set: { providerStatus: String(st.providerResponse?.status || "pending").slice(0, 60) } }));
      }
    } catch (err) {
      logger.error("[PayoutRequestDispatch] reconcile failed for a payout", { payoutId: String(_id), message: err.message });
    }
  }
  return { checked: stuck.length, resolved };
};
