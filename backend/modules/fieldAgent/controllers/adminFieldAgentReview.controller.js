/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentReview.controller.js
 *
 * FA-4.3 — thin controllers only. adminLevel is always req.user.adminLevel
 * (never client-supplied) — the same identity-derivation convention as
 * every other admin controller in this codebase. Read-only: neither
 * handler here ever mutates anything.
 */

import { successResponse } from "../../../utils/response.js";
import { listApplicationsForReview, getApplicationReviewDetail } from "../services/fieldAgentReview.service.js";

export const listApplicationsForReviewHandler = async (req, res, next) => {
  try {
    // Explicit per-field destructuring (not a `...req.query` spread) —
    // req.query has already been reduced to exactly this whitelist by
    // the validate() middleware's own stripUnknown:true, but naming
    // each field here removes any ambiguity for a future reader/audit,
    // matching the established convention (adminKyc.controller.js's
    // own listKYCForAdmin) rather than relying on the reader to know
    // that fact about a middleware two files away.
    const { page, limit, status, search, sortBy, sortOrder, createdFrom, createdTo, updatedFrom, updatedTo, applicationId } = req.query;
    const result = await listApplicationsForReview({
      page,
      limit,
      status,
      search,
      sortBy,
      sortOrder,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      applicationId,
      adminLevel: req.user.adminLevel,
    });
    return successResponse(res, {
      message: "Field Agent review queue fetched",
      data: { applications: result.applications },
      pagination: result.pagination,
    });
  } catch (err) {
    return next(err);
  }
};

export const getApplicationReviewDetailHandler = async (req, res, next) => {
  try {
    const detail = await getApplicationReviewDetail({ applicationId: req.params.applicationId, adminLevel: req.user.adminLevel });
    return successResponse(res, { message: "Application review detail fetched", data: detail });
  } catch (err) {
    return next(err);
  }
};
