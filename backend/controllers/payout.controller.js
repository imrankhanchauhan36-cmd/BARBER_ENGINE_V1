/**
 * BARBER ENGINE V1
 * backend/controllers/payout.controller.js
 * Owner Payout Controller — Phase 7 — 10/10 FROZEN
 */

import mongoose from "mongoose";
import PayoutRequest, { PAYOUT_STATUS, OPEN_PAYOUT_STATUSES } from "../models/PayoutRequest.js";
import Salon from "../models/Salon.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import WalletLedger from "../models/WalletLedger.js";
import KYC from "../modules/kyc/models/KYC.js";
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { Errors, successResponse } from "../utils/response.js";

// ✅ Fix — SalonEarnings import REMOVED (unused)
// All wallet operations go through WalletBalanceService only

const isValidId     = (id) => mongoose.Types.ObjectId.isValid(id);
const p2            = (v)  => Math.round(v ?? 0) / 100;
const MIN_PAISE     = 10000; // ₹100 minimum withdrawal

// ─── Salon-Ambiguity Guard (getWallet/requestWithdrawal/
//      getPayoutHistory/getLedger) ───────────────────────
// Same fail-closed shape already used in deviceToken.controller.js /
// notification.controller.js / booking.controller.js /
// salon.me.controller.js — duplicated locally per this codebase's own
// established per-file convention, not imported.
//
// No route in this file accepts a client-supplied salonId today (by
// design — out of scope to add one in this phase), so this resolves
// from ownerId ALONE, exactly like the unscoped query it replaces —
// deliberately NOT filtered on approval.status, unlike the booking/
// notification siblings: a DRAFT/PENDING salon's wallet is legitimately
// readable today (an all-zero balance, not an error), so narrowing to
// APPROVED-only would silently 404 a single-salon owner whose salon
// isn't approved yet — a real regression this fix must not introduce.
// "Eligible" here means exactly what the old query already matched
// (ownerId, not soft-deleted) — only now counted instead of blindly
// taking the first result:
//   0 matches  -> SALON_NOT_FOUND (byte-identical to today's 404)
//   1 match    -> that salon (byte-identical to today's behavior)
//   2+ matches -> SALON_AMBIGUOUS, fails closed with 409 instead of
//                 the old non-deterministic silent pick (the bug this
//                 fix closes — see the diagnosis report).
const resolveOwnerSalonOrThrow = async (ownerId, session = null) => {
  let query = Salon.find({ ownerId, isDeleted: { $ne: true } }).select("_id").limit(2).lean();
  if (session) query = query.session(session);
  const candidates = await query;
  if (candidates.length === 0) throw new Error("SALON_NOT_FOUND");
  if (candidates.length > 1) throw new Error("SALON_AMBIGUOUS");
  return candidates[0];
};

const payoutSalonErrorResponse = (res, err) => {
  if (err.message === "SALON_AMBIGUOUS") {
    return res.status(409).json({
      success: false,
      code: "AMBIGUOUS_SALON",
      message: "You own more than one salon. This operation does not yet support selecting a specific salon.",
    });
  }
  return res.status(404).json({ success: false, message: "Salon not found" });
};

/**
 * GET /api/payouts/wallet
 */
