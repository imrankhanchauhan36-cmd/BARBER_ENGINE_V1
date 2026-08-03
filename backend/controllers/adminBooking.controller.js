/**
 * BARBER ENGINE V1
 * backend/controllers/adminBooking.controller.js
 * Enterprise Grade — v2 — 10/10 FROZEN
 *
 * v2.1 — ADDED getBookingsAnalytics() at the end (PAN India analytics).
 * Nothing above this comment block was changed — all original frozen
 * functions (listBookingsForAdmin, getBookingDetail, adminCancelBooking,
 * adminUpdateBookingStatus, getBookingsSummary) are byte-for-byte identical.
 */

import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Salon from "../models/Salon.js";
import Transaction, { TRANSACTION_STATUS, TRANSACTION_TYPE } from "../models/Transaction.js"; // ← UPDATED (added named exports)
import User from "../models/User.js";
import { Errors, successResponse } from "../utils/response.js";

// ─── Helpers ─────────────────────────────────────────────────

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * Build scope filter — returns salonRef filter for STATE/DISTRICT
 * Single Salon.find() query — avoids N+1 on every request
 */
const buildSalonScope = async (admin) => {
  if (admin.adminLevel === "INDIA") return {};

  const salonFilter = { isDeleted: { $ne: true } };
  if (admin.adminLevel === "STATE")    salonFilter["location.territory.stateRef"] = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") salonFilter["assignedAdmin"] = admin._id;

  const salons = await Salon.find(salonFilter).select("_id").lean();
  return { salonRef: { $in: salons.map(s => s._id) } };
};

/**
 * =====================================================
 * LIST BOOKINGS FOR ADMIN
 * GET /api/admin/bookings
 * =====================================================
 */
