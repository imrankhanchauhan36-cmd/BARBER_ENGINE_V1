/**
 * BARBER ENGINE V1
 * backend/services/adminCustomerBookings.service.js
 *
 * STEP 5.2B — Admin Customer Booking History API. Read-only join only
 * — reuses User/Booking/Salon/Staff exactly as they are. No write to
 * any of them anywhere in this file. No schema change. Wallet engine
 * (SalonEarnings/WalletLedger/WalletBalanceService) is not imported —
 * this endpoint is entirely Booking-derived, per the ticket's own
 * "No wallet engine change" rule.
 *
 * Join chain, exactly as the ticket names it: User -> Booking ->
 * Salon -> Staff -> Service, implemented via a single query with
 * .populate() on each relation (no aggregation, no second round trip
 * per row).
 *
 * Unlike STEP 5.2A's summary (which deliberately counts only
 * COMPLETED bookings for its stats), this is a full booking HISTORY —
 * every booking for the customer, any status, newest first. The
 * ticket's own response shape includes both bookingStatus AND
 * paymentStatus precisely so a cancelled/failed booking is still
 * visible in the history, not silently filtered out.
 *
 * "Customer" = a User document with role "USER" (same definition as
 * STEP 5.2A, per the STEP 5.1 audit's own finding that no separate
 * Customer model exists).
 *
 * barberName: Booking.professionalRef (ref Staff) is nullable — a
 * booking where the customer never selected a specific professional
 * has barberName: null, never guessed.
 */

import mongoose from "mongoose";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import { Errors } from "../utils/response.js";

const isWithinAdminScope = (admin, customer) => {
  if (admin?.adminLevel === "INDIA") return true;
  if (admin?.adminLevel === "STATE") {
    return customer.stateRef?.toString() === admin.stateRef?.toString();
  }
  if (admin?.adminLevel === "DISTRICT") {
    return customer.districtRef?.toString() === admin.districtRef?.toString();
  }
  return false;
};

export const getAdminCustomerBookings = async ({ customerId, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw Errors.badRequest("Invalid customer ID");
  }

  const customer = await User.findOne({ _id: customerId, role: "USER", isDeleted: { $ne: true } })
    .select("stateRef districtRef")
    .lean();
  if (!customer) throw Errors.notFound("Customer not found");
  if (!isWithinAdminScope(admin, customer)) throw Errors.forbidden("Out of your authorized scope");

  const rows = await Booking.find({ userRef: customerId })
    .select("bookingDate startTime salonRef professionalRef serviceRefs totalAmountInPaise status paymentStatus")
    .sort({ startTime: -1 })
    .populate("salonRef", "basicInfo.shopName")
    .populate("professionalRef", "name")
    .populate("serviceRefs", "name price duration")
    .lean();

  const bookings = rows.map((b) => ({
    bookingId: b._id,
    bookingDate: b.bookingDate ?? null,
    bookingTime: b.startTime ?? null,
    salonName: b.salonRef?.basicInfo?.shopName ?? null,
    barberName: b.professionalRef?.name ?? null,
    // Service.price is stored in RUPEES (confirmed against the model —
    // no *InPaise suffix on that field, and SalonDetailPage's own
    // Services tab already displays it unconverted as ₹{s.price}) —
    // named priceInRupees here, never silently mislabeled as paise.
    services: (b.serviceRefs || []).map((s) => ({
      name: s.name ?? null,
      priceInRupees: s.price ?? null,
      durationMinutes: s.duration ?? null,
    })),
    amountInPaise: b.totalAmountInPaise ?? 0,
    bookingStatus: b.status ?? null,
    paymentStatus: b.paymentStatus ?? null,
  }));

  return { bookings };
};
