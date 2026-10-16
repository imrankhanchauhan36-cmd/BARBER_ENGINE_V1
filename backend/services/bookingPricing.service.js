/**
 * BARBER ENGINE V1
 * backend/services/bookingPricing.service.js
 *
 * SHARED BOOKING PRICING ENGINE (Phase 2, additive, 2026-10-12).
 *
 * Extracted, formula-for-formula equivalent to the pricing block that
 * used to live inline inside controllers/booking.controller.js#lockSlot
 * (service amount -> Platform Fee -> service GST -> platform-fee GST
 * -> total), so lockSlot and the new read-only
 * GET /v1/bookings/user/quote endpoint can never independently
 * disagree about a price. This is exactly the class of bug this
 * codebase has already been bitten by once in production — see
 * modules/finance/services/RevenueSplitIntegrationService.js's own
 * header for the real ₹141.60-vs-₹123.60 incident caused by a SECOND,
 * independent pricing calculation. Having one function, called from
 * both places, makes that class of drift structurally impossible
 * rather than merely "tested against".
 *
 * PLATFORM-FEE GST: a separate GST charge on the Platform Fee itself
 * (never the service amount), independent of salon GST registration
 * status, read from the SAME published GstPolicyVersion document
 * service GST already uses — via the SAME
 * services/gstPolicy.service.js#getPublishedGstPolicy() call. No new
 * policy model, no second configuration store, no hardcoded rate.
 *
 * FAIL-CLOSED (hardened, Phase 2 review, 2026-10-12): unlike service
 * GST, which is allowed to resolve null/not-yet-published (a
 * legitimate historical state this codebase has supported since
 * before GST existed — GST never blocks a booking there, by original
 * design), platform-fee GST is a REQUIRED charge once this feature is
 * live — the same "no silent fallback" discipline the Platform Fee
 * amount itself already uses. If the currently-published GST policy
 * has no valid platformFeeGstRatePercent (none ever published, or a
 * published policy predates this field), this function THROWS a
 * `{status: 503}` error — same shape, same HTTP status as the
 * Platform Fee guard just above it — rather than returning a
 * seemingly-normal total that is silently missing a required charge.
 * Verified empirically: before this guard existed, calling this
 * function against the real currently-published policy (which lacks
 * platformFeeGstRatePercent) returned a complete-looking
 * totalAmountInPaise with no error at all. This function still never
 * invents 18%, 0%, or any other rate — it only ever uses a rate an
 * admin actually published, or refuses to price at all.
 *
 * `session` is optional — pass a live mongoose ClientSession to run
 * inside an existing transaction (lockSlot does, since it already has
 * one open for the slot-lock itself); omit it for a plain,
 * transaction-free read (the quote endpoint does, since it never
 * writes anything). Neither underlying read (Service.find,
 * Salon.findById) requires a session for correctness on its own —
 * lockSlot only happens to also run them inside its own open
 * transaction.
 *
 * Never creates, locks, holds, or mutates anything — purely reads
 * Service prices, the published Platform Fee policy, and the
 * published GST policy, and returns a plain breakdown object. Throws
 * the same `{message, status}`-shaped errors the original inline
 * lockSlot block used to throw, so lockSlot's existing catch/response
 * handling needs no behavior change.
 */

import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import { getPublishedGstPolicy } from "./gstPolicy.service.js";
import { resolveGlobalPlatformFee } from "./areaPlatformFee.service.js";

/**
 * @param {Object} params
 * @param {string|import("mongoose").Types.ObjectId} params.salonId
 * @param {string[]} params.serviceRefs - non-empty, duplicate-free service ids
 * @param {import("mongoose").ClientSession} [params.session] - optional, for use inside an existing transaction
 * @returns {Promise<{
 *   serviceAmountInPaise: number,
 *   commissionAmountInPaise: number,
 *   platformFeePolicyRef: import("mongoose").Types.ObjectId|null,
 *   gstRatePercent: number|null,
 *   gstAmountInPaise: number|null,
 *   gstPolicyVersionRef: import("mongoose").Types.ObjectId|null,
 *   platformFeeGstConfigured: true,
 *   platformFeeGstRatePercent: number,
 *   platformFeeGstAmountInPaise: number,
 *   totalAmountInPaise: number,
 * }>} On any successful return, platformFeeGstConfigured is always
 *   `true` — an unconfigured platform-fee GST rate makes this function
 *   throw a `{status: 503}` error instead of returning (see FAIL-CLOSED
 *   note above). The field is kept on the return shape (rather than
 *   removed) so existing destructuring call sites remain unambiguous
 *   and so a future caller can see at a glance why it's always true.
 */
