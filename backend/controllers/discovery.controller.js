import mongoose from "mongoose";
import Category from "../models/Category.js";
import Chair from "../models/Chair.js";
import Salon from "../models/Salon.js";
import SalonMedia from "../models/SalonMedia.js";
import Service from "../models/Service.js";
import logger from "../utils/logger.js";

///////////////////////////////////////////////////////////
// GET SALONS — v4
//
// FIXES APPLIED (v2):
//   FIX 1: business.isDeleted → isDeleted
//   FIX 2: cityRef → location.territory.cityRef
//   FIX 3: category → basicInfo.category
//   FIX 4: salonType → basicInfo.tier
//   FIX 5: facilityFlags.ac → basicInfo.amenities.hasAC
//   FIX 6: avgRating filter disabled (virtual cannot be queried)
//          TODO: implement averageRating filter via aggregation
//
// IMPROVEMENTS (v3):
//   NOTE 1: specialization now supports multi-value (comma separated)
//           Example: ?specialization=BRIDAL,GROOMING
//   NOTE 2: maxDistance now supports radius param (km)
//           Default: 10km | Options: 5, 10, 25, 50
//
// FIX (v4):
//   FIX 7: `search` query param was silently dropped — it never
//          made it into `filter`, so /api/discovery/salons?search=xyz
//          always returned the same createdAt-sorted list regardless
//          of query text. Now matches basicInfo.shopName or the
//          pre-generated searchTags array (case-insensitive, regex-
//          escaped). Works for both the $geoNear path (query passed
//          through unchanged) and the non-geo fallback path, since
//          both consume the same `filter` object.
//
// NEW FILTERS:
//   specialization — multi-value: BRIDAL,GROOMING,LUXURY etc
//   capability     — HOME_SERVICE
//   isFeatured     — true/false
//   radius         — 5 / 10 / 25 / 50 (km)
//   search         — free text, matches shopName / searchTags
//
///////////////////////////////////////////////////////////
export const getSalons = async (req, res) => {
  try {
    const {
      lat,
      lng,
      cityRef,
      category,       // MEN_ONLY / WOMEN_ONLY / UNISEX
      serviceCategory,
      tier,           // STANDARD / PREMIUM / LUXURY
      ac,             // true/false
      specialization, // single or comma-separated: BRIDAL,GROOMING
      capability,     // HOME_SERVICE
      isFeatured,     // true/false
      search,         // free-text: matches shopName or searchTags
      radius = 10,    // km — default 10, max 50
      page   = 1,
      limit  = 20,
    } = req.query;

    //////////////////////////////////////////////////////
    // SAFE PAGINATION
    //////////////////////////////////////////////////////
    const safePage     = Math.max(Number(page)   || 1,  1);
    const safeLimit    = Math.min(Number(limit)  || 20, 50);
    const safeRadiusKm = Math.min(Math.max(Number(radius) || 10, 1), 50);
    const maxDistanceM = safeRadiusKm * 1000; // convert km → meters
    const skip         = (safePage - 1) * safeLimit;

    //////////////////////////////////////////////////////
    // BASE FILTER
    //////////////////////////////////////////////////////
    const filter = {
      "approval.status": "APPROVED",
      isDeleted:         { $ne: true }, // FIX 1
    };

    // FIX 2: cityRef path corrected
    if (cityRef) filter["location.territory.cityRef"] = cityRef;

    // FIX 3: category path corrected
    if (category) filter["basicInfo.category"] = category;

    // FIX 4: salonType → tier
    if (tier) filter["basicInfo.tier"] = tier;

    // FIX 5: amenities path corrected
    if (ac === "true") filter["basicInfo.amenities.hasAC"] = true;

    // NOTE 1: specialization — supports multi-value (comma separated)
    // Example: ?specialization=BRIDAL,GROOMING
    if (specialization) {
      const specs = specialization.split(",").map(s => s.trim()).filter(Boolean);
      filter["specializations"] = specs.length === 1
        ? specs[0]
        : { $in: specs };
    }

    // Capability filter
    if (capability) filter["capabilities"] = capability;

    // isFeatured filter
    if (isFeatured === "true") filter["isFeatured"] = true;

    // FIX 7 (v5): free-text search — uses MongoDB TEXT index
    // (basicInfo.shopName + searchTags, defined in models/Salon.js),
    // NOT regex. A case-insensitive regex $or scans every document
    // (COLLSCAN) regardless of any index on the field — it does not
    // scale at PAN-India volume. $text is index-backed.
    if (search && search.trim()) {
      filter.$text = { $search: search.trim() };
    }

    // ── SERVICE CATEGORY FILTER — Category Discovery Engine ──────
    // Category → Service → Salon chain. Loose match (not a hard FK)
    // against Service.category and Service.name, since salon owners
    // enter category as a free string with real-world inconsistency
    // (e.g. some "facial" services tagged FACIAL, some tagged OTHER).
    if (serviceCategory && serviceCategory.trim()) {
      const categoryDoc = await Category.findOne({
        slug: serviceCategory.trim().toLowerCase(),
        isActive: true,
        isDeleted: false,
      }).select("_id displayName").lean();

      if (!categoryDoc) {
        return res.status(400).json({
          success: false,
          message: `Unknown category: ${serviceCategory}`,
        });
      }

      const escaped = categoryDoc.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const categoryPattern = new RegExp(escaped, "i");

      const matchingServices = await Service.find({
        isActive: true,
        isDeleted: false,
        $or: [
          { category: categoryPattern },
          { name: categoryPattern },
        ],
      }).select("salonId").lean();

      const salonIds = [...new Set(matchingServices.map(s => s.salonId.toString()))];
      // No matching services yet → deliberately empty result, not an
      // error. filter._id: { $in: [] } yields zero salons through
      // both the $geoNear and fallback paths below.
      filter._id = { $in: salonIds };
    }
  
    // FIX 6: minRating DISABLED
    // TODO: averageRating aggregation implement karo
    // Compute: { $divide: ["$rating.total", "$rating.count"] }
    // Then $match: { computedAvg: { $gte: minRating } }

    //////////////////////////////////////////////////////
    // GEO SEARCH
    //////////////////////////////////////////////////////
    let salons = null;
    let total  = 0;

    // $geoNear's `query` field does NOT support $text (MongoDB
    // restriction). If a text search is active, skip the geo path
    // entirely and let the fallback (non-geo) path below handle it
    // via $text. Trade-off: an active text search loses distance
    // sorting in favor of relevance — acceptable, since a user who's
    // typing a query cares about matching the query, not proximity.
    const hasTextSearch = Boolean(filter.$text);

    if (lat && lng && !hasTextSearch) {
      const latitude  = Number(lat);
      const longitude = Number(lng);

      if (
        !isNaN(latitude)  && !isNaN(longitude) &&
        latitude  >= -90  && latitude  <= 90   &&
        longitude >= -180 && longitude <= 180
      ) {
        salons = await Salon.aggregate([
          {
            $geoNear: {
              near:               { type: "Point", coordinates: [longitude, latitude] },
              distanceField:      "distance",
              distanceMultiplier: 0.001,        // meters → km
              maxDistance:        maxDistanceM, // NOTE 2: dynamic radius
              spherical:          true,
              query:              filter,        // FIX 7: now includes $or search too
            },
          },
          { $sort: { distance: 1 } },
          {
            $facet: {
              data: [
                { $skip: skip },
                { $limit: safeLimit },
                {
                  $lookup: {
                    from: "salonmedia",
                    let:  { sid: "$_id" },
                    pipeline: [
                      { $match: { $expr: { $eq: ["$salonId", "$$sid"] }, isDeleted: false } },
                      { $sort:  { order: 1 } },
                      { $limit: 1 },
                      { $project: { url: 1, _id: 0 } },
                    ],
                    as: "coverPhoto",
                  },
                },
                { $addFields: { coverUrl: { $arrayElemAt: ["$coverPhoto.url", 0] } } },
                {
                  $project: {
                    "basicInfo.shopName":         1,
                    "basicInfo.category":         1,
                    "basicInfo.tier":             1,
                    "basicInfo.amenities":        1,
                    "specializations":            1,
                    "capabilities":               1,
                    "isFeatured":                 1,
                    "media.logo":                 1,
                    "media.coverImage":           1,
                    "location.address":           1,
                    "location.geo":               1,
                    "location.territory.cityRef": 1,
                    "approval.status":            1,
                    "timings":                    1,
                    "rating":                     1,
                    "business.isShopOpen":        1,
                    "business.isForceClosed":     1,
                    "coverUrl":                   1,
                    distance:                     1,
                  },
                },
              ],
              totalCount: [{ $count: "count" }],
            },
          },
        ]);

        const result = salons[0] || {};
        salons = result.data                   || [];
        total  = result.totalCount?.[0]?.count || 0;
      }
    }

    //////////////////////////////////////////////////////
    // FALLBACK (NON-GEO)
    //////////////////////////////////////////////////////
    if (!salons || salons.length === 0) {
      total = await Salon.countDocuments(filter);

      let fallbackQuery = Salon.find(
        filter,
        // When $text is active, project the relevance score so we
        // can sort by it — otherwise leave projection to .select() below.
        hasTextSearch ? { score: { $meta: "textScore" } } : undefined
      );

      fallbackQuery = hasTextSearch
        ? fallbackQuery.sort({ score: { $meta: "textScore" } }) // relevance first
        : fallbackQuery.sort({ createdAt: -1 });                 // newest first (browsing)

      salons = await fallbackQuery
        .skip(skip)
        .limit(safeLimit)
        .select(
          "basicInfo.shopName basicInfo.category basicInfo.tier basicInfo.amenities " +
          "specializations capabilities isFeatured media.logo media.coverImage " +
          "location.address location.geo location.territory " +
          "timings rating approval.status business.isShopOpen business.isForceClosed"
        )
        .lean();
    }

    // Cover photo for fallback
    const salonIds = salons.map(s => s._id);
    const covers   = await SalonMedia.find({ salonId: { $in: salonIds }, isDeleted: false })
      .sort({ order: 1 })
      .select("salonId url")
      .lean();

    const coverMap = {};
    for (const c of covers) {
      const key = c.salonId.toString();
      if (!coverMap[key]) coverMap[key] = c.url;
    }

    salons = salons.map(s => ({
      ...s,
      coverUrl: s.media?.coverImage?.url || coverMap[s._id.toString()] || null,
    }));

    //////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////
    return res.json({
      success:    true,
      page:       safePage,
      radiusKm:   safeRadiusKm,
      total,
      count:      salons.length,
      data:       salons,
    });

  } catch (err) {
    console.error("DISCOVERY LIST ERROR:", { message: err.message, stack: err.stack });
    return res.status(500).json({ success: false });
  }
};

