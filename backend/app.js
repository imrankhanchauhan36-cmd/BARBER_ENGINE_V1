import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import mongoSanitize from "express-mongo-sanitize";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";

import redis from "./config/redis.js";

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



// 🛠️ Middlewares
import { protect } from "./middlewares/auth.middleware.js";
import { onboardingBypass } from "./middlewares/onboardingBypass.middleware.js";

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
    if (redis.status === "ready") {
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
app.use("/api/notifications", notificationRoutes);


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
// ERROR HANDLER
///////////////////////////////////////////////////////////
app.use((err, req, res, next) => {
  console.error(
    JSON.stringify({
      requestId: req.requestId,
      error: err.message,
    })
  );

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    requestId: req.requestId,
  });
});


export default app;