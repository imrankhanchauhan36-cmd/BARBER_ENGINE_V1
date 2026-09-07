///////////////////////////////////////////////////////////
// RATING & REVIEW ENGINE — CUSTOMER ROUTES (Phase 2)
//
// Mounted at /api/ratings with `protect` + `onboardingBypass`
// already applied at the app.js mount level, matching exactly how
// bookingRoutes/paymentRoutes/etc. are wired. Replaces the retired
// routes/rating.routes.js (Phase 1 Decision 7 retirement plan).
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  getEligibilityHandler,
  submitRatingsHandler,
  getMyRatingsHandler,
  getSalonReviewsHandler,
  getSalonSummaryHandler,
  getServiceSummaryHandler,
  getServiceReviewsHandler,
  getProfessionalSummaryHandler,
  getProfessionalReviewsHandler,
} from "../controllers/serviceRating.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { serviceRatingSchemas } from "../validators/serviceRating.validator.js";

const router = express.Router();

router.get(
  "/eligible/:bookingId",
  validate(serviceRatingSchemas.eligibleParams, "params"),
  asyncHandler(getEligibilityHandler)
);

router.post(
  "/",
  validate(serviceRatingSchemas.submit, "body"),
  asyncHandler(submitRatingsHandler)
);

router.get(
  "/my",
  validate(serviceRatingSchemas.paginationQuery, "query"),
  asyncHandler(getMyRatingsHandler)
);

// NOTE: more specific /summary routes must be registered BEFORE the
// bare "/salon/:salonId" route — same route-order defensiveness
// already established in this codebase (see app.js's own comment on
// the support module's admin route ordering).
router.get(
  "/salon/:salonId/summary",
  validate(serviceRatingSchemas.salonIdParam, "params"),
  asyncHandler(getSalonSummaryHandler)
);

router.get(
  "/salon/:salonId",
  validate(serviceRatingSchemas.salonIdParam, "params"),
  validate(serviceRatingSchemas.paginationQuery, "query"),
  asyncHandler(getSalonReviewsHandler)
);

router.get(
  "/service/:serviceId/summary",
  validate(serviceRatingSchemas.serviceIdParam, "params"),
  asyncHandler(getServiceSummaryHandler)
);

router.get(
  "/service/:serviceId",
  validate(serviceRatingSchemas.serviceIdParam, "params"),
  validate(serviceRatingSchemas.paginationQuery, "query"),
  asyncHandler(getServiceReviewsHandler)
);

router.get(
  "/professional/:professionalId/summary",
  validate(serviceRatingSchemas.professionalIdParam, "params"),
  asyncHandler(getProfessionalSummaryHandler)
);

router.get(
  "/professional/:professionalId",
  validate(serviceRatingSchemas.professionalIdParam, "params"),
  validate(serviceRatingSchemas.paginationQuery, "query"),
  asyncHandler(getProfessionalReviewsHandler)
);

export default router;
