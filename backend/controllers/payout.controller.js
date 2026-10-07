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
import { requestSalonPayout } from "../services/salonPayout.service.js"; // FINANCE-P0-1
import { Errors, successResponse } from "../utils/response.js";

// ✅ Fix — SalonEarnings import REMOVED (unused)
// All wallet operations go through WalletBalanceService only

const isValidId     = (id) => mongoose.Types.ObjectId.isValid(id);
const p2            = (v)  => Math.round(v ?? 0) / 100;

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
 * FINANCE-P0-1 — the actual creation logic (KYC gate, amount
 * validation, open-request check, hold, create, notify) now lives in
 * services/salonPayout.service.js#requestSalonPayout, shared with
 * modules/wallet/controllers/wallet.controller.js#requestPayoutHandler
 * (which must delegate here for a SALON caller instead of creating a
 * GenericPayoutRequest — ticket §17). This controller's own observable
 * behavior (checks, order, error types, response shape) is unchanged.
 */
export const requestWithdrawal = async (req, res, next) => {
  try {
    const { payout } = await requestSalonPayout({ ownerId: req.user._id, amountInPaise: req.body.amountInPaise });

    return successResponse(res, {
      message: "Withdrawal request submitted",
      data: {
        payoutId:       payout._id,
        amountInPaise:  payout.amountInPaise,
        amountInRupees: p2(payout.amountInPaise),
        status:         payout.status,
      },
    });
  } catch (err) {
    next(err);
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
        providerStatus: p.providerStatus ?? null, // FINANCE-P0-1 — additive
        approvedAt:     p.approvedAt,
        processingAt:   p.processingAt ?? null,   // FINANCE-P0-1 — additive
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