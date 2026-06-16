import Salon from "../models/Salon.js";
import geoService from "../services/geo.service.js";
import { assignAdminByDistrict } from "../services/adminAssign.service.js";
import { validateGeoHierarchy } from "../utils/validateGeoHierarchy.js";

///////////////////////////////////////////////////////////
// PARTNER REGISTRATION — v2 FINAL LOCK ✅
//
// FIXES APPLIED:
//   FIX 1: managerPhone → manager.phone
//   FIX 2: location.type/coordinates → location.geo
//   FIX 3: stateRef/cityRef/districtRef → location.territory.*
//   FIX 4: Added basicInfo.tier, specializations, capabilities support
//   FIX 5: Admin query — stateRef/cityRef → location.territory.*
//   FIX 6: approveSalon — salon.cityRef → location.territory.cityRef
//   FIX 7: rejectSalon  — salon.cityRef → location.territory.cityRef
///////////////////////////////////////////////////////////
export const onboardSalon = async (req, res) => {
  try {
    const payload = req.body;

    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    // OWNER
    payload.ownerId = req.user.isTemp ? null : req.user._id;

    // FIX 1: managerPhone → manager.phone
    const rawPhone = String(payload.managerPhone || payload.manager?.phone || "")
      .replace(/\D/g, "")
      .trim();

    if (!/^[6-9]\d{9}$/.test(rawPhone)) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }

    // DUPLICATE CHECK — FIX 1: use manager.phone path
    const existingSalon = await Salon.findOne({
      "manager.phone": rawPhone,
      isDeleted: false,
    }).lean();

    if (existingSalon) {
      return res.status(409).json({
        success: false,
        message: "Salon already exists for this number",
        data: { salonId: existingSalon._id, status: existingSalon?.approval?.status },
      });
    }

    // FIX 2: GEO VALIDATION — support both old and new format
    const rawCoords =
      payload.location?.coordinates ||
      payload.location?.geo?.coordinates;

    if (!Array.isArray(rawCoords) || rawCoords.length !== 2) {
      return res.status(400).json({ success: false, message: "Valid location coordinates required" });
    }

    let [lng, lat] = rawCoords;
    lng = Number(lng);
    lat = Number(lat);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: "Invalid coordinates" });
    }

    // GEO SERVICE
    const location = await geoService.detectLocation(lat, lng);
    if (!location) {
      return res.status(400).json({ success: false, message: "Invalid location" });
    }

    // ADMIN ASSIGN
    const adminRef = await assignAdminByDistrict({
      districtRef: location.districtRef,
      stateRef:    location.stateRef,
    });

    if (!adminRef) console.warn("No admin assigned for:", location.districtRef);

    // GEO HIERARCHY VALIDATION
    await validateGeoHierarchy({
      stateRef:    location.stateRef,
      districtRef: location.districtRef,
      cityRef:     location.cityRef,
    });

    // FIX 4: Build new model structure
    const tier             = payload.basicInfo?.tier || payload.tier || "STANDARD";
    const specializations  = payload.specializations  || [];
    const capabilities     = payload.capabilities     || [];
    const searchTags       = payload.searchTags       || [];

    // Build final salon data
    const salonData = {
      ownerId: payload.ownerId,

      basicInfo: {
        ...(payload.basicInfo || {}),
        shopName:     payload.basicInfo?.shopName     || payload.shopName,
        category:     payload.basicInfo?.category     || payload.category     || "UNISEX",
        tagline:      payload.basicInfo?.tagline      || payload.tagline      || null,
        whatsapp:     payload.basicInfo?.whatsapp     || payload.whatsapp     || null,
        tier,           // FIX 4
        setupType:    payload.basicInfo?.setupType    || "PROPER_SHOP",
        privacySetup: payload.basicInfo?.privacySetup || "MIXED",
        amenities:    payload.basicInfo?.amenities    || {},
        brandName:    payload.basicInfo?.brandName    || null,
        branchCode:   payload.basicInfo?.branchCode   || null,
      },

      // FIX 1: manager.phone
      manager: {
        name:  payload.manager?.name  || payload.managerName  || null,
        phone: rawPhone,
      },

      // FIX 2 + FIX 3: location.geo + location.territory
      location: {
        address: payload.location?.address || payload.address || null,
        geo: {
          type:        "Point",
          coordinates: [lng, lat],
        },
        territory: {
          countryRef:  location.countryRef  || null,
          stateRef:    location.stateRef    || null,
          districtRef: location.districtRef || null,
          cityRef:     location.cityRef     || null,
          areaRef:     location.areaRef     || null,
        },
      },

      // FIX 4: new fields
      specializations,
      capabilities,
      searchTags,
      isFeatured: false,

      staff: payload.staff || {},

      assignedAdmin: adminRef,

      approval: { status: "PENDING" },
      onboarding: { step: 1 },
      isDeleted: false,
    };

    const salon = await Salon.create(salonData);

    return res.status(201).json({
      success: true,
      message: "Salon onboarded. Awaiting approval.",
      data: {
        salonId:        salon._id,
        approvalStatus: salon.approval?.status,
      },
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

///////////////////////////////////////////////////////////
// ADMIN: GET SALONS — v2
// FIX 5: stateRef/cityRef → location.territory.*
///////////////////////////////////////////////////////////
export const getSalonsForAdmin = async (req, res) => {
  try {
    const { adminLevel, stateRef, cityRef } = req.user;
    const { status } = req.query;

    let query = { isDeleted: false };

    if (status) query["approval.status"] = status;

    // FIX 5: territory paths corrected
    if (adminLevel === "STATE") {
      query["location.territory.stateRef"] = stateRef;
    } else if (adminLevel === "CITY") {
      query["location.territory.cityRef"] = cityRef;
    }

    const salons = await Salon.find(query)
      .populate("location.territory.stateRef", "name")
      .populate("location.territory.cityRef",  "name")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, count: salons.length, data: salons });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

///////////////////////////////////////////////////////////
// ADMIN: APPROVE SALON — v2
// FIX 6: salon.cityRef → salon.location.territory.cityRef
///////////////////////////////////////////////////////////
export const approveSalon = async (req, res) => {
  try {
    const { id }                  = req.params;
    const { adminLevel, cityRef } = req.user;

    if (adminLevel !== "CITY") {
      return res.status(403).json({ success: false, message: "Only CITY ADMIN can approve salons" });
    }

    const salon = await Salon.findOne({ _id: id, isDeleted: false });

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    // FIX 6: use location.territory.cityRef
    const salonCityRef = salon.location?.territory?.cityRef?.toString();
    if (salonCityRef !== cityRef?.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (salon.approval?.status === "APPROVED") {
      return res.status(400).json({ success: false, message: "Already approved" });
    }

    salon.approval.status     = "APPROVED";
    salon.approval.approvedBy = req.user._id;
    salon.approval.approvedAt = new Date();
    salon.onboarding.step     = 8;

    await salon.save();

    return res.json({
      success: true,
      message: "Salon approved",
      data: { salonId: salon._id, status: salon.approval.status },
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

///////////////////////////////////////////////////////////
// ADMIN: REJECT SALON — v2
// FIX 7: salon.cityRef → salon.location.territory.cityRef
///////////////////////////////////////////////////////////
export const rejectSalon = async (req, res) => {
  try {
    const { id }                  = req.params;
    const { reason }              = req.body;
    const { adminLevel, cityRef } = req.user;

    if (adminLevel !== "CITY") {
      return res.status(403).json({ success: false, message: "Only CITY ADMIN can reject salons" });
    }

    const salon = await Salon.findOne({ _id: id, isDeleted: false });

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    // FIX 7: use location.territory.cityRef
    const salonCityRef = salon.location?.territory?.cityRef?.toString();
    if (salonCityRef !== cityRef?.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    salon.approval.status          = "REJECTED";
    salon.approval.rejectionReason = reason || "Rejected by admin";

    await salon.save();

    return res.json({
      success: true,
      message: "Salon rejected",
      data: { salonId: salon._id, status: salon.approval.status },
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

///////////////////////////////////////////////////////////
// USER: CHECK SALON STATUS — UNTOUCHED ✅
///////////////////////////////////////////////////////////
export const checkSalonStatus = async (req, res) => {
  try {
    const { salonId } = req.body;

    if (!salonId) {
      return res.status(400).json({ success: false, message: "Salon ID required" });
    }

    const salon = await Salon.findById(salonId)
      .select("approval onboarding isDeleted")
      .lean();

    if (!salon || salon.isDeleted) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    return res.json({
      success: true,
      data: {
        status: salon.approval?.status || "UNKNOWN",
        step:   salon.onboarding?.step || 0,
      },
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

///////////////////////////////////////////////////////////
// OWNER: TOGGLE SHOP STATUS — UNTOUCHED ✅
///////////////////////////////////////////////////////////
export const toggleShopOpen = async (req, res) => {
  try {
    const ownerId            = req.user?._id;
    const { salonId, isShopOpen } = req.body;

    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!salonId) {
      return res.status(400).json({ success: false, message: "salonId required" });
    }

    const salon = await Salon.findOne({ _id: salonId, ownerId, isDeleted: false });

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    salon.business.isShopOpen = Boolean(isShopOpen);
    await salon.save();

    return res.json({
      success: true,
      message: "Shop status updated",
      data: { salonId: salon._id, isShopOpen: salon.business.isShopOpen },
    });

  } catch (error) {
    console.error("TOGGLE_SHOP_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};