export const calculateBookingPricing = async ({ salonId, serviceRefs, session } = {}) => {
  //////////////////////////////////////////////////////////
  // 💰 SERVICE AMOUNT — sum of selected services' prices.
  //////////////////////////////////////////////////////////
  const serviceQuery = Service.find({ _id: { $in: serviceRefs } }).select("price").lean();
  if (session) serviceQuery.session(session);
  const existingServices = await serviceQuery;

  // A nonexistent serviceRef matches nothing in $in — no error, just
  // fewer results than requested. serviceRefs is already
  // duplicate-free by the time it reaches here (validated at the
  // caller's own query-parsing/schema layer), so a plain length
  // comparison is exact — same guard as the original inline block.
  if (existingServices.length !== serviceRefs.length) {
    throw Object.assign(
      new Error("One or more selected services are invalid or unavailable"),
      { status: 400 }
    );
  }

  const serviceAmountInPaise = existingServices.reduce(
    (sum, s) => sum + Math.round(s.price * 100),
    0
  );

  //////////////////////////////////////////////////////////
  // 💰 PLATFORM FEE — single GLOBAL/PAN-India policy. NO SILENT ₹0
  // FALLBACK: an unconfigured Platform Fee refuses the booking/quote
  // with an explicit, controlled error rather than charging ₹0.
  //////////////////////////////////////////////////////////
  const globalPlatformFee = await resolveGlobalPlatformFee(serviceAmountInPaise);
  if (!globalPlatformFee) {
    throw Object.assign(
      new Error("Platform Fee is not configured yet. Please try again shortly."),
      { status: 503, code: "PLATFORM_FEE_NOT_CONFIGURED" }
    );
  }
  const { feeInPaise: commissionAmountInPaise, policyId: platformFeePolicyRef } = globalPlatformFee;

  //////////////////////////////////////////////////////////
  // 💰 SALON GST registration status.
  //////////////////////////////////////////////////////////
  const salonQuery = Salon.findById(salonId).select("basicInfo.gstStatus").lean();
  if (session) salonQuery.session(session);
  const salonForGst = await salonQuery;
  if (!salonForGst) {
    throw Object.assign(new Error("Salon not found"), { status: 404 });
  }
  const isGstRegistered = salonForGst?.basicInfo?.gstStatus === "REGISTERED";

  const gstPolicy = await getPublishedGstPolicy();

  //////////////////////////////////////////////////////////
  // 💰 SERVICE GST — taxable base is serviceAmountInPaise ONLY
  // (Platform Fee excluded from this specific charge). GST NEVER
  // blocks a booking: a null gstPolicy produces null snapshot
  // fields, distinguishable from a genuinely-zero computed rate
  // (which stores 0, not null).
  //////////////////////////////////////////////////////////
  const gstRatePercent = gstPolicy
    ? (isGstRegistered ? gstPolicy.registeredRatePercent : gstPolicy.unregisteredRatePercent)
    : null;
  const gstAmountInPaise = gstPolicy
    ? Math.round(serviceAmountInPaise * gstRatePercent / 100)
    : null;
  const gstPolicyVersionRef = gstPolicy ? gstPolicy.versionId : null;

  //////////////////////////////////////////////////////////
  // 💰 PLATFORM-FEE GST (additive, Phase 2) — taxable base is the
  // Platform Fee itself, rate independent of salon registration.
  // gstPolicy.platformFeeGstRatePercent is already null-safe (resolved
  // by gstPolicy.service.js's OWN, separate hasValidFeeRate check,
  // decoupled from the two service-GST rates above).
  //
  // FAIL-CLOSED, UNLIKE SERVICE GST ABOVE (hardened, Phase 2 review,
  // 2026-10-12): service GST is allowed to be null/not-yet-published
  // because "no GST policy has ever been published" is itself a
  // legitimate, historical state this codebase has supported since
  // before GST existed at all — GST NEVER blocks a booking there,
  // by original design. Platform-fee GST has no equivalent legitimate
  // "not applicable" state — the business rule for this feature is
  // that it is REQUIRED once live, exactly like the Platform Fee
  // amount itself (see the NO SILENT ₹0 FALLBACK guard above this
  // function already uses for the fee). Verified empirically before
  // this guard existed: calculateBookingPricing() against the real
  // currently-published policy (which has registeredRatePercent/
  // unregisteredRatePercent but no platformFeeGstRatePercent) returned
  // a normal-looking totalAmountInPaise with no error — i.e. a
  // booking/payment could proceed today with an incomplete total,
  // silently missing a required charge. Mirrors the Platform Fee
  // guard's exact shape (503, same message style) so lockSlot's
  // existing catch block and the quote route's existing catch block
  // both handle this with ZERO additional code — same mechanism,
  // same HTTP status, already wired.
  //////////////////////////////////////////////////////////
  const platformFeeGstConfigured = !!gstPolicy && Number.isFinite(gstPolicy.platformFeeGstRatePercent);

  if (!platformFeeGstConfigured) {
    throw Object.assign(
      new Error("Platform Fee GST rate is not configured yet. Please try again shortly."),
      { status: 503, code: "PLATFORM_FEE_GST_NOT_CONFIGURED" }
    );
  }

  const platformFeeGstRatePercent = gstPolicy.platformFeeGstRatePercent;
  const platformFeeGstAmountInPaise = Math.round(commissionAmountInPaise * platformFeeGstRatePercent / 100);

  const totalAmountInPaise = serviceAmountInPaise
    + commissionAmountInPaise
    + (gstAmountInPaise || 0)
    + (platformFeeGstAmountInPaise || 0);

  return {
    serviceAmountInPaise,
    commissionAmountInPaise,
    platformFeePolicyRef,
    gstRatePercent,
    gstAmountInPaise,
    gstPolicyVersionRef,
    platformFeeGstConfigured,
    platformFeeGstRatePercent,
    platformFeeGstAmountInPaise,
    totalAmountInPaise,
  };
};
