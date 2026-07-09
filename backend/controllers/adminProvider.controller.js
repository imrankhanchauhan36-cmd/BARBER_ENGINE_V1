/**
 * BARBER ENGINE V1
 * backend/controllers/adminProvider.controller.js
 * Enterprise Grade — v1 — Phase 5B Providers Module
 * Providers = Salon Owners (User model, role: "OWNER")
 */

import Salon from "../models/Salon.js";
import User from "../models/User.js";
import { Errors, successResponse } from "../utils/response.js";

// ─── Helpers ─────────────────────────────────────────────
const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

/**
 * Build scope filter for STATE/DISTRICT
 * Providers are scoped by their salons' location
 */
const getScopedOwnerIds = async (admin) => {
  if (admin.adminLevel === "INDIA") return null;

  const salonFilter = { isDeleted: { $ne: true } };
  if (admin.adminLevel === "STATE")    salonFilter["location.territory.stateRef"]    = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") salonFilter["location.territory.districtRef"] = admin.districtRef;

  const salons = await Salon.find(salonFilter).select("ownerId").lean();
  return [...new Set(salons.map(s => s.ownerId?.toString()).filter(Boolean))];
};

/**
 * =====================================================
 * GET PROVIDERS SUMMARY
 * GET /api/admin/providers/summary
 * =====================================================
 */
