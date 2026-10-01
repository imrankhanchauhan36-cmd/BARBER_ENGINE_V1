/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentAcquisitionClaim.routes.js
 *
 * FA-5.3 — Field-Agent-facing acquisition surface. protect/onboardingBypass
 * are applied at the app.js mount level, matching the exact precedent
 * of fieldAgentTrainingRoutes/fieldAgentTestRoutes; requireRole is
 * applied here, mirroring fieldAgent.routes.js's own
 * router.use(requireRole("FIELD_AGENT")) pattern exactly. idempotency
 * is applied to every mutating endpoint, same convention as FA-2's own
 * field-agent-facing POST endpoints.
 *
 * No route here accepts a client-supplied fieldAgentRef — every
 * handler derives it from req.user._id via getFieldAgentByUserId.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { requireActiveFieldAgent } from "../middlewares/requireActiveFieldAgent.js";
import { createRedisRateLimiter, RATE_LIMIT_ACTIONS, RATE_LIMIT_CONFIG } from "../../../middlewares/redisRateLimit.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  issueReferralHandler,
  listMyReferralsHandler,
  cancelMyReferralHandler,
  listMyClaimsHandler,
  withdrawMyClaimHandler,
} from "../controllers/fieldAgentAcquisitionClaim.controller.js";
import {
  getMyAcquisitionDashboardHandler,
  listMyAcquisitionRecoveryHandler,
  getMyAcquisitionRecoveryDetailHandler,
} from "../controllers/fieldAgentAcquisitionRecovery.controller.js";
import {
  sendAssistedOnboardingOtpHandler,
  startAssistedOnboardingHandler,
} from "../controllers/assistedOnboarding.controller.js";
import { listMyApplicationsHandler } from "../controllers/fieldAgentApplications.controller.js";
import {
  saveBasicInfoHandler,
  saveLocationHandler,
  saveServicesHandler,
  saveChairsHandler,
  saveTimingsHandler,
  saveStaffHandler,
  savePhotosHandler,
  getReviewHandler,
  submitSalonHandler,
  resubmitOnboardingHandler,
} from "../controllers/fieldAgentOnboarding.controller.js";
import { requireActiveClaimForSalon } from "../middlewares/requireActiveClaimForSalon.js";
import { acquisitionClaimSchemas } from "../validators/acquisitionClaim.validator.js";
import { assistedOnboardingSchemas } from "../validators/assistedOnboarding.validator.js";
import { fieldAgentApplicationsSchemas } from "../validators/fieldAgentApplications.validator.js";
import { fieldAgentOnboardingSchemas } from "../validators/fieldAgentOnboarding.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));
// FA-15 Phase A — request-level operationalStatus re-check, uniform
// across this whole "operational" surface (issueReferral/withdrawClaim
// already had their own ad-hoc ACTIVE check via assertClaimEligible;
// this closes the gap on the read-only list endpoints too).
router.use(requireActiveFieldAgent);

// FA-15 Phase C1 — abuse/cost-containment only, sits before the
// existing idempotency+handler chain; does not alter referral
// generation, acquisition attribution, territory rules, referral
// ownership, cancellation, or claim creation in any way.
const referralCreateLimiter = createRedisRateLimiter({
  action: RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE,
  ...RATE_LIMIT_CONFIG[RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE],
});

router.post("/referrals", referralCreateLimiter, idempotency, issueReferralHandler);

router.get(
  "/referrals/mine",
  validate(acquisitionClaimSchemas.listReferralsQuery, "query"),
  listMyReferralsHandler
);

router.post(
  "/referrals/:referralId/cancel",
  validate(acquisitionClaimSchemas.referralIdParam, "params"),
  idempotency,
  cancelMyReferralHandler
);

router.get(
  "/claims/mine",
  validate(acquisitionClaimSchemas.listClaimsQuery, "query"),
  listMyClaimsHandler
);

router.post(
  "/claims/:claimId/withdraw",
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  idempotency,
  withdrawMyClaimHandler
);

// FA-P3-B Step 2 — Recovery Dashboard, read-only, no new mutation.
router.get("/dashboard", getMyAcquisitionDashboardHandler);

router.get(
  "/recovery",
  validate(acquisitionClaimSchemas.listRecoveryQuery, "query"),
  listMyAcquisitionRecoveryHandler
);

router.get(
  "/recovery/:claimId",
  validate(acquisitionClaimSchemas.claimIdParam, "params"),
  getMyAcquisitionRecoveryDetailHandler
);

