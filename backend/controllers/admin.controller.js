import bcrypt from "bcryptjs";
import District from "../models/District.js";
import Salon from "../models/Salon.js";
import State from "../models/State.js";
import User from "../models/User.js";
import { Errors, successResponse } from "../utils/response.js";

/**
 * =====================================================
 * LIST SALONS FOR ADMIN
 * =====================================================
 */
export const listSalonsForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      search    = "",
      status    = "ALL",
      category,
      tier,
      state,
      district,
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Base Filter ──────────────────────────────────
    const filter = { isDeleted: { $ne: true } };

    if (status !== "ALL") filter["approval.status"]   = status;
    if (category)         filter["basicInfo.category"] = category;
    if (tier)             filter["basicInfo.tier"]     = tier;

    // ── Search (shop name + owner phone via $or) ─────
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or  = [
        { "basicInfo.shopName": regex },
        { "manager.phone":      regex },
      ];
    }

    // ── Scope Filter ─────────────────────────────────
    if (admin.adminLevel === "STATE") {
      filter["location.territory.stateRef"] = admin.stateRef;
    }
    if (admin.adminLevel === "DISTRICT") {
      filter["location.territory.districtRef"] = admin.districtRef;
    }
    if (admin.adminLevel === "INDIA") {
      if (state)    filter["location.territory.stateRef"]    = state;
      if (district) filter["location.territory.districtRef"] = district;
    }

    // ── Sort (whitelist) ─────────────────────────────
    const allowedSort = {
      createdAt: "createdAt",
      shopName:  "basicInfo.shopName",
      status:    "approval.status",
      category:  "basicInfo.category",
    };
    const sortField = allowedSort[sortBy] || "createdAt";
    const sort      = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ────────────────────────────────────────
    const [salons, total] = await Promise.all([
      Salon.find(filter)
        .select("_id basicInfo location approval createdAt assignedAdmin ownerId rating business")
        .populate("ownerId",                        "name phone")
        .populate("assignedAdmin",                  "name phone adminLevel")
        .populate("location.territory.stateRef",    "name")
        .populate("location.territory.districtRef", "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Salon.countDocuments(filter),
    ]);

    // ── Flatten Response ─────────────────────────────
    const isIndia = admin.adminLevel === "INDIA";

    const data = salons.map(s => ({
      id:           s._id,
      shopName:     s.basicInfo?.shopName   ?? null,
      category:     s.basicInfo?.category   ?? null,
      tier:         s.basicInfo?.tier       ?? null,
      ownerName:    s.ownerId?.name         ?? null,
      ownerPhone:   s.ownerId?.phone        ?? null,
      state:        s.location?.territory?.stateRef?.name    ?? null,
      district:     s.location?.territory?.districtRef?.name ?? null,
      status:       s.approval?.status      ?? null,
      rating:       s.rating?.average       ?? null,  // ✅ FIX 3
      isForceClosed: s.business?.isForceClosed ?? false,
      isSuspended:   s.business?.isSuspended   ?? false,
      assignedAdmin: s.assignedAdmin ?? null,
      createdAt:     s.createdAt,
      // ✅ FIX 5 — commission sirf INDIA admin dekhe
      ...(isIndia && { commissionRate: s.business?.commissionRate ?? null }),
    }));

    return successResponse(res, {
      message: "Salons fetched",
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
 * UPDATE SALON STATUS (APPROVE / REJECT)
 * DISTRICT admin only
 * =====================================================
 */
export const updateSalonStatus = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE", "DISTRICT"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Only DISTRICT admin can approve salons"));
    }

    const allowedStatuses = ["APPROVED", "REJECTED"];
    if (!allowedStatuses.includes(req.body.status)) {
      return next(Errors.badRequest("Invalid status"));
    }

    const { status, rejectionReason } = req.body;

    const salon = await Salon.findById(req.params.id);
    if (!salon) return next(Errors.notFound("Salon not found"));

    // DISTRICT admin → apne poore district ke salons approve kar sakta hai
    // (matches listSalonsForAdmin scope — one district = one district admin,
    // so district-wide access, not per-salon assignedAdmin matching)
    if (req.user.adminLevel === "DISTRICT") {
      const salonDistrictId = salon.location?.territory?.districtRef?.toString();
      if (!salonDistrictId || salonDistrictId !== req.user.districtRef?.toString()) {
        return next(Errors.forbidden("Not allowed to approve this salon"));
      }
    }
  // INDIA + STATE → koi bhi salon approve kar sakte hai

    const updated = await Salon.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "approval.status":          status,
          "approval.approvedBy":      status === "APPROVED" ? req.user._id : null,
          "approval.approvedAt":      status === "APPROVED" ? new Date()   : null,
          "approval.rejectedBy":      status === "REJECTED" ? req.user._id : null,
          "approval.rejectedAt":      status === "REJECTED" ? new Date()   : null,
          "approval.rejectionReason": status === "REJECTED"
            ? (rejectionReason || "Not specified") : null,
        },
      },
      { new: true }
    );

    return successResponse(res, { message: "Salon status updated", data: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * SET SALON COMMISSION
 * INDIA admin only — route level bhi guard hoga
 * =====================================================
 */
export const setSalonCommission = async (req, res, next) => {
  try {
    // ✅ FIX 7 — INDIA only
    if (req.user.adminLevel !== "INDIA") {
      return next(Errors.forbidden("Only INDIA admin can set commission"));
    }

    const { commission } = req.body;

    if (commission == null || commission < 0 || commission > 50) {
      return next(Errors.badRequest("Commission must be between 0 and 50"));
    }

    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      { $set: { "business.commissionRate": commission } },
      { new: true }
    );

    if (!salon) return next(Errors.notFound("Salon not found"));

    return successResponse(res, { message: "Commission updated", data: { commissionRate: salon.business.commissionRate } });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * FORCE CLOSE SALON
 * INDIA + STATE admin only
 * =====================================================
 */
export const forceCloseSalon = async (req, res, next) => {
  try {
    // ✅ FIX 6 — INDIA + STATE only
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges to force close salon"));
    }

    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "business.isForceClosed": true,
          "business.isShopOpen":    false,
        },
      },
      { new: true }
    );

    if (!salon) return next(Errors.notFound("Salon not found"));

    return successResponse(res, { message: "Salon force closed", data: salon });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * CREATE STATE ADMIN
 * =====================================================
 */
export const createStateAdmin = async (req, res, next) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId } = req.body;

    if (creator.adminLevel !== "INDIA") {
      return next(Errors.forbidden("Only INDIA admin can create state admin"));
    }

    name  = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const state = await State.findById(stateId).lean();
    if (!state) return next(Errors.notFound("State not found"));

    const hashedPassword = await bcrypt.hash("Admin@12345", 10);

    const admin = await User.create({
      name, phone, email,
      password:   hashedPassword,
      role:       "ADMIN",
      adminLevel: "STATE",
      countryRef: creator.countryRef,
      stateRef:   stateId,
    });

    return successResponse(res, {
      statusCode: 201,
      message:    "State admin created",
      data:       { adminId: admin._id, tempPassword: "Admin@12345" },
    });
  } catch (err) {
    if (err.code === 11000) return next(Errors.conflict("Duplicate admin"));
    next(err);
  }
};

