import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";

import redis, { isRedisReady } from "./config/redis.js";

// 🛣️ Routes
import ownerKycRoutes from "./modules/kyc/routes/ownerKyc.routes.js"; // ← NEW — Phase 6C owner KYC submission
import fieldAgentKycRoutes from "./modules/kyc/routes/fieldAgentKyc.routes.js"; // ← NEW — FA-3.2 Field Agent KYC submission
import adminRoutes from "./routes/admin.routes.js";
import adminAuthRoutes from "./routes/adminAuth.routes.js";
import adminServiceRatingRoutes from "./routes/adminServiceRating.routes.js"; // ← Rating & Review Engine Phase 2 — replaces retired adminRating.routes.js
import authRoutes from "./routes/auth.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import cityRoutes from "./routes/city.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import discoveryRoutes from "./routes/discovery.routes.js";
import masterRoutes from "./routes/master.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import notificationPreferencesRoutes from "./routes/notificationPreferences.routes.js";
import userNotificationRoutes from "./routes/userNotification.routes.js";
import deviceTokenRoutes from "./routes/deviceToken.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import payoutRoutes from "./routes/payout.routes.js";
import serviceRatingRoutes from "./routes/serviceRating.routes.js"; // ← Rating & Review Engine Phase 2 — replaces retired rating.routes.js
import reportRoutes from "./routes/reports.routes.js";
import salonOnboardingRouter from "./routes/salon.onboarding.routes.js";
import salonRoutes from "./routes/salon.routes.js";
import salonMediaRoutes from "./routes/salonMedia.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import userRoutes from "./routes/user.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import wishlistRoutes from "./routes/wishlist.routes.js";
import supportCustomerRoutes from "./modules/support/routes/supportCustomer.routes.js"; // ← NEW — Phase C Support Core
import fieldAgentSupportRoutes from "./modules/support/routes/fieldAgentSupport.routes.js"; // ← NEW — FA-10 Field Agent Support Integration
import supportAgentRoutes from "./modules/support/routes/agentSupport.routes.js"; // ← NEW — Phase F.3.7 Support API layer
import supportAdminRoutes from "./modules/support/routes/adminSupport.routes.js"; // ← NEW — Phase F.3.7 Support API layer
import supportAuthRoutes from "./modules/support/routes/supportAuth.routes.js"; // ← NEW — Phase F.3.9 AGENT/SUPPORT_ADMIN login
import fieldAgentAuthRoutes from "./modules/fieldAgent/routes/fieldAgentAuth.routes.js"; // ← NEW — FA-2 Field Agent OTP apply/login
import fieldAgentGeoRoutes from "./modules/fieldAgent/routes/fieldAgentGeo.routes.js"; // ← NEW — Field Agent Applicant public geo reference (states list)
import fieldAgentRoutes from "./modules/fieldAgent/routes/fieldAgent.routes.js"; // ← NEW — FA-2 Field Agent Application Engine
import fieldAgentTrainingRoutes from "./modules/fieldAgentTraining/routes/fieldAgentTraining.routes.js"; // ← NEW — FA-3.3 Field Agent Training Engine
import fieldAgentHelpRoutes from "./modules/fieldAgentTraining/routes/fieldAgentHelp.routes.js"; // ← NEW — FA-3.3 Field Agent Help (curated operational reference)
import adminFieldAgentTrainingRoutes from "./modules/fieldAgentTraining/routes/adminTraining.routes.js"; // ← NEW — FA-3.3 admin curriculum authoring/governance
import adminFieldAgentTestRoutes from "./modules/fieldAgentTest/routes/adminTest.routes.js"; // ← NEW — FA-3.4.1 admin exam authoring/governance
import adminFieldAgentApprovalRoutes from "./modules/fieldAgent/routes/adminFieldAgentApproval.routes.js"; // ← NEW — FA-4.2 admin approval/rejection
import fieldAgentTestRoutes from "./modules/fieldAgentTest/routes/fieldAgentTest.routes.js"; // ← NEW — FA-3.4.3 Field Agent test API
import adminCommercialPolicyRoutes from "./modules/fieldAgent/routes/adminCommercialPolicy.routes.js"; // ← NEW — FA-5.1 admin commercial policy authoring/governance
import adminCommercialTerritoryRoutes from "./modules/fieldAgent/routes/adminCommercialTerritory.routes.js"; // ← NEW — FA-5.2 admin Commercial Territory authoring/governance
import adminCommercialPolicyOverrideRoutes from "./modules/fieldAgent/routes/adminCommercialPolicyOverride.routes.js"; // ← NEW — FA-9 admin geography-scoped commercial policy override authoring/governance
import fieldAgentAcquisitionClaimRoutes from "./modules/fieldAgent/routes/fieldAgentAcquisitionClaim.routes.js"; // ← NEW — FA-5.3 Field Agent acquisition referral/claim self-service
import fieldAgentEarningRoutes from "./modules/fieldAgent/routes/fieldAgentEarning.routes.js"; // ← NEW — FA-14 Field Agent earnings self-service (read-only)
import fieldAgentPayoutRoutes from "./modules/fieldAgent/routes/fieldAgentPayout.routes.js"; // ← NEW — FA-14 (real) Field Agent payout/withdrawal/disbursement self-service
import adminFieldAgentPayoutRoutes from "./modules/fieldAgent/routes/adminFieldAgentPayout.routes.js"; // ← NEW — FA-14 admin Field Agent payout approval/rejection/manual-payout
import acquisitionRedeemRoutes from "./modules/fieldAgent/routes/acquisitionRedeem.routes.js"; // ← NEW — FA-5.3 Salon Owner referral redemption bridge
import adminAcquisitionClaimRoutes from "./modules/fieldAgent/routes/adminAcquisitionClaim.routes.js"; // ← NEW — FA-5.3 admin AcquisitionClaim review
import adminFieldAgentPerformanceRoutes from "./modules/fieldAgent/routes/adminFieldAgentPerformance.routes.js"; // ← NEW — FA-11.3 admin Field Agent Performance read API
import adminFieldAgentComplianceRoutes from "./modules/fieldAgent/routes/adminFieldAgentCompliance.routes.js"; // ← NEW — FA-12.2 admin compliance case/evidence workflow API
import slaPolicyRoutes from "./modules/support/routes/slaPolicy.routes.js"; // ← NEW — Phase G Step 1 SLA Policy CRUD
import adminCategoryRoutes from "./modules/support/routes/adminCategory.routes.js"; // ← NEW — Phase G Step 9 SUPPORT_ADMIN category read access
import adminAgentRoutes from "./modules/support/routes/adminAgent.routes.js"; // ← NEW — Phase H Step 7 Support Agent Management
import adminGstPolicyRoutes from "./routes/adminGstPolicy.routes.js"; // ← NEW — PAN-India GST configuration authoring/governance
import adminAreaPlatformFeeRoutes from "./routes/adminAreaPlatformFee.routes.js"; // ← NEW — PAN-India area-wise Platform Fee configuration authoring/governance
import adminTeamRoutes from "./modules/support/routes/adminTeam.routes.js"; // ← NEW — Phase H Step 7 SUPPORT_ADMIN team read access
import adminQueueRoutes from "./modules/support/routes/adminQueue.routes.js"; // ← NEW — Phase H Step 8 Support Configuration Management: Queues
import adminRoutingRuleRoutes from "./modules/support/routes/adminRoutingRule.routes.js"; // ← NEW — Phase H Step 8 Support Configuration Management: Routing Rules
import adminCoverageRoutes from "./modules/support/routes/adminCoverage.routes.js"; // ← NEW — Phase H Step 8 Support Configuration Management: Coverage
import emailWebhookRoutes from "./modules/support/routes/emailWebhook.routes.js"; // ← NEW — Phase H Step 9 Email Support (inbound webhook)
import whatsappWebhookRoutes from "./modules/support/routes/whatsappWebhook.routes.js"; // ← NEW — Phase H WhatsApp Support (inbound webhook)
import callWebhookRoutes from "./modules/support/routes/callWebhook.routes.js"; // ← NEW — Phase H Call Support (inbound webhook)



