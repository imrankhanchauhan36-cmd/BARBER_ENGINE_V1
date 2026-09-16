/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentPayout.controller.js
 *
 * FA-14 — Field-Agent-facing withdrawal request controller. Thin
 * controllers only — all business logic lives in
 * services/fieldAgentPayout.service.js. Identity derives exclusively
 * from req.user._id, never a client-supplied field.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getMyBalanceSummary,
  createWithdrawalRequest,
  listMyPayouts,
  getMyPayoutDetail,
  cancelMyPayout,
} from "../services/fieldAgentPayout.service.js";

export const getMyBalanceHandler = async (req, res, next) => {
  try {
    const summary = await getMyBalanceSummary(req.user._id);
    return successResponse(res, { message: "Balance fetched", data: summary });
  } catch (err) {
    return next(err);
  }
};

export const createWithdrawalHandler = async (req, res, next) => {
  try {
    const { payout, idempotentReplay } = await createWithdrawalRequest({
      userId:         req.user._id,
      amountInPaise:  req.body.amountInPaise,
      idempotencyKey: req.body.idempotencyKey,
    });
    return successResponse(res, {
      statusCode: idempotentReplay ? 200 : 201,
      message:    idempotentReplay ? "Withdrawal request already exists" : "Withdrawal request created",
      data:       { payout },
    });
  } catch (err) {
    return next(err);
  }
};

export const listMyPayoutsHandler = async (req, res, next) => {
  try {
    const result = await listMyPayouts({ userId: req.user._id, query: req.query });
    return successResponse(res, {
      message:    "Payout requests fetched",
      data:       { payouts: result.docs },
      pagination: result.meta,
    });
  } catch (err) {
    return next(err);
  }
};

export const getMyPayoutDetailHandler = async (req, res, next) => {
  try {
    const payout = await getMyPayoutDetail({ userId: req.user._id, payoutId: req.params.id });
    return successResponse(res, { message: "Payout request fetched", data: { payout } });
  } catch (err) {
    return next(err);
  }
};

export const cancelMyPayoutHandler = async (req, res, next) => {
  try {
    const payout = await cancelMyPayout({ userId: req.user._id, payoutId: req.params.id });
    return successResponse(res, { message: "Withdrawal request cancelled", data: { payout } });
  } catch (err) {
    return next(err);
  }
};