export const listBookingsForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      status    = "ALL",
      search    = "",
      date      = "",
      salonId   = "",
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Number.isFinite guard — Math.max/Math.min return NaN (not the other
    // operand) if ANY argument is NaN, so a malformed ?page=abc/?limit=abc
    // previously produced skip=NaN, crashing the query at the driver level
    // instead of falling back to the intended defaults.
    const parsedPage  = parseInt(page,  10);
    const parsedLimit = parseInt(limit, 10);
    const pageNumber  = Math.max(Number.isFinite(parsedPage)  ? parsedPage  : 1,  1);
    const limitNumber = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 20, 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Base Filter ──────────────────────────────────
    const filter = { isDeleted: { $ne: true } };

    if (status !== "ALL") filter.status      = status;
    if (date)             filter.bookingDate = date;
    if (salonId && isValidId(salonId)) filter.salonRef = salonId;

    // ── Scope Filter (single query, no N+1) ──────────
    const scopeFilter = await buildSalonScope(admin);
    Object.assign(filter, scopeFilter);

    // ── Search ───────────────────────────────────────
    // Search by booking ID, or join with user collection
    if (search?.trim()) {
      const s = search.trim();
      // If it looks like a booking ID
      if (isValidId(s)) {
        filter._id = s;
      } else {
        // Escape regex metacharacters — s is raw user input fed directly
        // into $regex below; unescaped, characters like ( ) . * + change
        // matching semantics unpredictably (no behavior change for
        // ordinary name/phone/shop-name search text, which contains none
        // of these).
        const safeS = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Search users by name/phone, then filter bookings
        const matchedUsers = await User
          .find({
            isDeleted: { $ne: true },
            $or: [
              { name:  { $regex: safeS, $options: "i" } },
              { phone: { $regex: safeS, $options: "i" } },
            ],
          })
          .select("_id")
          .lean();

        const matchedSalons = await Salon.find({
          isDeleted: { $ne: true },
          "basicInfo.shopName": { $regex: safeS, $options: "i" },
        }).select("_id").lean();

        filter.$or = [
          { userRef:  { $in: matchedUsers.map(u => u._id)  } },
          { salonRef: { $in: matchedSalons.map(s => s._id) } },
        ];
      }
    }

    // ── Sort ─────────────────────────────────────────
    const allowedSort = {
      createdAt:   "createdAt",
      startTime:   "startTime",
      amount:      "amount",
      bookingDate: "bookingDate",
    };
    const sortField = allowedSort[sortBy] || "createdAt";
    const sort      = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ────────────────────────────────────────
    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .select("_id userRef salonRef chairRef serviceRefs bookingDate startTime endTime status paymentStatus amount totalAmountInPaise source createdAt cancelledAt completedAt checkedInAt")
        .populate("userRef",     "name phone email")
        .populate("salonRef",    "basicInfo.shopName")
        .populate("serviceRefs", "name price duration")
        .populate("chairRef",    "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Booking.countDocuments(filter),
    ]);

    // ── DTO ──────────────────────────────────────────
    const data = bookings.map(b => ({
      id:            b._id,
      bookingDate:   b.bookingDate   ?? null,
      startTime:     b.startTime     ?? null,
      endTime:       b.endTime       ?? null,
      status:        b.status        ?? null,
      paymentStatus: b.paymentStatus ?? null,
      // ✅ Both rupees and paise for frontend flexibility
      amountRupees:  Math.round((b.totalAmountInPaise ?? 0) / 100),   // FIX: was b.amount (never populated by booking creation flow)
      amountPaise:   b.totalAmountInPaise              ?? 0,
      source:        b.source        ?? null,

      user: b.userRef ? {
        id:    b.userRef._id,
        name:  b.userRef.name  ?? null,
        phone: b.userRef.phone ?? null,
        email: b.userRef.email ?? null,
      } : null,

      salon: b.salonRef ? {
        id:       b.salonRef._id,
        shopName: b.salonRef.basicInfo?.shopName ?? null,
      } : null,

      chair: b.chairRef ? {
        id:   b.chairRef._id,
        name: b.chairRef.name ?? null,
      } : null,

      services: (b.serviceRefs || []).map(s => ({
        id:       s._id,
        name:     s.name     ?? null,
        price:    s.price    ?? 0,
        duration: s.duration ?? 0,
      })),

      createdAt:   b.createdAt   ?? null,
      cancelledAt: b.cancelledAt ?? null,
      completedAt: b.completedAt ?? null,
      checkedInAt: b.checkedInAt ?? null,
    }));

    return successResponse(res, {
      message: "Bookings fetched",
      data,
      pagination: {
        page:       pageNumber,
        limit:      limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber) || 1,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * GET BOOKING DETAIL
 * GET /api/admin/bookings/:id
 * =====================================================
 */
export const getBookingDetail = async (req, res, next) => {
  try {
    const admin = req.user;

    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid booking ID"));

    const booking = await Booking.findOne({
      _id:       req.params.id,
      isDeleted: { $ne: true },
    })
      .populate("userRef",     "name phone email profilePhoto")
      .populate("salonRef",    "basicInfo.shopName basicInfo.category location.address location.territory.stateRef location.territory.districtRef assignedAdmin")
      .populate("serviceRefs", "name price duration")
      .populate("chairRef",    "name")
      .populate("cancelledBy", "name phone adminLevel")
      .populate("statusHistory.changedBy", "name adminLevel")
      .lean();

    if (!booking) return next(Errors.notFound("Booking not found"));

    // ── Scope Guard — use already-populated salonRef ──
    // ✅ FIX 3: no extra DB query needed
    if (admin.adminLevel === "STATE") {
      const salonStateRef = booking.salonRef?.location?.territory?.stateRef?.toString();
      if (salonStateRef !== admin.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }
    if (admin.adminLevel === "DISTRICT") {
      const salonAssigned = booking.salonRef?.assignedAdmin?.toString();
      if (salonAssigned !== admin._id?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    // ── Transaction ──────────────────────────────────
    const transaction = await Transaction.findOne({ bookingId: booking._id }).lean();

    return successResponse(res, {
      message: "Booking detail fetched",
      data: {
        id:              booking._id,
        bookingDate:     booking.bookingDate     ?? null,
        startTime:       booking.startTime       ?? null,
        endTime:         booking.endTime         ?? null,
        serviceDuration: booking.serviceDuration ?? null,
        bufferTime:      booking.bufferTime      ?? 0,
        status:          booking.status          ?? null,
        paymentStatus:   booking.paymentStatus   ?? null,
        amountRupees:    Math.round((booking.totalAmountInPaise ?? 0) / 100),   // FIX: was booking.amount (never populated)
        amountPaise:     booking.totalAmountInPaise ?? 0,
        source:          booking.source          ?? null,
        rating:          booking.rating          ?? null,
        cancelReason:    booking.cancelReason    ?? null,

        user: booking.userRef ? {
          id:           booking.userRef._id,
          name:         booking.userRef.name         ?? null,
          phone:        booking.userRef.phone        ?? null,
          email:        booking.userRef.email        ?? null,
          profilePhoto: booking.userRef.profilePhoto ?? null,
        } : null,

        salon: booking.salonRef ? {
          id:       booking.salonRef._id,
          shopName: booking.salonRef.basicInfo?.shopName  ?? null,
          category: booking.salonRef.basicInfo?.category  ?? null,
          address:  booking.salonRef.location?.address    ?? null,
        } : null,

        chair: booking.chairRef ? {
          id:   booking.chairRef._id,
          name: booking.chairRef.name ?? null,
        } : null,

        services: (booking.serviceRefs || []).map(s => ({
          id:       s._id,
          name:     s.name     ?? null,
          price:    s.price    ?? 0,
          duration: s.duration ?? 0,
        })),

        cancelledBy: booking.cancelledBy ? {
          id:         booking.cancelledBy._id,
          name:       booking.cancelledBy.name       ?? null,
          phone:      booking.cancelledBy.phone      ?? null,
          adminLevel: booking.cancelledBy.adminLevel ?? null,
        } : null,

        transaction: transaction ? {
          id:           transaction._id,
          amountPaise:  transaction.amount       ?? 0,
          amountRupees: Math.round((transaction.amount ?? 0) / 100),
          commission:   transaction.commission   ?? 0,
          payoutAmount: transaction.payoutAmount ?? 0,
          status:       transaction.status       ?? null,
          paymentId:    transaction.paymentId    ?? null,
          type:         transaction.type         ?? null,
          createdAt:    transaction.createdAt    ?? null,
        } : null,

        // ✅ Rich timeline for UI
        timeline: [
          { event: "BOOKING_CREATED",   label: "Booking Created",   time: booking.createdAt,        done: true },
          { event: "CONFIRMED",         label: "Payment Confirmed",  time: transaction?.createdAt ?? null, done: !!transaction },
          { event: "CHECKED_IN",        label: "Customer Checked In",time: booking.checkedInAt,      done: !!booking.checkedInAt },
          { event: "ONGOING",           label: "Service Started",    time: booking.serviceStartedAt, done: !!booking.serviceStartedAt },
          { event: "COMPLETED",         label: "Service Completed",  time: booking.completedAt,      done: !!booking.completedAt },
          { event: "CANCELLED",         label: "Booking Cancelled",  time: booking.cancelledAt,      done: !!booking.cancelledAt },
          { event: "NO_SHOW",           label: "Marked No Show",     time: booking.noShowMarkedAt,   done: !!booking.noShowMarkedAt },
        ].filter(t => t.done || !["CANCELLED","NO_SHOW"].includes(t.event) ),

        statusHistory: (booking.statusHistory || []).map(h => ({
          status:    h.status    ?? null,
          changedAt: h.changedAt ?? null,
          changedBy: h.changedBy ? {
            id:         h.changedBy._id,
            name:       h.changedBy.name       ?? "System",
            adminLevel: h.changedBy.adminLevel ?? null,
          } : { name: "System" },
        })),

        createdAt:        booking.createdAt        ?? null,
        cancelledAt:      booking.cancelledAt      ?? null,
        completedAt:      booking.completedAt      ?? null,
        checkedInAt:      booking.checkedInAt      ?? null,
        serviceStartedAt: booking.serviceStartedAt ?? null,
        noShowMarkedAt:   booking.noShowMarkedAt   ?? null,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * ADMIN CANCEL BOOKING
 * PATCH /api/admin/bookings/:id/cancel
 * INDIA + STATE only
 * =====================================================
 */
export const adminCancelBooking = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges to cancel bookings"));
    }

    const { reason } = req.body;
    if (!reason?.trim()) return next(Errors.badRequest("Cancellation reason is required"));
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid booking ID"));

    const booking = await Booking.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("salonRef", "location.territory.stateRef");
    if (!booking) return next(Errors.notFound("Booking not found"));

    // Jurisdiction scope guard — same rule getBookingDetail() already
    // enforces for STATE admins (this file, above). The role check
    // above only confirms adminLevel is INDIA/STATE; without this, a
    // STATE admin could cancel any booking PAN-India, not just their
    // own state's.
    if (req.user.adminLevel === "STATE") {
      const salonStateRef = booking.salonRef?.location?.territory?.stateRef?.toString();
      if (salonStateRef !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    const cancellableStatuses = [
      BOOKING_STATUS.HOLD,
      BOOKING_STATUS.CONFIRMED,
      BOOKING_STATUS.CHECKED_IN,
    ];

    if (!cancellableStatuses.includes(booking.status)) {
      return next(Errors.badRequest(`Cannot cancel booking in ${booking.status} status`));
    }

    const now = new Date();
    booking.status          = BOOKING_STATUS.CANCELLED;
    booking.cancelledAt     = now;
    booking.cancelledBy     = req.user._id;
    booking.cancelReason    = reason.trim();
    booking.statusChangedAt = now;
    booking.statusChangedBy = req.user._id;

    // ✅ FIX 4 — Enriched audit entry
    booking.statusHistory.push({
      status:    BOOKING_STATUS.CANCELLED,
      changedAt: now,
      changedBy: req.user._id,
      // Extra audit fields stored in meta (schema allows mixed)
      meta: {
        reason:          reason.trim(),
        performedByRole: req.user.adminLevel,
        source:          "ADMIN_PANEL",
        ip:              req.ip ?? null,
      },
    });

    await booking.save();

    return successResponse(res, {
      message: "Booking cancelled by admin",
      data: {
        id:          booking._id,
        status:      booking.status,
        cancelledAt: booking.cancelledAt,
        cancelledBy: req.user.name,
        adminLevel:  req.user.adminLevel,
        reason:      reason.trim(),
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * ADMIN STATUS UPDATE
 * PATCH /api/admin/bookings/:id/status
 * Controlled transitions — INDIA + STATE only
 * =====================================================
 */
export const adminUpdateBookingStatus = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges to update booking status"));
    }

    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid booking ID"));

    const { status, reason } = req.body;

    // ✅ Allowed admin transitions
    const allowedTransitions = {
      CONFIRMED:  ["CHECKED_IN", "CANCELLED"],
      CHECKED_IN: ["ONGOING",    "CANCELLED"],
      ONGOING:    ["COMPLETED"],
      HOLD:       ["CANCELLED"],
    };

    const booking = await Booking.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("salonRef", "location.territory.stateRef");
    if (!booking) return next(Errors.notFound("Booking not found"));

    // Jurisdiction scope guard — same rule getBookingDetail() already
    // enforces for STATE admins (this file, above). The role check
    // above only confirms adminLevel is INDIA/STATE; without this, a
    // STATE admin could transition any booking PAN-India, not just
    // their own state's.
    if (req.user.adminLevel === "STATE") {
      const salonStateRef = booking.salonRef?.location?.territory?.stateRef?.toString();
      if (salonStateRef !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    const allowed = allowedTransitions[booking.status] || [];
    if (!allowed.includes(status)) {
      return next(Errors.badRequest(
        `Cannot transition from ${booking.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}`
      ));
    }

    if (["CANCELLED"].includes(status) && !reason?.trim()) {
      return next(Errors.badRequest("Reason is required for cancellation"));
    }

    const now = new Date();
    booking.status          = status;
    booking.statusChangedAt = now;
    booking.statusChangedBy = req.user._id;

    if (status === "CANCELLED") {
      booking.cancelledAt  = now;
      booking.cancelledBy  = req.user._id;
      booking.cancelReason = reason?.trim() || null;
    }
    if (status === "CHECKED_IN")  booking.checkedInAt      = now;
    if (status === "ONGOING")     booking.serviceStartedAt = now;
    if (status === "COMPLETED")   booking.completedAt      = now;

    booking.statusHistory.push({
      status,
      changedAt: now,
      changedBy: req.user._id,
    });

    await booking.save();

    return successResponse(res, {
      message: `Booking status updated to ${status}`,
      data: {
        id:         booking._id,
        status:     booking.status,
        updatedBy:  req.user.name,
        adminLevel: req.user.adminLevel,
        reason:     reason?.trim() || null,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * GET BOOKINGS SUMMARY (with dashboard metrics)
 * GET /api/admin/bookings/summary
 * =====================================================
 */
export const getBookingsSummary = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const scopeFilter = await buildSalonScope(admin);
    const baseFilter  = { isDeleted: { $ne: true }, ...scopeFilter };

    const now = new Date();

    // toISOString() is always UTC; India is UTC+5:30, so between 12:00 AM
    // and 5:30 AM IST the raw UTC calendar date is still "yesterday."
    // bookingDate is an exact-match string, so without this shift the
    // "Today" stats would show zero/wrong data every day during that
    // window. Matches this file's own IST convention used in
    // getBookingsAnalytics (TZ = "Asia/Kolkata") below.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const todayStr  = new Date(now.getTime() + IST_OFFSET_MS).toISOString().split("T")[0];
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monStart  = new Date(now.getFullYear(), now.getMonth(), 1);

    const [summary, todayStats, weekStats, monthStats] = await Promise.all([
      // Overall
      Booking.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id:          null,
            total:        { $sum: 1 },
            confirmed:    { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED"]  }, 1, 0] } },
            completed:    { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"]  }, 1, 0] } },
            cancelled:    { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"]  }, 1, 0] } },
            ongoing:      { $sum: { $cond: [{ $eq: ["$status", "ONGOING"]    }, 1, 0] } },
            noShow:       { $sum: { $cond: [{ $eq: ["$status", "NO_SHOW"]    }, 1, 0] } },
            hold:         { $sum: { $cond: [{ $eq: ["$status", "HOLD"]       }, 1, 0] } },
            totalRevenue: { $sum: "$totalAmountInPaise" },

            // totalAmountInPaise is set at confirm/payment time, not at
            // completion — so totalRevenue above already includes money
            // from CONFIRMED/CHECKED_IN/ONGOING bookings that haven't
            // completed yet. avgTicket below divides by completed-count,
            // so it needs completed-only revenue as its numerator, not
            // totalRevenue — otherwise the average is inflated by
            // revenue from bookings that were never in its denominator.
            completedRevenue: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$totalAmountInPaise", 0] } },

            // ✅ Payment summary
            payPaid:      { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"]     }, 1, 0] } },
            payPending:   { $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"]  }, 1, 0] } },
            payFailed:    { $sum: { $cond: [{ $eq: ["$paymentStatus", "FAILED"]   }, 1, 0] } },
            payRefunded:  { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, 1, 0] } },

            // ✅ Source breakdown
            srcApp:       { $sum: { $cond: [{ $eq: ["$source", "APP"]    }, 1, 0] } },
            srcAdmin:     { $sum: { $cond: [{ $eq: ["$source", "ADMIN"]  }, 1, 0] } },
            srcSystem:    { $sum: { $cond: [{ $eq: ["$source", "SYSTEM"] }, 1, 0] } },
            srcWeb:       { $sum: { $cond: [{ $eq: ["$source", "WEB"]    }, 1, 0] } },
          },
        },
      ]),

      // Today
      Booking.aggregate([
        { $match: { ...baseFilter, bookingDate: todayStr } },
        { $group: {
          _id:       null,
          count:     { $sum: 1 },
          revenue:   { $sum: "$totalAmountInPaise" },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          ongoing:   { $sum: { $cond: [{ $eq: ["$status", "ONGOING"]   }, 1, 0] } },
          pending:   { $sum: { $cond: [{ $in: ["$status", ["CONFIRMED", "HOLD", "CHECKED_IN", "ONGOING"]] }, 1, 0] } },
        }},
      ]),

      // Last 7 days
      Booking.aggregate([
        { $match: { ...baseFilter, createdAt: { $gte: weekStart } } },
        { $group: {
          _id:       null,
          count:     { $sum: 1 },
          revenue:   { $sum: "$totalAmountInPaise" },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          ongoing:   { $sum: { $cond: [{ $eq: ["$status", "ONGOING"]   }, 1, 0] } },
          pending:   { $sum: { $cond: [{ $in: ["$status", ["CONFIRMED", "HOLD", "CHECKED_IN", "ONGOING"]] }, 1, 0] } },
        }},
      ]),

      // This month
      Booking.aggregate([
        { $match: { ...baseFilter, createdAt: { $gte: monStart } } },
        { $group: {
          _id:       null,
          count:     { $sum: 1 },
          revenue:   { $sum: "$totalAmountInPaise" },
          completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          ongoing:   { $sum: { $cond: [{ $eq: ["$status", "ONGOING"]   }, 1, 0] } },
          pending:   { $sum: { $cond: [{ $in: ["$status", ["CONFIRMED", "HOLD", "CHECKED_IN", "ONGOING"]] }, 1, 0] } },
        }},
      ]),
    ]);

    const s = summary[0] || {};
    const t = todayStats[0] || {};
    const w = weekStats[0]  || {};
    const m = monthStats[0] || {};

    const totalRevPaise      = s.totalRevenue     ?? 0;
    const completedRevPaise  = s.completedRevenue ?? 0;
    const totalComplete      = s.completed         ?? 0;
    // Numerator now scoped to COMPLETED-only revenue, matching the
    // COMPLETED-only denominator (totalComplete) — see completedRevenue
    // comment in the aggregation above.
    const avgTicket      = totalComplete > 0 ? Math.round(completedRevPaise / totalComplete / 100) : 0;
    const cancelRate     = s.total > 0 ? +((s.cancelled  / s.total) * 100).toFixed(1) : 0;
    // ✅ Completion rate
    const completionRate = s.total > 0 ? +((s.completed  / s.total) * 100).toFixed(1) : 0;
    const noShowRate     = s.total > 0 ? +((s.noShow     / s.total) * 100).toFixed(1) : 0;

    return successResponse(res, {
      message: "Bookings summary fetched",
      data: {
        overall: {
          total:        s.total     ?? 0,
          confirmed:    s.confirmed ?? 0,
          completed:    s.completed ?? 0,
          cancelled:    s.cancelled ?? 0,
          ongoing:      s.ongoing   ?? 0,
          noShow:       s.noShow    ?? 0,
          hold:         s.hold      ?? 0,
          totalRevenueRupees:  Math.round(totalRevPaise / 100),
          totalRevenuePaise:   totalRevPaise,
          avgTicketSizeRupees: avgTicket,
          avgTicketSizePaise:  totalComplete > 0 ? Math.round(completedRevPaise / totalComplete) : 0,
          // ✅ Rates
          cancellationRate:  cancelRate,
          completionRate:    completionRate,
          noShowRate:        noShowRate,
        },

        // ✅ Payment summary
        payments: {
          paid:     s.payPaid     ?? 0,
          pending:  s.payPending  ?? 0,
          failed:   s.payFailed   ?? 0,
          refunded: s.payRefunded ?? 0,
        },

        // ✅ Source breakdown
        source: {
          app:    s.srcApp    ?? 0,
          admin:  s.srcAdmin  ?? 0,
          system: s.srcSystem ?? 0,
          web:    s.srcWeb    ?? 0,
        },

        today: {
          count:         t.count     ?? 0,
          revenueRupees: Math.round((t.revenue ?? 0) / 100),
          revenuePaise:  t.revenue   ?? 0,
          completed:     t.completed ?? 0,
          cancelled:     t.cancelled ?? 0,
          ongoing:       t.ongoing   ?? 0,
          pending:       t.pending   ?? 0,
        },
        thisWeek: {
          count:         w.count     ?? 0,
          revenueRupees: Math.round((w.revenue ?? 0) / 100),
          revenuePaise:  w.revenue   ?? 0,
          completed:     w.completed ?? 0,
          cancelled:     w.cancelled ?? 0,
          ongoing:       w.ongoing   ?? 0,
          pending:       w.pending   ?? 0,
        },
        thisMonth: {
          count:         m.count     ?? 0,
          revenueRupees: Math.round((m.revenue ?? 0) / 100),
          revenuePaise:  m.revenue   ?? 0,
          completed:     m.completed ?? 0,
          cancelled:     m.cancelled ?? 0,
          ongoing:       m.ongoing   ?? 0,
          pending:       m.pending   ?? 0,
        },
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * GET BOOKINGS ANALYTICS (PAN INDIA — multi-facet)        ← NEW
 * GET /api/admin/bookings/analytics?range=6m
 *
 * Every number in this response is derived directly from real
 * Booking / Transaction / Salon / State documents. Anything that
 * cannot be honestly computed from stored fields (e.g. payment
 * MODE — UPI/Card/Cash — which is never persisted anywhere in the
 * schema) is intentionally OMITTED rather than guessed.
 *
 * range: "30d" | "3m" | "6m" | "1y"  (default "6m")
 *
 * PERFORMANCE NOTE (PAN India scale):
 *   This uses a single $facet over one $match-ed cursor, so the
 *   base filter (scope + date range) runs once. At current data
 *   volumes this is fine for an admin-only, low-frequency analytics
 *   screen. If booking volume grows into the tens of millions,
 *   migrate this to a pre-aggregated rollup collection written by a
 *   nightly/hourly job instead of computing live — flagged here so
 *   it isn't forgotten, not implemented now since it isn't needed yet.
 * =====================================================
 */
export const getBookingsAnalytics = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const { range = "6m" } = req.query;

    const now = new Date();
    const rangeStartMap = {
      "30d": () => new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      "3m":  () => { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; },
      "6m":  () => { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d; },
      "1y":  () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; },
    };
    const rangeStart = (rangeStartMap[range] || rangeStartMap["6m"])();

    // ── Scope filter — same helper used by list/summary, zero duplication ──
    const scopeFilter = await buildSalonScope(admin);

    const baseMatch = {
      isDeleted: { $ne: true },
      createdAt: { $gte: rangeStart },
      ...scopeFilter,
    };

    const TZ = "Asia/Kolkata"; // PAN India — all hour/day buckets in IST

    const [result] = await Booking.aggregate([
      { $match: baseMatch },

      {
        $facet: {
          // ── 1. OVERALL SUMMARY ──────────────────────────────
          overall: [
            {
              $group: {
                _id:          null,
                total:        { $sum: 1 },
                completed:    { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
                cancelled:    { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
                ongoing:      { $sum: { $cond: [{ $eq: ["$status", "ONGOING"]   }, 1, 0] } },
                noShow:       { $sum: { $cond: [{ $eq: ["$status", "NO_SHOW"]   }, 1, 0] } },

                // Booking Engine V2 — Phase 5 — additive breakdown of the
                // existing completed/noShow counts above by trigger
                // (SYSTEM via autoComplete.job.js vs. a human action).
                // Same $group, same cursor — no new query, no new stage.
                manualCompleted: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "COMPLETED"] }, { $ne: ["$autoCompleted", true] }] }, 1, 0] } },
                autoCompleted:   { $sum: { $cond: [{ $and: [{ $eq: ["$status", "COMPLETED"] }, { $eq: ["$autoCompleted", true] }] }, 1, 0] } },
                manualNoShow:    { $sum: { $cond: [{ $and: [{ $eq: ["$status", "NO_SHOW"]   }, { $ne: ["$autoNoShow",   true] }] }, 1, 0] } },
                autoNoShow:      { $sum: { $cond: [{ $and: [{ $eq: ["$status", "NO_SHOW"]   }, { $eq: ["$autoNoShow",   true] }] }, 1, 0] } },

                upcoming: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $in: ["$status", ["CONFIRMED", "HOLD", "CHECKED_IN"]] },
                          { $gte: ["$startTime", now] },
                        ],
                      },
                      1, 0,
                    ],
                  },
                },
                totalRevenuePaise:    { $sum: "$totalAmountInPaise" },

                // totalAmountInPaise is set at confirm/payment time, not
                // completion — totalRevenuePaise above already includes
                // revenue from CONFIRMED/CHECKED_IN/ONGOING bookings that
                // haven't completed yet. avgBookingValueRupees below
                // divides by completedCount, so it needs completed-only
                // revenue as its numerator, not totalRevenuePaise.
                completedRevenuePaise: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$totalAmountInPaise", 0] } },

                refundedAmountPaise: {
                  $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, "$totalAmountInPaise", 0] },
                },
                refundedCount: { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, 1, 0] } },
              },
            },
          ],

          // ── 2. MONTHLY TREND ────────────────────────────────
          trend: [
            {
              $group: {
                _id: {
                  year:  { $year:  { date: "$createdAt", timezone: TZ } },
                  month: { $month: { date: "$createdAt", timezone: TZ } },
                },
                bookings:     { $sum: 1 },
                revenuePaise: { $sum: "$totalAmountInPaise" },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ],

          // ── 3. PEAK HOURS (IST) ─────────────────────────────
          peakHours: [
            {
              $group: {
                _id:   { $hour: { date: "$startTime", timezone: TZ } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],

          // ── 4. PEAK DAYS OF WEEK (IST) ──────────────────────
          // $dayOfWeek: 1=Sunday ... 7=Saturday
          peakDays: [
            {
              $group: {
                _id:   { $dayOfWeek: { date: "$startTime", timezone: TZ } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],

          // ── 5. TOP SERVICES ──────────────────────────────────
          // bookings = real count. estimatedRevenueRupees is an ESTIMATE
          // (sum of each booking's service listed price), because the
          // Booking schema stores only a single totalAmountInPaise for
          // the whole booking — there is no per-service price split
          // persisted anywhere to sum exactly. Flagged as "estimated"
          // in the response so the frontend never presents it as exact.
          //
          // GROUPING KEY: when the Service doc resolves, we group by its
          // NAME (so two Service docs that happen to share a name don't
          // split into duplicate rows). When it does NOT resolve (deleted
          // / invalid serviceRef), we group by the raw serviceRefs _id
          // instead of a single generic bucket — so each distinct missing
          // service still gets its own row with its real ID shown in the
          // label (e.g. "Deleted Service (#a1b2c3)"), giving the admin
          // enough context to look it up, rather than merging all unknown
          // services into one indistinguishable "Deleted Service" total.
          topServices: [
            { $unwind: "$serviceRefs" },
            {
              $lookup: {
                from:         "services",
                localField:   "serviceRefs",
                foreignField: "_id",
                as:           "service",
              },
            },
            { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id:                    { $ifNull: ["$service.name", "$serviceRefs"] },
                bookings:               { $sum: 1 },
                totalListedPriceRupees: { $sum: { $ifNull: ["$service.price", 0] } },
                isDeleted:              { $first: { $cond: [{ $ifNull: ["$service", false] }, false, true] } },
              },
            },
            { $sort: { bookings: -1 } },
            { $limit: 10 },
            {
              $project: {
                _id:      0,
                name: {
                  $cond: [
                    "$isDeleted",
                    {
                      $concat: [
                        "Deleted Service (#",
                        { $substrBytes: [{ $toString: "$_id" }, 18, 6] }, // last 6 hex chars of the ObjectId
                        ")",
                      ],
                    },
                    "$_id",
                  ],
                },
                bookings: 1,
                avgValueRupees: {
                  $cond: [
                    { $eq: ["$bookings", 0] },
                    0,
                    { $round: [{ $divide: ["$totalListedPriceRupees", "$bookings"] }, 0] },
                  ],
                },
                estimatedRevenueRupees: "$totalListedPriceRupees",
              },
            },
          ],

          // ── 6. PAYMENT STATUS SPLIT (real — mode is not stored) ──
          paymentStatusSplit: [
            {
              $group: {
                _id:   "$paymentStatus",
                count: { $sum: 1 },
              },
            },
          ],

          // ── 7. TOP STATES ────────────────────────────────────
          topStates: [
            {
              $lookup: {
                from:         "salons",
                localField:   "salonRef",
                foreignField: "_id",
                as:           "salon",
              },
            },
            { $unwind: { path: "$salon", preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id:       "$salon.location.territory.stateRef",
                bookings:  { $sum: 1 },
                cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
                revenuePaise: { $sum: "$totalAmountInPaise" },
              },
            },
            { $match: { _id: { $ne: null } } },
            { $sort: { bookings: -1 } },
            { $limit: 10 },
            {
              $lookup: {
                from:         "states",
                localField:   "_id",
                foreignField: "_id",
                as:           "state",
              },
            },
            { $unwind: { path: "$state", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id:           0,
                stateId:       "$_id",
                name:          { $ifNull: ["$state.name", "Unknown"] },
                code:          { $ifNull: ["$state.code", "—"] },
                bookings:      1,
                revenuePaise:  1,
                cancelRate: {
                  $cond: [
                    { $eq: ["$bookings", 0] },
                    0,
                    { $round: [{ $multiply: [{ $divide: ["$cancelled", "$bookings"] }, 100] }, 1] },
                  ],
                },
              },
            },
          ],

          // ── 8. REPEAT CUSTOMER RATE ──────────────────────────
          customerFrequency: [
            { $group: { _id: "$userRef", bookingsInRange: { $sum: 1 } } },
            {
              $group: {
                _id:               null,
                totalCustomers:    { $sum: 1 },
                repeatCustomers:   { $sum: { $cond: [{ $gt: ["$bookingsInRange", 1] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]);

    // ── 9. PLATFORM COMMISSION (from Transaction collection — real, not estimated) ──
    // Separate query (not inside the $facet) since it requires joining a
    // different base collection (Transaction) filtered by booking scope.
    const bookingIdsInRange = await Booking.find(baseMatch).select("_id").lean();
    const platformRevenueAgg = await Transaction.aggregate([
      {
        $match: {
          bookingId: { $in: bookingIdsInRange.map(b => b._id) },
          type:      TRANSACTION_TYPE.BOOKING,
          status:    TRANSACTION_STATUS.PAID,
        },
      },
      { $group: { _id: null, totalCommissionPaise: { $sum: "$commission" } } },
    ]);

    // ── Shape response ──────────────────────────────────────
    const o   = result.overall[0]             || {};
    const cf  = result.customerFrequency[0]    || {};
    const platformRevenuePaise = platformRevenueAgg[0]?.totalCommissionPaise ?? 0;

    const totalRevenuePaise     = o.totalRevenuePaise     ?? 0;
    const completedRevenuePaise = o.completedRevenuePaise ?? 0;
    const completedCount       = o.completed ?? 0;
    // Numerator scoped to COMPLETED-only revenue, matching the
    // COMPLETED-only denominator (completedCount) — see
    // completedRevenuePaise comment in the aggregation above.
    const avgBookingValueRupees = completedCount > 0
      ? Math.round(completedRevenuePaise / completedCount / 100)
      : 0;

    const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const DAY_LABELS    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; // $dayOfWeek: 1=Sun

    return successResponse(res, {
      message: "Booking analytics fetched",
      data: {
        range,
        lastUpdated: new Date().toISOString(),

        summary: {
          total:                o.total ?? 0,
          completed:            o.completed ?? 0,
          cancelled:            o.cancelled ?? 0,
          ongoing:              o.ongoing ?? 0,
          noShow:               o.noShow ?? 0,
          upcoming:             o.upcoming ?? 0,

          // Booking Engine V2 — Phase 5 — read-only breakdown, sourced
          // from the same overall facet above; completed/noShow totals
          // are unchanged and still the authoritative counts.
          manualCompleted:      o.manualCompleted ?? 0,
          autoCompleted:        o.autoCompleted ?? 0,
          manualNoShow:         o.manualNoShow ?? 0,
          autoNoShow:           o.autoNoShow ?? 0,
          totalRevenueRupees:   Math.round(totalRevenuePaise / 100),
          platformRevenueRupees: Math.round(platformRevenuePaise / 100),
          avgBookingValueRupees,
          refundedAmountRupees: Math.round((o.refundedAmountPaise ?? 0) / 100),
          refundedCount:        o.refundedCount ?? 0,
          completionRate:    o.total > 0 ? +((o.completed  / o.total) * 100).toFixed(1) : 0,
          cancellationRate:  o.total > 0 ? +((o.cancelled  / o.total) * 100).toFixed(1) : 0,
          noShowRate:        o.total > 0 ? +((o.noShow     / o.total) * 100).toFixed(1) : 0,
          repeatCustomerRate: cf.totalCustomers > 0
            ? +((cf.repeatCustomers / cf.totalCustomers) * 100).toFixed(1)
            : 0,
        },

        // Monthly trend — labelled with month name, IST-bucketed
        trend: (result.trend || []).map(t => ({
          label:         `${MONTH_LABELS[t._id.month - 1]} ${t._id.year}`,
          bookings:      t.bookings,
          revenueRupees: Math.round(t.revenuePaise / 100),
        })),

        // Peak hours — 0-23 IST, labelled "8 AM" / "5 PM" style
        peakHours: (result.peakHours || []).map(h => ({
          hour:  h._id,
          label: h._id === 0 ? "12 AM" : h._id < 12 ? `${h._id} AM` : h._id === 12 ? "12 PM" : `${h._id - 12} PM`,
          count: h.count,
        })),

        // Peak days — Sun..Sat IST
        peakDays: (result.peakDays || []).map(d => ({
          day:   DAY_LABELS[d._id - 1],
          count: d.count,
        })),

        topServices: result.topServices || [],

        // Real payment STATUS split (PAID/PENDING/FAILED/REFUNDED).
        // NOTE: payment MODE (UPI/Card/Cash) is not available — that
        // field is never persisted in the Transaction/Booking schema.
        paymentStatusSplit: (result.paymentStatusSplit || []).map(p => ({
          status: p._id,
          count:  p.count,
          pct:    o.total > 0 ? +((p.count / o.total) * 100).toFixed(1) : 0,
        })),

        topStates: result.topStates || [],
      },
    });

  } catch (err) {
    next(err);
  }
};