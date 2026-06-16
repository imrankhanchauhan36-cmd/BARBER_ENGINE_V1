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