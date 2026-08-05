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
import PayoutRequest, { PAYOUT_STATUS } from "../models/PayoutRequest.js";
import Salon from "../models/Salon.js";
import User from "../models/User.js";
import KYC from "../modules/kyc/models/KYC.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import SettlementEngine from "../services/settlement/SettlementEngine.js";
import { Errors, successResponse } from "../utils/response.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const p2        = (v)  => Math.round(v ?? 0) / 100;

/**
 * PATCH /api/payouts/admin/approve/:id
 *
 * Flow: REQUESTED(LOCKED) → PROCESSING → PAID
 *
 * ✅ Fix — walletMid replaced with result-based validation.
 *   WalletBalanceService throws on failure (insufficient balance,
 *   idempotency race, etc.), so we trust the throw — not a
 *   post-hoc wallet read — as proof of success. walletMid check
 *   removed because it only verified wallet *existence*, not
 *   the actual state transition.
 *
 * ✅ Explicit abortTransaction before every early return inside try.
 * ✅ Wallet read after commit (consistent snapshot).
 * ✅ parseInt with radix 10.
 */
export const approvePayout = async (req, res, next) => {
  if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid payout ID"));

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const payout = await PayoutRequest.findById(req.params.id).session(session);
    if (!payout) {
      await session.abortTransaction();
      return next(Errors.notFound("Payout request not found"));
    }

    if (payout.status !== PAYOUT_STATUS.REQUESTED) {
      await session.abortTransaction();
      return next(Errors.conflict(`Cannot approve — current status is ${payout.status}`));
    }

    const { utr, adminNote } = req.body;
    const adminId = req.user?._id ?? null;

    // Controller no longer knows HOW this payout gets executed — it
    // only knows it wants it executed, and persists whatever the
    // engine reports back. See services/settlement/SettlementEngine.js.
    const result = await SettlementEngine.execute({ payout, adminId, utr, adminNote, session });

    payout.status           = result.status;
    payout.approvedBy       = adminId;
    payout.approvedAt       = new Date();
    payout.utr              = result.utr;
    payout.adminNote        = adminNote || null;
    payout.providerPayoutId = result.providerPayoutId;
    payout.providerResponse = result.providerResponse;
    await payout.save({ session });

    await session.commitTransaction();

    const wallet = await WalletBalanceService.getWallet(payout.salonId);

    return successResponse(res, {
      message: "Payout approved and completed",
      data: {
        payoutId:                payout._id,
        status:                  payout.status,
        amountInPaise:           payout.amountInPaise,
        amountInRupees:          p2(payout.amountInPaise),
        utr:                     payout.utr,
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

    if (payout.status !== PAYOUT_STATUS.REQUESTED) {
      await session.abortTransaction();
      return next(Errors.conflict(`Cannot reject — current status is ${payout.status}`));
    }

    const adminId   = req.user?._id ?? null;
    const adminNote = req.body.adminNote || "Admin rejected payout";

    await WalletBalanceService.release({
      salonId:       payout.salonId,
      amountInPaise: payout.amountInPaise,
      entityType:    "WITHDRAWAL",
      entityId:      payout._id,
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
    const [agg] = await PayoutRequest.aggregate([{
      $group: {
        _id:                    null,
        total:                  { $sum: 1 },
        requested:              { $sum: { $cond: [{ $eq: ["$status","REQUESTED"]  }, 1, 0] } },
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
        approvedBy:     p.approvedBy ? { id: p.approvedBy._id, name: p.approvedBy.name } : null,
        approvedAt:     p.approvedAt,
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
      .select("basicInfo.shopName location.address location.territory.cityRef ownerId")
      .populate("location.territory.cityRef", "name")
      .lean();

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
        utr:            payout.utr,
        adminNote:      payout.adminNote,
        failureReason:  payout.failureReason,
        approvedBy:     payout.approvedBy ? { id: payout.approvedBy._id, name: payout.approvedBy.name } : null,
        approvedAt:     payout.approvedAt,
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