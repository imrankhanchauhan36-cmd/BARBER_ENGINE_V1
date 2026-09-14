/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/acquisitionRedeem.controller.js
 *
 * FA-5.3 — the owner-facing bridge endpoint. ownerId is always
 * req.user._id (the authenticated Salon Owner's own session) — never
 * a client-supplied ownerId/salonId, matching the exact identity
 * convention salon.onboarding.controller.js already uses for every
 * onboarding step (`const ownerId = req.user?._id`).
 */

import { successResponse } from "../../../utils/response.js";
import { redeemReferral } from "../services/acquisitionClaim.service.js";

export const redeemReferralHandler = async (req, res, next) => {
  try {
    const result = await redeemReferral({ ownerId: req.user._id, referralCode: req.body.referralCode });
    return successResponse(res, {
      message: "Acquisition referral redeemed",
      data: { claim: result.claim, salonId: result.salon._id },
    });
  } catch (err) {
    return next(err);
  }
};
