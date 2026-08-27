/**
 * BARBER ENGINE V1
 * backend/services/UserReadService.js
 *
 * Phase H Step 4 (H.2a) — a pure, read-only extraction of the exact
 * safe-field shaping already proven in controllers/adminUser.controller.js's
 * getUserDetail handler. That controller is left completely untouched
 * (its own header marks it "Enterprise Grade — v3 — 10/10 FROZEN", it
 * has exactly one caller in routes/admin.routes.js).
 *
 * Two things are deliberately NOT carried over from getUserDetail,
 * because they are that controller's own business policy rather than
 * a universal safety rule:
 *   - the `role: { $nin: ["ADMIN"] }` query filter (getUserDetail's
 *     admin-panel-specific "this endpoint is for viewing customers/
 *     owners, not other admins" rule)
 *   - the STATE/DISTRICT geo-scope check (an admin-panel authorization
 *     concern — Support's own authorization model is ticket-ownership-
 *     based, not geo-scope-based, and belongs at the caller boundary,
 *     same as TransactionReadService.js / BookingReadService.js)
 *
 * What IS carried over exactly: the password/otpCode/loginAttempts/
 * lockUntil/tokenVersion/otpExpiresAt exclusion (defensive/explicit
 * here even though the User schema already marks all six select:false
 * at the schema level — kept for the same clarity the original
 * controller has), and the identical output field shape.
 */

import User from "../models/User.js";

/**
 * Returns the same field shape adminUser.controller.js's getUserDetail
 * has always returned — id/name/phone/email/role/accountStatus/
 * isActive/verification/wallet/profilePhoto/lastLoginAt/timestamps,
 * with the same null placeholders (stats/bookings/reviews/addresses/
 * devices) getUserDetail's own comment documents as "no dummy arrays —
 * dedicated endpoints when those modules are ready."
 *
 * @param {string} userId
 * @returns {Promise<object|null>} null if the id is invalid, the user
 *   doesn't exist, or is soft-deleted
 */
export async function getUserSafeProfile(userId) {
  if (!/^[0-9a-fA-F]{24}$/.test(userId ?? "")) return null;

  const user = await User.findOne({ _id: userId, isDeleted: { $ne: true } })
    .select("-password -otpCode -loginAttempts -lockUntil -tokenVersion -otpExpiresAt")
    .lean();

  if (!user) return null;

  return {
    id: user._id,

    name: user.name ?? null,
    phone: user.phone ?? null,
    email: user.email ?? null,
    role: user.role ?? null,

    accountStatus: user.accountStatus ?? null,
    isActive: user.isActive ?? true,

    verification: {
      phone: user.isPhoneVerified ?? false,
      email: user.isEmailVerified ?? false,
    },

    wallet: {
      balance: user.walletBalance ?? 0,
      rewardPoints: user.rewardPoints ?? 0,
    },

    profilePhoto: user.profilePhoto ?? null,

    stats: null,
    bookings: null,
    reviews: null,
    addresses: null,
    devices: null,

    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
