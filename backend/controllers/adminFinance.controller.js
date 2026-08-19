/**
 * BARBER ENGINE V1
 * backend/controllers/adminFinance.controller.js
 * Admin Finance Controller — Phase 7 — 10/10 FROZEN
 */

import mongoose from "mongoose";
import PayoutRequest from "../models/PayoutRequest.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Transaction from "../models/Transaction.js";
import WalletLedger from "../models/WalletLedger.js";
import { Errors, successResponse } from "../utils/response.js";

const p2 = (v) => Math.round(v ?? 0) / 100;

/**
 * Admin geographic scope, applied to every finance query below.
 * Same convention already used in admin.controller.js / adminUser.controller.js /
 * adminStaff.controller.js / modules/kyc/controllers/adminKyc.controller.js:
 *   INDIA    → unrestricted (returns { unrestricted: true })
 *   STATE    → only salons whose location.territory.stateRef matches admin.stateRef
 *   DISTRICT → only salons whose location.territory.districtRef matches admin.districtRef
 *   anything else (missing/unrecognized adminLevel) → fail closed, zero salons
 */
const resolveAdminFinanceScope = async (admin) => {
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
 * For endpoints that take a single :salonId / resolve one target salon —
 * verifies that salon is inside the admin's authorized territory. Never
 * trusts the client-supplied ID as authorization by itself.
 */
const isSalonWithinScope = (admin, salon) => {
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

// ✅ Safe date parser — throws on invalid strings like "abc"
// Throw pattern is cleaner than returning undefined + caller null-check
const parseDate = (str, fieldName) => {
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error(`Invalid ${fieldName} date`), { status: 400 });
  }
  return d;
};

/**
 * GET /api/admin/finance/summary
 */
