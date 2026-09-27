/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentPayout.controller.js
 *
 * FA-14 — Admin-facing Field Agent payout approval/rejection/manual-
 * payout-recording controller. Thin controllers only — all business
 * logic + territory-scope enforcement lives in
 * services/fieldAgentPayout.service.js. Admin identity is req.user
 * (role/adminLevel/stateRef already verified by requireRole +
 * requireAdminLevel middleware at the route level).
 */

import { successResponse } from "../../../utils/response.js";
import {
  listPayoutsForAdmin,
  getPayoutDetailForAdmin,
  approvePayout,
  rejectPayout,
  recordManualPayoutResult,
  retryFailedPayout,
} from "../services/fieldAgentPayout.service.js";
// FA-P2-A — notification only; never mutates FieldAgent, mirrors the
// read-only lookup pattern used elsewhere (e.g. commercialTerritory
// .service.js's own FieldAgent.findById for eligibility checks).
import FieldAgent from "../models/FieldAgent.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import { NOTIFICATION_EVENTS } from "../../notifications/constants/notificationEvents.constants.js";
import FieldAgentPayoutRequest from "../models/FieldAgentPayoutRequest.js";
import { dispatchAfterApproval } from "../services/fieldAgentAutoPayout.service.js";

// Paise -> "₹X,XXX.XX", matching the same display rule as the User/
// Salon App's own shared/utils/formatPaise.js (no backend equivalent
// existed — this is intentionally local/private, used only for the
// notification message text below, never for a financial computation
// or persisted value).
const formatPaiseAsRupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// FA-P2-A — shared by both handlers below; a payout notification
// failure must never fail the admin's approve/reject request, so this
// is always called after successResponse-worthy data is already
// resolved and always swallows its own errors.
const notifyPayoutOutcome = async ({ payout, templateKey, title, message }) => {
  try {
    const fieldAgent = await FieldAgent.findById(payout.fieldAgentRef).select("userRef").lean();
    if (!fieldAgent) return;
    await NotificationService.send(
      {
        recipientId:   fieldAgent.userRef,
        recipientType: "FIELD_AGENT",
        templateKey,
        variables:     { amount: formatPaiseAsRupees(payout.amountInPaise) },
        title,
        message,
        type:          "SYSTEM",
        priority:      "HIGH",
        actionType:    "OPEN_WALLET",
        actionUrl:     "/field-agent/payouts",
        entityType:    "PAYMENT",
        entityId:      payout._id,
        meta:          { payoutId: payout._id, amountInPaise: payout.amountInPaise },
      },
      [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH]
    );
  } catch (err) {
    console.warn("[adminFieldAgentPayout] notification failed (non-critical):", err.message);
  }
};

export const listPayoutsForAdminHandler = async (req, res, next) => {
  try {
    const result = await listPayoutsForAdmin({ admin: req.user, query: req.query });
    return successResponse(res, {
      message:    "Payout requests fetched",
      data:       { payouts: result.docs },
      pagination: result.meta,
    });
  } catch (err) {
    return next(err);
  }
};

export const getPayoutDetailForAdminHandler = async (req, res, next) => {
  try {
    const payout = await getPayoutDetailForAdmin({ admin: req.user, payoutId: req.params.id });
    return successResponse(res, { message: "Payout request fetched", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const approvePayoutHandler = async (req, res, next) => {
  try {
    let payout = await approvePayout({ admin: req.user, payoutId: req.params.id });
    // FA-P4-D Step 1 — when Auto Payout is ON the approval chose CASHFREE:
    // send the transfer now (after the approval transaction has committed) and
    // return the resulting state. A no-op for MANUAL payouts.
    if (payout.payoutProvider === "CASHFREE") {
      await dispatchAfterApproval(payout);
      payout = (await FieldAgentPayoutRequest.findById(payout._id).lean()) || payout;
    }
    await notifyPayoutOutcome({
      payout,
      templateKey: NOTIFICATION_EVENTS.WITHDRAW_APPROVED,
      title:       "Withdrawal Approved",
      message:     `Your withdrawal request of ${formatPaiseAsRupees(payout.amountInPaise)} has been approved and is being processed.`,
    });
    return successResponse(res, { message: "Payout request approved", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const rejectPayoutHandler = async (req, res, next) => {
  try {
    const payout = await rejectPayout({ admin: req.user, payoutId: req.params.id, reason: req.body.reason });
    await notifyPayoutOutcome({
      payout,
      templateKey: NOTIFICATION_EVENTS.WITHDRAW_REJECTED,
      title:       "Withdrawal Rejected",
      message:     `Your withdrawal request of ${formatPaiseAsRupees(payout.amountInPaise)} was rejected. Reason: ${payout.adminNote || "Not specified"}`,
    });
    return successResponse(res, { message: "Payout request rejected", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const recordManualPayoutResultHandler = async (req, res, next) => {
  try {
    const payout = await recordManualPayoutResult({
      admin:         req.user,
      payoutId:      req.params.id,
      success:       req.body.success,
      utr:           req.body.utr,
      failureReason: req.body.failureReason,
    });
    return successResponse(res, { message: "Manual payout result recorded", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const retryFailedPayoutHandler = async (req, res, next) => {
  try {
    const payout = await retryFailedPayout({ admin: req.user, payoutId: req.params.id });
    return successResponse(res, { message: "Payout request re-queued for processing", data: { payout } });
  } catch (err) {
    return next(err);
  }
};
