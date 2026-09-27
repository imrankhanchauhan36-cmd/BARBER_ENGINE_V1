/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminFinanceAnalytics.controller.js
 *
 * STEP 7.2 — Finance Analytics Engine. Thin controllers only — all
 * aggregation lives in FinanceAnalyticsService.js. Read-only: no body
 * is ever accepted; only validated query params are read.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getDailyRevenueTrend,
  getMonthlyRevenueTrend,
  getGstCollectedTrend,
  getPayoutTrends,
} from "../services/FinanceAnalyticsService.js";

export const getDailyRevenueHandler = async (req, res, next) => {
  try {
    const data = await getDailyRevenueTrend({ days: req.query.days });
    return successResponse(res, { message: "Daily revenue trend fetched", data });
  } catch (err) {
    return next(err);
  }
};

export const getMonthlyRevenueHandler = async (req, res, next) => {
  try {
    const data = await getMonthlyRevenueTrend({ months: req.query.months });
    return successResponse(res, { message: "Monthly revenue trend fetched", data });
  } catch (err) {
    return next(err);
  }
};

export const getGstTrendHandler = async (req, res, next) => {
  try {
    const data = await getGstCollectedTrend({ granularity: req.query.granularity, days: req.query.days, months: req.query.months });
    return successResponse(res, { message: "GST collected trend fetched", data });
  } catch (err) {
    return next(err);
  }
};

export const getPayoutTrendsHandler = async (req, res, next) => {
  try {
    const data = await getPayoutTrends({ granularity: req.query.granularity, days: req.query.days, months: req.query.months });
    return successResponse(res, { message: "Payout trends fetched", data });
  } catch (err) {
    return next(err);
  }
};