///////////////////////////////////////////////////////////
// GET SALON DETAIL — v2
///////////////////////////////////////////////////////////
export const getSalonById = async (req, res) => {
  try {
    const salon = await Salon.findOne({
      _id:               req.params.salonId,
      "approval.status": "APPROVED",
      isDeleted:         { $ne: true },
    })
      .select(
        "basicInfo location timings rating business " +
        "specializations capabilities isFeatured media searchTags"
      )
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const [chairs, media] = await Promise.all([
      Chair.find({ salonId: salon._id, isDeleted: false, isActive: true })
        .select("_id name position type")
        .sort({ position: 1 })
        .lean(),
      SalonMedia.find({ salonId: salon._id, isDeleted: false })
        .select("_id url type order")
        .sort({ order: 1 })
        .lean(),
    ]);

    // Compute averageRating (virtual cannot serialize via lean)
    const averageRating = salon.rating?.count
      ? Number((salon.rating.total / salon.rating.count).toFixed(1))
      : 0;

    return res.json({
      success: true,
      data:    { ...salon, chairs, media, averageRating },
    });

  } catch (err) {
    console.error("DISCOVERY DETAIL ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

///////////////////////////////////////////////////////////
// GET SALON SERVICES — v2
//
// Supports:
//   ?applicableFor=MEN   → MEN tab
//   ?applicableFor=WOMEN → WOMEN tab
//   ?category=HAIRCUT    → category filter
///////////////////////////////////////////////////////////
export const getSalonServices = async (req, res) => {
  try {
    const { salonId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(salonId)) {
      return res.status(400).json({ success: false, message: "Invalid salon ID" });
    }

    const salon = await Salon.findOne({
      _id:               salonId,
      "approval.status": "APPROVED",
      isDeleted:         { $ne: true },
    })
      .select("_id")
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const { applicableFor, category } = req.query;

    const serviceFilter = {
      salonId,
      isActive:  true,
      isDeleted: false,
    };

    // Home tab filter — MEN shows MEN + BOTH, WOMEN shows WOMEN + BOTH
    if (applicableFor && ["MEN", "WOMEN"].includes(applicableFor)) {
      serviceFilter.applicableFor = { $in: [applicableFor, "BOTH"] };
    }

    if (category) serviceFilter.category = category;

    const services = await Service.find(serviceFilter)
      .select("_id name price duration category applicableFor thumbnailImage imageUrl images isFeatured description benefits suitableFor brandsUsed steps beforeAfterImages resultsDurationText buffer bufferMin bufferMax")
      .sort({ category: 1, name: 1 })
      .lean();

    return res.status(200).json({
      success:  true,
      salonId,
      count:    services.length,
      services,
      ...(services.length === 0 && { message: "No services available for this salon" }),
    });

  } catch (err) {
    console.error("getSalonServices error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch services" });
  }
};


///////////////////////////////////////////////////////////
// GET CATEGORIES — Category Discovery Engine v1
//
// GET /api/discovery/categories
// GET /api/discovery/categories?applicableFor=MEN
// GET /api/discovery/categories?applicableFor=WOMEN
// GET /api/discovery/categories?applicableFor=UNISEX
//
// Public, unauthenticated. Returns only isActive + non-deleted
// categories, sorted by displayOrder. Exact query shape the
// isDeleted_1_isActive_1_displayOrder_1 compound index on Category
// was built for.
//
// ?applicableFor matches Home Screen's existing Men/Women/Unisex tab
// switcher:
//   MEN / WOMEN → only categories whose applicableFor array includes
//                 that value (e.g. "Beard" excluded when WOMEN).
//   UNISEX      → NO filter applied — returns all active categories.
//                 Business rule: a Unisex-tab user is browsing a
//                 salon type that serves both genders, so they see
//                 the full category list rather than a subset.
//   omitted     → same as UNISEX (no filter).
//   anything else → 400, explicit rejection rather than silently
//                 ignoring an unrecognized value.
//
// "Coming soon" categories (Grooming Packages, Bridal at launch) are
// seeded isActive:false, so they're automatically excluded — no
// special-casing needed. They appear the moment an admin flips
// isActive:true, with zero code changes.
///////////////////////////////////////////////////////////
export const getCategories = async (req, res) => {
  try {
    const { applicableFor } = req.query;

    const VALID_VALUES = ["MEN", "WOMEN", "UNISEX"];
    if (applicableFor && !VALID_VALUES.includes(applicableFor)) {
      return res.status(400).json({
        success: false,
        message: `Invalid applicableFor value. Expected one of: ${VALID_VALUES.join(", ")}`,
      });
    }

    const filter = {
      isDeleted: false,
      isActive: true,
    };

    // UNISEX (or omitted) intentionally applies no applicableFor
    // filter — see business rule in the header comment.
    if (applicableFor === "MEN" || applicableFor === "WOMEN") {
      filter.applicableFor = applicableFor;
    }

    const categories = await Category.find(filter)
      .select(
        "code slug displayName description iconUrl thumbnailUrl imageUrl " +
        "applicableFor estimatedDuration startingPrice featured displayOrder"
      )
      .sort({ displayOrder: 1 })
      .lean();

    return res.json({
      success: true,
      count: categories.length,
      meta: {
        applicableFor: applicableFor || "UNISEX",
      },
      data: categories,
    });
  } catch (err) {
    logger.error("DISCOVERY CATEGORIES ERROR", { message: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      message: "Unable to load categories",
    });
  }
};