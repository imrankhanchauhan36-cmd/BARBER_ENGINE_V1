/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentOnboarding.controller.js
 *
 * PHASE 2B — thin controllers only. `salonId` always comes from
 * req.params (already shape-validated + ownership-proven by
 * requireActiveClaimForSalon.js before any of these run) — never from
 * req.user, never trusted from the body. No handler here reads
 * req.user beyond what the upstream middleware already resolved.
 */

import { successResponse } from "../../../utils/response.js";
import {
  saveBasicInfo,
  saveLocation,
  saveServices,
  saveChairs,
  saveTimings,
  saveStaff,
  savePhotos,
  getReview,
  submitSalon,
  resubmitOnboarding,
} from "../services/fieldAgentOnboarding.service.js";

const wrap = (fn, message) => async (req, res, next) => {
  try {
    const data = await fn({ salonId: req.params.salonId, body: req.body });
    return successResponse(res, { message, data });
  } catch (err) {
    return next(err);
  }
};

export const saveBasicInfoHandler = wrap(saveBasicInfo, "Basic info saved successfully");
export const saveLocationHandler = wrap(saveLocation, "Location saved successfully");
export const saveServicesHandler = wrap(saveServices, "Services saved successfully");
export const saveChairsHandler = wrap(saveChairs, "Chairs created successfully");
export const saveTimingsHandler = wrap(saveTimings, "Timings saved successfully");
export const saveStaffHandler = wrap(saveStaff, "Staff saved successfully");
export const savePhotosHandler = wrap(savePhotos, "Photos saved successfully");
export const getReviewHandler = wrap(getReview, "Review data fetched");
export const submitSalonHandler = wrap(submitSalon, "Salon submitted for approval");
export const resubmitOnboardingHandler = wrap(resubmitOnboarding, "Application reopened for editing");