// 🛠️ Middlewares
import { protect } from "./middlewares/auth.middleware.js";
import { requireRole } from "./middlewares/role.middleware.js"; // ← P0-4 — GET /health/ops admin gate, same pattern as every /api/admin/* route
import { onboardingBypass } from "./middlewares/onboardingBypass.middleware.js";
import { errorHandler } from "./middlewares/errorHandler.js"; // ← NEW — Phase C: mounted globally, replaces the inline handler below
import { getStatus as getJobHeartbeatStatus } from "./jobs/jobHeartbeat.js"; // ← P0-4 — background job monitoring, read-only

const app = express();

///////////////////////////////////////////////////////////
// TRUST PROXY
///////////////////////////////////////////////////////////
app.set("trust proxy", 1);

///////////////////////////////////////////////////////////
// SECURITY LAYER
///////////////////////////////////////////////////////////
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(hpp());
app.use(mongoSanitize());
app.use(compression());

///////////////////////////////////////////////////////////
// GLOBAL RATE LIMIT
///////////////////////////////////////////////////////////
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
});

app.use(globalLimiter);

///////////////////////////////////////////////////////////
// REQUEST LOGGER
///////////////////////////////////////////////////////////
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  req.startTime = Date.now();

  res.setHeader("X-Request-Id", req.requestId);

  res.on("finish", () => {
    const duration = Date.now() - req.startTime;

    console.log(
      JSON.stringify({
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: duration + "ms",
      })
    );
  });

  next();
});