export const getProvidersSummary = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const ownerIds   = await getScopedOwnerIds(admin);
    const baseFilter = { role: "OWNER", isDeleted: { $ne: true } };
    if (ownerIds) baseFilter._id = { $in: ownerIds };

    const [summary] = await User.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id:       null,
          total:     { $sum: 1 },
          active:    { $sum: { $cond: [{ $eq: ["$accountStatus", "ACTIVE"]    }, 1, 0] } },
          suspended: { $sum: { $cond: [{ $eq: ["$accountStatus", "SUSPENDED"] }, 1, 0] } },
          blocked:   { $sum: { $cond: [{ $eq: ["$accountStatus", "BLOCKED"]   }, 1, 0] } },
          verified:  { $sum: { $cond: [{ $eq: ["$isPhoneVerified", true]      }, 1, 0] } },
        },
      },
    ]);

    // Salon stats per provider scope
    const salonFilter = { isDeleted: { $ne: true } };
    if (ownerIds) salonFilter.ownerId = { $in: ownerIds };

    const [salonStats] = await Salon.aggregate([
      { $match: salonFilter },
      {
        $group: {
          _id:          null,
          totalSalons:  { $sum: 1 },
          activeSalons: { $sum: { $cond: [{ $eq: ["$approval.status", "APPROVED"] }, 1, 0] } },
          pendingSalons:{ $sum: { $cond: [{ $eq: ["$approval.status", "PENDING"]  }, 1, 0] } },
        },
      },
    ]);

    const s = summary    || {};
    const sl = salonStats || {};

    return successResponse(res, {
      message: "Providers summary fetched",
      data: {
        total:     s.total     ?? 0,
        active:    s.active    ?? 0,
        suspended: s.suspended ?? 0,
        blocked:   s.blocked   ?? 0,
        verified:  s.verified  ?? 0,
        salons: {
          total:   sl.totalSalons   ?? 0,
          active:  sl.activeSalons  ?? 0,
          pending: sl.pendingSalons ?? 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * LIST PROVIDERS FOR ADMIN
 * GET /api/admin/providers
 * =====================================================
 */
export const listProvidersForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      search    = "",
      status    = "ALL",
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Scope Filter ──────────────────────────────────
    const ownerIds = await getScopedOwnerIds(admin);
    const filter   = { role: "OWNER", isDeleted: { $ne: true } };
    if (ownerIds) filter._id = { $in: ownerIds };

    // ── Status Filter ─────────────────────────────────
    if (status !== "ALL") filter.accountStatus = status;

    // ── Search ───────────────────────────────────────
    if (search?.trim()) {
      const s = search.trim();
      filter.$or = [
        { name:  { $regex: s, $options: "i" } },
        { phone: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
      ]
    }

    // ── Sort ─────────────────────────────────────────
    const allowedSort = { createdAt: "createdAt", name: "name" };
    const sortField   = allowedSort[sortBy] || "createdAt";
    const sort        = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ─────────────────────────────────────────
    const [providers, total] = await Promise.all([
      User.find(filter)
        .select("_id name phone email accountStatus isPhoneVerified isEmailVerified walletBalance rewardPoints createdAt lastLoginAt")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      User.countDocuments(filter),
    ]);

    // ── Fetch salons for each provider ────────────────
    const providerIds = providers.map(p => p._id);
    const salons = await Salon.find({
      ownerId:   { $in: providerIds },
      isDeleted: { $ne: true },
    })
      .select("ownerId basicInfo.shopName approval.status location.territory.stateRef location.territory.districtRef")
      .populate("location.territory.stateRef",    "name")
      .populate("location.territory.districtRef", "name")
      .lean();

    // Group salons by ownerId
    const salonsByOwner = {}
    salons.forEach(s => {
      const oid = s.ownerId?.toString()
      if (!salonsByOwner[oid]) salonsByOwner[oid] = []
      salonsByOwner[oid].push(s)
    })

    // ── DTO ──────────────────────────────────────────
    const data = providers.map(p => {
      const ownerSalons = salonsByOwner[p._id.toString()] || []
      return {
        id:            p._id,
        name:          p.name          ?? null,
        phone:         p.phone         ?? null,
        email:         p.email         ?? null,
        accountStatus: p.accountStatus ?? null,
        verification: {
          phone: p.isPhoneVerified ?? false,
          email: p.isEmailVerified ?? false,
        },
        wallet: {
          balance:      p.walletBalance ?? 0,
          rewardPoints: p.rewardPoints  ?? 0,
        },
        lastLoginAt: p.lastLoginAt ?? null,
        createdAt:   p.createdAt   ?? null,

        // Salon summary
        salonCount: ownerSalons.length,
        salons: ownerSalons.map(s => ({
          id:       s._id,
          shopName: s.basicInfo?.shopName ?? null,
          status:   s.approval?.status   ?? null,
          state:    s.location?.territory?.stateRef    ? { id: s.location.territory.stateRef._id, name: s.location.territory.stateRef.name } : null,
          district: s.location?.territory?.districtRef ? { id: s.location.territory.districtRef._id, name: s.location.territory.districtRef.name } : null,
        })),
      }
    });

    return successResponse(res, {
      message: "Providers fetched",
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
 * GET PROVIDER DETAIL
 * GET /api/admin/providers/:id
 * =====================================================
 */
export const getProviderDetail = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid provider ID"));

    const provider = await User.findOne({
      _id:       req.params.id,
      role:      "OWNER",
      isDeleted: { $ne: true },
    })
      .select("-password -otpCode -loginAttempts -lockUntil -tokenVersion -otpExpiresAt")
      .lean();

    if (!provider) return next(Errors.notFound("Provider not found"));

    // ── Scope Guard ──────────────────────────────────
    if (admin.adminLevel !== "INDIA") {
      const ownerIds = await getScopedOwnerIds(admin);
      if (!ownerIds?.includes(provider._id.toString())) {
        return next(Errors.forbidden("Access denied — provider outside your scope"));
      }
    }

    // ── Fetch Salons ─────────────────────────────────
    const salons = await Salon.find({
      ownerId:   provider._id,
      isDeleted: { $ne: true },
    })
      .select("basicInfo.shopName basicInfo.category approval.status location.territory location.address business.commissionRate createdAt")
      .populate("location.territory.stateRef",    "name")
      .populate("location.territory.districtRef", "name")
      .lean();

    return successResponse(res, {
      message: "Provider detail fetched",
      data: {
        id:            provider._id,
        name:          provider.name          ?? null,
        phone:         provider.phone         ?? null,
        email:         provider.email         ?? null,
        accountStatus: provider.accountStatus ?? null,
        isActive:      provider.isActive      ?? true,

        verification: {
          phone: provider.isPhoneVerified ?? false,
          email: provider.isEmailVerified ?? false,
        },

        wallet: {
          balance:      provider.walletBalance ?? 0,
          rewardPoints: provider.rewardPoints  ?? 0,
        },

        lastLoginAt: provider.lastLoginAt ?? null,
        createdAt:   provider.createdAt   ?? null,
        updatedAt:   provider.updatedAt   ?? null,

        // Salons
        salonCount: salons.length,
        salons: salons.map(s => ({
          id:             s._id,
          shopName:       s.basicInfo?.shopName   ?? null,
          category:       s.basicInfo?.category   ?? null,
          approvalStatus: s.approval?.status      ?? null,
          commissionRate: s.business?.commissionRate        ?? null,
          address:        s.location?.address     ?? null,
          state:    s.location?.territory?.stateRef    ? { id: s.location.territory.stateRef._id,    name: s.location.territory.stateRef.name    } : null,
          district: s.location?.territory?.districtRef ? { id: s.location.territory.districtRef._id, name: s.location.territory.districtRef.name } : null,
          createdAt: s.createdAt ?? null,
        })),

        // Placeholders
        kyc:      {},   // Phase 6 KYC module
        earnings: {},   // Phase 7 Finance module
        documents:{},   // Phase 6 KYC module
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * UPDATE PROVIDER STATUS
 * PATCH /api/admin/providers/:id/status
 * INDIA + STATE only
 * =====================================================
 */
export const updateProviderStatus = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges"));
    }
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid provider ID"));

    const { status, reason } = req.body;
    const allowed = ["ACTIVE", "SUSPENDED", "BLOCKED"];
    if (!allowed.includes(status)) {
      return next(Errors.badRequest("Invalid status. Must be ACTIVE, SUSPENDED, or BLOCKED"));
    }
    if (["SUSPENDED", "BLOCKED"].includes(status) && !reason?.trim()) {
      return next(Errors.badRequest("Reason required when suspending or blocking"));
    }

    const provider = await User.findOne({
      _id:       req.params.id,
      role:      "OWNER",
      isDeleted: { $ne: true },
    });
    if (!provider) return next(Errors.notFound("Provider not found"));

    // Scope guard for STATE admin
    if (req.user.adminLevel === "STATE") {
      const ownerIds = await getScopedOwnerIds(req.user);
      if (!ownerIds?.includes(provider._id.toString())) {
        return next(Errors.forbidden("Provider outside your state scope"));
      }
    }

    provider.accountStatus      = status;
    provider.status             = status;
    provider.statusUpdatedBy    = req.user._id;
    provider.statusUpdatedAt    = new Date();
    provider.statusUpdateReason = reason?.trim() || null;
    await provider.save();

    return successResponse(res, {
      message: `Provider ${status.toLowerCase()} successfully`,
      data: {
        id:            provider._id,
        name:          provider.name,
        phone:         provider.phone,
        accountStatus: provider.accountStatus,
        updatedBy:     req.user.name,
        reason:        reason?.trim() || null,
      },
    });
  } catch (err) {
    next(err);
  }
};