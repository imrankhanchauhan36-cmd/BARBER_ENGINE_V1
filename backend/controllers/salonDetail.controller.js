/**
 * BARBER ENGINE V1
 * backend/controllers/salonDetail.controller.js
 * GET /api/admin/salons/:id
 */

import "../models/Area.js";
import "../models/City.js";
import "../models/Country.js";
import Salon from "../models/Salon.js";

import { Errors, successResponse } from "../utils/response.js";

export const getSalonDetail = async (req, res, next) => {
  try {
    const admin    = req.user;
    const salonId  = req.params.id;

    const salon = await Salon.findById(salonId)
      .populate("ownerId",                          "name phone email")
      .populate("assignedAdmin",                    "name phone adminLevel")
      .populate("approval.approvedBy",              "name adminLevel")
      .populate("approval.rejectedBy",              "name adminLevel")
      .populate("location.territory.countryRef",    "name code")
      .populate("location.territory.stateRef",      "name")
      .populate("location.territory.districtRef",   "name")
      .populate("location.territory.cityRef",       "name")
      .populate("location.territory.areaRef",       "name")
      .lean();

    if (!salon || salon.isDeleted) {
      return next(Errors.notFound("Salon not found"));
    }

    // ── Scope Guard ──────────────────────────────────
    if (admin.adminLevel === "STATE") {
      const salonState = salon.location?.territory?.stateRef?._id?.toString();
      if (salonState !== admin.stateRef?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    if (admin.adminLevel === "DISTRICT") {
      if (salon.assignedAdmin?._id?.toString() !== admin._id?.toString()) {
        return next(Errors.forbidden("Access denied"));
      }
    }

    const isIndia = admin.adminLevel === "INDIA";

    // ── Build Response ───────────────────────────────
    const data = {
      // Basic
      id:          salon._id,
      shopName:    salon.basicInfo?.shopName    ?? null,
      tagline:     salon.basicInfo?.tagline     ?? null,
      category:    salon.basicInfo?.category    ?? null,
      tier:        salon.basicInfo?.tier        ?? null,
      since:       salon.basicInfo?.since       ?? null,
      experience:  salon.basicInfo?.experience  ?? null,
      whatsapp:    salon.basicInfo?.whatsapp    ?? null,
      setupType:   salon.basicInfo?.setupType   ?? null,
      brandName:   salon.basicInfo?.brandName   ?? null,
      branchCode:  salon.basicInfo?.branchCode  ?? null,

      // Owner
      owner: {
        name:  salon.ownerId?.name  ?? null,
        phone: salon.ownerId?.phone ?? null,
        email: salon.ownerId?.email ?? null,
      },

      // Manager
      manager: {
        name:  salon.manager?.name  ?? null,
        phone: salon.manager?.phone ?? null,
      },

      // Location
      location: {
        address:  salon.location?.address ?? null,
        geo:      salon.location?.geo?.coordinates
                    ? { lat: salon.location.geo.coordinates[1], lng: salon.location.geo.coordinates[0] }
                    : null,
        country:  salon.location?.territory?.countryRef?.name  ?? null,
        state:    salon.location?.territory?.stateRef?.name    ?? null,
        district: salon.location?.territory?.districtRef?.name ?? null,
        city:     salon.location?.territory?.cityRef?.name     ?? null,
        area:     salon.location?.territory?.areaRef?.name     ?? null,
      },

      // Amenities
      amenities: salon.basicInfo?.amenities ?? {
        hasAC: false, hasParking: false, hasWifi: false,
        waitingArea: false, restroom: false,
      },

      // Staff
      staff: {
        count:         salon.staff?.count ?? null,
        genderSupport: salon.staff?.genderSupport ?? null,
      },

      // Specializations
      specializations: salon.specializations ?? [],
      capabilities:    salon.capabilities    ?? [],

      // Timings
      timings: salon.timings ?? null,

      // Media
      media: {
        logo:        salon.media?.logo?.url        ?? null,
        coverImage:  salon.media?.coverImage?.url  ?? null,
        galleryCount: salon.media?.gallery?.length ?? 0,
        gallery:     salon.media?.gallery?.map(g => ({
          url:     g.url,
          caption: g.caption ?? null,
        })) ?? [],
      },

      // Rating
      rating: {
        average: salon.rating?.count > 0
          ? +(salon.rating.total / salon.rating.count).toFixed(1)
          : 0,
        count: salon.rating?.count ?? 0,
      },

      // Business
      business: {
        isShopOpen:      salon.business?.isShopOpen      ?? false,
        isForceClosed:   salon.business?.isForceClosed   ?? false,
        isSuspended:     salon.business?.isSuspended     ?? false,
        suspendedReason: salon.business?.suspendedReason ?? null,
        suspendedAt:     salon.business?.suspendedAt     ?? null,
        ...(isIndia && {
          commissionRate: salon.business?.commissionRate ?? null,
        }),
      },

      // Approval
      approval: {
        status:          salon.approval?.status          ?? null,
        approvedBy: salon.approval?.approvedBy
          ? {
              id:         salon.approval.approvedBy._id,
              name:       salon.approval.approvedBy.name       ?? null,
              adminLevel: salon.approval.approvedBy.adminLevel ?? null,
            }
          : null,
        approvedAt:      salon.approval?.approvedAt      ?? null,
        rejectedBy: salon.approval?.rejectedBy
          ? {
              id:         salon.approval.rejectedBy._id,
              name:       salon.approval.rejectedBy.name       ?? null,
              adminLevel: salon.approval.rejectedBy.adminLevel ?? null,
            }
          : null,
        rejectedAt:      salon.approval?.rejectedAt      ?? null,
        rejectionReason: salon.approval?.rejectionReason ?? null,
      },

      // Onboarding
      onboarding: {
        step:      salon.onboarding?.step      ?? 1,
        completed: salon.onboarding?.completed ?? false,
      },

      // Assigned Admin
      assignedAdmin: salon.assignedAdmin
        ? {
            id:         salon.assignedAdmin._id,
            name:       salon.assignedAdmin.name       ?? null,
            phone:      salon.assignedAdmin.phone      ?? null,
            adminLevel: salon.assignedAdmin.adminLevel ?? null,
          }
        : null,

      // Chairs
      chairCount: salon.chairCount ?? null,

      // Featured
      isFeatured: salon.isFeatured ?? false,

      // Timestamps
      createdAt:  salon.createdAt,
      updatedAt:  salon.updatedAt,
    };

    return successResponse(res, {
      message: "Salon detail fetched",
      data,
    });

  } catch (err) {
    next(err);
  }
};