export const getWallet = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    let salon;
    try {
      salon = await resolveOwnerSalonOrThrow(ownerId);
    } catch (err) {
      return payoutSalonErrorResponse(res, err);
    }

    const wallet = await WalletBalanceService.getWallet(salon._id);
    const openPayout = await PayoutRequest.findOne({
      salonId: salon._id,
      status:  { $in: OPEN_PAYOUT_STATUSES },
    }).lean();

    return successResponse(res, {
      message: "Wallet fetched",
      data: {
        salonId:  salon._id,
        currency: wallet?.currency ?? "INR",

        // ✅ Fix — all buckets with both paise + rupees
        availableBalanceInPaise:     wallet?.availableBalanceInPaise    ?? 0,
        availableBalanceInRupees:    p2(wallet?.availableBalanceInPaise),
        pendingBalanceInPaise:       wallet?.pendingBalanceInPaise      ?? 0,
        pendingBalanceInRupees:      p2(wallet?.pendingBalanceInPaise),
        lockedBalanceInPaise:        wallet?.lockedBalanceInPaise       ?? 0,
        lockedBalanceInRupees:       p2(wallet?.lockedBalanceInPaise),
        processingBalanceInPaise:    wallet?.processingBalanceInPaise   ?? 0,
        processingBalanceInRupees:   p2(wallet?.processingBalanceInPaise),

        lifetimeEarningsInPaise:     wallet?.lifetimeEarningsInPaise    ?? 0,
        lifetimeEarningsInRupees:    p2(wallet?.lifetimeEarningsInPaise),
        lifetimeWithdrawalsInPaise:  wallet?.lifetimeWithdrawalsInPaise ?? 0,
        lifetimeWithdrawalsInRupees: p2(wallet?.lifetimeWithdrawalsInPaise),

        lastPayoutAt:                wallet?.lastPayoutAt ?? null,
        lastPayoutAmountInPaise:     wallet?.lastPayoutAmountInPaise ?? 0,
        lastPayoutAmountInRupees:    p2(wallet?.lastPayoutAmountInPaise),

        openPayoutRequest: openPayout ? {
          id:             openPayout._id,
          amountInPaise:  openPayout.amountInPaise,
          amountInRupees: p2(openPayout.amountInPaise),
          status:         openPayout.status,
          createdAt:      openPayout.createdAt,
        } : null,
      },
    });
  } catch (err) { next(err) }
};

/**
 * POST /api/payouts/withdraw
 *
 * ✅ Fix — PayoutRequest created FIRST, then hold() with real entityId
 *   This ensures WalletLedger always has a valid entity reference.
 *   Flow: create REQUESTED payout → hold(AVAILABLE→LOCKED) with payout._id
 *   If hold fails → transaction aborts → payout creation rolled back
 */
