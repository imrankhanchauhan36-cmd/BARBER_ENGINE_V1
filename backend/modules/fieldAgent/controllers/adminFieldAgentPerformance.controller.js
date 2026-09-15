/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentPerformance.controller.js
 *
 * FA-11.3 — thin admin controllers only, same convention as
 * adminAcquisitionClaim.controller.js: `admin` is always req.user
 * (server-populated by protect middleware — never client input).
 * These controllers never touch FieldAgentPerformanceSnapshot
 * directly and never recompute any metric — all authorization
 * scoping and persisted-snapshot reads live in
 * fieldAgentPerformance.service.js (FA-11.2/FA-11.3).
 */

import { successResponse } from "../../../utils/response.js";
import {
  adminListFieldAgentPerformanceSnapshots,
  adminGetLatestFieldAgentPerformanceSnapshot,
} from "../services/fieldAgentPerformance.service.js";

export const adminListFieldAgentPerformanceHandler = async (req, res, next) => {
  try {
    const result = await adminListFieldAgentPerformanceSnapshots({
      admin: req.user,
      page: req.query.page,
      limit: req.query.limit,
      fieldAgentRef: req.query.fieldAgentRef,
      commercialPath: req.query.commercialPath,
      cycleKey: req.query.cycleKey,
      policyVersionRef: req.query.policyVersionRef,
    });
    return successResponse(res, {
      message: "Field Agent performance snapshots fetched",
      data: { snapshots: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const adminGetFieldAgentPerformanceDetailHandler = async (req, res, next) => {
  try {
    const snapshot = await adminGetLatestFieldAgentPerformanceSnapshot({
      admin: req.user,
      fieldAgentId: req.params.fieldAgentId,
    });
    return successResponse(res, { message: "Field Agent performance snapshot fetched", data: { snapshot } });
  } catch (err) {
    return next(err);
  }
};
