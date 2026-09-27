/**
 * BARBER ENGINE V1
 * backend/modules/wallet/controllers/wallet.controller.js
 *
 * STEP 6.5A — HTTP API Exposure Audit + Build. Exposes the ALREADY-
 * BUILT, UNMODIFIED backend engines (WalletBalanceService — STEP 6.2;
 * GenericPayoutRequestService — STEP 6.3) over HTTP for the first
 * time. Thin controllers only:
 *   - getMyWalletHandler        -> WalletBalanceService.getWallet (unchanged)
 *   - getMyWalletHistoryHandler -> WalletLedger.find (read-only, same
 *     pagination shape as controllers/payout.controller.js#getLedger,
 *     generalized to {ownerType, ownerId} instead of hardcoded salonId)
 *   - requestPayoutHandler      -> GenericPayoutRequestService.
 *     requestGenericPayout (unchanged)
 *   - getMyPayoutsHandler       -> GenericPayoutRequest.find (read-only,
 *     same pagination shape as controllers/payout.controller.js#
 *     getPayoutHistory, generalized)
 *
 * NO business logic changes anywhere in this file — every financial
 * decision (balance math, idempotency, hold/release, KYC gate, dispatch)
 * still lives entirely inside the services this file calls, untouched.
 * The only NEW logic here is identity resolution (which Salon/FieldAgent
 * does this authenticated user own?) via walletIdentityResolver.
 * service.js, and pagination/response shaping — pure HTTP glue.
 */

import crypto from "crypto";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import WalletLedger from "../../../models/WalletLedger.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import { requestGenericPayout } from "../../payout/services/GenericPayoutRequestService.js";
import { resolveWalletIdentityForUser } from "../services/walletIdentityResolver.service.js";
import { successResponse, Errors } from "../../../utils/response.js";

const paginationParams = (req) => {
  const page = Math.max(parseInt(req.query.page ?? 1, 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit ?? 20, 10), 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

/** GET /api/wallet/me */
export const getMyWalletHandler = async (req, res, next) => {
  try {
    const identity = await resolveWalletIdentityForUser(req.user);
    if (!identity) return next(Errors.notFound("No wallet found for this account"));

    const wallet = await WalletBalanceService.getWallet(identity); // STEP 6.2 — unmodified
    return successResponse(res, {
      message: "Wallet fetched",
      data: {
        entityType: identity.entityType,
        entityId: identity.entityId,
        availableBalanceInPaise: wallet?.availableBalanceInPaise ?? 0,
        pendingBalanceInPaise: wallet?.pendingBalanceInPaise ?? 0,
        lockedBalanceInPaise: wallet?.lockedBalanceInPaise ?? 0,
        processingBalanceInPaise: wallet?.processingBalanceInPaise ?? 0,
        lifetimeEarningsInPaise: wallet?.lifetimeEarningsInPaise ?? 0,
        lifetimeWithdrawalsInPaise: wallet?.lifetimeWithdrawalsInPaise ?? 0,
        currency: wallet?.currency ?? "INR",
        status: wallet?.status ?? "INACTIVE",
        lastPayoutAt: wallet?.lastPayoutAt ?? null,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/wallet/history */
export const getMyWalletHistoryHandler = async (req, res, next) => {
  try {
    const identity = await resolveWalletIdentityForUser(req.user);
    if (!identity) return next(Errors.notFound("No wallet found for this account"));

    const { page, limit, skip } = paginationParams(req);
    const filter = { ownerType: identity.entityType, ownerId: identity.entityId };

    const [entries, total] = await Promise.all([
      WalletLedger.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WalletLedger.countDocuments(filter),
    ]);

    return successResponse(res, { message: "Wallet history fetched", data: { entries, page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

/** POST /api/wallet/payout/request */
export const requestPayoutHandler = async (req, res, next) => {
  try {
    const identity = await resolveWalletIdentityForUser(req.user);
    if (!identity) return next(Errors.notFound("No wallet found for this account"));

    const { amountInPaise, idempotencyKey } = req.body;
    const triggeredBy = identity.entityType === "SALON" ? "OWNER" : "FIELD_AGENT";

    const request = await requestGenericPayout({
      entityType: identity.entityType,
      entityId: identity.entityId,
      amountInPaise,
      // Auto-generated when the caller doesn't supply one — pure HTTP-
      // layer convenience, never a change to requestGenericPayout's own
      // idempotency contract (it still enforces uniqueness exactly as
      // STEP 6.3 built it).
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      triggeredBy,
      triggeredById: req.user._id,
    }); // STEP 6.3 — unmodified

    // requestGenericPayout's own STEP 6.4 auto-dispatch (dispatchAfterRequest)
    // mutates the payout row via its own fresh findById(...), not this
    // `request` object reference — so `request` is a stale, pre-dispatch
    // snapshot (always "REQUESTED") even once the row has already moved
    // to PROCESSING/PAID/FAILED in the DB. Re-reading it here is a plain,
    // read-only lookup (no business logic, no write) so the HTTP response
    // reflects the real current state instead of a snapshot from before
    // dispatch ran.
    const fresh = await GenericPayoutRequest.findById(request._id).lean();
    return successResponse(res, { statusCode: 201, message: "Payout requested", data: fresh || request });
  } catch (err) {
    return next(err);
  }
};

/** GET /api/wallet/payouts */
export const getMyPayoutsHandler = async (req, res, next) => {
  try {
    const identity = await resolveWalletIdentityForUser(req.user);
    if (!identity) return next(Errors.notFound("No wallet found for this account"));

    const { page, limit, skip } = paginationParams(req);
    const filter = { entityType: identity.entityType, entityId: identity.entityId };

    const [rows, total] = await Promise.all([
      GenericPayoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      GenericPayoutRequest.countDocuments(filter),
    ]);

    return successResponse(res, { message: "Payouts fetched", data: { rows, page, limit, total } });
  } catch (err) {
    return next(err);
  }
};
