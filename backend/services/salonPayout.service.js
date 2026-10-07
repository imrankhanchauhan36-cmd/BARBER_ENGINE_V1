/**
 * BARBER ENGINE V1
 * backend/services/salonPayout.service.js
 *
 * FINANCE-P0-1 — Canonical Salon Payout merge. The ONE place a salon
 * withdrawal is ever created, extracted verbatim (same checks, same
 * order, same transaction shape, same error types) from
 * controllers/payout.controller.js#requestWithdrawal so it can be
 * called from BOTH that controller (unchanged observable behavior —
 * see the implementation report) AND
 * modules/wallet/controllers/wallet.controller.js#requestPayoutHandler
 * for a SALON entity, which must now delegate here instead of calling
 * GenericPayoutRequestService.requestGenericPayout (ticket §17 —
 * "It must delegate into the SAME canonical PayoutRequest service...
 * must NOT create GenericPayoutRequest").
 *
 * NO gateway dispatch happens here — this function only ever creates a
 * REQUESTED PayoutRequest with funds LOCKED. Dispatch is strictly a
 * post-approval concern (see adminPayout.controller.js#approvePayout +
 * services/settlement/payoutRequestDispatch.service.js).
 */

import mongoose from "mongoose";
import PayoutRequest, { PAYOUT_STATUS, OPEN_PAYOUT_STATUSES } from "../models/PayoutRequest.js";
import Salon from "../models/Salon.js";
import KYC from "../modules/kyc/models/KYC.js";
import WalletBalanceService from "./WalletBalanceService.js";
import NotificationService from "./NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { Errors } from "../utils/response.js";

const MIN_PAISE = 10000; // ₹100 minimum withdrawal — unchanged from the original controller
const p2 = (v) => Math.round(v ?? 0) / 100;

/**
 * @param {{ ownerId: import("mongoose").Types.ObjectId|string, amountInPaise: number }} params
 *   salonId is deliberately NOT accepted directly — always re-derived
 *   from ownerId here (Salon.findOne({ownerId})), exactly like the
 *   original controller, so a caller can never supply a salonId that
 *   doesn't belong to the authenticated owner. A FIELD_AGENT-identity
 *   caller (wallet.controller.js's other branch) never reaches this
 *   function at all — see that file's own routing.
 * @returns {Promise<{payout: object}>}
 */
export const requestSalonPayout = async ({ ownerId, amountInPaise }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("_id")
      .session(session)
      .lean();

    if (!salon) {
      await session.abortTransaction();
      throw Errors.notFound("Salon not found");
    }

    // Unchanged bank-verification gate — see payout.controller.js's own
    // header comment for the full rationale (KYC.verification.bank.verified
    // is the sole source of truth; never loosened to also accept the
    // looser pennyDropStatus signal payoutKycResolver.service.js's own
    // resolver would accept, to keep this gate's behavior byte-identical
    // to before this ticket).
    const kyc = await KYC.findOne({ ownerId, isDeleted: { $ne: true } })
      .select("verification.bank.verified bank.accountHolder bank.maskedAccount bank.ifsc bank.bankName")
      .session(session)
      .lean();

    if (kyc?.verification?.bank?.verified !== true) {
      await session.abortTransaction();
      throw Errors.forbidden("Your bank account must be verified before you can request a withdrawal. Please complete KYC bank verification first.");
    }

    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
      await session.abortTransaction();
      throw Errors.badRequest("amountInPaise must be a positive integer");
    }
    if (amountInPaise < MIN_PAISE) {
      await session.abortTransaction();
      throw Errors.badRequest(`Minimum withdrawal is ₹${MIN_PAISE / 100}`);
    }

    const existing = await PayoutRequest.findOne({
      salonId: salon._id,
      status: { $in: OPEN_PAYOUT_STATUSES },
    }).session(session).lean();

    if (existing) {
      await session.abortTransaction();
      throw Errors.conflict("A withdrawal request is already pending. Cancel it first.");
    }

    // FINANCE-P0-1 — capture a bank snapshot unconditionally (cheap,
    // already-read fields above) so a future admin decision to dispatch
    // this payout via RAZORPAY_ROUTE never needs a second KYC read.
    // Never gates creation itself — the verified check above already
    // did that; this is purely a snapshot of already-permitted data.
    const bankSnapshot = kyc?.bank?.accountHolder
      ? {
          accountHolder: kyc.bank.accountHolder,
          maskedAccount: kyc.bank.maskedAccount || null,
          ifsc: kyc.bank.ifsc || null,
          bankName: kyc.bank.bankName || null,
        }
      : null;

    const [payout] = await PayoutRequest.create([{
      salonId: salon._id,
      amountInPaise,
      status: PAYOUT_STATUS.REQUESTED,
      bankSnapshot,
    }], { session });

    await WalletBalanceService.hold({
      salonId: salon._id,
      amountInPaise,
      refType: "WITHDRAWAL",
      refId: payout._id,
      idempotencyKey: `payout:hold:${payout._id}`,
      session,
      triggeredBy: "OWNER",
      triggeredById: ownerId,
      remarks: `Withdrawal request — ₹${p2(amountInPaise)}`,
    });

    await session.commitTransaction();

    await NotificationService.send({
      recipientId: salon._id,
      recipientType: "SALON",
      templateKey: NOTIFICATION_EVENTS.WITHDRAW_REQUESTED,
      variables: { amount: p2(amountInPaise) },
      title: "Withdrawal Requested",
      message: `Your withdrawal request for ₹${p2(amountInPaise)} has been submitted.`,
      type: "PAYMENT",
      priority: "MEDIUM",
      actionType: "OPEN_WALLET",
      actionUrl: "/wallet",
      meta: { payoutId: payout._id, amountInPaise },
    }).catch(() => {}); // non-blocking, same convention as every other notification call site

    return { payout };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000) {
      throw Errors.conflict("A withdrawal request is already pending. Cancel it first.");
    }
    throw err;
  } finally {
    session.endSession();
  }
};
