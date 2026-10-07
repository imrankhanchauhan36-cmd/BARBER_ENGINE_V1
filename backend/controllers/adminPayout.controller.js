/**
 * BARBER ENGINE V1
 * backend/controllers/adminPayout.controller.js
 * Admin Payout Controller — Phase 7 — 10/10 FROZEN
 * + Phase 8 additions: fixed salon populate bug, new getPayoutDetail endpoint
 * + Phase 4A: approvePayout no longer inlines "how a payout is
 *   executed" — it delegates to SettlementEngine, which resolves and
 *   calls the right provider (ManualProvider today). Same API
 *   contract, same DB writes, same idempotency keys — see
 *   services/settlement/ for the new architecture.
 */

import mongoose from "mongoose";
import PayoutRequest, { PAYOUT_STATUS, PAYOUT_PROVIDER } from "../models/PayoutRequest.js";
import Salon from "../models/Salon.js";
import User from "../models/User.js";
import KYC from "../modules/kyc/models/KYC.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import SettlementEngine from "../services/settlement/SettlementEngine.js";
import { dispatchApprovedPayout } from "../services/settlement/payoutRequestDispatch.service.js"; // FINANCE-P0-1
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { Errors, successResponse } from "../utils/response.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const p2        = (v)  => Math.round(v ?? 0) / 100;

// Same retry primitive already proven in genericPayoutDispatch.service.js /
// payoutRequestDispatch.service.js — two concurrent admin approvals on the
// same payout both start a transaction, and MongoDB can abort one with a
// transient write conflict even though the conditional findOneAndUpdate
// below is the real correctness guard. Without this retry, that transient
// error surfaced as a raw Mongo message instead of the controlled
// "Cannot approve — current status is X" response the blueprint requires.
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

/** Sentinel thrown from inside withTxn to carry a controlled next(err) response out past the retry loop without being mistaken for a transient conflict. */
class ControlledResponse extends Error {
  constructor(responder) { super("ControlledResponse"); this.responder = responder; }
}

/**
 * Admin geographic scope for payouts. Same convention verified in
 * controllers/adminFinance.controller.js (F2) / admin.controller.js /
 * adminBooking.controller.js — kept as an independent local copy here
 * rather than importing from adminFinance.controller.js, matching how
 * every admin controller in this codebase owns its own copy.
 *   INDIA    → unrestricted
 *   STATE    → only salons whose location.territory.stateRef matches admin.stateRef
 *   DISTRICT → only salons whose location.territory.districtRef matches admin.districtRef
 *              (route currently blocks DISTRICT from reaching any of these
 *              endpoints at all — kept here anyway so this never silently
 *              falls open if that route gate is ever loosened later)
 *   anything else → fail closed, zero salons
 */
const resolveAdminPayoutScope = async (admin) => {
  if (admin?.adminLevel === "INDIA") return { unrestricted: true };

  const salonFilter = { isDeleted: { $ne: true } };
  if (admin?.adminLevel === "STATE") {
    salonFilter["location.territory.stateRef"] = admin.stateRef;
  } else if (admin?.adminLevel === "DISTRICT") {
    salonFilter["location.territory.districtRef"] = admin.districtRef;
  } else {
    return { unrestricted: false, salonIds: [] };
  }

  const salons = await Salon.find(salonFilter).select("_id").lean();
  return { unrestricted: false, salonIds: salons.map((s) => s._id) };
};

/**
 * For a single resolved target salon — verifies it's inside the admin's
 * authorized territory. Never trusts the client-supplied payout/salon ID
 * as authorization by itself.
 */
const isSalonWithinPayoutScope = (admin, salon) => {
  if (!salon) return false;
  if (admin?.adminLevel === "INDIA") return true;
  if (admin?.adminLevel === "STATE") {
    return salon.location?.territory?.stateRef?.toString() === admin.stateRef?.toString();
  }
  if (admin?.adminLevel === "DISTRICT") {
    return salon.location?.territory?.districtRef?.toString() === admin.districtRef?.toString();
  }
  return false;
};

