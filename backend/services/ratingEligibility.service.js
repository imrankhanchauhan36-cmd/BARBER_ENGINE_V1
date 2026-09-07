import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import Staff from "../models/Staff.js";
import ServiceRating, { RATING_TYPE } from "../models/ServiceRating.js";

//////////////////////////////////////////////////////////////
// 📖 SERVICE OVERVIEW — Rating & Review Engine, Phase 2
//
// Per-dimension eligibility model (Phase 1 §5, approved). Given a
// COMPLETED booking, the applicable rating dimensions are derived
// directly and only from that booking's own fields — never guessed,
// never invented:
//
//   - one SERVICE dimension per entry in booking.serviceRefs
//   - one PROFESSIONAL dimension IFF booking.professionalRef !== null
//     (Option A: exactly the one historical performer, never a
//     per-service performer — see Phase 0A approval)
//   - one SALON dimension, always
//
// "Fully rated" is never stored — always computed live by comparing
// the applicable dimension set against existing ServiceRating rows,
// so partial/resumable rating (Phase 1 Decision 4) needs no extra
// state or write path.
//////////////////////////////////////////////////////////////

const dimensionKey = (type, targetId) => `${type}:${targetId.toString()}`;

/**
 * Loads a booking and asserts it is owned by the given customer and
 * COMPLETED. Returns the booking (lean) or a {eligible:false, reason}
 * result. Shared by both the read-only eligibility endpoint and the
 * submission service's own re-verification.
 */
export async function loadRateableBooking({ bookingId, customerId }) {
  const booking = await Booking.findOne({ _id: bookingId, isDeleted: { $ne: true } })
    .select("userRef salonRef serviceRefs professionalRef status completedAt")
    .lean();

  if (!booking) {
    return { ok: false, status: 404, reason: "BOOKING_NOT_FOUND" };
  }
  if (booking.userRef.toString() !== customerId.toString()) {
    return { ok: false, status: 403, reason: "NOT_BOOKING_OWNER" };
  }
  if (booking.status !== "COMPLETED") {
    return { ok: false, status: 400, reason: "BOOKING_NOT_COMPLETED" };
  }

  return { ok: true, booking };
}

/**
 * Builds the applicable dimension list for a COMPLETED booking.
 * Pure function of the booking document — no DB reads beyond what's
 * already loaded, aside from resolving display names.
 */
export function buildApplicableDimensions(booking) {
  const dimensions = [];

  for (const serviceId of booking.serviceRefs) {
    dimensions.push({ type: RATING_TYPE.SERVICE, targetId: serviceId });
  }

  if (booking.professionalRef) {
    dimensions.push({ type: RATING_TYPE.PROFESSIONAL, targetId: booking.professionalRef });
  }

  dimensions.push({ type: RATING_TYPE.SALON, targetId: booking.salonRef });

  return dimensions;
}

/**
 * Full eligibility resolution for GET /api/ratings/eligible/:bookingId.
 * Returns which dimensions apply, which are already rated, and
 * whether the booking is now fully rated.
 */
export async function getRatingEligibility({ bookingId, customerId }) {
  const loaded = await loadRateableBooking({ bookingId, customerId });
  if (!loaded.ok) return loaded;

  const { booking } = loaded;
  const dimensions = buildApplicableDimensions(booking);

  const existingRows = await ServiceRating.find({ bookingId: booking._id, customerId })
    .select("type targetId")
    .lean();
  const ratedKeys = new Set(existingRows.map((r) => dimensionKey(r.type, r.targetId)));

  const [services, professional] = await Promise.all([
    Service.find({ _id: { $in: booking.serviceRefs } }).select("name").lean(),
    booking.professionalRef
      ? Staff.findById(booking.professionalRef).select("name").lean()
      : Promise.resolve(null),
  ]);
  const serviceNameById = new Map(services.map((s) => [s._id.toString(), s.name]));

  const annotated = dimensions.map((d) => {
    let name = null;
    if (d.type === RATING_TYPE.SERVICE) name = serviceNameById.get(d.targetId.toString()) || null;
    else if (d.type === RATING_TYPE.PROFESSIONAL) name = professional?.name || null;
    else if (d.type === RATING_TYPE.SALON) name = "Overall Experience";

    return {
      type: d.type,
      targetId: d.targetId,
      name,
      alreadyRated: ratedKeys.has(dimensionKey(d.type, d.targetId)),
    };
  });

  return {
    ok: true,
    bookingId: booking._id,
    salonId: booking.salonRef,
    completedAt: booking.completedAt,
    dimensions: annotated,
    fullyRated: annotated.every((d) => d.alreadyRated),
  };
}

/**
 * Validates one submitted dimension against the AUTHORITATIVE
 * booking data — never trusts client-supplied targetId beyond
 * checking it against what the booking actually contains. Used by
 * ratingSubmission.service.js for every item in a submission.
 */
export function validateDimensionAgainstBooking(booking, { type, targetId }) {
  const targetIdStr = targetId.toString();

  if (type === RATING_TYPE.SERVICE) {
    const found = booking.serviceRefs.some((s) => s.toString() === targetIdStr);
    if (!found) return { valid: false, reason: "SERVICE_NOT_IN_BOOKING" };
    return { valid: true };
  }

  if (type === RATING_TYPE.PROFESSIONAL) {
    if (!booking.professionalRef) return { valid: false, reason: "NO_PROFESSIONAL_ON_BOOKING" };
    if (booking.professionalRef.toString() !== targetIdStr) {
      return { valid: false, reason: "PROFESSIONAL_MISMATCH" };
    }
    return { valid: true };
  }

  if (type === RATING_TYPE.SALON) {
    if (booking.salonRef.toString() !== targetIdStr) return { valid: false, reason: "SALON_MISMATCH" };
    return { valid: true };
  }

  return { valid: false, reason: "INVALID_TYPE" };
}
