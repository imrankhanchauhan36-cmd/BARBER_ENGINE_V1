/**
 * BARBER ENGINE V1
 * backend/controllers/adminUser.controller.js
 * Enterprise Grade — v3 — 10/10 FROZEN
 */

import User from "../models/User.js";
import { Errors, successResponse } from "../utils/response.js";

/**
 * =====================================================
 * LIST USERS FOR ADMIN
 * =====================================================
 */
export const listUsersForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      search    = "",
      role      = "ALL",
      status    = "ALL",
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Base Filter ──────────────────────────────────
    const filter = {
      isDeleted: { $ne: true },
      role:      { $nin: ["ADMIN"] },
    };

    if (role   !== "ALL") filter.role          = role;
    if (status !== "ALL") filter.accountStatus = status;

    // ── Search ───────────────────────────────────────
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or  = [
        { name:  regex },
        { phone: regex },
        { email: regex },
      ];
    }

    // ── Role Scope (INDIA > STATE > DISTRICT) ────────
    if (admin.adminLevel === "STATE") {
      filter.stateRef = admin.stateRef;
    }
    if (admin.adminLevel === "DISTRICT") {
      filter.districtRef = admin.districtRef;
    }
    // INDIA admin — all users, no scope filter

    // ── Sort ─────────────────────────────────────────
    const allowedSort = {
      createdAt:     "createdAt",
      name:          "name",
      walletBalance: "walletBalance",
      rewardPoints:  "rewardPoints",
      lastLoginAt:   "lastLoginAt",
    };
    const sortField = allowedSort[sortBy] || "createdAt";
    const sort      = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ────────────────────────────────────────
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("_id name phone email role accountStatus isPhoneVerified isEmailVerified walletBalance rewardPoints profilePhoto createdAt lastLoginAt")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      User.countDocuments(filter),
    ]);

    // ── DTO ──────────────────────────────────────────
    const data = users.map(u => ({
      id:    u._id,

      // Identity
      name:  u.name  ?? null,
      phone: u.phone ?? null,
      email: u.email ?? null,
      role:  u.role  ?? null,

      // Status
      accountStatus: u.accountStatus ?? null,

      // Verification
      verification: {
        phone: u.isPhoneVerified ?? false,
        email: u.isEmailVerified ?? false,
      },

      // Wallet
      wallet: {
        balance:      u.walletBalance ?? 0,
        rewardPoints: u.rewardPoints  ?? 0,
      },

      // Profile
      profilePhoto: u.profilePhoto ?? null,

      // ✅ FIX 1 — stats null, not dummy values
      // Bookings module (Phase 5) me populate hoga
      stats: null,

      // Activity
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt:   u.createdAt,
    }));

    return successResponse(res, {
      message: "Users fetched",
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
 * GET USER DETAIL
 * =====================================================
 */
export const getUserDetail = async (req, res, next) => {
  try {
    const admin = req.user;

    // ✅ Guard against non-ObjectId params
        if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
          return next(Errors.badRequest("Invalid user ID"));
        }
    const user = await User.findOne({
      _id:       req.params.id,
      isDeleted: { $ne: true },
      role:      { $nin: ["ADMIN"] },
    })
      .select("-password -otpCode -loginAttempts -lockUntil -tokenVersion -otpExpiresAt")
      .lean();

    if (!user) return next(Errors.notFound("User not found"));

    // ── Scope Guard ──────────────────────────────────
    // ✅ FIX 2 — Explicit INDIA check for readability
    if (admin.adminLevel === "INDIA") {
      // INDIA admin — full access, no scope filter needed
    } else if (admin.adminLevel === "STATE") {
      if (user.stateRef?.toString() !== admin.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    } else if (admin.adminLevel === "DISTRICT") {
      if (user.districtRef?.toString() !== admin.districtRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    return successResponse(res, {
      message: "User detail fetched",
      data: {
        id:    user._id,

        // Identity
        name:  user.name  ?? null,
        phone: user.phone ?? null,
        email: user.email ?? null,
        role:  user.role  ?? null,

        // Status
        accountStatus: user.accountStatus ?? null,
        isActive:      user.isActive      ?? true,

        // Verification
        verification: {
          phone: user.isPhoneVerified ?? false,
          email: user.isEmailVerified ?? false,
        },

        // Wallet
        wallet: {
          balance:      user.walletBalance ?? 0,
          rewardPoints: user.rewardPoints  ?? 0,
        },

        // Profile
        profilePhoto: user.profilePhoto ?? null,

        // ✅ FIX 1 — No dummy arrays/placeholders
        // Dedicated endpoints jab modules ready hon:
        // GET /users/:id/bookings  → Phase 5
        // GET /users/:id/reviews   → Phase 7
        // GET /users/:id/wallet    → Phase 6
        // GET /users/:id/devices   → Phase 9
        stats:     null,
        bookings:  null,
        reviews:   null,
        addresses: null,
        devices:   null,

        // Activity
        lastLoginAt: user.lastLoginAt ?? null,
        createdAt:   user.createdAt,
        updatedAt:   user.updatedAt,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * UPDATE USER STATUS (BAN / UNBAN / SUSPEND)
 * INDIA + STATE only
 * =====================================================
 * NOTE: statusUpdatedBy, statusUpdatedAt, statusUpdateReason
 * User schema me nahi hain (strict: true).
 * Ye fields AuditLog collection me save honge — Phase 14.
 * =====================================================
 */
export const updateUserStatus = async (req, res, next) => {
  try {
    // ✅ Controller-level permission check
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges to update user status"));
    }

    const { status, reason } = req.body;
    const allowed = ["ACTIVE", "SUSPENDED", "BLOCKED"];

    if (!allowed.includes(status)) {
      return next(Errors.badRequest("Invalid status. Must be ACTIVE, SUSPENDED, or BLOCKED"));
    }

    // ✅ Reason required when blocking or suspending
    if (["SUSPENDED", "BLOCKED"].includes(status) && !reason?.trim()) {
      return next(Errors.badRequest("Reason is required when suspending or blocking a user"));
    }

    const user = await User.findOne({
      _id:       req.params.id,
      isDeleted: { $ne: true },
      role:      { $nin: ["ADMIN"] },
    });

    if (!user) return next(Errors.notFound("User not found"));

    // ✅ Scope guard
    if (req.user.adminLevel === "STATE") {
      if (user.stateRef?.toString() !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Cannot update user outside your state"));
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          accountStatus:      status,
          status,
          statusUpdatedBy:    req.user._id,
          statusUpdatedAt:    new Date(),
          statusUpdateReason: reason?.trim() || null,
        },
      },
      { new: true }
    ).select("_id name phone accountStatus statusUpdatedBy statusUpdatedAt statusUpdateReason");

    // TODO Phase 14 — AuditLog.create({
    //   action:    "USER_STATUS_UPDATE",
    //   targetId:  updated._id,
    //   targetType:"User",
    //   by:        req.user._id,
    //   reason:    reason?.trim() || null,
    //   from:      user.accountStatus,
    //   to:        status,
    //   ip:        req.ip,
    // })

    return successResponse(res, {
      message: `User ${status.toLowerCase()} successfully`,
      data: {
        id:            updated._id,
        name:          updated.name,
        phone:         updated.phone,
        accountStatus: updated.accountStatus,
        updatedBy:     req.user.name,
        reason:        reason?.trim() || null,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * GET USERS SUMMARY
 * GET /api/admin/users/summary
 * =====================================================
 */
export const getUsersSummary = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    // ── Scope Filter ─────────────────────────────────
    const baseFilter = {
      isDeleted: { $ne: true },
      role:      { $nin: ["ADMIN"] },
    };

    if (admin.adminLevel === "STATE")    baseFilter.stateRef    = admin.stateRef;
    if (admin.adminLevel === "DISTRICT") baseFilter.districtRef = admin.districtRef;

    // ── Aggregate ────────────────────────────────────
    const [summary] = await User.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id:        null,
          total:      { $sum: 1 },
          active:     { $sum: { $cond: [{ $eq: ["$accountStatus", "ACTIVE"]    }, 1, 0] } },
          suspended:  { $sum: { $cond: [{ $eq: ["$accountStatus", "SUSPENDED"] }, 1, 0] } },
          blocked:    { $sum: { $cond: [{ $eq: ["$accountStatus", "BLOCKED"]   }, 1, 0] } },
          users:      { $sum: { $cond: [{ $eq: ["$role", "USER"]        }, 1, 0] } },
          owners:     { $sum: { $cond: [{ $eq: ["$role", "OWNER"]       }, 1, 0] } },
          barbers:    { $sum: { $cond: [{ $eq: ["$role", "BARBER"]      }, 1, 0] } },
          fieldStaff: { $sum: { $cond: [{ $eq: ["$role", "FIELD_STAFF"] }, 1, 0] } },
        },
      },
    ]);

    return successResponse(res, {
      message: "Users summary fetched",
      data: summary
        ? {
            total:     summary.total     ?? 0,
            active:    summary.active    ?? 0,
            suspended: summary.suspended ?? 0,
            blocked:   summary.blocked   ?? 0,
            byRole: {
              users:      summary.users      ?? 0,
              owners:     summary.owners     ?? 0,
              barbers:    summary.barbers    ?? 0,
              fieldStaff: summary.fieldStaff ?? 0,
            },
          }
        : {
            total:0, active:0, suspended:0, blocked:0,
            byRole:{ users:0, owners:0, barbers:0, fieldStaff:0 },
          },
    });

  } catch (err) {
    next(err);
  }
};