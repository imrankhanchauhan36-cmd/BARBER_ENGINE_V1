/**
 * BARBER ENGINE V1
 * backend/controllers/payout.controller.js
 * Owner Payout Controller — Phase 7 — 10/10 FROZEN
 */

import mongoose from "mongoose";
import PayoutRequest, { PAYOUT_STATUS } from "../models/PayoutRequest.js";
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

/**
 * GET /api/payouts/wallet
 */
export const getWallet = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const salon   = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
    if (!salon) return next(Errors.notFound("Salon not found"));

    const wallet = await WalletBalanceService.getWallet(salon._id);
    const openPayout = await PayoutRequest.findOne({
      salonId: salon._id,
      status:  PAYOUT_STATUS.REQUESTED,
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
    const salon   = await Salon.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("_id")
      .session(session)
      .lean();

    if (!salon) {
      await session.abortTransaction(); // ✅ explicit abort
      return next(Errors.notFound("Salon not found"));
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
      status:  PAYOUT_STATUS.REQUESTED,
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
      entityType:    "WITHDRAWAL",
      entityId:      payout._id,           // ← real reference, not null
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
    const salon   = await Salon.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("_id")
      .session(session)
      .lean();

    if (!salon) {
      await session.abortTransaction(); // ✅ explicit abort
      return next(Errors.notFound("Salon not found"));
    }

    const payout = await PayoutRequest.findOne({
      _id:     req.params.id,
      salonId: salon._id,
    }).session(session);

    if (!payout) {
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
      entityType:    "WITHDRAWAL",
      entityId:      payout._id,
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
    const salon   = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
    if (!salon) return next(Errors.notFound("Salon not found"));

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
    const salon   = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
    if (!salon) return next(Errors.notFound("Salon not found"));

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