import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Rating from "../models/Rating.js";
import Salon from "../models/Salon.js";
import User from "../models/User.js";

const VIP_SPEND_THRESHOLD_PAISE = 500000;
const REPEAT_VISIT_THRESHOLD    = 2;
const COMPLETED_STATUSES = ["COMPLETED", "CONFIRMED"];

const toRupees = (paise) => Math.round(paise) / 100;

const getOwnerSalonIds = async (ownerId) => {
  const salons = await Salon.find({ ownerId }, { _id: 1 }).lean();
  return salons.map((s) => s._id);
};

export const getDashboardAnalytics = async (req, res) => {
  try {
    const ownerId  = req.user._id;
    const salonIds = await getOwnerSalonIds(ownerId);

    const emptyResponse = {
      success: true,
      data: {
        stats: { totalCustomers: 0, newCustomers30Days: 0, repeatCustomers: 0, vipCustomers: 0, averageSpendRupees: 0 },
        analyticsCards: { topSpender: null, mostVisits: null, recentCustomer: null },
      },
    };

    if (!salonIds.length) return res.status(200).json(emptyResponse);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const customerAgg = await Booking.aggregate([
      { $match: { salonRef: { $in: salonIds }, status: { $in: COMPLETED_STATUSES } } },
      { $group: { _id: "$userRef", totalPaise: { $sum: "$totalAmountInPaise" }, visitCount: { $sum: 1 }, lastBookingDate: { $max: "$bookingDate" } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userInfo", pipeline: [{ $project: { name: 1, phone: 1, profilePhoto: 1, createdAt: 1 } }] } },
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: false } },
      { $addFields: { isNew: { $gte: ["$userInfo.createdAt", thirtyDaysAgo] }, isRepeat: { $gte: ["$visitCount", REPEAT_VISIT_THRESHOLD] }, isVIP: { $gte: ["$totalPaise", VIP_SPEND_THRESHOLD_PAISE] } } },
    ]);

    if (!customerAgg.length) return res.status(200).json(emptyResponse);

    const totalCustomers     = customerAgg.length;
    const newCustomers30Days = customerAgg.filter((c) => c.isNew).length;
    const repeatCustomers    = customerAgg.filter((c) => c.isRepeat).length;
    const vipCustomers       = customerAgg.filter((c) => c.isVIP).length;
    const totalPaiseAll      = customerAgg.reduce((s, c) => s + c.totalPaise, 0);
    const averageSpendRupees = toRupees(totalPaiseAll / totalCustomers);

    const topSpender     = customerAgg.reduce((p, c) => c.totalPaise     > p.totalPaise     ? c : p);
    const mostVisits     = customerAgg.reduce((p, c) => c.visitCount      > p.visitCount      ? c : p);
    const recentCustomer = customerAgg.reduce((p, c) => c.lastBookingDate > p.lastBookingDate ? c : p);

    const formatCard = (c) => ({
      userId: c._id, name: c.userInfo.name, phone: c.userInfo.phone,
      profilePhoto: c.userInfo.profilePhoto || null,
      totalSpendRupees: toRupees(c.totalPaise), visitCount: c.visitCount, lastBookingDate: c.lastBookingDate,
    });

    return res.status(200).json({
      success: true,
      data: {
        stats: { totalCustomers, newCustomers30Days, repeatCustomers, vipCustomers, averageSpendRupees },
        analyticsCards: { topSpender: formatCard(topSpender), mostVisits: formatCard(mostVisits), recentCustomer: formatCard(recentCustomer) },
      },
    });
  } catch (err) {
    console.error("getDashboardAnalytics:", err);
    return res.status(500).json({ success: false, message: "Analytics fetch failed", error: process.env.NODE_ENV === "development" ? err.message : undefined });
  }
};