/**
 * PATCH /api/payouts/admin/approve/:id
 *
 * FINANCE-P0-1 — Canonical Salon Payout merge. Flow is now a genuine
 * two-phase sequence, per the approved blueprint:
 *
 *   Phase 1 (this transaction): REQUESTED -> APPROVED. Funds remain
 *   LOCKED (never touched here) — APPROVED is a durable, queryable
 *   checkpoint. The atomic conditional findOneAndUpdate below matches
 *   {status: REQUESTED or APPROVED} — REQUESTED is the normal first
 *   approval; APPROVED-already is a safe RESUME of a previous attempt
 *   that was interrupted before dispatch/settlement completed (the
 *   exact "server crashes between approval and dispatch" scenario the
 *   blueprint requires recovering from) — never re-dispatches blindly:
 *   see dispatchApprovedPayout()'s own idempotent guard and
 *   SettlementEngine's/WalletBalanceService's existing idempotency
 *   keys below for why a concurrent or repeated Phase 2 attempt can
 *   never produce two gateway payouts or two ledger entries (both
 *   layers are reused completely unmodified).
 *
 *   Phase 2 (post-commit, outside any transaction holding the
 *   approval): branches on payout.payoutProvider —
 *     MANUAL (default, unchanged default) — settles synchronously via
 *       the existing, unmodified SettlementEngine (ManualProvider),
 *       in its OWN second transaction, preserving the exact one-click
 *       admin UX this endpoint already had before this ticket (a
 *       MANUAL approval still completes to PAID in a single API call).
 *     RAZORPAY_ROUTE (merged in from GenericPayoutRequest) — moves
 *       APPROVED->PROCESSING and dispatches to the real gateway via
 *       services/settlement/payoutRequestDispatch.service.js (reused,
 *       unmodified Razorpay provider/client underneath) — genuinely
 *       async; this call returns at PROCESSING (or PAID, if the
 *       gateway resolved synchronously), never blocking on a webhook.
 *
 * An async gateway call must never run inside the same transaction
 * that just committed the approval (same rationale documented in
 * genericPayoutDispatch.service.js's own header) — hence the split.
 */
