//////////////////////////////////////////////////////
// BARBER_ENGINE_V1
// controllers/salon.performance.controller.js
//
// GET /api/salon/owner/performance — Business Performance Date Range
// Selector (Phase 2, approved plan). A NEW, isolated endpoint — does
// NOT modify, share a code path with, or read from the same cache as
// getDashboardStats()/getLiveSchedule() (salon.me.controller.js),
// which remain the Home Dashboard's untouched, real-time-only data
// source.
//
// TENANT ISOLATION (hard requirement, pan-India multi-tenant scale):
// salonRef is NEVER accepted from the client. The salon is resolved
// exclusively from the authenticated owner's own identity
// (req.user._id) — the exact same ownership-resolution pattern
// getDashboardStats() already uses. Every subsequent query is scoped
// to that one resolved salonId; no cross-tenant read is possible.
//
// SCALABILITY: exactly one Mongo aggregation per request, $match'd
// first on {salonRef, startTime range} — hits the existing
// {salonRef:1,startTime:1,endTime:1} index (Booking.js) — never a
// global scan, never all bookings loaded into Node memory, no
// per-document application-side loop, no populate. Bookings/Revenue/
// Customers/Repeat Customers are all derived from the SAME single
// pass over the already salon+date-narrowed candidate set.
//////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import { resolvePerformanceDateRange } from "../utils/dateRange.helpers.js";

// Matches getDashboardStats()'s own two DISTINCT status sets exactly
// (salon.me.controller.js) — todayBookings uses the narrower set (no
// CHECKED_IN), todayCustomers uses the broader one. Preserved here
// deliberately rather than collapsed into one set, per the approved
// plan's metric-semantics table.
const CUSTOMER_QUALIFYING_STATUSES = ["CONFIRMED", "CHECKED_IN", "ONGOING", "COMPLETED"];
const BOOKING_QUALIFYING_STATUSES = ["CONFIRMED", "ONGOING", "COMPLETED"];

// Repeat Customers = distinct customers with >= 2 qualifying bookings
// WITHIN THE SELECTED RANGE itself (approved decision — not an
// all-time/lifetime calculation). "Qualifying" uses the same status
// set as Bookings, not the broader Customers set.
const REPEAT_VISIT_THRESHOLD = 2;

export const getBusinessPerformance = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Tenant resolution — ownership-derived only, identical pattern to
    // getDashboardStats(). No client-supplied salon id is ever read.
    const salon = await Salon.findOne({ ownerId }).select("_id").lean();
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    const salonId = salon._id;

    const resolved = resolvePerformanceDateRange({
      range: req.query.range,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    if (resolved.error) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    const { startUtc, endUtc, resolvedStartDate, resolvedEndDate } = resolved;

    const [agg] = await Booking.aggregate([
      {
        // Salon + date range only — the sole filter that touches an
        // index, and it hits {salonRef:1,startTime:1,endTime:1}
        // exactly (salonRef equality, startTime range).
        $match: {
          salonRef: salonId,
          status: { $in: CUSTOMER_QUALIFYING_STATUSES },
          startTime: { $gte: startUtc, $lte: endUtc },
        },
      },
      {
        // Per-customer subtotal, still scoped to the already-narrowed
        // candidate set from the $match above.
        $group: {
          _id: "$userRef",
          bookingVisitCount: { $sum: { $cond: [{ $in: ["$status", BOOKING_QUALIFYING_STATUSES] }, 1, 0] } },
          completedRevenuePaise: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$totalAmountInPaise", 0] } },
        },
      },
      {
        $group: {
          _id: null,
          bookings: { $sum: "$bookingVisitCount" },
          revenuePaise: { $sum: "$completedRevenuePaise" },
          customers: { $sum: 1 }, // one bucket per distinct userRef from the inner $group
          repeatCustomers: { $sum: { $cond: [{ $gte: ["$bookingVisitCount", REPEAT_VISIT_THRESHOLD] }, 1, 0] } },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        range: req.query.range,
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        metrics: {
          bookings: agg?.bookings || 0,
          revenue: Math.round((agg?.revenuePaise || 0) / 100),
          customers: agg?.customers || 0,
          repeatCustomers: agg?.repeatCustomers || 0,
        },
      },
    });
  } catch (error) {
    console.error("BUSINESS_PERFORMANCE_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch business performance" });
  }
};