export const getCustomersList = async (req, res) => {
  try {
    const ownerId  = req.user._id;
    const salonIds = await getOwnerSalonIds(ownerId);

    if (!salonIds.length) return res.status(200).json({ success: true, data: { customers: [], pagination: { total: 0, page: 1, pages: 0 } } });

    const page   = Math.max(1,  parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip   = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const filter = req.query.filter || "all";
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const pipeline = [
      { $match: { salonRef: { $in: salonIds }, status: { $in: COMPLETED_STATUSES } } },
      { $group: { _id: "$userRef", totalPaise: { $sum: "$totalAmountInPaise" }, visitCount: { $sum: 1 }, lastBookingDate: { $max: "$bookingDate" } } },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userInfo", pipeline: [{ $project: { name: 1, phone: 1, profilePhoto: 1, createdAt: 1 } }] } },
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: false } },
    ];

    if (search) pipeline.push({ $match: { $or: [{ "userInfo.name": { $regex: search, $options: "i" } }, { "userInfo.phone": { $regex: search, $options: "i" } }] } });
    if (filter === "new")    pipeline.push({ $match: { "userInfo.createdAt": { $gte: thirtyDaysAgo } } });
    if (filter === "repeat") pipeline.push({ $match: { visitCount: { $gte: REPEAT_VISIT_THRESHOLD } } });
    if (filter === "vip")    pipeline.push({ $match: { totalPaise: { $gte: VIP_SPEND_THRESHOLD_PAISE } } });

    const countResult = await Booking.aggregate([...pipeline, { $count: "total" }]);
    const total       = countResult[0]?.total || 0;

    pipeline.push(
      { $sort: { lastBookingDate: -1 } }, { $skip: skip }, { $limit: limit },
      { $project: { _id: 0, userId: "$_id", name: "$userInfo.name", phone: "$userInfo.phone", profilePhoto: "$userInfo.profilePhoto", visitCount: 1, lastBookingDate: 1, totalSpendRupees: { $divide: ["$totalPaise", 100] }, isVIP: { $gte: ["$totalPaise", VIP_SPEND_THRESHOLD_PAISE] }, isRepeat: { $gte: ["$visitCount", REPEAT_VISIT_THRESHOLD] } } }
    );

    const customers = await Booking.aggregate(pipeline);
    return res.status(200).json({ success: true, data: { customers, pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch (err) {
    console.error("getCustomersList:", err);
    return res.status(500).json({ success: false, message: "Customers list fetch failed", error: process.env.NODE_ENV === "development" ? err.message : undefined });
  }
};

export const getCustomerDetail = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid user ID" });

    const salonIds = await getOwnerSalonIds(ownerId);
    if (!salonIds.length) return res.status(404).json({ success: false, message: "No salons found" });

    const hasBooking = await Booking.exists({ userRef: new mongoose.Types.ObjectId(userId), salonRef: { $in: salonIds }, status: { $in: COMPLETED_STATUSES } });
    if (!hasBooking) return res.status(404).json({ success: false, message: "Customer not found" });

    const user = await User.findById(userId, { name: 1, phone: 1, profilePhoto: 1, email: 1, createdAt: 1 }).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const statsAgg = await Booking.aggregate([
      { $match: { userRef: new mongoose.Types.ObjectId(userId), salonRef: { $in: salonIds }, status: { $in: COMPLETED_STATUSES } } },
      { $group: { _id: null, totalVisits: { $sum: 1 }, lifetimePaise: { $sum: "$totalAmountInPaise" }, lastBookingDate: { $max: "$bookingDate" } } },
    ]);

    const stats = statsAgg[0] || { totalVisits: 0, lifetimePaise: 0, lastBookingDate: null };

    return res.status(200).json({
      success: true,
      data: {
        user: { userId: user._id, name: user.name, phone: user.phone, profilePhoto: user.profilePhoto || null, email: user.email || null, memberSince: user.createdAt },
        stats: { totalVisits: stats.totalVisits, lifetimeSpendRupees: toRupees(stats.lifetimePaise), averageTicketRupees: stats.totalVisits > 0 ? toRupees(stats.lifetimePaise / stats.totalVisits) : 0, lastBookingDate: stats.lastBookingDate, isVIP: stats.lifetimePaise >= VIP_SPEND_THRESHOLD_PAISE },
      },
    });
  } catch (err) {
    console.error("getCustomerDetail:", err);
    return res.status(500).json({ success: false, message: "Customer detail fetch failed", error: process.env.NODE_ENV === "development" ? err.message : undefined });
  }
};

export const getCustomerHistory = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success: false, message: "Invalid user ID" });

    const salonIds = await getOwnerSalonIds(ownerId);
    if (!salonIds.length) return res.status(200).json({ success: true, data: { bookings: [], reviews: [], pagination: { total: 0 } } });

    const page  = Math.max(1,  parseInt(req.query.page)  || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
    const skip  = (page - 1) * limit;

    const totalCount = await Booking.countDocuments({ userRef: userId, salonRef: { $in: salonIds } });

    const bookings = await Booking.find(
      { userRef: userId, salonRef: { $in: salonIds } },
      { bookingDate: 1, startTime: 1, endTime: 1, serviceRefs: 1, totalAmountInPaise: 1, status: 1, salonRef: 1 }
    ).populate("salonRef", "basicInfo.shopName").populate("serviceRefs", "name duration").sort({ bookingDate: -1 }).skip(skip).limit(limit).lean();

    const reviews = await Rating.find(
      { userId, salonId: { $in: salonIds } },
      { rating: 1, review: 1, salonId: 1, createdAt: 1 }
    ).populate("salonId", "basicInfo.shopName").sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      data: {
        bookings: bookings.map((b) => ({ bookingId: b._id, bookingDate: b.bookingDate, startTime: b.startTime, endTime: b.endTime, salonName: b.salonRef?.basicInfo?.shopName || "Unknown", services: (b.serviceRefs || []).map((s) => ({ name: s.name, durationMinutes: s.duration })), amountRupees: toRupees(b.totalAmountInPaise), status: b.status })),
        reviews:  reviews.map((r) => ({ reviewId: r._id, salonName: r.salonId?.basicInfo?.shopName || "Unknown", rating: r.rating, review: r.review || null, date: r.createdAt })),
        pagination: { total: totalCount, page, limit, pages: Math.ceil(totalCount / limit) },
      },
    });
  } catch (err) {
    console.error("getCustomerHistory:", err);
    return res.status(500).json({ success: false, message: "Customer history fetch failed", error: process.env.NODE_ENV === "development" ? err.message : undefined });
  }
};