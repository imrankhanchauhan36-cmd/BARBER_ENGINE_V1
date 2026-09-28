/**
 * BARBER ENGINE V1
 * backend/services/adminSalonRevenue.service.js
 *
 * STEP 4.2A — Admin Salon Revenue API. Read-only — no write to any
 * model anywhere in this file. No schema change.
 *
 * SOURCE OF TRUTH (the ticket's own explicit rule): RevenueSplit is
 * the ONLY financial source. Every money figure below is a plain
 * $sum of an already-stored RevenueSplit field
 * (salonCreditInPaise / customerPaidInPaise / platformFeeInPaise /
 * gstAmountInPaise) — nothing here recalculates from Booking or from
 * Wallet (SalonEarnings/WalletLedger are not even imported).
 *
 * Booking is used ONLY to identify WHICH RevenueSplit rows belong to
 * this salon — RevenueSplit itself has no salonId field, only
 * bookingId (see that model's own header), so Booking.distinct(
 * "_id", {salonRef}) is the one, minimal, necessary join to scope the
 * RevenueSplit query to a single salon. No field is ever read off a
 * Booking document itself (no amount, no status, no date) — this is
 * "booking count verification" in the ticket's own words, not a
 * second revenue source.
 *
 * "Completed Bookings" = a plain COUNT of RevenueSplit rows for this
 * salon (per the ticket's own explicit calculation rule) — RevenueSplit
 * is written at booking-lock time (see that model's own header /
 * booking.controller.js#lockSlot), so this counts every booking that
 * ever reached a priced split, not only bookings whose current status
 * is literally COMPLETED. This is the ticket's own literal
 * instruction, not a design choice made here.
 *
 * Monthly trend groups by RevenueSplit's own createdAt (the only date
 * field RevenueSplit has — it has no bookingDate/completedAt of its
 * own), ascending (oldest first, newest last, per the ticket's own
 * "Newest month last" instruction).
 *
 * Admin scope guard mirrors adminFinance.controller.js's own
 * isSalonWithinScope() exactly (same INDIA/STATE/DISTRICT logic) —
 * reimplemented here rather than imported, since that function is not
 * exported from that file and this ticket does not permit modifying
 * it.
 */

import mongoose from "mongoose";
import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import { Errors } from "../utils/response.js";

const isSalonWithinScope = (admin, salon) => {
  if (!salon) return false;
  if (admin?.adminLevel === "INDIA") return true;
  if (admin?.adminLevel === "STATE") {
    return salon.location?.territory?.stateRef?.toString() === admin.stateRef?.toString();
  }
  if (admin?.adminLevel === "DISTRICT") {
    return salon.location?.territory?.districtRef?.toString() === admin.districtRef?.toString();
  }
  return false;
};

export const getAdminSalonRevenue = async ({ salonId, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(salonId)) {
    throw Errors.badRequest("Invalid salon ID");
  }

  const salon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
    .select("location.territory.stateRef location.territory.districtRef")
    .lean();
  if (!salon) throw Errors.notFound("Salon not found");
  if (!isSalonWithinScope(admin, salon)) throw Errors.forbidden("Out of your authorized scope");

  // The one, minimal Booking read — identifies which bookingIds belong
  // to this salon so the RevenueSplit query below can be scoped to it.
  // No field other than _id is ever read off Booking.
  const bookingIds = await Booking.distinct("_id", { salonRef: salonId });

  if (bookingIds.length === 0) {
    return {
      summary: {
        lifetimeRevenueInPaise: 0,
        customerPaidInPaise: 0,
        platformRevenueInPaise: 0,
        gstCollectedInPaise: 0,
        completedBookings: 0,
        averageTicketInPaise: 0,
      },
      monthlyTrend: [],
    };
  }

  const [summaryAgg, trendAgg] = await Promise.all([
    RevenueSplit.aggregate([
      { $match: { bookingId: { $in: bookingIds } } },
      {
        $group: {
          _id: null,
          lifetimeRevenueInPaise: { $sum: "$salonCreditInPaise" },
          customerPaidInPaise: { $sum: "$customerPaidInPaise" },
          platformRevenueInPaise: { $sum: "$platformFeeInPaise" },
          gstCollectedInPaise: { $sum: "$gstAmountInPaise" },
          completedBookings: { $sum: 1 },
        },
      },
    ]),
    RevenueSplit.aggregate([
      { $match: { bookingId: { $in: bookingIds } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          revenueInPaise: { $sum: "$salonCreditInPaise" },
          bookings: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } }, // oldest first, newest last — ticket's own instruction
    ]),
  ]);

  const s = summaryAgg[0] || {
    lifetimeRevenueInPaise: 0,
    customerPaidInPaise: 0,
    platformRevenueInPaise: 0,
    gstCollectedInPaise: 0,
    completedBookings: 0,
  };

  const averageTicketInPaise = s.completedBookings > 0
    ? Math.round(s.customerPaidInPaise / s.completedBookings)
    : 0;

  return {
    summary: {
      lifetimeRevenueInPaise: s.lifetimeRevenueInPaise,
      customerPaidInPaise: s.customerPaidInPaise,
      platformRevenueInPaise: s.platformRevenueInPaise,
      gstCollectedInPaise: s.gstCollectedInPaise,
      completedBookings: s.completedBookings,
      averageTicketInPaise,
    },
    monthlyTrend: trendAgg.map((r) => ({
      month: r._id,
      revenueInPaise: r.revenueInPaise,
      bookings: r.bookings,
    })),
  };
};
