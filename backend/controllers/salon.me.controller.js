import Booking from "../models/Booking.js";
import Chair from "../models/Chair.js";
import District from "../models/District.js";
import Rating from "../models/Rating.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Service from "../models/Service.js"; // ✅ NEW
import Staff from "../models/Staff.js";
import State from "../models/State.js";
import Transaction from "../models/Transaction.js";


/**
 * =========================================================
 * GET /api/salon/owner/me
 * =========================================================
 */
export const getMySalon = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const salon = await Salon.findOne(
      { ownerId },
      { _id: 1, onboarding: 1, approval: 1, basicInfo: 1, location: 1, assignedAdmin: 1 }
    ).lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const districtRef = salon.location?.territory?.districtRef;
    const stateRef    = salon.location?.territory?.stateRef;

    let districtName = null;
    let stateName    = null;

    try {
      const [district, state] = await Promise.all([
        districtRef ? District.findById(districtRef).select("name").lean() : null,
        stateRef    ? State.findById(stateRef).select("name").lean()       : null,
      ]);

      districtName = district?.name || null;
      stateName    = state?.name    || null;

    } catch (geoErr) {
      console.warn("GEO_FETCH_WARN:", geoErr.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        salonId:        salon._id,
        onboardingStep: salon.onboarding?.step ?? 0,
        status:         salon.approval?.status ?? "NONE",
        approval: {
          status:          salon.approval?.status ?? "NONE",
          rejectionReason: salon.approval?.rejectionReason ?? null,
          rejectedAt:      salon.approval?.rejectedAt ?? null,
        },
        basicInfo:      salon.basicInfo ?? null,
        location: {
          ...(salon.location ?? {}),
          districtName,
          stateName,
        },
      },
    });

  } catch (error) {
    console.error("GET_MY_SALON_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch salon" });
  }
};

/**
 * =========================================================
 * GET /api/salon/owner/dashboard — Dashboard Stats
 * =========================================================
 */
