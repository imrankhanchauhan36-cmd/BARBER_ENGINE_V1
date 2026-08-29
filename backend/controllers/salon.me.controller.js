import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Chair from "../models/Chair.js";
import District from "../models/District.js";
import Notification from "../models/Notification.js";
import Rating from "../models/Rating.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Service from "../models/Service.js"; // ✅ NEW
import Staff from "../models/Staff.js";
import State from "../models/State.js";
import Transaction from "../models/Transaction.js";
import { resolveScheduleDate } from "../utils/dateRange.helpers.js";


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
      { _id: 1, onboarding: 1, approval: 1, basicInfo: 1, location: 1, assignedAdmin: 1, media: 1 }
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
        media:          salon.media ?? null,
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
      manualNoShow,
      autoNoShow,
      todayCustomers,
      chairs,
      staff,
      nextBookings,
      ongoingBookings,
      services,
      ratingResult,
      topServicesResult,
      unreadNotifications,
    ] = await Promise.all([

      Booking.countDocuments({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "ONGOING", "COMPLETED"] },
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      // Booking Engine V2 — Phase 5, Step 4 — manualCompleted/autoCompleted
      // are additive sibling accumulators inside this SAME existing $group.
      // $match is untouched (still COMPLETED-only, today-scoped), so the
      // existing `total` revenue sum is unaffected — these two new fields
      // only count how many of the already-matched documents were
      // system- vs. human-triggered.
      Booking.aggregate([
        {
          $match: {
            salonRef: salonId,
            status: "COMPLETED",
            startTime: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmountInPaise" },
            manualCompleted: { $sum: { $cond: [{ $ne: ["$autoCompleted", true] }, 1, 0] } },
            autoCompleted:   { $sum: { $cond: [{ $eq: ["$autoCompleted", true] }, 1, 0] } },
          },
        },
      ]),

      Booking.countDocuments({
        salonRef: salonId,
        status: "CANCELLED",
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      // Booking Engine V2 — Phase 5, Step 4 — manualNoShow/autoNoShow.
      // Not folded into the aggregate above: revenueResult's $match is
      // COMPLETED-only, and broadening it to include NO_SHOW would
      // silently pull NO_SHOW booking amounts into the existing
      // `total` revenue sum — an unintended change to an existing
      // field. countDocuments() is not an aggregation pipeline; this
      // mirrors the `cancelled` counter's own existing style directly
      // above, not a new technique.
      Booking.countDocuments({
        salonRef: salonId,
        status: "NO_SHOW",
        autoNoShow: { $ne: true },
        startTime: { $gte: todayStart, $lte: todayEnd },
      }),

      Booking.countDocuments({
        salonRef: salonId,
        status: "NO_SHOW",
        autoNoShow: true,
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
        .select("name position photo")
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

      // Same filter shape as notification.controller.js's getNotifications
      // unreadCount — covered by the compound index on Notification
      // (recipientId+recipientType+isRead+isArchived) built for exactly
      // this badge use case.
      Notification.countDocuments({
        recipientId:   salonId,
        recipientType: "SALON",
        isRead:        false,
        isArchived:    false,
      }),
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

        // Booking Engine V2 — Phase 5, Step 4 — read-only breakdown,
        // additive only. todayBookings/todayRevenue/cancelled above are
        // unchanged.
        manualCompleted: revenueResult[0]?.manualCompleted ?? 0,
        autoCompleted:   revenueResult[0]?.autoCompleted ?? 0,
        manualNoShow,
        autoNoShow,
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

        // Consumed by DashboardHeader/DashboardBottomTab's unread badge
        // via stats.unreadNotifications — same query notification.controller.js's
        // getNotifications already uses for its own unreadCount.
        unreadNotifications: unreadNotifications || 0,

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

    // Single selected IST calendar day — defaults to today when
    // ?date= is absent (byte-identical to the previous behavior for
    // every existing caller). Never a multi-day/range concept — see
    // resolveScheduleDate()'s own header for why this is deliberately
    // NOT built on Business Performance's range resolver.
    const resolved = resolveScheduleDate(req.query.date);
    if (resolved.error) {
      return res.status(400).json({ success: false, message: resolved.error });
    }
    const { startUtc, endUtc, resolvedDate } = resolved;

    const [chairs, bookings, cancelledCount] = await Promise.all([
      Chair.find({ salonId, isDeleted: false, isActive: true })
        .select("name position").sort({ position: 1 }).lean(),
      Booking.find({
        salonRef: salonId,
        status: { $in: ["CONFIRMED", "ONGOING", "COMPLETED"] },
        startTime: { $gte: startUtc, $lte: endUtc }
      })
        .populate("userRef", "name phone profilePhoto")
        .populate("serviceRefs", "name duration price")
        .populate("chairRef", "name position")
        .sort({ startTime: 1 }).lean(),
      // Additive, bounded count only (no documents loaded) — the
      // operational chair-based list above deliberately never includes
      // CANCELLED bookings (unchanged), but the Schedule summary cards
      // still need a real count rather than a permanently-zero one.
      // Same indexed shape as the query above ({salonRef,startTime}
      // prefix of the existing {salonRef:1,startTime:1,endTime:1}
      // index) — no new index required.
      Booking.countDocuments({
        salonRef: salonId,
        status: "CANCELLED",
        startTime: { $gte: startUtc, $lte: endUtc },
      }),
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
          // Additive only — existing User.profilePhoto field, already
          // used elsewhere (BookingReadService.js, customer.controller.js).
          // null when unset; frontend's existing Avatar component already
          // falls back to initials in that case, unchanged.
          customerPhoto: b.userRef?.profilePhoto || null,
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
          // Booking Engine V2 — Phase 4: lets the dashboard distinguish
          // a system-triggered completion from a manual one without a
          // new status value. Additive field — every existing consumer
          // of this response already ignores unknown keys.
          autoCompleted: b.autoCompleted || false,
          // Booking Engine V2 — Phase 6: lets the app show Call/Send
          // Reminder/Generate OTP once customerArrival.job.js has
          // flagged this booking delayed. Additive field.
          customerDelayedAt: b.customerDelayedAt || null,
        })),
    }));

    // `date` is additive — the exact IST calendar day actually applied
    // (defaults to today), so the frontend can display it without
    // separately recomputing "today" client-side. Every existing
    // consumer that only reads `success`/`data` is unaffected.
    // cancelledCount is additive, same as `date` above — a real count
    // for the selected day, never the cancelled bookings themselves
    // (those still never appear in `data`, unchanged operational view).
    return res.status(200).json({ success: true, data: schedule, date: resolvedDate, cancelledCount });
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

/**
 * =========================================================
 * PATCH /api/salon/owner/chairs/:chairId/photo
 *
 * Additive only — Chair.photo already existed in the schema
 * (models/Chair.js, frozen v4, NOTE 2) but had no write path.
 * This is the first endpoint that sets it. Ownership check
 * mirrors addSalonMedia() in salonMedia.controller.js.
 * =========================================================
 */
export const updateChairPhoto = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const { chairId } = req.params;
    const { url, publicId } = req.body;

    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!mongoose.Types.ObjectId.isValid(chairId)) {
      return res.status(404).json({ success: false, message: "Chair not found" });
    }

    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, message: "Photo url is required" });
    }

    const salon = await Salon.findOne({ ownerId }).select("_id").lean();
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const chair = await Chair.findOne({ _id: chairId, isDeleted: false });
    if (!chair) {
      return res.status(404).json({ success: false, message: "Chair not found" });
    }

    if (chair.salonId?.toString() !== salon._id.toString()) {
      return res.status(403).json({ success: false, message: "Not your chair" });
    }

    chair.photo = { url, publicId: publicId || null };
    chair.updatedBy = ownerId;
    await chair.save();

    return res.json({ success: true, photo: chair.photo });
  } catch (err) {
    console.error("UPDATE CHAIR PHOTO ERROR:", err);
    return res.status(500).json({ success: false, message: "Could not update chair photo" });
  }
};