// PHASE 1 — PAN-India Field Agent Assisted Onboarding. Deliberately
// added to THIS existing router rather than a new file/new app.js
// mount: requireRole("FIELD_AGENT") + requireActiveFieldAgent are
// already applied above via router.use(...), and this flow reuses the
// SAME referralCreateLimiter (FIELD_AGENT_REFERRAL_CREATE) already
// defined above for /referrals — no second rate-limit system, exactly
// as this phase's own instruction requires. idempotency is applied to
// both (same "every mutating endpoint" convention as every other POST
// in this router) so a client-side retry (e.g. a flaky mobile network
// after OTP verify) can never create a duplicate OWNER/Salon/
// AcquisitionClaim — see assistedOnboarding.service.js's own
// transactional + partial-unique-index guarantees for the deeper
// correctness story idempotency sits on top of here.
router.post(
  "/assisted-onboarding/send-otp",
  validate(assistedOnboardingSchemas.sendOtpBody, "body"),
  referralCreateLimiter,
  idempotency,
  sendAssistedOnboardingOtpHandler
);

router.post(
  "/assisted-onboarding/start",
  validate(assistedOnboardingSchemas.startBody, "body"),
  referralCreateLimiter,
  idempotency,
  startAssistedOnboardingHandler
);

// PHASE 2A — Field Agent "My Applications" list. Strictly read-only
// (no idempotency/rate-limiter needed, same convention as every other
// GET in this router — /referrals/mine, /claims/mine, /dashboard,
// /recovery, /recovery/:claimId — none of which carry either). Scoped
// exclusively to the caller's own fieldAgentRef inside the service —
// see fieldAgentApplications.service.js's own header.
router.get(
  "/applications",
  validate(fieldAgentApplicationsSchemas.listApplicationsQuery, "query"),
  listMyApplicationsHandler
);

// PHASE 2B — salonId-scoped onboarding step-write surface. Every
// route below runs, in order: (1) salonId param shape validation,
// (2) requireActiveClaimForSalon — the new claim-ownership boundary
// (404, never 403, on any mismatch — see that middleware's own
// header), (3) body validation (mutating routes only), (4) idempotency
// (mutating routes only, same "every mutating endpoint" convention as
// every other POST/PATCH in this router — a retried PATCH can never
// double-apply a step write, e.g. saveChairs' own delete+insert).
// GET routes (review) carry neither idempotency nor a body schema,
// matching /claims/mine, /dashboard, /recovery's own existing
// GET-has-neither convention in this same file. No rate limiter is
// applied here — the real Owner onboarding engine
// (routes/salon.onboarding.routes.js, frozen, unmodified) has none on
// any of these 10 endpoints either, and referralCreateLimiter's own
// 20/hour budget is semantically a referral/claim-CREATION limit, not
// a step-edit limit — applying it here would be a mismatched reuse,
// not a faithful one.
router.patch(
  "/applications/:salonId/onboarding/basic-info",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.basicInfoBody, "body"),
  idempotency,
  saveBasicInfoHandler
);

router.patch(
  "/applications/:salonId/onboarding/location",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.locationBody, "body"),
  idempotency,
  saveLocationHandler
);

router.patch(
  "/applications/:salonId/onboarding/services",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.servicesBody, "body"),
  idempotency,
  saveServicesHandler
);

router.patch(
  "/applications/:salonId/onboarding/chairs",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.chairsBody, "body"),
  idempotency,
  saveChairsHandler
);

router.patch(
  "/applications/:salonId/onboarding/timings",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.timingsBody, "body"),
  idempotency,
  saveTimingsHandler
);

router.patch(
  "/applications/:salonId/onboarding/staff",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.staffBody, "body"),
  idempotency,
  saveStaffHandler
);

router.patch(
  "/applications/:salonId/onboarding/photos",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  validate(fieldAgentOnboardingSchemas.photosBody, "body"),
  idempotency,
  savePhotosHandler
);

router.get(
  "/applications/:salonId/onboarding/review",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  getReviewHandler
);

router.post(
  "/applications/:salonId/onboarding/submit",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  idempotency,
  submitSalonHandler
);

router.patch(
  "/applications/:salonId/onboarding/resubmit",
  validate(fieldAgentOnboardingSchemas.salonIdParam, "params"),
  requireActiveClaimForSalon,
  idempotency,
  resubmitOnboardingHandler
);

export default router;
