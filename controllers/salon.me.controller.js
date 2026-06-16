import Salon from "../models/Salon.js";
import District from "../models/District.js";
import State from "../models/State.js";
import Booking from "../models/Booking.js";
import Chair from "../models/Chair.js";
import Staff from "../models/Staff.js";
import Service from "../models/Service.js"; // ✅ NEW
import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";


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
      .select("_id basicInfo business")
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
      chairs,
      staff,
      nextBookings,
      ongoingBookings,
      services,
    ] = await Promise.all([

      Booking.countDocuments({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "ONGOING", "COMPLETED"] },
        createdAt: { $gte: todayStart, $lte: todayEnd },
      }),

      Booking.aggregate([
        {
          $match: {
            salonRef: salonId,
            status: "COMPLETED",
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      Booking.countDocuments({
        salonRef: salonId,
        status: "CANCELLED",
        createdAt: { $gte: todayStart, $lte: todayEnd },
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
    ]);

    return res.status(200).json({
      success: true,
      data: {
        salonId:      salon._id,  // ← YEH ADD KARO
        shopName:     salon.basicInfo?.shopName || "My Salon",
        isShopOpen:   salon.business?.isShopOpen || false,
        todayBookings,
        todayRevenue: revenueResult[0]?.total || 0,
        cancelled,
        chairs,
        staff,
        services,
        nextBooking:    nextBookings?.[0]    || null,
        nextBookings:   nextBookings         || [],
        ongoingBooking:  ongoingBookings?.[0] || null,
        ongoingBookings: ongoingBookings     || [],

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
        createdAt: { $gte: todayStart, $lte: todayEnd },
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
          amount:    b.amount,
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