export const approvePayout = async (req, res, next) => {
  if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid payout ID"));

  const adminId = req.user?._id ?? null;
  const { utr, adminNote } = req.body;
  let payout;

  // ── Phase 1 — REQUESTED (or a stuck APPROVED) -> APPROVED ──────────
  // Wrapped in the same TransientTransactionError/WriteConflict retry
  // already proven in genericPayoutDispatch.service.js /
  // payoutRequestDispatch.service.js — two genuinely concurrent approve
  // calls on the same document can make MongoDB abort one transaction
  // with a transient conflict even though the conditional
  // findOneAndUpdate below is the real correctness guard; without this
  // retry that transient error would leak to the admin as a raw Mongo
  // message instead of a controlled response.
  try {
    payout = await withTxn(async (session) => {
      const existing = await PayoutRequest.findById(req.params.id).session(session).lean();
      if (!existing) {
        throw new ControlledResponse(() => next(Errors.notFound("Payout request not found")));
      }

      const targetSalon = await Salon.findOne({ _id: existing.salonId, isDeleted: { $ne: true } })
        .select("location.territory.stateRef location.territory.districtRef")
        .lean();
      if (!targetSalon || !isSalonWithinPayoutScope(req.user, targetSalon)) {
        throw new ControlledResponse(() => next(Errors.forbidden("Out of your authorized scope")));
      }

      // Atomic conditional — the real concurrency guard. Two simultaneous
      // approve calls on a REQUESTED payout: only one matches and flips
      // to APPROVED; the loser gets null and a clean 409, never a second
      // dispatch. See the function header for why re-matching an
      // already-APPROVED payout here is intentional (safe resume), not a
      // bypass of this guard.
      const updated = await PayoutRequest.findOneAndUpdate(
        { _id: req.params.id, status: { $in: [PAYOUT_STATUS.REQUESTED, PAYOUT_STATUS.APPROVED] } },
        { $set: { status: PAYOUT_STATUS.APPROVED, approvedBy: adminId, approvedAt: new Date() } },
        { new: true, session }
      );

      if (!updated) {
        const current = await PayoutRequest.findById(req.params.id).session(session).lean();
        throw new ControlledResponse(() => next(Errors.conflict(`Cannot approve — current status is ${current?.status ?? "unknown"}`)));
      }

      return updated;
    });
  } catch (err) {
    if (err instanceof ControlledResponse) return err.responder();
    return next(err);
  }

  // ── Phase 2 — post-commit dispatch/settlement. APPROVED is already
  // durable at this point — a failure anywhere below never loses the
  // approval decision itself (see function header). ──────────────────
  try {
    if (payout.payoutProvider === PAYOUT_PROVIDER.RAZORPAY_ROUTE) {
      await notifyApproved(payout);
      await dispatchApprovedPayout(payout._id);

      const fresh = await PayoutRequest.findById(payout._id).lean();
      const wallet = await WalletBalanceService.getWallet(fresh.salonId);
      return successResponse(res, {
        message: fresh.status === PAYOUT_STATUS.PAID ? "Payout approved and completed" : "Payout approved — dispatching to gateway",
        data: {
          payoutId:                 fresh._id,
          status:                   fresh.status,
          amountInPaise:            fresh.amountInPaise,
          amountInRupees:           p2(fresh.amountInPaise),
          utr:                      fresh.utr,
          providerStatus:           fresh.providerStatus,
          availableBalanceInPaise:  wallet?.availableBalanceInPaise ?? 0,
          availableBalanceInRupees: p2(wallet?.availableBalanceInPaise),
        },
      });
    }

    // MANUAL (default) — settle synchronously, own transaction, exactly
    // mirroring what this endpoint already did in one shot before this
    // ticket (same SettlementEngine call, same fields persisted). Same
    // transient-conflict retry as Phase 1 — a concurrent/resumed
    // approval racing into this same settlement transaction must not
    // leak a raw Mongo error either.
    const settled = await withTxn(async (session2) => {
      const fresh = await PayoutRequest.findById(payout._id).session(session2);
      if (fresh.status !== PAYOUT_STATUS.APPROVED) {
        // Already settled by a concurrent/previous resumed attempt —
        // idempotent no-op, return the real current state.
        return fresh;
      }
      const result = await SettlementEngine.execute({ payout: fresh, adminId, utr, adminNote, session: session2 });
      fresh.status           = result.status;
      fresh.utr              = result.utr;
      fresh.providerPayoutId = result.providerPayoutId;
      fresh.providerResponse = result.providerResponse;
      fresh.adminNote        = adminNote || fresh.adminNote || null;
      await fresh.save({ session: session2 });
      return fresh;
    });

    await notifyApproved(settled);

    const wallet = await WalletBalanceService.getWallet(settled.salonId);
    return successResponse(res, {
      message: "Payout approved and completed",
      data: {
        payoutId:                 settled._id,
        status:                   settled.status,
        amountInPaise:            settled.amountInPaise,
        amountInRupees:           p2(settled.amountInPaise),
        utr:                      settled.utr,
        availableBalanceInPaise:  wallet?.availableBalanceInPaise ?? 0,
        availableBalanceInRupees: p2(wallet?.availableBalanceInPaise),
      },
    });
  } catch (err) {
    // The approval itself is already committed and safe (see header).
    // A MANUAL-path failure here surfaces as a real error to the admin,
    // same as this endpoint already did before this ticket. The payout
    // is left at APPROVED, re-resumable by a repeat approve call.
    return next(err);
  }
};

/** Non-blocking "approved" notification, shared by both provider branches. */
const notifyApproved = (payout) =>
  NotificationService.send({
    recipientId:   payout.salonId,
    recipientType: "SALON",
    templateKey:   NOTIFICATION_EVENTS.WITHDRAW_APPROVED,
    variables:     { amount: p2(payout.amountInPaise) },
    title:         "Withdrawal Approved ✅",
    message:       `Your withdrawal of ₹${p2(payout.amountInPaise)} has been approved.`,
    type:          "PAYMENT",
    priority:      "HIGH",
    actionType:    "OPEN_WALLET",
    actionUrl:     "/wallet",
    meta:          { payoutId: payout._id, amountInPaise: payout.amountInPaise },
  }).catch(() => {});

/**
 * PATCH /api/payouts/admin/reject/:id
 * Flow: REQUESTED(LOCKED) → REJECTED(AVAILABLE)
 * ✅ Explicit abort before early returns
 */
