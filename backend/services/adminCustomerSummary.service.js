/**
 * BARBER ENGINE V1
 * backend/services/adminCustomerSummary.service.js
 *
 * STEP 5.2A — Admin Customer Summary API. Read-only aggregation only
 * — reuses Booking/User/Salon/Staff exactly as they are. No write to
 * any of them anywhere in this file. No schema change. Wallet engine
 * (SalonEarnings/WalletLedger/WalletBalanceService) is not imported —
 * this endpoint is entirely Booking-derived, per the ticket's own
 * "Do not touch Wallet engine" rule.
 *
 * PLATFORM-WIDE, not owner-scoped: this is the admin-facing
 * counterpart to controllers/customer.controller.js's own
 * getCustomerDetail (confirmed via the STEP 5.1 audit to be gated
 * requireRole("OWNER") and scoped to one owner's own salons only) —
 * this service deliberately has no salon-ownership filter, so
 * favouriteSalon/favouriteBarber are computed across every salon the
 * customer has ever visited, not just one owner's.
 *
 * "Completed bookings" (the ticket's own literal business rule) means
 * exactly Booking.status === "COMPLETED" — the real enum value — not
 * the looser CONFIRMED-or-COMPLETED convention customer.controller.js
 * happens to use for its own, different purpose. Disclosed here
 * rather than silently reused, since the ticket names its own rule
 * explicitly.
 *
 * "Customer" = a User document with role "USER" (per the STEP 5.1
 * audit's own definition — there is no separate Customer model). A
 * valid-format id belonging to a non-USER role (OWNER/BARBER/ADMIN/
 * etc.) returns 404, same as it genuinely not being a customer.
 */

import mongoose from "mongoose";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Salon from "../models/Salon.js";
import Staff from "../models/Staff.js";
import { Errors } from "../utils/response.js";

const VIP_SPEND_THRESHOLD_PAISE = 500000;
const REPEAT_VISIT_THRESHOLD = 2;
const COMPLETED_STATUS = "COMPLETED";

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

export const getAdminCustomerSummary = async ({ customerId, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw Errors.badRequest("Invalid customer ID");
  }

  const customer = await User.findOne({ _id: customerId, role: "USER", isDeleted: { $ne: true } })
    .select("name phone email stateRef districtRef")
    .lean();
  if (!customer) throw Errors.notFound("Customer not found");
  if (!isWithinAdminScope(admin, customer)) throw Errors.forbidden("Out of your authorized scope");

  const completedBookings = await Booking.find({ userRef: customerId, status: COMPLETED_STATUS })
    .select("salonRef professionalRef totalAmountInPaise bookingDate")
    .sort({ bookingDate: -1 })
    .lean();

  const totalVisits = completedBookings.length;

  if (totalVisits === 0) {
    return {
      customerId: customer._id,
      name: customer.name ?? null,
      phone: customer.phone ?? null,
      email: customer.email ?? null,
      stats: {
        totalVisits: 0,
        lifetimeSpendInPaise: 0,
        averageTicketInPaise: 0,
        lastVisit: null,
        favouriteSalon: null,
        favouriteBarber: null,
        repeatCustomer: false,
        vipCustomer: false,
      },
    };
  }

  const lifetimeSpendInPaise = completedBookings.reduce((sum, b) => sum + (b.totalAmountInPaise ?? 0), 0);
  const averageTicketInPaise = Math.round(lifetimeSpendInPaise / totalVisits);
  const lastVisit = completedBookings[0].bookingDate ?? null; // already sorted newest-first

  // ── Favourite salon — highest completed-visit COUNT (not revenue) ──
  const salonCounts = new Map();
  for (const b of completedBookings) {
    const key = String(b.salonRef);
    salonCounts.set(key, (salonCounts.get(key) || 0) + 1);
  }
  let favouriteSalonId = null;
  let favouriteSalonCount = 0;
  for (const [salonId, count] of salonCounts) {
    if (count > favouriteSalonCount) { favouriteSalonId = salonId; favouriteSalonCount = count; }
  }

  // ── Favourite barber — same rule, over professionalRef. Bookings
  // with no professional selected (professionalRef: null) never count
  // toward any barber's total — if the customer never selected one,
  // favouriteBarber is genuinely null, not guessed. ──────────────────
  const barberCounts = new Map();
  for (const b of completedBookings) {
    if (!b.professionalRef) continue;
    const key = String(b.professionalRef);
    barberCounts.set(key, (barberCounts.get(key) || 0) + 1);
  }
  let favouriteBarberId = null;
  let favouriteBarberCount = 0;
  for (const [staffId, count] of barberCounts) {
    if (count > favouriteBarberCount) { favouriteBarberId = staffId; favouriteBarberCount = count; }
  }

  const [salonDoc, staffDoc] = await Promise.all([
    favouriteSalonId
      ? Salon.findById(favouriteSalonId).select("basicInfo.shopName").lean()
      : Promise.resolve(null),
    favouriteBarberId
      ? Staff.findById(favouriteBarberId).select("name").lean()
      : Promise.resolve(null),
  ]);

  return {
    customerId: customer._id,
    name: customer.name ?? null,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    stats: {
      totalVisits,
      lifetimeSpendInPaise,
      averageTicketInPaise,
      lastVisit,
      favouriteSalon: favouriteSalonId
        ? { id: favouriteSalonId, name: salonDoc?.basicInfo?.shopName ?? null, visits: favouriteSalonCount }
        : null,
      favouriteBarber: favouriteBarberId
        ? { id: favouriteBarberId, name: staffDoc?.name ?? null, visits: favouriteBarberCount }
        : null,
      repeatCustomer: totalVisits >= REPEAT_VISIT_THRESHOLD,
      vipCustomer: lifetimeSpendInPaise >= VIP_SPEND_THRESHOLD_PAISE,
    },
  };
};
