/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentAcquisitionClaim.controller.js
 *
 * FA-5.3 — thin controllers only. Every identity is derived exclusively
 * from req.user._id — never a client-supplied fieldAgentRef, matching
 * the identity-derivation convention already used everywhere in this
 * codebase (fieldAgentApplication.controller.js's getMyApplication(req.user._id),
 * adminCommercialTerritory.controller.js).
 */

import { successResponse } from "../../../utils/response.js";
import {
  issueReferral,
  listMyReferrals,
  cancelMyReferral,
  listMyClaims,
  withdrawMyClaim,
} from "../services/acquisitionClaim.service.js";

export const issueReferralHandler = async (req, res, next) => {
  try {
    const referral = await issueReferral({ userId: req.user._id });
    return successResponse(res, { statusCode: 201, message: "Acquisition referral issued", data: { referral } });
  } catch (err) {
    return next(err);
  }
};

export const listMyReferralsHandler = async (req, res, next) => {
  try {
    const result = await listMyReferrals({ userId: req.user._id, page: req.query.page, limit: req.query.limit });
    return successResponse(res, {
      message: "Acquisition referrals fetched",
      data: { referrals: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const cancelMyReferralHandler = async (req, res, next) => {
  try {
    const referral = await cancelMyReferral({ userId: req.user._id, referralId: req.params.referralId });
    return successResponse(res, { message: "Acquisition referral cancelled", data: { referral } });
  } catch (err) {
    return next(err);
  }
};

export const listMyClaimsHandler = async (req, res, next) => {
  try {
    const result = await listMyClaims({ userId: req.user._id, page: req.query.page, limit: req.query.limit });
    return successResponse(res, {
      message: "Acquisition claims fetched",
      data: { claims: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const withdrawMyClaimHandler = async (req, res, next) => {
  try {
    const claim = await withdrawMyClaim({ userId: req.user._id, claimId: req.params.claimId });
    return successResponse(res, { message: "Acquisition claim withdrawn", data: { claim } });
  } catch (err) {
    return next(err);
  }
};