/**
 * =====================================================
 * CREATE DISTRICT ADMIN
 * =====================================================
 */
export const createDistrictAdmin = async (req, res, next) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId, districtId } = req.body;

    if (!["INDIA", "STATE"].includes(creator.adminLevel)) {
      return next(Errors.forbidden("Not allowed to create district admin"));
    }

    if (
      creator.adminLevel === "STATE" &&
      creator.stateRef.toString() !== stateId
    ) {
      return next(Errors.forbidden("Cannot create admin outside your state"));
    }

    name  = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const district = await District.findById(districtId).lean();
    if (!district) return next(Errors.notFound("District not found"));

    if (district.stateRef.toString() !== stateId) {
      return next(Errors.badRequest("District mismatch"));
    }

    const hashedPassword = await bcrypt.hash("Admin@12345", 10);

    const admin = await User.create({
      name, phone, email,
      password:    hashedPassword,
      role:        "ADMIN",
      adminLevel:  "DISTRICT",
      countryRef:  creator.countryRef,
      stateRef:    stateId,
      districtRef: districtId,
    });

    return successResponse(res, {
      statusCode: 201,
      message:    "District admin created",
      data:       { adminId: admin._id, tempPassword: "Admin@12345" },
    });
  } catch (err) {
    if (err.code === 11000) return next(Errors.conflict("Duplicate admin"));
    next(err);
  }
};