///////////////////////////////////////////////////////////
// CORS
///////////////////////////////////////////////////////////
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`🚫 CORS blocked: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Refresh-Token",
      "X-Request-Id",
      "Idempotency-Key",
    ],
  })
);

///////////////////////////////////////////////////////////
// BODY PARSER
///////////////////////////////////////////////////////////
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

///////////////////////////////////////////////////////////
// REDIS ATTACH
///////////////////////////////////////////////////////////
app.use((req, res, next) => {
  req.redis = redis;
  next();
});

///////////////////////////////////////////////////////////
// HEALTH CHECK
///////////////////////////////////////////////////////////
app.get("/health", async (req, res) => {
  let redisStatus = "disconnected";

  try {
    if (isRedisReady()) {
      redisStatus = "connected";
    }
  } catch {}

  res.status(200).json({
    success: true,
    service: "BARBER_ENGINE_V1",
    redis: redisStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

///////////////////////////////////////////////////////////
// HEALTH CHECK — OPERATIONAL (P0-4 — background job monitoring)
//
// Read-only visibility into the 9 in-process background jobs'
// heartbeat state (jobs/jobHeartbeat.js). Admin-only — job names/
// timings are internal operational detail, not public information,
// same reasoning as every other /api/admin/* route already being
// gated behind protect + requireRole("ADMIN").
///////////////////////////////////////////////////////////
app.get("/health/ops", protect, requireRole("ADMIN"), (req, res) => {
  const { overallStatus, evaluatedAt, jobs } = getJobHeartbeatStatus();

  res.status(200).json({
    success: true,
    status: overallStatus,
    evaluatedAt,
    jobs,
  });
});

///////////////////////////////////////////////////////////
// PUBLIC ROUTES
///////////////////////////////////////////////////////////
app.use("/api/auth", authRoutes);
app.use("/api/admin-auth", adminAuthRoutes);
// Phase F.3.9 fix — must be mounted here, alongside the other public
// login surfaces, and BEFORE the generic app.use("/api", protect, ...)
// mount further below (SUPPORT ROUTES section). That generic mount
// matches any /api/* path and runs `protect` unconditionally; mounted
// after it (as originally placed), /login and /refresh — which must
// work with no Bearer token — were being rejected by it before ever
// reaching supportAuthRoutes. No protect/onboardingBypass here — same
// as /api/auth and /api/admin-auth above.
app.use("/api/support/auth", supportAuthRoutes);
// FA-2 — public (pre-authentication) OTP apply/login for Field
// Agents. Same reasoning as /api/auth and /api/support/auth
// immediately above: must be mounted here, before the generic
// app.use("/api", protect, ...) mount further below, since send-otp/
// verify-otp have no session yet. No protect/onboardingBypass here.
app.use("/api/field-agent/auth", fieldAgentAuthRoutes);
// Field Agent Applicant public geo reference — same reasoning as
// /api/field-agent/auth immediately above: GET /states must be
// callable from the Application Profile step, which happens right
// after apply-OTP verify. Read-only, no protect/onboardingBypass.
app.use("/api/field-agent/geo", fieldAgentGeoRoutes);
// Phase H Step 9 — same reasoning as /api/support/auth immediately
// above: an inbound email webhook has no user session at all, so it
// must be mounted here, before the generic protect-wrapping mounts
// further below, and is secured instead by emailWebhookAuth's own
// shared-secret check inside the router itself.
app.use("/api/support/email", emailWebhookRoutes);
// Phase H — WhatsApp Support. Same reasoning as /api/support/email
// immediately above: an inbound WhatsApp webhook has no user session
// at all, so it must be mounted here, secured instead by
// whatsappWebhookAuth's own shared-secret check inside the router.
app.use("/api/support/whatsapp", whatsappWebhookRoutes);
// Phase H — Call Support. Same reasoning as /api/support/email and
// /api/support/whatsapp immediately above.
app.use("/api/support/call", callWebhookRoutes);
app.use("/api/user", userRoutes);


///////////////////////////////////////////////////////////
// ONBOARDING ROUTES
///////////////////////////////////////////////////////////
app.use("/api/salon/onboarding", salonOnboardingRouter);

///////////////////////////////////////////////////////////
// SALON ROUTES
///////////////////////////////////////////////////////////
app.use("/api/salon", salonRoutes);


/////////////////////////////////////////////////////////
//NOTIFICATION ROUTES
////////////////////////////////////////////////////////
// Mounted before /api/notifications (more specific prefix first) so
// this never relies on falling through notificationRoutes' own
// (unmatched) route table — notification.routes.js itself is untouched.
app.use("/api/notifications/device-tokens", deviceTokenRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/user/notifications/preferences", notificationPreferencesRoutes);
app.use("/api/user/notifications", userNotificationRoutes);


///////////////////////////////////////////////////////////
// USER ROUTES
///////////////////////////////////////////////////////////
app.use("/api/discovery", discoveryRoutes);
app.use("/api/v1/wishlist", wishlistRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/cities", cityRoutes);
app.use("/api", protect, onboardingBypass, bookingRoutes);
app.use("/api/payments", protect, onboardingBypass, paymentRoutes);
app.use("/api/payouts", protect, onboardingBypass, payoutRoutes);
app.use("/api/salon/kyc", protect, onboardingBypass, ownerKycRoutes); // ← NEW — Phase 6C owner KYC submission
app.use("/api/field-agent/kyc", protect, onboardingBypass, fieldAgentKycRoutes); // ← NEW — FA-3.2 Field Agent KYC submission
app.use("/api/reports", protect, onboardingBypass, reportRoutes);
app.use("/api/ratings", protect, onboardingBypass, serviceRatingRoutes);
app.use("/api/salon-media", protect, onboardingBypass, salonMediaRoutes);
app.use("/api/customers",  protect, onboardingBypass, customerRoutes);
app.use("/api/upload", uploadRoutes);

///////////////////////////////////////////////////////////
// SUPPORT ROUTES — Phase C customer/salon-owner-facing; Phase F.3.7
// adds the AGENT and SUPPORT_ADMIN (+ team-lead-scoped) surfaces —
// same protect/onboardingBypass wrapper, same mount convention.
// (/api/support/auth is mounted earlier, with the other public auth
// routes — see PUBLIC ROUTES section above.)
///////////////////////////////////////////////////////////
app.use("/api/support/customer", protect, onboardingBypass, supportCustomerRoutes);
// FA-10 — Field Agent Support Integration. Same protect/onboardingBypass
// pattern as every other Support mount; requireRole("FIELD_AGENT") is
// applied inside the router itself.
app.use("/api/support/field-agent", protect, onboardingBypass, fieldAgentSupportRoutes);
// FA-2 — authenticated Field Agent application endpoints (own
// application CRUD only). requireRole("FIELD_AGENT") is applied
// inside fieldAgent.routes.js itself, same pattern as
// supportCustomer.routes.js's own internal requireRole("USER","OWNER").
app.use("/api/field-agent", protect, onboardingBypass, fieldAgentRoutes);
// FA-3.3 — authenticated Field Agent training + help endpoints.
// requireRole("FIELD_AGENT") is applied inside each route file
// itself, same pattern as fieldAgentRoutes above.
app.use("/api/field-agent/training", protect, onboardingBypass, fieldAgentTrainingRoutes);
app.use("/api/field-agent/help", protect, onboardingBypass, fieldAgentHelpRoutes);
// FA-3.4.3 — authenticated Field Agent mandatory-test endpoints. Same
// protect/onboardingBypass-at-mount + requireRole-inside-route-file
// pattern as fieldAgentTrainingRoutes above.
app.use("/api/field-agent/test", protect, onboardingBypass, fieldAgentTestRoutes);
app.use("/api/support/agent", protect, onboardingBypass, supportAgentRoutes);
// Mounted BEFORE the broader /api/support/admin prefix, deliberately —
// /api/support/admin/sla-policies would otherwise first enter
// supportAdminRoutes (whose own routes are all /tickets*), which
// happens to fall through via Express Router's own no-match next()
// behavior, but relying on that fall-through is exactly the class of
// route-order fragility already found and fixed once in this project
// (the F.3.9 /api/support/auth defect) — registering the more
// specific prefix first avoids depending on it at all.
app.use("/api/support/admin/sla-policies", protect, onboardingBypass, slaPolicyRoutes);
// Same defensive reasoning as sla-policies above — Phase G Step 9.
app.use("/api/support/admin/categories", protect, onboardingBypass, adminCategoryRoutes);
// Same defensive reasoning as sla-policies/categories above — Phase H Step 7.
app.use("/api/support/admin/agents", protect, onboardingBypass, adminAgentRoutes);
app.use("/api/support/admin/teams", protect, onboardingBypass, adminTeamRoutes);
// Same defensive reasoning as sla-policies/categories/agents/teams
// above — Phase H Step 8.
app.use("/api/support/admin/queues", protect, onboardingBypass, adminQueueRoutes);
app.use("/api/support/admin/routing-rules", protect, onboardingBypass, adminRoutingRuleRoutes);
app.use("/api/support/admin/coverage", protect, onboardingBypass, adminCoverageRoutes);
app.use("/api/support/admin", protect, onboardingBypass, supportAdminRoutes);

///////////////////////////////////////////////////////////
// ADMIN ROUTES
//
// /api/admin/ratings is registered BEFORE the broad /api/admin
// mount — adminRoutes (routes/admin.routes.js) owns its own
// requireRole("ADMIN") gate and a catch-all 404 for any unmatched
// sub-path, so if the broad mount ran first it would swallow every
// /api/admin/ratings/* request before this more specific router ever
// got a chance (same route-order defensiveness already applied to
// the support module's admin routes above). Auth/role protection is
// unchanged — adminServiceRatingRoutes still requires protect +
// requireRole("ADMIN") exactly as before.
///////////////////////////////////////////////////////////
app.use("/api/admin/ratings", protect, adminServiceRatingRoutes);
// FA-3.3 — admin curriculum authoring/governance. requireAdminLevel is
// applied per-route inside adminTraining.routes.js itself (write ops
// need INDIA level, read ops allow INDIA/STATE/DISTRICT), same
// pattern as routes/location.routes.js.
app.use("/api/admin/field-agent-training", protect, adminFieldAgentTrainingRoutes);
// FA-3.4.1 — admin exam authoring/governance. Same requireAdminLevel
// per-route pattern as adminFieldAgentTrainingRoutes above (write ops
// need INDIA level, read ops allow INDIA/STATE/DISTRICT). Agent-facing
// test-taking routes do not exist yet (FA-3.4.3).
app.use("/api/admin/field-agent-test", protect, adminFieldAgentTestRoutes);
// FA-4.2 — admin approval/rejection of Field Agent applications. Same
// requireAdminLevel per-route pattern as adminFieldAgentTestRoutes
// above (approve/reject need INDIA level, read ops allow
// INDIA/STATE/DISTRICT).
// FA-11.3 — admin Field Agent Performance read API. Read-only (no
// write route exists here); INDIA sees all, STATE is scoped
// server-side to TERRITORY_PARTNER agents in their own state only
// (ACQUISITION_AGENT is INDIA-only in V1 — see fieldAgentPerformance
// .service.js's own header for why). MUST be mounted before the
// broader "/api/admin/field-agents" prefix immediately below —
// Express matches app.use() prefixes in registration order, and
// "/api/admin/field-agents" would otherwise swallow every request to
// "/api/admin/field-agents/performance" first (confirmed by a real
// test failure during implementation — see the FA-11.3 report).
app.use("/api/admin/field-agents/performance", protect, adminFieldAgentPerformanceRoutes);
app.use("/api/admin/field-agents", protect, adminFieldAgentApprovalRoutes);
// FA-5.1 — admin CommercialPolicyVersion authoring/versioning. Read
// AND write are INDIA-only (see adminCommercialPolicy.routes.js's own
// header for why this is stricter than the read-level split above).
app.use("/api/admin/commercial-policies", protect, adminCommercialPolicyRoutes);
// FA-5.2 — admin CommercialTerritory authoring/governance. Read AND
// write are INDIA-only for writes (see
// adminCommercialTerritory.routes.js's own header); reads additionally
// allow STATE/DISTRICT, scoped to the admin's own geography.
app.use("/api/admin/commercial-territories", protect, adminCommercialTerritoryRoutes);
// FA-5.3 — Field Agent acquisition referral/claim self-service.
// protect/onboardingBypass at the mount level, same convention as
// fieldAgentTrainingRoutes/fieldAgentTestRoutes above.
app.use("/api/field-agent/acquisition", protect, onboardingBypass, fieldAgentAcquisitionClaimRoutes);
app.use("/api/field-agent/earnings", protect, onboardingBypass, fieldAgentEarningRoutes); // ← NEW — FA-14 Field Agent earnings self-service (read-only)
// FA-14 — (real) Field Agent payout/withdrawal/disbursement. Same
// protect/onboardingBypass-at-mount + requireRole-inside-route-file
// convention as fieldAgentEarningRoutes above.
app.use("/api/field-agent/payouts", protect, onboardingBypass, fieldAgentPayoutRoutes);
// FA-14 — admin Field Agent payout approval/rejection/manual-payout.
// protect at mount level; requireRole("ADMIN") + requireAdminLevel
// ("INDIA") inside the route file — INDIA-only, see that file's own
// header for why STATE-level scope was dropped mid-implementation.
app.use("/api/admin/field-agent/payouts", protect, adminFieldAgentPayoutRoutes);
// FA-5.3 — Salon Owner referral redemption bridge. protect +
// requireRole("OWNER") are applied INSIDE the router itself, same
// convention as salonOnboardingRouter (no extra middleware here).
app.use("/api/acquisition", acquisitionRedeemRoutes);
// FA-5.3 — admin AcquisitionClaim review. Read AND reject/reassign
// scoping mirrors adminCommercialTerritoryRoutes exactly.
app.use("/api/admin/acquisition-claims", protect, adminAcquisitionClaimRoutes);
// FA-9 — admin CommercialPolicyOverride authoring/governance
// (geography-scoped commercial policy, additive to the national
// CommercialPolicyVersion above). Read AND write are INDIA-only, same
// rationale as adminCommercialPolicyRoutes.
app.use("/api/admin/commercial-policy-overrides", protect, adminCommercialPolicyOverrideRoutes);
// FA-12.2 — admin compliance case/evidence workflow. Read (list/detail)
// and evidence-filing/case-opening are INDIA/STATE (STATE scoped to
// its own FA-11.3 Territory Partner set at the service layer);
// transition/reopen are INDIA-only (zero STATE decision authority,
// per the FA-12 lock) — see adminFieldAgentCompliance.routes.js's own
// header for the exact split.
app.use("/api/admin/field-agent-compliance", protect, adminFieldAgentComplianceRoutes);
// PAN-India Platform Fee + GST architecture — admin authoring/
// governance for both the global GST rate and area-wise Platform Fee.
// Read AND write are INDIA-only for both, same rationale as
// adminCommercialPolicyRoutes/adminCommercialPolicyOverrideRoutes
// above (see each route file's own header).
app.use("/api/admin/finance/gst", protect, adminGstPolicyRoutes);
app.use("/api/admin/finance/platform-fee", protect, adminAreaPlatformFeeRoutes);
app.use("/api/admin", protect, adminRoutes);

///////////////////////////////////////////////////////////
// MASTER ROUTES
///////////////////////////////////////////////////////////
app.use("/api/master", masterRoutes);

///////////////////////////////////////////////////////////
// 404 HANDLER
///////////////////////////////////////////////////////////
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
    requestId: req.requestId,
  });
});

///////////////////////////////////////////////////////////
// ERROR HANDLER — mounted globally (Phase C prerequisite, per the
// Phase B freeze review). Replaces the previous inline handler;
// covers every existing route the same way it covers new Support
// routes — AppError, Mongoose validation/duplicate-key/cast errors,
// JWT errors, and Joi errors are now translated consistently instead
// of falling through to a generic 500.
///////////////////////////////////////////////////////////
app.use(errorHandler);


export default app;