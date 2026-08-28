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
import adminRoutes from "./routes/admin.routes.js";
import adminAuthRoutes from "./routes/adminAuth.routes.js";
import adminRatingRoutes from "./routes/adminRating.routes.js";
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
import ratingRoutes from "./routes/rating.routes.js";
import reportRoutes from "./routes/reports.routes.js";
import salonOnboardingRouter from "./routes/salon.onboarding.routes.js";
import salonRoutes from "./routes/salon.routes.js";
import salonMediaRoutes from "./routes/salonMedia.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import userRoutes from "./routes/user.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import wishlistRoutes from "./routes/wishlist.routes.js";
import supportCustomerRoutes from "./modules/support/routes/supportCustomer.routes.js"; // ← NEW — Phase C Support Core
import supportAgentRoutes from "./modules/support/routes/agentSupport.routes.js"; // ← NEW — Phase F.3.7 Support API layer
import supportAdminRoutes from "./modules/support/routes/adminSupport.routes.js"; // ← NEW — Phase F.3.7 Support API layer
import supportAuthRoutes from "./modules/support/routes/supportAuth.routes.js"; // ← NEW — Phase F.3.9 AGENT/SUPPORT_ADMIN login
import slaPolicyRoutes from "./modules/support/routes/slaPolicy.routes.js"; // ← NEW — Phase G Step 1 SLA Policy CRUD
import adminCategoryRoutes from "./modules/support/routes/adminCategory.routes.js"; // ← NEW — Phase G Step 9 SUPPORT_ADMIN category read access
import adminAgentRoutes from "./modules/support/routes/adminAgent.routes.js"; // ← NEW — Phase H Step 7 Support Agent Management
import adminTeamRoutes from "./modules/support/routes/adminTeam.routes.js"; // ← NEW — Phase H Step 7 SUPPORT_ADMIN team read access



// 🛠️ Middlewares
import { protect } from "./middlewares/auth.middleware.js";
import { onboardingBypass } from "./middlewares/onboardingBypass.middleware.js";
import { errorHandler } from "./middlewares/errorHandler.js"; // ← NEW — Phase C: mounted globally, replaces the inline handler below

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
app.use("/api/reports", protect, onboardingBypass, reportRoutes);
app.use("/api/ratings", protect, onboardingBypass, ratingRoutes);
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
app.use("/api/support/admin", protect, onboardingBypass, supportAdminRoutes);

///////////////////////////////////////////////////////////
// ADMIN ROUTES
///////////////////////////////////////////////////////////
app.use("/api/admin", protect, adminRoutes);
app.use("/api/admin/ratings", protect, adminRatingRoutes);

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