export const getDashboardStats = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const salon = await Salon.findOne({ ownerId })
      .select("_id basicInfo business timings")
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const salonId = salon._id;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      todayBookings,
      revenueResult,
      cancelled,
      todayCustomers,
      chairs,
      staff,
      nextBookings,
      ongoingBookings,
      services,
      ratingResult,
      topServicesResult,
    ] = await Promise.all([

      Booking.countDocuments({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "ONGOING", "COMPLETED"] },
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      Booking.aggregate([
        {
          $match: {
            salonRef: salonId,
            status: "COMPLETED",
            startTime: { $gte: todayStart, $lte: todayEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmountInPaise" } } },
      ]),

      Booking.countDocuments({
        salonRef: salonId,
        status: "CANCELLED",
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      Booking.distinct("userRef", {
        salonRef: salonId,
        status: {
          $in: ["CONFIRMED", "CHECKED_IN", "ONGOING", "COMPLETED"]
        },
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      Chair.find({ salonId, isDeleted: false, isActive: true })
        .select("name position type")
        .sort({ position: 1 })
        .lean(),

      Staff.find({ salonId, isDeleted: false })
        .select("name role isOwner")
        .lean(),

      Booking.find({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "CHECKED_IN"] },
        startTime: { $gte: todayStart, $lte: todayEnd },
      })
        .sort({ startTime: 1 })
        .limit(10)
        .populate("userRef", "name phone")
        .populate("serviceRefs", "name duration price")
        .populate("chairRef", "name position")
        .lean(),
      
      Booking.find({
        salonRef: salonId,
        status: "ONGOING",
      })
        .populate("userRef", "name phone")
        .populate("serviceRefs", "name duration price")
        .populate("chairRef", "name position")
        .lean(),

      Service.find({ salonId, isDeleted: false, isActive: true })
        .select("name price duration category")
        .sort({ createdAt: 1 })
        .lean(),

      Rating.aggregate([
        {
          $match: {
            salonId,
            isHidden: false,
          },
        },
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
          },
        },
      ]),

      Booking.aggregate([
        {
          $match: {
            salonRef: salonId,
            status: "COMPLETED",
          },
        },
        {
          $unwind: "$serviceRefs",
        },
        {
          $group: {
            _id: "$serviceRefs",
            totalBookings: { $sum: 1 },
            revenue:       { $sum: "$totalAmountInPaise" },
          },
        },
        {
          $sort: { totalBookings: -1 },
        },
        {
          $limit: 5,
        },
        {
          $lookup: {
            from:         "services",
            localField:   "_id",
            foreignField: "_id",
            as:           "service",
          },
        },
        {
          $unwind: "$service",
        },
        {
          $project: {
            _id:           "$service._id",
            name:          "$service.name",
            price:         "$service.price",
            duration:      "$service.duration",
            totalBookings: 1,
            revenue:       { $round: [{ $divide: ["$revenue", 100] }, 0] },
          },
        },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        salonId:      salon._id,
        shopName:     salon.basicInfo?.shopName || "My Salon",
        isShopOpen:   salon.business?.isShopOpen || false,
        todayBookings,
        todayCustomers: todayCustomers.length,
        todayRevenue: Math.round((revenueResult[0]?.total || 0) / 100),
        cancelled,
        chairs,
        staff,
        services,
        nextBooking:    nextBookings?.[0]    || null,
        nextBookings:   nextBookings         || [],
        ongoingBooking:  ongoingBookings?.[0] || null,
        ongoingBookings: ongoingBookings     || [],
        averageRating:   Number(ratingResult?.[0]?.averageRating?.toFixed(1) || 0),
        totalReviews:    ratingResult?.[0]?.totalReviews || 0,
        topServices:     topServicesResult || [],

        // Consumed by SalonWorkingHoursScreen.js via res.data.salon.timings
        // and res.data.salon.business.isForceClosed — did not exist on this
        // response before, so those reads always resolved to undefined.
        salon: {
          timings: salon.timings || {},
          business: {
            isForceClosed: salon.business?.isForceClosed || false,
          },
        },
      },
    });

  } catch (error) {
    console.error("DASHBOARD_STATS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

export const getLiveSchedule = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon = await Salon.findOne({ ownerId }).select("_id").lean();
    if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });

    const salonId = salon._id;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const [chairs, bookings] = await Promise.all([
      Chair.find({ salonId, isDeleted: false, isActive: true })
        .select("name position").sort({ position: 1 }).lean(),
      Booking.find({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "ONGOING", "COMPLETED"] },
        startTime: { $gte: todayStart, $lte: todayEnd }
      })
        .populate("userRef", "name phone")
        .populate("serviceRefs", "name duration price")
        .populate("chairRef", "name position")
        .sort({ startTime: 1 }).lean(),
    ]);

    const schedule = chairs.map(chair => ({
      chairId:   chair._id,
      chairName: chair.name,
      slots: bookings
        .filter(b => String(b.chairRef?._id) === String(chair._id))
        .map(b => ({
          bookingId: b._id,
          time:      b.startTime,
          endTime:   b.endTime,
          customer:  b.userRef?.name || "Customer",
          phone:     b.userRef?.phone || "",
          service:   b.serviceRefs?.map(s => s.name).join(", ") || "",
          status:    b.status,
          // b.amount is the legacy/optional display field (Booking.js:247-254,
          // "NEVER use this for finance logic") — never set by lockSlot/
          // confirmBooking, always 0 on real bookings, which silently zeroed
          // out both the per-row price and "Today's Revenue". totalAmountInPaise
          // is the authoritative field and was already being fetched (this
          // query has no .select() restricting it) — just not read. Same
          // response field name/shape/type (a rupee Number), no contract change.
          amount:    Math.round((b.totalAmountInPaise ?? 0) / 100),
          duration:         b.serviceRefs?.reduce((sum, s) => sum + (s.duration || 30), 0) || 30,
          serviceStartedAt: b.serviceStartedAt || null,
        })),
    }));

    return res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch live schedule" });
  }
};

export const getWallet = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon = await Salon.findOne({ ownerId }).select("_id").lean();
    if (!salon) return res.status(404).json({ success: false, message: "Salon not found" });

    const salonId = salon._id;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const [wallet, todayEarnings, transactions] = await Promise.all([
      SalonEarnings.findOne({ salonId }).lean(),
      Transaction.aggregate([
        { $match: { salonId, createdAt: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: "$payoutAmount" } } },
      ]),
      Transaction.find({ salonId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        balance:       wallet?.balance || 0,
        todayEarnings: todayEarnings[0]?.total || 0,
        transactions:  transactions.map(t => ({
          id:      t._id,
          amount:  t.payoutAmount,
          type:    "EARNING",
          date:    t.createdAt,
          status:  t.status,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch wallet" });
  }
};