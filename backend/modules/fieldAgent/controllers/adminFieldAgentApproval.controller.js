/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminFieldAgentApproval.controller.js
 *
 * FA-4.2 — thin controllers only. adminId is always req.user._id —
 * never client-supplied, matching the identity-derivation convention
 * used everywhere else in this codebase (adminTest.controller.js,
 * fieldAgentTest.controller.js, etc.).
 *
 * FA-4.3 — the review-queue/detail handlers that used to live here
 * (listApplicationsInReviewHandler/getApplicationForReviewHandler)
 * have moved to adminFieldAgentReview.controller.js, which supersedes
 * them with the full-featured versions. approveApplicationHandler/
 * rejectApplicationHandler below are completely untouched.
 */

import { successResponse } from "../../../utils/response.js";
import { approveApplication, rejectApplication } from "../services/fieldAgentApproval.service.js";

export const approveApplicationHandler = async (req, res, next) => {
  try {
    const result = await approveApplication({ applicationId: req.params.applicationId, adminId: req.user._id });
    return successResponse(res, {
      message: result.alreadyApproved ? "Application was already approved" : "Application approved — Field Agent profile created",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const rejectApplicationHandler = async (req, res, next) => {
  try {
    const application = await rejectApplication({
      applicationId: req.params.applicationId,
      adminId: req.user._id,
      reason: req.body.reason,
    });
    return successResponse(res, { message: "Application rejected", data: { application } });
  } catch (err) {
    return next(err);
  }
};
