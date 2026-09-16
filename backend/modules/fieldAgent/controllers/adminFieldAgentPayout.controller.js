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
    const payout = await approvePayout({ admin: req.user, payoutId: req.params.id });
    return successResponse(res, { message: "Payout request approved", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const rejectPayoutHandler = async (req, res, next) => {
  try {
    const payout = await rejectPayout({ admin: req.user, payoutId: req.params.id, reason: req.body.reason });
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