/**
 * =========================================================
 * PATCH /api/salon/owner/basic-info
 *
 * Post-approval-safe profile editor. This is deliberately a
 * SEPARATE endpoint from saveBasicInfo() (the onboarding-only
 * handler in salon.onboarding.controller.js) — that one
 * unconditionally resets approval.status to DRAFT, zeroes
 * location.geo.coordinates, and upserts. This endpoint never
 * references approval/onboarding/location.geo/ownerId, never
 * upserts, and rejects invalid input with 400 instead of
 * silently coercing it to a default.
 * =========================================================
 */
const EDITABLE_CATEGORY    = ["MEN_ONLY", "WOMEN_ONLY", "UNISEX"];
const EDITABLE_TIER        = ["STANDARD", "PREMIUM", "LUXURY"];
const EDITABLE_SETUP_TYPE  = ["PROPER_SHOP", "OPEN_SETUP"];
const EDITABLE_PRIVACY     = ["SEPARATE", "MIXED"];
const EDITABLE_EXPERIENCE  = ["LESS_THAN_1", "1_TO_3", "3_TO_5", "5_PLUS", "10_PLUS", null];
const EDITABLE_AMENITY_KEYS = ["hasAC", "hasParking", "hasWifi", "waitingArea", "restroom"];

export const updateBasicInfo = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const {
      shopName,
      category,
      tagline,
      since,
      experience,
      whatsapp,
      tier,
      setupType,
      privacySetup,
      amenities,
      brandName,
      branchCode,
    } = req.body;

    if (typeof shopName !== "string" || shopName.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Shop name must be at least 3 characters" });
    }
    const cleanShopName = shopName.trim();
    if (cleanShopName.length > 120) {
      return res.status(400).json({ success: false, message: "Shop name must be 120 characters or fewer" });
    }

    if (!EDITABLE_CATEGORY.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    if (!EDITABLE_TIER.includes(tier)) {
      return res.status(400).json({ success: false, message: "Invalid tier" });
    }
    if (!EDITABLE_SETUP_TYPE.includes(setupType)) {
      return res.status(400).json({ success: false, message: "Invalid setup type" });
    }
    if (!EDITABLE_PRIVACY.includes(privacySetup)) {
      return res.status(400).json({ success: false, message: "Invalid privacy setup" });
    }

    const cleanExperience = experience === undefined ? null : experience;
    if (!EDITABLE_EXPERIENCE.includes(cleanExperience)) {
      return res.status(400).json({ success: false, message: "Invalid experience value" });
    }

    const currentYear = new Date().getFullYear();
    const cleanSince = (since === undefined || since === null || since === "") ? null : Number(since);
    if (cleanSince !== null && (!Number.isFinite(cleanSince) || cleanSince < 1950 || cleanSince > currentYear)) {
      return res.status(400).json({ success: false, message: `Since must be a year between 1950 and ${currentYear}` });
    }

    const cleanWhatsapp = (whatsapp === undefined || whatsapp === null || whatsapp === "") ? null : String(whatsapp).trim();
    if (cleanWhatsapp !== null && !/^\d{10}$/.test(cleanWhatsapp)) {
      return res.status(400).json({ success: false, message: "WhatsApp number must be exactly 10 digits" });
    }

    const cleanTagline = (tagline === undefined || tagline === null || tagline === "") ? null : String(tagline).trim();
    if (cleanTagline !== null && cleanTagline.length > 200) {
      return res.status(400).json({ success: false, message: "Tagline must be 200 characters or fewer" });
    }

    const cleanBrandName = (brandName === undefined || brandName === null || brandName === "") ? null : String(brandName).trim();
    if (cleanBrandName !== null && cleanBrandName.length > 100) {
      return res.status(400).json({ success: false, message: "Brand name must be 100 characters or fewer" });
    }

    const cleanBranchCode = (branchCode === undefined || branchCode === null || branchCode === "") ? null : String(branchCode).trim();
    if (cleanBranchCode !== null && cleanBranchCode.length > 30) {
      return res.status(400).json({ success: false, message: "Branch code must be 30 characters or fewer" });
    }

    if (amenities !== undefined && (typeof amenities !== "object" || amenities === null || Array.isArray(amenities))) {
      return res.status(400).json({ success: false, message: "Invalid amenities" });
    }
    const cleanAmenities = {};
    for (const key of EDITABLE_AMENITY_KEYS) {
      const value = amenities?.[key] ?? false;
      if (typeof value !== "boolean") {
        return res.status(400).json({ success: false, message: `Amenity "${key}" must be true or false` });
      }
      cleanAmenities[key] = value;
    }

    const salon = await Salon.findOne({ ownerId }).select("_id");
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const updatePayload = {
      "basicInfo.shopName": cleanShopName,
      "basicInfo.category": category,
      "basicInfo.tagline": cleanTagline,
      "basicInfo.since": cleanSince,
      "basicInfo.experience": cleanExperience,
      "basicInfo.whatsapp": cleanWhatsapp,
      "basicInfo.tier": tier,
      "basicInfo.setupType": setupType,
      "basicInfo.privacySetup": privacySetup,
      "basicInfo.amenities.hasAC": cleanAmenities.hasAC,
      "basicInfo.amenities.hasParking": cleanAmenities.hasParking,
      "basicInfo.amenities.hasWifi": cleanAmenities.hasWifi,
      "basicInfo.amenities.waitingArea": cleanAmenities.waitingArea,
      "basicInfo.amenities.restroom": cleanAmenities.restroom,
      "basicInfo.brandName": cleanBrandName,
      "basicInfo.branchCode": cleanBranchCode,
    };

    const updated = await Salon.findOneAndUpdate(
      { ownerId },
      { $set: updatePayload },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        basicInfo: updated.basicInfo,
      },
    });

  } catch (err) {
    console.error("UPDATE_BASIC_INFO_ERROR:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to update profile" });
  }
};