export const requestWithdrawal = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const ownerId = req.user._id;
    let salon;
    try {
      salon = await resolveOwnerSalonOrThrow(ownerId, session);
    } catch (err) {
      // ✅ explicit abort — ambiguous or missing salon must never reach
      // the hold()/PayoutRequest.create() below; no funds are ever
      // held and no payout row is ever created for this attempt.
      await session.abortTransaction();
      return payoutSalonErrorResponse(res, err);
    }

    // ✅ Wallet Phase 3C — bank verification gate. Reuses the existing
    // KYC.verification.bank.verified field (set only via the admin
    // PATCH .../verify-bank action) as the sole source of truth — no
    // new field, no new status value, no new model. Covers all of:
    // no KYC record, no bank submitted, bank pending, bank rejected —
    // every one of those leaves verification.bank.verified !== true.
    const kyc = await KYC.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("verification.bank.verified")
      .session(session)
      .lean();

    if (kyc?.verification?.bank?.verified !== true) {
      await session.abortTransaction();
      return next(Errors.forbidden("Your bank account must be verified before you can request a withdrawal. Please complete KYC bank verification first."));
    }

    const { amountInPaise } = req.body;

    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
      await session.abortTransaction();
      return next(Errors.badRequest("amountInPaise must be a positive integer"));
    }
    if (amountInPaise < MIN_PAISE) {
      await session.abortTransaction();
      return next(Errors.badRequest(`Minimum withdrawal is ₹${MIN_PAISE / 100}`));
    }

    // Check no open payout
    const existing = await PayoutRequest.findOne({
      salonId: salon._id,
      status:  { $in: OPEN_PAYOUT_STATUSES },
    }).session(session).lean();

    if (existing) {
      await session.abortTransaction();
      return next(Errors.conflict("A withdrawal request is already pending. Cancel it first."));
    }

    // ✅ Fix — Create payout FIRST to get a real _id
    const [payout] = await PayoutRequest.create([{
      salonId:       salon._id,
      amountInPaise,
      status:        PAYOUT_STATUS.REQUESTED,
    }], { session });

    // ✅ Fix — hold() now has real entityId (payout._id)
    // ✅ Fix — idempotency key based on payout._id (not Date.now)
    //          so retries are safe no-ops
    await WalletBalanceService.hold({
      salonId:       salon._id,
      amountInPaise,
      refType:       "WITHDRAWAL",
      refId:         payout._id,           // ← real reference, not null
      idempotencyKey:`payout:hold:${payout._id}`, // ← stable, retry-safe
      session,
      triggeredBy:   "OWNER",
      triggeredById: ownerId,
      remarks:       `Withdrawal request — ₹${p2(amountInPaise)}`,
    });

    await session.commitTransaction();

    //////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after commit)
    //////////////////////////////////////////////////////

    await NotificationService.send({
      recipientId:   salon._id,
      recipientType: "SALON",
      templateKey:   NOTIFICATION_EVENTS.WITHDRAW_REQUESTED,
      variables:     { amount: p2(amountInPaise) },
      title:         "Withdrawal Requested",
      message:       `Your withdrawal request for ₹${p2(amountInPaise)} has been submitted.`,
      type:          "PAYMENT",
      priority:      "MEDIUM",
      actionType:    "OPEN_WALLET",
      actionUrl:     "/wallet",
      meta:          { payoutId: payout._id, amountInPaise },
    });

    return successResponse(res, {
      message: "Withdrawal request submitted",
      data: {
        payoutId:       payout._id,
        amountInPaise,
        amountInRupees: p2(amountInPaise),
        status:         PAYOUT_STATUS.REQUESTED,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    // FA-P4-B Step 2 — two concurrent requests can both pass the
    // pre-check above; the salonId_open_unique partial index is what
    // actually stops the second. Report that as the same 409 the
    // pre-check gives, not a 500.
    if (err?.code === 11000) {
      return next(Errors.conflict("A withdrawal request is already pending. Cancel it first."));
    }
    next(err);
  } finally {
    session.endSession();
  }
};

/**
 * POST /api/payouts/cancel/:id
 * ✅ Fix — isValidId check added
 * ✅ Fix — explicit abortTransaction before early returns
 */
export const cancelWithdrawal = async (req, res, next) => {
  // ✅ Fix — ObjectId validation
  if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid payout ID"));

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const ownerId = req.user._id;

    // ✅ Fix — authoritative-record scoping (same shape as the
    // already-fixed ownerCancelBooking in booking.controller.js). The
    // payout's own salonId is the authoritative reference, so it is
    // fetched by _id FIRST; ownership is then verified against THAT
    // salon, rather than resolving "the" salon from ownerId alone
    // first (unscoped Salon.findOne({ownerId}) — ambiguous for an
    // owner with 2+ real salons) and filtering the payout lookup by
    // whichever salon that unscoped query happened to return. The old
    // order could false-negative (404) an owner cancelling their own
    // real withdrawal if the unscoped lookup picked their OTHER
    // salon; it could never leak or mutate a different owner's
    // payout, since the salon-ownership check below still requires
    // ownerId to match the real caller.
    const payout = await PayoutRequest.findOne({ _id: req.params.id }).session(session);

    if (!payout) {
      await session.abortTransaction();
      return next(Errors.notFound("Payout request not found"));
    }

    const salon = await Salon.findOne({ _id: payout.salonId, ownerId, isDeleted: { $ne: true } })
      .select("_id")
      .session(session)
      .lean();

    // Same 404 for "doesn't exist" and "belongs to a different owner"
    // — matches this payout's prior non-disclosure behavior, and
    // never discloses whether the id belongs to someone else.
    if (!salon) {
      await session.abortTransaction();
      return next(Errors.notFound("Payout request not found"));
    }

    if (payout.status !== PAYOUT_STATUS.REQUESTED) {
      await session.abortTransaction();
      return next(Errors.conflict(`Cannot cancel — current status is ${payout.status}`));
    }

    // LOCKED → AVAILABLE
    await WalletBalanceService.release({
      salonId:       salon._id,
      amountInPaise: payout.amountInPaise,
      refType:       "WITHDRAWAL",
      refId:         payout._id,
      idempotencyKey:`payout:cancel:${payout._id}`,
      session,
      triggeredBy:   "OWNER",
      triggeredById: ownerId,
      remarks:       "Owner cancelled withdrawal request",
    });

    payout.status      = PAYOUT_STATUS.CANCELLED;
    payout.cancelledAt = new Date();
    await payout.save({ session });

    await session.commitTransaction();

    // Read after commit
    const wallet = await WalletBalanceService.getWallet(salon._id);

    return successResponse(res, {
      message: "Withdrawal cancelled — funds returned to available balance",
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
 * GET /api/payouts/history
 * ✅ Fix — parseInt with radix 10
 */
export const getPayoutHistory = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    let salon;
    try {
      salon = await resolveOwnerSalonOrThrow(ownerId);
    } catch (err) {
      return payoutSalonErrorResponse(res, err);
    }

    // ✅ Fix — parseInt radix 10
    const pageNum  = Math.max(parseInt(req.query.page  ?? 1, 10), 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 20, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const [payouts, total] = await Promise.all([
      PayoutRequest.find({ salonId: salon._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PayoutRequest.countDocuments({ salonId: salon._id }),
    ]);

    return successResponse(res, {
      message: "Payout history fetched",
      data: payouts.map(p => ({
        id:             p._id,
        amountInPaise:  p.amountInPaise,
        amountInRupees: p2(p.amountInPaise),
        status:         p.status,
        utr:            p.utr,
        provider:       p.payoutProvider,
        approvedAt:     p.approvedAt,
        cancelledAt:    p.cancelledAt,
        failureReason:  p.failureReason,
        createdAt:      p.createdAt,
      })),
      pagination: {
        page:       pageNum,
        limit:      limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/payouts/ledger
 *
 * Wallet Phase 3B — owner-facing WalletLedger read. Mirrors
 * adminFinance.controller.js's getSalonLedger exactly (same query
 * shape, same pagination convention) but salonId is ALWAYS derived
 * from the authenticated owner (never a client-supplied param, as
 * the admin route takes) — an owner can only ever see their own
 * salon's ledger. Read-only; does not touch WalletBalanceService,
 * does not write anything.
 *
 * entityType/entityId are the real, generic fields WalletLedger
 * actually stores — there is no separate bookingId/payoutId column.
 * bookingId/payoutId below are derived, not stored, exactly mirroring
 * the only two entityType values anything in this codebase ever
 * writes ("BOOKING" and "WITHDRAWAL" — "PAYOUT" is defined in the
 * enum but never used at any real write site, verified by grep).
 */
export const getLedger = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    let salon;
    try {
      salon = await resolveOwnerSalonOrThrow(ownerId);
    } catch (err) {
      return payoutSalonErrorResponse(res, err);
    }

    const pageNum  = Math.max(parseInt(req.query.page  ?? 1,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 20, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const filter = { salonId: salon._id };

    const [entries, total] = await Promise.all([
      WalletLedger.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      WalletLedger.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Wallet ledger fetched",
      data: entries.map(e => ({
        id:             e._id,
        direction:      e.direction,
        bucket:         e.bucket,
        action:         e.action,
        amountInPaise:  e.amountInPaise,
        amountInRupees: p2(e.amountInPaise),
        currency:       e.currency ?? "INR",
        entityType:     e.entityType,
        entityId:       e.entityId,
        bookingId:      e.entityType === "BOOKING"    ? e.entityId : null,
        payoutId:       e.entityType === "WITHDRAWAL" ? e.entityId : null,
        balanceAfter:   e.balanceAfter ?? null,
        triggeredBy:    e.triggeredBy,
        remarks:        e.remarks ?? null,
        createdAt:      e.createdAt,
      })),
      pagination: {
        page:       pageNum,
        limit:      limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) { next(err) }
};