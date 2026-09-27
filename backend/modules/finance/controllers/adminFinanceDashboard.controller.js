/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminFinanceDashboard.controller.js
 *
 * STEP 7.1 — Finance Dashboard KPI Engine. Thin controller only — all
 * aggregation lives in FinanceDashboardKPIService.js. Read-only: no
 * body is ever accepted, no write of any kind happens here.
 */

import { successResponse } from "../../../utils/response.js";
import { getFinanceDashboardKPIs } from "../services/FinanceDashboardKPIService.js";

export const getFinanceDashboardKPIsHandler = async (req, res, next) => {
  try {
    const kpis = await getFinanceDashboardKPIs();
    return successResponse(res, { message: "Finance dashboard KPIs fetched", data: kpis });
  } catch (err) {
    return next(err);
  }
};
