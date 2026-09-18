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
 *
 * FA-17 F3 — OFFICIAL V1 IDENTITY POLICY (explicit product decision,
 * locked, not an implementation accident):
 *
 *   ONE PHONE/EMAIL MAY BACK AT MOST ONE ACTIVE USER IDENTITY PER ROLE.
 *
 *   - phone X + USER  -> at most 1 active User document
 *   - phone X + OWNER -> at most 1 active User document
 *   - the SAME phone X may legitimately back BOTH a USER document and
 *     an OWNER document (two separate identities) — this is INTENTIONAL,
 *     not a gap: ZEMISH V1 is Model B (role-scoped identity), not
 *     Model A (one global multi-role identity). There is no `roles: []`
 *     array anywhere in this codebase, `User.role` is single-valued and
 *     immutable after creation, and every domain ownership reference
 *     (Salon.ownerId, Booking.userRef, KYC.ownerId, FieldAgent.userRef,
 *     SupportTicket.requesterRef, RefreshToken.userRef) points at one
 *     specific User._id, never at a phone number or a person spanning
 *     documents. Sessions/JWTs are likewise bound to one specific
 *     User._id with an immutable role, re-verified live on every
 *     request — cross-role phone sharing has no session-confusion or
 *     privilege-escalation implication (see the FA-17 F3 decision
 *     report for the full analysis).
 *
 *   This lookup (`{phone, role}`, scoped by role) is therefore the
 *   CORRECT, intended implementation of that policy, not a narrower
 *   workaround — it is backed by a real DB-level partial-unique index
 *   on `{phone,role}`/`{email,role}` in models/User.js (see that
 *   file's own index-block comment for the live-database verification
 *   history). Real, currently-active production accounts already rely
 *   on the cross-role half of this policy (the same phone backing both
 *   a USER and an OWNER identity) — do not "fix" this into a global
 *   phone/email-uniqueness constraint without a dedicated identity
 *   migration project; see scripts/verifyUserIdentityUniqueness.js for
 *   the full rationale and the permanent regression proof of both
 *   halves of this rule (same-role uniqueness enforced; cross-role
 *   reuse intentionally allowed).
 *
 *   A future Model A (one global, multi-role identity) is explicitly
 *   NOT part of V1 and is not implied or enabled by this function —
 *   it would require a `roles[]`-style schema redesign, a rewrite of
 *   every creation path listed in the F3 decision report, and a
 *   reconciliation plan for the existing cross-role accounts. It must
 *   never be approximated by a simple index change.
 */
export const createOrFindUser = async (phone, role, defaultName) => {
  let user = await User.findOne({ phone, role }).select("+tokenVersion");
  if (!user) {
    user = new User({ phone, role, name: defaultName });
    await user.save({ validateBeforeSave: false });
  }
  return user;
};