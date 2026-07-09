/**
 * BARBER ENGINE V1
 * backend/controllers/adminStaff.controller.js
 * Enterprise Grade — v2 — 10/10 FROZEN
 */

import Chair from "../models/Chair.js";
import Salon from "../models/Salon.js";
import Staff from "../models/Staff.js";
import { Errors, successResponse } from "../utils/response.js";

// ─── Helpers ─────────────────────────────────────────────
const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * Build scoped salon IDs — single query, no N+1
 * Returns null for INDIA (no filter needed)
 */
const getScopedSalonIds = async (admin) => {
  if (admin.adminLevel === "INDIA") return null;

  const salonFilter = { isDeleted: { $ne: true } };
  if (admin.adminLevel === "STATE")    salonFilter["location.territory.stateRef"]    = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") salonFilter["location.territory.districtRef"] = admin.districtRef;

  const salons = await Salon.find(salonFilter).select("_id").lean();
  return salons.map(s => s._id);
};

/**
 * =====================================================
 * GET STAFF SUMMARY
 * GET /api/admin/staff/summary
 * =====================================================
 */
export const getStaffSummary = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const salonIds   = await getScopedSalonIds(admin);
    const baseFilter = { isDeleted: { $ne: true } };
    if (salonIds) baseFilter.salonId = { $in: salonIds };

    const [summary] = await Staff.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id:        null,
          total:      { $sum: 1 },
          active:     { $sum: { $cond: [{ $eq: ["$isActive", true]  }, 1, 0] } },
          inactive:   { $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] } },
          barbers:    { $sum: { $cond: [{ $eq: ["$role", "BARBER"]  }, 1, 0] } },
          helpers:    { $sum: { $cond: [{ $eq: ["$role", "HELPER"]  }, 1, 0] } },
          managers:   { $sum: { $cond: [{ $eq: ["$role", "MANAGER"] }, 1, 0] } },
          ownerOperators: { $sum: { $cond: [{ $eq: ["$isOwner", true]   }, 1, 0] } },
          withChair:  { $sum: { $cond: [{ $ne: ["$chairId", null]   }, 1, 0] } },
          // ✅ Fix #6 — additional dashboard metrics
          busyToday:  { $sum: { $cond: [{ $gt: ["$totalBookingsToday", 0] }, 1, 0] } },
          totalBookingsToday: { $sum: "$totalBookingsToday" },
        },
      },
    ]);

    const s = summary || {};

    return successResponse(res, {
      message: "Staff summary fetched",
      data: {
        total:     s.total     ?? 0,
        active:    s.active    ?? 0,
        inactive:  s.inactive  ?? 0,
        withChair: s.withChair ?? 0,
        // ✅ Fix #6
        busyToday:          s.busyToday          ?? 0,
        totalBookingsToday: s.totalBookingsToday ?? 0,
        ownerOperators: s.ownerOperators ?? 0,
        byRole: {
          barbers:  s.barbers  ?? 0,
          helpers:  s.helpers  ?? 0,
          managers: s.managers ?? 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * LIST STAFF FOR ADMIN
 * GET /api/admin/staff
 * =====================================================
 */
export const listStaffForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      search    = "",
      role      = "ALL",
      status    = "ALL",
      salonId   = "",
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Scope Filter ──────────────────────────────────
    const salonIds = await getScopedSalonIds(admin);
    const filter   = { isDeleted: { $ne: true } };
    if (salonIds) filter.salonId = { $in: salonIds };

    // ── Role / Status Filters ─────────────────────────
    if (role   !== "ALL")      filter.role     = role;
    if (status === "ACTIVE")   filter.isActive = true;
    if (status === "INACTIVE") filter.isActive = false;

    // ✅ Fix #1 — salonId filter with scope validation
    if (salonId && isValidId(salonId)) {
      if (salonIds && !salonIds.some(id => id.toString() === salonId)) {
        return next(Errors.forbidden("Salon is outside your admin scope"));
      }
      filter.salonId = salonId;
    }

    // ✅ Fix #7 — Search by name, phone, AND salon name
    if (search?.trim()) {
      const s = search.trim();
      if (isValidId(s)) {
        filter._id = s;
      } else {
        const matchedSalons = await Salon.find({
          isDeleted: { $ne: true },
          "basicInfo.shopName": { $regex: s, $options: "i" },
          ...(salonIds ? { _id: { $in: salonIds } } : {}),
        }).select("_id").lean();

        filter.$or = [
          { name:    { $regex: s, $options: "i" } },
          { phone:   { $regex: s, $options: "i" } },
          { salonId: { $in: matchedSalons.map(sl => sl._id) } },
        ];
      }
    }

    // ── Sort ─────────────────────────────────────────
    const allowedSort = {
      createdAt:          "createdAt",
      name:               "name",
      totalBookingsToday: "totalBookingsToday",
    };
    const sortField = allowedSort[sortBy] || "createdAt";
    const sort      = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ─────────────────────────────────────────
    const [staff, total] = await Promise.all([
      Staff.find(filter)
        .select("_id name phone role skills chairId isActive isOwner totalBookingsToday salonId createdAt")
        .populate({
          path: "salonId",
          select: "basicInfo.shopName location.territory.stateRef location.territory.districtRef",
          populate: [
            { path: "location.territory.stateRef",    select: "name", model: "State"    },
            { path: "location.territory.districtRef", select: "name", model: "District" },
          ],
        })
        .populate("chairId", "name")
        .populate("skills",  "name price duration")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Staff.countDocuments(filter),
    ]);

    const data = staff.map(s => ({
      id:                 s._id,
      name:               s.name               ?? null,
      phone:              s.phone              ?? null,
      role:               s.role               ?? null,
      isActive:           s.isActive           ?? true,
      isOwner:            s.isOwner            ?? false,
      totalBookingsToday: s.totalBookingsToday ?? 0,
      createdAt:          s.createdAt          ?? null,

      salon: s.salonId ? {
        id:       s.salonId._id,
        shopName: s.salonId.basicInfo?.shopName ?? null,
        state: s.salonId.location?.territory?.stateRef ? {
          id:   s.salonId.location.territory.stateRef._id  ?? s.salonId.location.territory.stateRef,
          name: s.salonId.location.territory.stateRef.name ?? null,
        } : null,
        district: s.salonId.location?.territory?.districtRef ? {
          id:   s.salonId.location.territory.districtRef._id  ?? s.salonId.location.territory.districtRef,
          name: s.salonId.location.territory.districtRef.name ?? null,
        } : null,
      } : null,

      chair: s.chairId ? {
        id:   s.chairId._id,
        name: s.chairId.name ?? null,
      } : null,

      skills: (s.skills || []).map(sk => ({
        id:       sk._id,
        name:     sk.name     ?? null,
        price:    sk.price    ?? 0,
        duration: sk.duration ?? 0,
      })),
    }));

    return successResponse(res, {
      message: "Staff fetched",
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
 * GET STAFF DETAIL
 * GET /api/admin/staff/:id
 * =====================================================
 */
export const getStaffDetail = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid staff ID"));

    const staff = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate({
      path: "salonId",
      select: "basicInfo.shopName location.territory.stateRef location.territory.districtRef ownerId",
      populate: [
        { path: "location.territory.stateRef",    select: "name", model: "State"    },
        { path: "location.territory.districtRef", select: "name", model: "District" },
      ],
    })
      .populate("chairId",   "name")
      .populate("skills",    "name price duration")
      .populate("createdBy",              "name adminLevel")
      .populate("updatedBy",              "name adminLevel")
      .populate("statusHistory.changedBy", "name adminLevel")
      .lean();

    if (!staff) return next(Errors.notFound("Staff not found"));

    // ── Scope Guard ──────────────────────────────────
    if (admin.adminLevel === "STATE") {
      const salonState = staff.salonId?.location?.territory?.stateRef?.toString();
      if (salonState !== admin.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied — outside your state"));
      }
    }
    if (admin.adminLevel === "DISTRICT") {
      const salonDist = staff.salonId?.location?.territory?.districtRef?.toString();
      if (salonDist !== admin.districtRef?.toString()) {
        return next(Errors.forbidden("Access denied — outside your district"));
      }
    }

    return successResponse(res, {
      message: "Staff detail fetched",
      data: {
        id:                 staff._id,
        name:               staff.name               ?? null,
        phone:              staff.phone              ?? null,
        role:               staff.role               ?? null,
        isActive:           staff.isActive           ?? true,
        isOwner:            staff.isOwner            ?? false,
        totalBookingsToday: staff.totalBookingsToday ?? 0,
        createdAt:          staff.createdAt          ?? null,
        updatedAt:          staff.updatedAt          ?? null,

        salon: staff.salonId ? {
          id:       staff.salonId._id,
          shopName: staff.salonId.basicInfo?.shopName ?? null,
          state: staff.salonId.location?.territory?.stateRef ? {
            id:   staff.salonId.location.territory.stateRef._id  ?? staff.salonId.location.territory.stateRef,
            name: staff.salonId.location.territory.stateRef.name ?? null,
          } : null,
          district: staff.salonId.location?.territory?.districtRef ? {
            id:   staff.salonId.location.territory.districtRef._id  ?? staff.salonId.location.territory.districtRef,
            name: staff.salonId.location.territory.districtRef.name ?? null,
          } : null,
        } : null,

        chair: staff.chairId ? {
          id:   staff.chairId._id,
          name: staff.chairId.name ?? null,
        } : null,

        skills: (staff.skills || []).map(sk => ({
          id:       sk._id,
          name:     sk.name     ?? null,
          price:    sk.price    ?? 0,
          duration: sk.duration ?? 0,
        })),

        // ✅ Fix #8 — Future placeholders for frontend stability
        performance: {},     // Phase 5A — Part 2
        attendance:  {},     // Phase 5A — Part 2
        schedule:    {},     // Phase 5A — Part 2
        reviews:     {},     // Phase 5B
        wallet:      {},     // Phase 7 Finance

        // ✅ Fix #5 — Status audit trail
        statusHistory: (staff.statusHistory || []).map(h => ({
          previousStatus: h.previousStatus ?? null,
          currentStatus:  h.currentStatus  ?? null,
          isActive:       h.isActive       ?? null,
          changedAt:      h.changedAt      ?? null,
          changedBy: h.changedBy ? {
            id:         h.changedBy._id,
            name:       h.changedBy.name       ?? null,
            adminLevel: h.changedBy.adminLevel ?? null,
          } : null,
          adminLevel: h.adminLevel ?? null,
          reason:     h.reason     ?? null,
        })),
        // ✅ Fix #4 — Transfer history
        transferHistory: staff.transferHistory || [],

        createdBy: staff.createdBy ? {
          id:         staff.createdBy._id,
          name:       staff.createdBy.name       ?? null,
          adminLevel: staff.createdBy.adminLevel ?? null,
        } : null,

        updatedBy: staff.updatedBy ? {
          id:         staff.updatedBy._id,
          name:       staff.updatedBy.name       ?? null,
          adminLevel: staff.updatedBy.adminLevel ?? null,
        } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * UPDATE STAFF STATUS
 * PATCH /api/admin/staff/:id/status
 * INDIA + STATE only
 * =====================================================
 */
export const updateStaffStatus = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges"));
    }
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid staff ID"));

    const { isActive, reason } = req.body;
    if (typeof isActive !== "boolean") {
      return next(Errors.badRequest("isActive must be true or false"));
    }
    if (!isActive && !reason?.trim()) {
      return next(Errors.badRequest("Reason required when deactivating staff"));
    }

    const staff = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!staff) return next(Errors.notFound("Staff not found"));

    // Scope guard
    if (req.user.adminLevel === "STATE") {
      const salon = await Salon.findById(staff.salonId).lean();
      const salonState = salon?.location?.territory?.stateRef?.toString();
      if (salonState !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Cannot update staff outside your state"));
      }
    }

    // ✅ Fix #5 — Status history audit trail
    if (!Array.isArray(staff.statusHistory)) staff.statusHistory = [];
    staff.statusHistory.push({
      previousStatus: staff.isActive,
      currentStatus:  isActive,
      isActive,
      changedAt:  new Date(),
      changedBy:  req.user._id,
      adminLevel: req.user.adminLevel,
      reason:     reason?.trim() || null,
    });

    staff.isActive  = isActive;
    staff.updatedBy = req.user._id;
    await staff.save();

    return successResponse(res, {
      message: `Staff ${isActive ? "activated" : "deactivated"} successfully`,
      data: {
        id:        staff._id,
        name:      staff.name,
        isActive:  staff.isActive,
        reason:    reason?.trim() || null,
        updatedBy: req.user.name,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * ASSIGN / CHANGE CHAIR
 * PATCH /api/admin/staff/:id/chair
 * INDIA + STATE only
 * =====================================================
 */
export const assignStaffChair = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges"));
    }
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid staff ID"));

    const { chairId } = req.body;
    if (chairId && !isValidId(chairId)) return next(Errors.badRequest("Invalid chair ID"));

    const staff = await Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!staff) return next(Errors.notFound("Staff not found"));


    // ✅ Fix — STATE scope check on staff's salon
    if (req.user.adminLevel === "STATE") {
      const salon = await Salon.findById(staff.salonId).lean();
      if (salon?.location?.territory?.stateRef?.toString() !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Cannot update staff outside your state"));
      }
    }

    // ✅ Fix #2 & #9 — Chair validation: exists + same salon
    if (chairId) {
      const chair = await Chair.findOne({ _id: chairId, isDeleted: { $ne: true } }).lean();
      if (!chair) return next(Errors.notFound("Chair not found"));

      // Chair must belong to same salon as staff
      if (chair.salonId?.toString() !== staff.salonId?.toString()) {
        return next(Errors.badRequest("Chair does not belong to staff's salon"));
      }

      // Chair must not be already assigned to another staff
      const alreadyAssigned = await Staff.findOne({
        _id:       { $ne: staff._id },
        chairId,
        isDeleted: { $ne: true },
      }).lean();
      if (alreadyAssigned) {
        return next(Errors.badRequest(`Chair already assigned to ${alreadyAssigned.name}`));
      }
    }

    staff.chairId   = chairId || null;
    staff.updatedBy = req.user._id;
    await staff.save();

    return successResponse(res, {
      message: chairId ? "Chair assigned successfully" : "Chair removed successfully",
      data: {
        id:      staff._id,
        name:    staff.name,
        chairId: staff.chairId,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * TRANSFER STAFF TO ANOTHER SALON
 * PATCH /api/admin/staff/:id/salon
 * INDIA only
 * =====================================================
 */
export const transferStaff = async (req, res, next) => {
  try {
    if (req.user.adminLevel !== "INDIA") {
      return next(Errors.forbidden("Only INDIA admin can transfer staff"));
    }
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid staff ID"));

    const { salonId, reason } = req.body;
    if (!salonId || !isValidId(salonId)) return next(Errors.badRequest("Valid salonId required"));
    if (!reason?.trim()) return next(Errors.badRequest("Reason required for transfer"));

    const [staff, salon] = await Promise.all([
      Staff.findOne({ _id: req.params.id, isDeleted: { $ne: true } }),
      Salon.findOne({ _id: salonId, isDeleted: { $ne: true } }).lean(),
    ]);

    if (!staff) return next(Errors.notFound("Staff not found"));
    if (!salon) return next(Errors.notFound("Target salon not found"));

    // ✅ Fix #3 — Prevent same salon transfer
    if (staff.salonId?.toString() === salonId) {
      return next(Errors.badRequest("Staff is already assigned to this salon"));
    }

    const prevSalonId = staff.salonId;

    // ✅ Fix #4 — Save transfer history in DB
    if (!Array.isArray(staff.transferHistory)) staff.transferHistory = [];
    staff.transferHistory.push({
      fromChairId:   staff.chairId ?? null,
      toChairId:     null,
      fromSalonId:  prevSalonId,
      toSalonId:    salonId,
      transferredAt: new Date(),
      transferredBy: req.user._id,
      adminLevel:   req.user.adminLevel,
      reason:       reason.trim(),
    });

    staff.salonId   = salonId;
    staff.chairId   = null; // ✅ Fix #10 — clear chair on transfer (business rule: new salon, new chair)
    staff.totalBookingsToday = 0; // reset daily counter on transfer
    staff.updatedBy = req.user._id;
    await staff.save();

    return successResponse(res, {
      message: "Staff transferred successfully",
      data: {
        id:           staff._id,
        name:         staff.name,
        fromSalonId:  prevSalonId,
        toSalonId:    salonId,
        toSalonName:  salon.basicInfo?.shopName ?? null,
        chairCleared: true,
        reason:       reason.trim(),
      },
    });
  } catch (err) {
    next(err);
  }
};