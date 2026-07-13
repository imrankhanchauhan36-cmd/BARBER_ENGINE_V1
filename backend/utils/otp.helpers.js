import crypto from "crypto";
import User from "../models/User.js";

const OTP_ATTEMPT_LIMIT = 5;
const OTP_WINDOW_SECONDS = 300; // also used as OTP hash TTL

// Fixed OTP used ONLY when explicitly enabled via ALLOW_FIXED_OTP=true
// (no DLT/SMS provider set up yet, so real SMS can't be sent).
// Makes manual testing fast — no need to check server logs for a
// random code every time.
//
// SAFETY: deliberately a SEPARATE flag from NODE_ENV, not reused from
// it. Several other things in this codebase (e.g. Razorpay signature
// verification in booking.controller.js) are gated on
// `NODE_ENV !== "production"` — if this were tied to NODE_ENV too,
// enabling fixed-OTP testing on Render (where NODE_ENV=production)
// would require flipping NODE_ENV to "development", which would
// SILENTLY ALSO disable Razorpay payment verification in production.
// Keeping this on its own flag means fixed OTP can be safely turned
// on/off on Render without touching payment security at all.
const DEV_FIXED_OTP = "123456";
const ALLOW_FIXED_OTP = process.env.ALLOW_FIXED_OTP === "true";

export const generateOtp = () => {
  if (ALLOW_FIXED_OTP) {
    return DEV_FIXED_OTP;
  }
  // Cryptographically random 6-digit OTP
  return crypto.randomInt(100000, 999999).toString();
};

export const hashOtp = (otp) =>
  crypto.createHash("sha256").update(otp).digest("hex");

const getOtpAttemptKey = (phone, role) => `otp:attempts:${role}:${phone}`;
const getOtpHashKey = (phone, role) => `otp:hash:${role}:${phone}`;

export const isValidOtpFormat = (otp) =>
  typeof otp === "string" && /^\d{6}$/.test(otp);

/**
 * Stores the hashed OTP in Redis with a short TTL.
 * Call right after generating + "sending" the OTP.
 */
export const storeOtpHash = async (redis, phone, role, otp) => {
  const key = getOtpHashKey(phone, role);
  await redis.set(key, hashOtp(otp), { EX: OTP_WINDOW_SECONDS });
};

/**
 * Verifies phone+otp against the stored hash and enforces the
 * attempt rate limit. Returns a structured result (no res.status
 * calls here) so both OWNER and USER controllers can reuse this
 * without drifting apart.
 */
export const verifyOtpAttempt = async (redis, phone, role, otp) => {
  const attemptKey = getOtpAttemptKey(phone, role);
  const hashKey = getOtpHashKey(phone, role);

  const attempts = await redis.get(attemptKey);
  if (attempts && Number(attempts) >= OTP_ATTEMPT_LIMIT) {
    return {
      ok: false,
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many OTP attempts. Try again later.",
    };
  }

  const storedHash = await redis.get(hashKey);
  if (!storedHash) {
    return {
      ok: false,
      code: "OTP_EXPIRED",
      message: "OTP expired. Please request a new one.",
    };
  }

  if (hashOtp(otp) !== storedHash) {
    await redis.multi()
      .incr(attemptKey)
      .expire(attemptKey, OTP_WINDOW_SECONDS)
      .exec();

    return {
      ok: false,
      code: "INVALID_OTP",
      message: "Invalid OTP",
    };
  }

  await redis.del(attemptKey);
  await redis.del(hashKey);
  return { ok: true };
};

/**
 * Shared find-or-create so OWNER and USER flows can never drift apart.
 */
export const createOrFindUser = async (phone, role, defaultName) => {
  let user = await User.findOne({ phone, role }).select("+tokenVersion");
  if (!user) {
    user = new User({ phone, role, name: defaultName });
    await user.save({ validateBeforeSave: false });
  }
  return user;
};