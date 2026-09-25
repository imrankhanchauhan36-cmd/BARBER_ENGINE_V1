import User from "../models/User.js";

/**
 * OTP-1 — this file is now a thin backward-compatible facade. The
 * canonical OTP generate/hash/store/verify implementation lives in
 * modules/otp/services/otp.service.js (purpose-scoped Redis keys,
 * atomic Lua verify, audit logging — see that file's own header).
 * `generateOtp`/`hashOtp` are pure, role/purpose-agnostic primitives —
 * re-exporting them here is not a duplicate implementation, just a
 * second import path kept for any existing caller of this file (e.g.
 * scripts/verifyFieldAgentSecurityPhaseA.js's own hashOtp usage).
 *
 * `storeOtpHash`/`verifyOtpAttempt` (the old role-scoped, non-atomic
 * versions) are NOT re-exported — every controller that used them has
 * been migrated to modules/otp/services/otp.service.js's
 * sendOtp()/verifyOtp() (purpose-scoped, atomic, audited). See OTP-1's
 * own migration report for the full file list.
 */
export { generateOtp, hashOtp } from "../modules/otp/services/otp.service.js";

export const isValidOtpFormat = (otp) =>
  typeof otp === "string" && /^\d{6}$/.test(otp);

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