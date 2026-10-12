import rateLimit from "express-rate-limit";

//////////////////////////////////////////////////////////////
// 🔑 COMMON CONFIG (ENTERPRISE SAFE)
//////////////////////////////////////////////////////////////

const baseConfig = {
  standardHeaders: true,
  legacyHeaders: false,

  //////////////////////////////////////////////////////////
  // 🔐 KEY GENERATOR (USER + PROXY SAFE IP)
  //////////////////////////////////////////////////////////
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    const ip = forwarded
      ? forwarded.split(",")[0].trim()
      : req.socket?.remoteAddress;

    return req.user?._id?.toString() || ip;
  },

  //////////////////////////////////////////////////////////
  // 📊 HANDLER (LOGGING + RESPONSE)
  //////////////////////////////////////////////////////////
  handler: (req, res) => {
    console.warn("Rate limit hit:", {
      user: req.user?._id || null,
      ip:
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress,
      path: req.originalUrl,
      method: req.method,
      time: new Date().toISOString(),
    });

    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
    });
  },
};

//////////////////////////////////////////////////////////////
// 🔒 LOCK SLOT LIMIT (STRICT)
//////////////////////////////////////////////////////////////

export const lockRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 5,
  message: {
    success: false,
    message: "Too many slot lock attempts. Please wait.",
  },
});

//////////////////////////////////////////////////////////////
// 💳 CONFIRM BOOKING LIMIT (MEDIUM)
//////////////////////////////////////////////////////////////

export const confirmRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many booking confirmations. Try again.",
  },
});

//////////////////////////////////////////////////////////////
// 🌐 GENERAL LIMIT
//////////////////////////////////////////////////////////////

export const bookingRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many requests. Please slow down.",
  },
});

//////////////////////////////////////////////////////////////
// 🪪 FA-3.2 — FIELD AGENT KYC LIMITS (Field-Agent-scoped only —
// Owner/admin KYC endpoints are NOT retrofitted with rate limiting
// in this phase, per the approved FA-3.2 plan)
//////////////////////////////////////////////////////////////

export const fieldAgentKycSubmissionRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: {
    success: false,
    message: "Too many KYC submission requests. Please wait.",
  },
});

export const fieldAgentKycDocumentRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: {
    success: false,
    message: "Too many document upload requests. Please wait.",
  },
});

// Stricter — each call may hit the real Surepass API, which has a
// financial/rate cost, unlike the two limiters above.
export const fieldAgentKycProviderRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    success: false,
    message: "Too many automatic verification attempts. Please try again later or continue with Manual KYC.",
  },
});

// ZEMISH onboarding-gate pass — Owner self-serve verification, exact
// same config as fieldAgentKycProviderRateLimiter above (same product
// shape: a real, possibly-billed Cashfree/Surepass call per attempt).
export const ownerKycProviderRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    success: false,
    message: "Too many automatic verification attempts. Please try again later or continue with Manual KYC.",
  },
});

//////////////////////////////////////////////////////////////
// 🪪 PHASE 3b — OWNER + ADMIN KYC LIMITS (Global Verification Engine
// security hardening, approved 2026-10-10)
//
// Closes the gap the FA-3.2 comment above explicitly deferred: Owner's
// self-serve KYC routes (modules/kyc/routes/ownerKyc.routes.js) and the
// live admin KYC verification routes (routes/admin.routes.js) had no
// rate limiting at all before this phase. Thresholds mirror the
// already-proven Field Agent values above — confirmed safe via a
// read-only check of salon-app's kycApi.js (no client-side retry loop)
// and KYCScreen.js (buttons already disabled while a request is
// in-flight; a real session produces ~9 requests total, far under
// these limits).
//
// Uses the exact same baseConfig (and therefore the exact same
// keyGenerator — req.user._id, falling back to IP only when
// unauthenticated, which cannot happen on these protect()-gated
// routes) as every limiter above. No existing limiter, and no
// Field Agent route, is modified by this section.
//////////////////////////////////////////////////////////////

export const ownerKycSubmissionRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: {
    success: false,
    message: "Too many KYC submission requests. Please wait.",
  },
});

export const ownerKycDocumentRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: {
    success: false,
    message: "Too many document upload requests. Please wait.",
  },
});

// Admin review throughput is deliberately NOT capped at Field Agent's
// self-serve 5/hour level — an admin legitimately batches through a
// queue of pending KYC records in one sitting. 30/min is abuse
// prevention only, far above normal single-admin review pace, and
// only verify-pan ever has real provider-cost exposure today
// (Surepass, when configured) — verify-aadhaar/verify-bank are
// Manual-only in the current admin flow (confirmed in the Phase 1
// audit), so none of the three can run up an unbounded real bill even
// at this ceiling.
export const adminKycVerifyRateLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 1000, // 1 min
  max: 30,
  message: {
    success: false,
    message: "Too many verification attempts. Please wait.",
  },
});