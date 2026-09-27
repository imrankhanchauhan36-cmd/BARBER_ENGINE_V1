/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminGSTReport.controller.js
 *
 * P0 Revenue Calculation Engine — Step 4.3. Thin controllers only —
 * every number comes from GSTReportService.js (GSTLedger only, read-only).
 */

import { successResponse } from "../../../utils/response.js";
import { getSummaryReport, getMonthlyReport, getExportReport } from "../services/GSTReportService.js";
import { toSummaryReportDTO, toMonthlyReportDTO, toExportReportDTO } from "../dto/gstReport.dto.js";

export const getGSTReportSummaryHandler = async (req, res, next) => {
  try {
    const report = await getSummaryReport();
    return successResponse(res, { message: "GST report summary fetched", data: toSummaryReportDTO(report) });
  } catch (err) {
    return next(err);
  }
};

export const getGSTReportMonthlyHandler = async (req, res, next) => {
  try {
    const report = await getMonthlyReport(req.query.year);
    return successResponse(res, { message: "GST monthly report fetched", data: toMonthlyReportDTO(report) });
  } catch (err) {
    return next(err);
  }
};

export const getGSTReportExportHandler = async (req, res, next) => {
  try {
    const report = await getExportReport({ month: req.query.month, year: req.query.year });
    return successResponse(res, { message: "GST export report fetched", data: toExportReportDTO(report) });
  } catch (err) {
    return next(err);
  }
};