export const getFinanceSummary = async (req, res, next) => {
  try {
    const scope = await resolveAdminFinanceScope(req.user);
    if (!scope.unrestricted && scope.salonIds.length === 0) {
      return successResponse(res, {
        message: "Finance summary fetched",
        data: {
          wallets: { count: 0, totalAvailableInPaise: 0, totalAvailableInRupees: 0, totalPendingInPaise: 0, totalPendingInRupees: 0, totalLockedInPaise: 0, totalLockedInRupees: 0, totalProcessingInPaise: 0, totalProcessingInRupees: 0, lifetimeEarningsInPaise: 0, lifetimeEarningsInRupees: 0, lifetimePayoutsInPaise: 0, lifetimePayoutsInRupees: 0 },
          payouts: { pendingCount: 0, processingCount: 0, paidCount: 0, rejectedCount: 0, totalPaidInPaise: 0, totalPaidInRupees: 0, totalRequestedInPaise: 0, totalRequestedInRupees: 0 },
          transactions: { totalBookings: 0, paidBookings: 0, successRate: 0, totalRevenueInPaise: 0, totalRevenueInRupees: 0, totalCommissionInPaise: 0, totalCommissionInRupees: 0, avgBookingValueInPaise: 0, avgBookingValueInRupees: 0 },
        },
      });
    }
    const salonMatch = scope.unrestricted ? {} : { salonId: { $in: scope.salonIds } };

    const [walletAgg, payoutAgg, txnAgg] = await Promise.all([
      SalonEarnings.aggregate([
        { $match: salonMatch },
        { $group: {
          _id:                          null,
          totalAvailableInPaise:        { $sum: "$availableBalanceInPaise"    },
          totalPendingInPaise:          { $sum: "$pendingBalanceInPaise"      },
          totalLockedInPaise:           { $sum: "$lockedBalanceInPaise"       },
          totalProcessingInPaise:       { $sum: "$processingBalanceInPaise"   },
          totalLifetimeEarningsInPaise: { $sum: "$lifetimeEarningsInPaise"   },
          totalLifetimePayoutsInPaise:  { $sum: "$lifetimeWithdrawalsInPaise" },
          walletCount:                  { $sum: 1 },
        },
      }]),
      PayoutRequest.aggregate([
        { $match: salonMatch },
        { $group: {
          _id:                   null,
          totalPaidInPaise:      { $sum: { $cond: [{ $eq: ["$status","PAID"]       }, "$amountInPaise", 0] } },
          totalRequestedInPaise: { $sum: { $cond: [{ $eq: ["$status","REQUESTED"]  }, "$amountInPaise", 0] } },
          pendingCount:          { $sum: { $cond: [{ $eq: ["$status","REQUESTED"]  }, 1, 0] } },
          processingCount:       { $sum: { $cond: [{ $eq: ["$status","PROCESSING"] }, 1, 0] } },
          paidCount:             { $sum: { $cond: [{ $eq: ["$status","PAID"]       }, 1, 0] } },
          rejectedCount:         { $sum: { $cond: [{ $eq: ["$status","REJECTED"]   }, 1, 0] } },
        },
      }]),
      Transaction.aggregate([
        { $match: salonMatch },
        { $group: {
          _id:                 null,
          totalRevenueInPaise: { $sum: { $cond: [{ $eq: ["$status","PAID"] }, "$amount", 0] } },
          totalBookings:       { $sum: 1 },
          paidBookings:        { $sum: { $cond: [{ $eq: ["$status","PAID"] }, 1, 0] } },
          // Medium 2 — commission + avg booking value
          totalCommissionInPaise: { $sum: { $cond: [{ $eq: ["$status","PAID"] }, "$commission", 0] } },
          totalBookingAmount:     { $sum: { $cond: [{ $eq: ["$status","PAID"] }, "$amount", 0] } },
        },
      }]),
    ]);

    const w = walletAgg[0] || {};
    const p = payoutAgg[0] || {};
    const t = txnAgg[0]    || {};

    const avgBookingInPaise = t.paidBookings > 0
      ? Math.round(t.totalBookingAmount / t.paidBookings)
      : 0;

    return successResponse(res, {
      message: "Finance summary fetched",
      data: {
        wallets: {
          count:                    w.walletCount                   ?? 0,
          totalAvailableInPaise:    w.totalAvailableInPaise         ?? 0,
          totalAvailableInRupees:   p2(w.totalAvailableInPaise),
          totalPendingInPaise:      w.totalPendingInPaise           ?? 0,
          totalPendingInRupees:     p2(w.totalPendingInPaise),
          totalLockedInPaise:       w.totalLockedInPaise            ?? 0,
          totalLockedInRupees:      p2(w.totalLockedInPaise),
          totalProcessingInPaise:   w.totalProcessingInPaise        ?? 0,
          totalProcessingInRupees:  p2(w.totalProcessingInPaise),
          lifetimeEarningsInPaise:  w.totalLifetimeEarningsInPaise  ?? 0,
          lifetimeEarningsInRupees: p2(w.totalLifetimeEarningsInPaise),
          lifetimePayoutsInPaise:   w.totalLifetimePayoutsInPaise   ?? 0,
          lifetimePayoutsInRupees:  p2(w.totalLifetimePayoutsInPaise),
        },
        payouts: {
          pendingCount:             p.pendingCount                  ?? 0,
          processingCount:          p.processingCount               ?? 0,
          paidCount:                p.paidCount                     ?? 0,
          rejectedCount:            p.rejectedCount                 ?? 0,
          totalPaidInPaise:         p.totalPaidInPaise              ?? 0,
          totalPaidInRupees:        p2(p.totalPaidInPaise),
          totalRequestedInPaise:    p.totalRequestedInPaise         ?? 0,
          totalRequestedInRupees:   p2(p.totalRequestedInPaise),
        },
        transactions: {
          totalBookings:            t.totalBookings                 ?? 0,
          paidBookings:             t.paidBookings                  ?? 0,
          successRate:              t.totalBookings > 0
            ? Math.round((t.paidBookings / t.totalBookings) * 100)
            : 0,
          totalRevenueInPaise:      t.totalRevenueInPaise           ?? 0,
          totalRevenueInRupees:     p2(t.totalRevenueInPaise),
          totalCommissionInPaise:   t.totalCommissionInPaise        ?? 0,  // maps from Transaction.commission
          totalCommissionInRupees:  p2(t.totalCommissionInPaise),
          avgBookingValueInPaise:   avgBookingInPaise,
          avgBookingValueInRupees:  p2(avgBookingInPaise),
        },
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/wallets
 * ✅ Fix 1 — parseInt radix 10
 * ✅ Medium 1 — all bucket rupee fields added
 * ✅ Medium 3 — sort whitelist (already safe, documented)
 */
export const listWallets = async (req, res, next) => {
  try {
    // ✅ Fix 1 — parseInt radix 10
    const pageNum  = Math.max(parseInt(req.query.page  ?? 1,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 20, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    // ✅ Medium 3 — explicit whitelist, no arbitrary Mongo sort injection
    const sortMap = {
      available: { availableBalanceInPaise:  -1 },
      earnings:  { lifetimeEarningsInPaise:  -1 },
      recent:    { lastTransactionAt:        -1 },
    };
    const sortQuery = sortMap[req.query.sort] || sortMap.available;

    const { status: walletStatus } = req.query;
    const walletFilter = {};
    if (walletStatus && walletStatus !== 'ALL') walletFilter.status = walletStatus;

    const scope = await resolveAdminFinanceScope(req.user);
    if (!scope.unrestricted) walletFilter.salonId = { $in: scope.salonIds };

    const [wallets, total] = await Promise.all([
      SalonEarnings.find(walletFilter)
        .populate("salonId", "basicInfo.shopName basicInfo.phone location.address")
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SalonEarnings.countDocuments(walletFilter),
    ]);

    return successResponse(res, {
      message: "Wallet list fetched",
      data: wallets.map(w => ({
        id:      w._id,
        salonId: w.salonId?._id,
        salon:   w.salonId?.basicInfo?.shopName ?? null,
        address: w.salonId?.location?.address ?? null,

        // ✅ Medium 1 — all buckets with paise + rupees
        availableBalanceInPaise:     w.availableBalanceInPaise    ?? 0,
        availableBalanceInRupees:    p2(w.availableBalanceInPaise),
        pendingBalanceInPaise:       w.pendingBalanceInPaise      ?? 0,
        pendingBalanceInRupees:      p2(w.pendingBalanceInPaise),
        lockedBalanceInPaise:        w.lockedBalanceInPaise       ?? 0,
        lockedBalanceInRupees:       p2(w.lockedBalanceInPaise),
        processingBalanceInPaise:    w.processingBalanceInPaise   ?? 0,
        processingBalanceInRupees:   p2(w.processingBalanceInPaise),

        lifetimeEarningsInPaise:     w.lifetimeEarningsInPaise    ?? 0,
        lifetimeEarningsInRupees:    p2(w.lifetimeEarningsInPaise),
        lifetimeWithdrawalsInPaise:  w.lifetimeWithdrawalsInPaise ?? 0,
        lifetimeWithdrawalsInRupees: p2(w.lifetimeWithdrawalsInPaise),

        lastTransactionAt: w.lastTransactionAt,
        lastPayoutAt:      w.lastPayoutAt,
        status:            w.status ?? "ACTIVE",
        frozenAt:          w.frozenAt   ?? null,
        frozenNote:        w.frozenNote ?? null,
        phone:             w.salonId?.basicInfo?.phone ?? null,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/transactions
 * ✅ Fix 1 — parseInt radix 10
 * ✅ Future — date range + salonId filters
 */
export const listTransactions = async (req, res, next) => {
  try {
    // ✅ Fix 1 — parseInt radix 10
    const pageNum  = Math.max(parseInt(req.query.page  ?? 1,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 20, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const { status = "ALL", salonId, from, to } = req.query;

    const filter = {};
    if (status !== "ALL") filter.status = status;

    // The client-supplied salonId is never trusted as authorization by
    // itself — it only narrows the query further within whatever the
    // admin's own scope already allows.
    const scope = await resolveAdminFinanceScope(req.user);
    if (salonId && mongoose.Types.ObjectId.isValid(salonId)) {
      if (scope.unrestricted || scope.salonIds.some((id) => id.toString() === salonId)) {
        filter.salonId = salonId;
      } else {
        filter.salonId = { $in: [] }; // requested salon is out of scope — force empty result
      }
    } else if (!scope.unrestricted) {
      filter.salonId = { $in: scope.salonIds };
    }
    // ✅ Date range filter with validation
    if (from || to) {
      const fromDate = from ? parseDate(from, "from") : null;
      const toDate   = to   ? parseDate(to,   "to")   : null;

      // ✅ ADD THIS
      if (fromDate && toDate && fromDate > toDate) {
        return next(Errors.badRequest("'from' date cannot be after 'to' date"));
      }
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate)   filter.createdAt.$lte = toDate;
    }

    const [txns, total] = await Promise.all([
      Transaction.find(filter)
        .populate("bookingId", "bookingCode")
        .populate("salonId",   "basicInfo.shopName basicInfo.phone location.address")
        .populate("userId",    "name phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Transactions fetched",
      data: txns.map(t => ({
        id:                   t._id,
        type:                 t.type,
        status:               t.status,
        provider:             t.provider          ?? "MANUAL",
        paymentMethod:        t.paymentMethod     ?? "UNKNOWN",
        currency:             t.currency          ?? "INR",
        amountInPaise:        t.amount            ?? 0,
        amountInRupees:       p2(t.amount),
        commissionInPaise:    t.commission        ?? 0,
        commissionInRupees:   p2(t.commission),
        payoutAmountInPaise:  t.payoutAmount      ?? 0,
        payoutAmountInRupees: p2(t.payoutAmount),
        gatewayFeeInPaise:    t.gatewayFee        ?? 0,
        refundAmountInPaise:  t.refundAmount      ?? 0,
        salon:    { id: t.salonId?._id, name: t.salonId?.basicInfo?.shopName, address: t.salonId?.location?.address ?? null },
        user:     { id: t.userId?._id,  name: t.userId?.name, phone: t.userId?.phone },
        booking:  { id: t.bookingId?._id },
        paymentId:            t.paymentId         ?? null,
        orderId:              t.orderId           ?? null,
        source:               t.source            ?? "APP",
        failureReason:        t.failureReason     ?? null,
        refundedAt:           t.refundedAt        ?? null,
        settledAt:            t.settledAt         ?? null,
        createdAt:            t.createdAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/wallets/:salonId
 *
 * Single-wallet lookup — fixes the frontend N+1 bug where
 * WalletDetailPage.jsx was calling listWallets({ limit: 100 }) and
 * searching client-side for one salonId. Same response shape as
 * listWallets' per-item mapping, so frontend needs only a
 * fetch-call change, no shape change.
 */
export const getWalletDetail = async (req, res, next) => {
  const { salonId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(salonId)) {
    return next(Errors.badRequest("Invalid salon ID"));
  }

  try {
    const salon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
      .select("location.territory.stateRef location.territory.districtRef")
      .lean();
    if (!salon) return next(Errors.notFound("Salon not found"));
    if (!isSalonWithinScope(req.user, salon)) {
      return next(Errors.forbidden("Out of your authorized scope"));
    }

    const w = await SalonEarnings.findOne({ salonId })
      .populate("salonId", "basicInfo.shopName basicInfo.phone location.address")
      .lean();

    if (!w) return next(Errors.notFound("Wallet not found for this salon"));

    return successResponse(res, {
      message: "Wallet fetched",
      data: {
        id:      w._id,
        salonId: w.salonId?._id,
        salon:   w.salonId?.basicInfo?.shopName ?? null,
        address: w.salonId?.location?.address ?? null,

        availableBalanceInPaise:     w.availableBalanceInPaise    ?? 0,
        availableBalanceInRupees:    p2(w.availableBalanceInPaise),
        pendingBalanceInPaise:       w.pendingBalanceInPaise      ?? 0,
        lockedBalanceInPaise:        w.lockedBalanceInPaise       ?? 0,
        lockedBalanceInRupees:       p2(w.lockedBalanceInPaise),
        processingBalanceInPaise:    w.processingBalanceInPaise   ?? 0,
        processingBalanceInRupees:   p2(w.processingBalanceInPaise),

        lifetimeEarningsInPaise:     w.lifetimeEarningsInPaise    ?? 0,
        lifetimeEarningsInRupees:    p2(w.lifetimeEarningsInPaise),
        lifetimeWithdrawalsInPaise:  w.lifetimeWithdrawalsInPaise ?? 0,
        lifetimeWithdrawalsInRupees: p2(w.lifetimeWithdrawalsInPaise),

        lastTransactionAt: w.lastTransactionAt,
        lastPayoutAt:      w.lastPayoutAt,
        status:            w.status ?? "ACTIVE",
        frozenAt:          w.frozenAt   ?? null,
        frozenNote:        w.frozenNote ?? null,
        phone:             w.salonId?.basicInfo?.phone ?? null,
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/ledger/:salonId
 * ✅ Fix 1 — parseInt radix 10
 * ✅ Fix 2 — next(Errors.badRequest) instead of res.status(400).json
 * ✅ Medium 4 — idempotencyKey + currency in response
 * ✅ Future — date range filter
 */
export const getSalonLedger = async (req, res, next) => {
  try {
    const { salonId } = req.params;

    // ✅ Fix 2 — consistent error helper
    if (!mongoose.Types.ObjectId.isValid(salonId)) {
      return next(Errors.badRequest("Invalid salonId"));
    }

    const targetSalon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
      .select("location.territory.stateRef location.territory.districtRef")
      .lean();
    if (!targetSalon) return next(Errors.notFound("Salon not found"));
    if (!isSalonWithinScope(req.user, targetSalon)) {
      return next(Errors.forbidden("Out of your authorized scope"));
    }

    // ✅ Fix 1 — parseInt radix 10
    const pageNum  = Math.max(parseInt(req.query.page  ?? 1,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 50, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;

    const { from, to } = req.query;
    const filter = { salonId };
    if (from || to) {
      const fromDate = from ? parseDate(from, "from") : null;
      const toDate   = to   ? parseDate(to,   "to")   : null;

      // ✅ Consistent with listTransactions
      if (fromDate && toDate && fromDate > toDate) {
        return next(Errors.badRequest("'from' date cannot be after 'to' date"));
      }

      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate)   filter.createdAt.$lte = toDate;
    }

    const [entries, total] = await Promise.all([
      WalletLedger.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      WalletLedger.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Ledger fetched",
      data: entries.map(e => ({
        id:             e._id,
        direction:      e.direction,
        bucket:         e.bucket,
        action:         e.action,
        amountInPaise:  e.amountInPaise,
        amountInRupees: p2(e.amountInPaise),
        balanceAfter:   e.balanceAfter,
        entityType:     e.entityType,
        entityId:       e.entityId,
        // ✅ Medium 4 — idempotencyKey + currency for admin debugging
        idempotencyKey: e.idempotencyKey ?? null,
        currency:       e.currency       ?? "INR",
        remarks:        e.remarks,
        triggeredBy:    e.triggeredBy,
        triggeredById:  e.triggeredById  ?? null,
        createdAt:      e.createdAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /api/admin/finance/wallets/:id/freeze
 * Freeze or unfreeze a salon wallet
 */
export const freezeWallet = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(Errors.badRequest("Invalid wallet ID"));
    }

    const { action, note } = req.body; // action: "FREEZE" | "UNFREEZE" | "BLOCK"
    const adminId = req.user?._id ?? null;

    const allowedActions = ["FREEZE", "UNFREEZE", "BLOCK"];
    if (!allowedActions.includes(action)) {
      return next(Errors.badRequest("action must be FREEZE, UNFREEZE, or BLOCK"));
    }

    // ✅ ADD THIS — Conflict check
    const currentWallet = await SalonEarnings.findById(id).select("status").lean();
    if (!currentWallet) return next(Errors.notFound("Wallet not found"));

    if (
      (action === "FREEZE"   && currentWallet.status === "FROZEN")  ||
      (action === "UNFREEZE" && currentWallet.status === "ACTIVE")   ||
      (action === "BLOCK"    && currentWallet.status === "BLOCKED")
    ) {
    
      return next(Errors.conflict(`Wallet is already ${currentWallet.status}`));
    }
  

    const statusMap = { FREEZE: "FROZEN", UNFREEZE: "ACTIVE", BLOCK: "BLOCKED" };
    const newStatus = statusMap[action];

    const wallet = await SalonEarnings.findByIdAndUpdate(
      id,
      {
        $set: {
          status:     newStatus,
          frozenBy:   action === "UNFREEZE" ? null : adminId,
          frozenAt:   action === "UNFREEZE" ? null : new Date(),
          frozenNote: action === "UNFREEZE" ? null : (note || null),
        },
      },
      { new: true }
    ).populate("salonId", "basicInfo.shopName basicInfo.phone location.address")


    if (!wallet) return next(Errors.notFound("Wallet not found"));

    return successResponse(res, {
      message: `Wallet ${action.toLowerCase()}d successfully`,
      data: {
        id:       wallet._id,
        salonId:  wallet.salonId?._id,
        salon:    wallet.salonId?.basicInfo?.shopName,
        status:   wallet.status,
        frozenAt: wallet.frozenAt,
        frozenNote: wallet.frozenNote,
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/transactions/:id
 * Single transaction detail
 */
export const getTransaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(Errors.badRequest("Invalid transaction ID"));
    }

    const t = await Transaction.findById(id)
      .populate("salonId",   "basicInfo.shopName basicInfo.phone location.address location.territory.stateRef location.territory.districtRef")
      .populate("userId",    "name phone")
      .populate("bookingId", "_id")
      .lean();

    if (!t) return next(Errors.notFound("Transaction not found"));
    if (!isSalonWithinScope(req.user, t.salonId)) {
      return next(Errors.forbidden("Out of your authorized scope"));
    }

    return successResponse(res, {
      message: "Transaction fetched",
      data: {
        id:                   t._id,
        type:                 t.type,
        status:               t.status,
        provider:             t.provider          ?? "MANUAL",
        paymentMethod:        t.paymentMethod     ?? "UNKNOWN",
        currency:             t.currency          ?? "INR",
        amountInPaise:        t.amount            ?? 0,
        amountInRupees:       p2(t.amount),
        commissionInPaise:    t.commission        ?? 0,
        commissionInRupees:   p2(t.commission),
        payoutAmountInPaise:  t.payoutAmount      ?? 0,
        payoutAmountInRupees: p2(t.payoutAmount),
        gatewayFeeInPaise:    t.gatewayFee        ?? 0,
        refundAmountInPaise:  t.refundAmount      ?? 0,
        salon:    { id: t.salonId?._id, name: t.salonId?.basicInfo?.shopName, phone: t.salonId?.basicInfo?.phone ?? null, address: t.salonId?.location?.address ?? null },
        user:     { id: t.userId?._id,  name: t.userId?.name, phone: t.userId?.phone },
        booking:  { id: t.bookingId?._id },
        paymentId:            t.paymentId         ?? null,
        orderId:              t.orderId           ?? null,
        source:               t.source            ?? "APP",
        failureReason:        t.failureReason     ?? null,
        refundedAt:           t.refundedAt        ?? null,
        refundReason:         t.refundReason      ?? null,
        settledAt:            t.settledAt         ?? null,
        gatewaySettlementId:  t.gatewaySettlementId ?? null,
        createdAt:            t.createdAt,
        updatedAt:            t.updatedAt,
      },
    });
  } catch (err) { next(err) }
};

//////////////////////////////////////////////////////////////////
// PASTE INSTRUCTIONS
//
// File: backend/controllers/adminFinance.controller.js
//
// STEP 1 — Add this import near the top, with the other model imports:
//
//   import Salon from "../models/Salon.js";
//
// STEP 2 — Add these 3 new functions anywhere in the file (e.g. at
// the very end, after getTransaction). Nothing else in the file
// needs to change.
//////////////////////////////////////////////////////////////////

/**
 * GET /api/admin/finance/analytics/revenue-trend?months=6
 *
 * Real replacement for frontend's hardcoded TREND_DATA.
 * Groups PAID transactions by calendar month (createdAt), summing
 * gross volume, commission, and payoutAmount (= settled to salons).
 *
 * Returns months in chronological order, oldest first — matches
 * how the frontend bar chart expects to render left-to-right.
 * Months with zero transactions still appear (filled with zeros),
 * so the chart never silently skips a month.
 */
export const getRevenueTrend = async (req, res, next) => {
  try {
    const monthsBack = Math.min(Math.max(parseInt(req.query.months ?? 6, 10), 1), 24);

    const now = new Date();
    // Start of the month, (monthsBack - 1) months ago — e.g. months=6
    // and today is July → range starts Feb 1st, so Feb..Jul = 6 months.
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);

    const scope = await resolveAdminFinanceScope(req.user);
    const matchStage = {
      status:    "PAID",
      createdAt: { $gte: rangeStart },
    };
    if (!scope.unrestricted) matchStage.salonId = { $in: scope.salonIds };

    const agg = await Transaction.aggregate([
      {
        $match: matchStage,
      },
      {
        $group: {
          _id: {
            year:  { $year:  "$createdAt" },
            month: { $month: "$createdAt" },
          },
          volumeInPaise:     { $sum: "$amount" },
          commissionInPaise: { $sum: "$commission" },
          settledInPaise:    { $sum: "$payoutAmount" },
          bookings:          { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Build a lookup so we can fill in zero-months that had no transactions
    const byKey = new Map(
      agg.map(a => [`${a._id.year}-${a._id.month}`, a])
    );

    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const trend = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const found = byKey.get(key);
      trend.push({
        month:               monthNames[d.getMonth()],
        year:                d.getFullYear(),
        volumeInPaise:       found?.volumeInPaise     ?? 0,
        volumeInRupees:      p2(found?.volumeInPaise),
        commissionInPaise:   found?.commissionInPaise ?? 0,
        commissionInRupees:  p2(found?.commissionInPaise),
        settledInPaise:      found?.settledInPaise    ?? 0,
        settledInRupees:     p2(found?.settledInPaise),
        bookings:            found?.bookings          ?? 0,
      });
    }

    return successResponse(res, {
      message: "Revenue trend fetched",
      data: trend,
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/analytics/states
 *
 * Real replacement for frontend's hardcoded STATE_DATA.
 * Joins Transaction → Salon → State to group revenue by state.
 *
 * successRate per state = paid transactions / all transactions
 * for salons in that state (not just paid ones) — matches the
 * "success rate" semantic used elsewhere (getFinanceSummary).
 */
export const getStatePerformance = async (req, res, next) => {
  try {
    const scope = await resolveAdminFinanceScope(req.user);
    const pipeline = [];
    if (!scope.unrestricted) pipeline.push({ $match: { salonId: { $in: scope.salonIds } } });
    pipeline.push(
      {
        $lookup: {
          from:         "salons",
          localField:   "salonId",
          foreignField: "_id",
          as:           "salon",
        },
      },
      { $unwind: "$salon" },
      {
        $lookup: {
          from:         "states",
          localField:   "salon.location.territory.stateRef",
          foreignField: "_id",
          as:           "state",
        },
      },
      { $unwind: { path: "$state", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id:            { $ifNull: ["$state._id", null] },
          stateName:      { $first: { $ifNull: ["$state.name", "Unknown"] } },
          volumeInPaise:  { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, "$amount", 0] } },
          totalCount:     { $sum: 1 },
          paidCount:      { $sum: { $cond: [{ $eq: ["$status", "PAID"] }, 1, 0] } },
          salonIds:       { $addToSet: "$salonId" },
        },
      },
      {
        $project: {
          _id:           0,
          stateId:       "$_id",
          state:         "$stateName",
          volumeInPaise: 1,
          salons:        { $size: "$salonIds" },
          successRate:   {
            $cond: [
              { $gt: ["$totalCount", 0] },
              { $round: [{ $multiply: [{ $divide: ["$paidCount", "$totalCount"] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
      { $sort: { volumeInPaise: -1 } },
    );

    const agg = await Transaction.aggregate(pipeline);

    return successResponse(res, {
      message: "State performance fetched",
      data: agg.map(s => ({
        state:           s.state,
        stateId:         s.stateId ?? null,
        volumeInPaise:   s.volumeInPaise,
        volumeInRupees:  p2(s.volumeInPaise),
        salons:          s.salons,
        successRate:     s.successRate,
      })),
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/finance/analytics/top-salons?limit=10
 *
 * Real replacement for frontend's hardcoded TOP_SALONS.
 * Groups PAID transactions by salonId, ranks by gross revenue.
 */
export const getTopSalons = async (req, res, next) => {
  try {
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? 10, 10), 1), 50);

    const scope = await resolveAdminFinanceScope(req.user);
    const topSalonsMatch = { status: "PAID" };
    if (!scope.unrestricted) topSalonsMatch.salonId = { $in: scope.salonIds };

    const agg = await Transaction.aggregate([
      { $match: topSalonsMatch },
      {
        $group: {
          _id:             "$salonId",
          revenueInPaise:  { $sum: "$amount" },
          bookings:        { $sum: 1 },
        },
      },
      { $sort: { revenueInPaise: -1 } },
      { $limit: limitNum },
      {
        $lookup: {
          from:         "salons",
          localField:   "_id",
          foreignField: "_id",
          as:           "salon",
        },
      },
      { $unwind: { path: "$salon", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from:         "cities",
          localField:   "salon.location.territory.cityRef",
          foreignField: "_id",
          as:           "city",
        },
      },
      { $unwind: { path: "$city", preserveNullAndEmptyArrays: true } },
    ]);

    return successResponse(res, {
      message: "Top salons fetched",
      data: agg.map((s, i) => ({
        rank:            i + 1,
        salonId:         s._id,
        name:            s.salon?.basicInfo?.shopName ?? "Unknown",
        city:            s.city?.name ?? null,
        revenueInPaise:  s.revenueInPaise,
        revenueInRupees: p2(s.revenueInPaise),
        bookings:        s.bookings,
      })),
    });
  } catch (err) { next(err) }
};