export const rejectPayout = async (req, res, next) => {
  if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid payout ID"));

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await PayoutRequest.findById(req.params.id).session(session);
    if (!payout) {
      await session.abortTransaction();
      return next(Errors.notFound("Payout request not found"));
    }

    const targetSalon = await Salon.findOne({ _id: payout.salonId, isDeleted: { $ne: true } })
      .select("location.territory.stateRef location.territory.districtRef")
      .lean();
    if (!targetSalon || !isSalonWithinPayoutScope(req.user, targetSalon)) {
      await session.abortTransaction();
      return next(Errors.forbidden("Out of your authorized scope"));
    }

    // FINANCE-P0-1 — widened from REQUESTED-only to also allow APPROVED:
    // the canonical blueprint's own cutoff is "no rejection after
    // gateway dispatch" (i.e. once PROCESSING), not "no rejection after
    // approval" — an APPROVED-but-not-yet-PROCESSING payout (the narrow
    // crash-recovery window, or simply an admin reconsidering before
    // dispatch has actually run) must still be rejectable. PROCESSING/
    // PAID/FAILED/REJECTED/CANCELLED remain correctly blocked.
    if (![PAYOUT_STATUS.REQUESTED, PAYOUT_STATUS.APPROVED].includes(payout.status)) {
      await session.abortTransaction();
      return next(Errors.conflict(`Cannot reject — current status is ${payout.status}`));
    }

    const adminId   = req.user?._id ?? null;
    const adminNote = req.body.adminNote || "Admin rejected payout";

    await WalletBalanceService.release({
      salonId:       payout.salonId,
      amountInPaise: payout.amountInPaise,
      refType:       "WITHDRAWAL",
      refId:         payout._id,
      idempotencyKey:`payout:reject:${payout._id}`,
      session,
      triggeredBy:   "ADMIN",
      triggeredById: adminId,
      remarks:       adminNote,
    });

    payout.status    = PAYOUT_STATUS.REJECTED;
    payout.adminNote = adminNote;
    await payout.save({ session });

    await session.commitTransaction();

    //////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after commit)
    //////////////////////////////////////////////////////

    await NotificationService.send({
      recipientId:   payout.salonId,
      recipientType: "SALON",
      templateKey:   NOTIFICATION_EVENTS.WITHDRAW_REJECTED,
      variables:     { amount: p2(payout.amountInPaise), reason: adminNote },
      title:         "Withdrawal Rejected",
      message:       `Your withdrawal request of ₹${p2(payout.amountInPaise)} was rejected. Reason: ${adminNote}`,
      type:          "PAYMENT",
      priority:      "HIGH",
      actionType:    "OPEN_WALLET",
      actionUrl:     "/wallet",
      meta:          { payoutId: payout._id, amountInPaise: payout.amountInPaise },
    });

    const wallet = await WalletBalanceService.getWallet(payout.salonId);

    return successResponse(res, {
      message: "Payout rejected — funds released to available balance",
      data: {
        payoutId:                payout._id,
        status:                  payout.status,
        availableBalanceInPaise: wallet?.availableBalanceInPaise  ?? 0,
        availableBalanceInRupees:p2(wallet?.availableBalanceInPaise),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally {
    session.endSession();
  }
};

/**
 * GET /api/payouts/admin/summary
 * ✅ All statuses including CANCELLED
 */
export const getPayoutSummary = async (req, res, next) => {
  try {
    const scope = await resolveAdminPayoutScope(req.user);
    const matchStage = scope.unrestricted ? {} : { salonId: { $in: scope.salonIds } };

    const [agg] = await PayoutRequest.aggregate([
      { $match: matchStage },
      { $group: {
        _id:                    null,
        total:                  { $sum: 1 },
        requested:              { $sum: { $cond: [{ $eq: ["$status","REQUESTED"]  }, 1, 0] } },
        // FINANCE-P0-1 — additive bucket for the new APPROVED state.
        approved:               { $sum: { $cond: [{ $eq: ["$status","APPROVED"]   }, 1, 0] } },
        processing:             { $sum: { $cond: [{ $eq: ["$status","PROCESSING"] }, 1, 0] } },
        paid:                   { $sum: { $cond: [{ $eq: ["$status","PAID"]       }, 1, 0] } },
        rejected:               { $sum: { $cond: [{ $eq: ["$status","REJECTED"]   }, 1, 0] } },
        failed:                 { $sum: { $cond: [{ $eq: ["$status","FAILED"]     }, 1, 0] } },
        cancelled:              { $sum: { $cond: [{ $eq: ["$status","CANCELLED"]  }, 1, 0] } },
        totalPaidInPaise:       { $sum: { $cond: [{ $eq: ["$status","PAID"]       }, "$amountInPaise", 0] } },
        totalRequestedInPaise:  { $sum: { $cond: [{ $eq: ["$status","REQUESTED"]  }, "$amountInPaise", 0] } },
        totalProcessingInPaise: { $sum: { $cond: [{ $eq: ["$status","PROCESSING"] }, "$amountInPaise", 0] } },
        totalFailedInPaise:     { $sum: { $cond: [{ $eq: ["$status","FAILED"]     }, "$amountInPaise", 0] } },
        totalRejectedInPaise:   { $sum: { $cond: [{ $eq: ["$status","REJECTED"]   }, "$amountInPaise", 0] } },
      },
    }]);

    const d = agg || {};
    return successResponse(res, {
      message: "Payout summary fetched",
      data: {
        total:                   d.total                  ?? 0,
        requested:               d.requested              ?? 0,
        approved:                d.approved               ?? 0, // FINANCE-P0-1 — additive
        processing:              d.processing             ?? 0,
        paid:                    d.paid                   ?? 0,
        rejected:                d.rejected               ?? 0,
        failed:                  d.failed                 ?? 0,
        cancelled:               d.cancelled              ?? 0,
        totalPaidInPaise:        d.totalPaidInPaise       ?? 0,
        totalPaidInRupees:       p2(d.totalPaidInPaise),
        totalRequestedInPaise:   d.totalRequestedInPaise  ?? 0,
        totalRequestedInRupees:  p2(d.totalRequestedInPaise),
        totalProcessingInPaise:  d.totalProcessingInPaise ?? 0,
        totalProcessingInRupees: p2(d.totalProcessingInPaise),
        totalFailedInPaise:      d.totalFailedInPaise     ?? 0,
        totalFailedInRupees:     p2(d.totalFailedInPaise),
        totalRejectedInPaise:    d.totalRejectedInPaise   ?? 0,
        totalRejectedInRupees:   p2(d.totalRejectedInPaise),
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/payouts/admin/list
 *
 * ✅ FIXED (Phase 8) — the old populate used `"name location.address.city"`
 * which don't exist on the Salon schema (verified against models/Salon.js).
 * Real paths are `basicInfo.shopName` and `location.territory.cityRef`
 * (a City document reference, not a string). This was silently returning
 * undefined for salon name/city on every row. Also added owner name/phone
 * via a nested populate on salonId.ownerId.
 */
export const listPayouts = async (req, res, next) => {
  try {
    const { status = "ALL", page = 1, limit = 20 } = req.query;
    const pageNum  = Math.max(parseInt(page,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const filter = {};
    if (status !== "ALL") filter.status = status;

    const scope = await resolveAdminPayoutScope(req.user);
    if (!scope.unrestricted) filter.salonId = { $in: scope.salonIds };

    const [payouts, total] = await Promise.all([
      PayoutRequest.find(filter)
        .populate({
          path:   "salonId",
          select: "basicInfo.shopName location.territory.cityRef ownerId",
          populate: [
            { path: "location.territory.cityRef", select: "name" },
            { path: "ownerId", select: "name phone" },
          ],
        })
        .populate("approvedBy", "name adminLevel")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PayoutRequest.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Payout list fetched",
      data: payouts.map(p => ({
        id: p._id,
        salon: {
          id:   p.salonId?._id,
          name: p.salonId?.basicInfo?.shopName,
          city: p.salonId?.location?.territory?.cityRef?.name,
        },
        owner: p.salonId?.ownerId ? {
          id:    p.salonId.ownerId._id,
          name:  p.salonId.ownerId.name,
          phone: p.salonId.ownerId.phone,
        } : null,
        amountInPaise:  p.amountInPaise,
        amountInRupees: p2(p.amountInPaise),
        status:         p.status,
        utr:            p.utr,
        provider:       p.payoutProvider,
        providerStatus: p.providerStatus ?? null, // FINANCE-P0-1 — additive
        approvedBy:     p.approvedBy ? { id: p.approvedBy._id, name: p.approvedBy.name } : null,
        approvedAt:     p.approvedAt,
        processingAt:   p.processingAt ?? null,    // FINANCE-P0-1 — additive
        adminNote:      p.adminNote,
        failureReason:  p.failureReason,
        createdAt:      p.createdAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/payouts/admin/detail/:id
 *
 * NEW (Phase 8). Joins:
 *   PayoutRequest → Salon (shop name, city, ownerId)
 *   Salon.ownerId → User (owner name, phone)
 *   Salon.ownerId → KYC.ownerId (bank.*, verification.bank, status)
 *   Salon._id     → WalletBalanceService (live balance snapshot)
 *
 * Security: only KYC.bank.maskedAccount is ever returned — never
 * encryptedAccount (stays server-side only, matching the discipline
 * already established in KYC.js's own file-header comment).
 *
 * Not called from the list screen (that would be N+1) — only fetched
 * on-demand when the admin opens a single payout's detail view.
 */
export const getPayoutDetail = async (req, res, next) => {
  if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid payout ID"));

  try {
    const payout = await PayoutRequest.findById(req.params.id)
      .populate("approvedBy", "name adminLevel")
      .lean();

    if (!payout) return next(Errors.notFound("Payout request not found"));

    const salon = await Salon.findById(payout.salonId)
      .select("basicInfo.shopName location.address location.territory.cityRef location.territory.stateRef location.territory.districtRef ownerId")
      .populate("location.territory.cityRef", "name")
      .lean();

    if (!isSalonWithinPayoutScope(req.user, salon)) {
      return next(Errors.forbidden("Out of your authorized scope"));
    }

    const [owner, kyc, wallet] = await Promise.all([
      salon?.ownerId ? User.findById(salon.ownerId).select("name phone email").lean() : null,
      salon?.ownerId ? KYC.findOne({ ownerId: salon.ownerId })
        .select("status bank.accountHolder bank.maskedAccount bank.ifsc bank.bankName verification.bank")
        .lean() : null,
      WalletBalanceService.getWallet(payout.salonId),
    ]);

    return successResponse(res, {
      message: "Payout detail fetched",
      data: {
        id:             payout._id,
        status:         payout.status,
        amountInPaise:  payout.amountInPaise,
        amountInRupees: p2(payout.amountInPaise),
        currency:       payout.currency,
        provider:       payout.payoutProvider,
        providerStatus: payout.providerStatus ?? null, // FINANCE-P0-1 — additive
        providerPayoutId: payout.providerPayoutId ?? null, // FINANCE-P0-1 — additive
        utr:            payout.utr,
        adminNote:      payout.adminNote,
        failureReason:  payout.failureReason,
        approvedBy:     payout.approvedBy ? { id: payout.approvedBy._id, name: payout.approvedBy.name } : null,
        approvedAt:     payout.approvedAt,
        processingAt:   payout.processingAt ?? null, // FINANCE-P0-1 — additive
        cancelledAt:    payout.cancelledAt,
        createdAt:      payout.createdAt,
        updatedAt:      payout.updatedAt,

        salon: salon ? {
          id:      salon._id,
          name:    salon.basicInfo?.shopName,
          address: salon.location?.address,
          city:    salon.location?.territory?.cityRef?.name,
        } : null,

        owner: owner ? {
          id:    owner._id,
          name:  owner.name,
          phone: owner.phone,
          email: owner.email,
        } : null,

        kyc: kyc ? {
          status:                  kyc.status,
          bankVerified:            kyc.verification?.bank?.verified ?? false,
          bankVerificationStatus:  kyc.verification?.bank?.status ?? "NOT_SUBMITTED",
          bank: {
            accountHolder: kyc.bank?.accountHolder ?? null,
            maskedAccount: kyc.bank?.maskedAccount ?? null,
            ifsc:          kyc.bank?.ifsc ?? null,
            bankName:      kyc.bank?.bankName ?? null,
          },
        } : null,

        wallet: {
          availableBalanceInPaise:  wallet?.availableBalanceInPaise  ?? 0,
          lockedBalanceInPaise:     wallet?.lockedBalanceInPaise     ?? 0,
          processingBalanceInPaise: wallet?.processingBalanceInPaise ?? 0,
        },
      },
    });
  } catch (err) { next(err) }
};