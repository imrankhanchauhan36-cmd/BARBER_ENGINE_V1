///////////////////////////////////////////////////////////
// SALON ONBOARDING CONTROLLER — FINAL ZOMATO GRADE
///////////////////////////////////////////////////////////

import mongoose from "mongoose";
import Chair from "../models/Chair.js";
import Salon from "../models/Salon.js";
import SalonMedia from "../models/SalonMedia.js";
import Service from "../models/Service.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { assignAdminByDistrict } from "../services/adminAssign.service.js";
import geoService from "../services/geo.service.js";
import { invalidateAllNextSlotCache } from "../services/slotEngine.service.js";

///////////////////////////////////////////////////////////
// STEP 1 — SAVE BASIC INFO (UNCHANGED — PERFECT)
///////////////////////////////////////////////////////////

export const saveBasicInfo = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const {
      shopName,
      category,
      tagline,
      since,
      amenities,
      tier,
      setupType,
      specializations,
      capabilities,
      privacySetup,
      whatsapp,
      brandName,
      branchCode,
      experience,
    } = req.body;

    if (!shopName || !category) {
      return res.status(400).json({
        success: false,
        message: "shopName and category required",
      });
    }

    const cleanName = shopName.trim();
    const cleanCategory = category.trim().toUpperCase();
    const cleanTagline = tagline?.trim() || null;

    if (cleanName.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Shop name too short",
      });
    }

    const allowedCategories = [
      "MEN_ONLY",
      "WOMEN_ONLY",
      "UNISEX",
    ];
    const finalCategory = allowedCategories.includes(cleanCategory)
      ? cleanCategory
      : "UNISEX";

    const allowedSalonTypes = [
      "STANDARD",
      "PREMIUM",
      "LUXURY",
    ];
    const finalTier = allowedSalonTypes.includes(tier)
      ? tier
      : "STANDARD";

    const allowedSetupTypes = ["PROPER_SHOP", "OPEN_SETUP"];
    const finalSetupType = allowedSetupTypes.includes(setupType)
      ? setupType
      : "PROPER_SHOP";

    const allowedPrivacy = ["SEPARATE", "MIXED"];
    const finalPrivacy = allowedPrivacy.includes(privacySetup)
      ? privacySetup
      : "MIXED";

    const updatePayload = {
      "basicInfo.shopName": cleanName,
      "basicInfo.category": finalCategory,
      "basicInfo.tagline": cleanTagline,
      "basicInfo.since": since ?? null,
      "basicInfo.tier": finalTier,
      "basicInfo.whatsapp": whatsapp ?? null,
      "basicInfo.brandName": brandName ?? null,
      "basicInfo.branchCode": branchCode ?? null,
      "basicInfo.experience": experience ?? null,

      "specializations": Array.isArray(specializations)
        ? specializations
        : [],

      "capabilities": Array.isArray(capabilities)
        ? capabilities
        : [],
      "basicInfo.setupType": finalSetupType,
      "basicInfo.privacySetup": finalPrivacy,

      "basicInfo.amenities.hasAC": amenities?.hasAC ?? false,
      "basicInfo.amenities.hasParking": amenities?.hasParking ?? false,
      "basicInfo.amenities.hasWifi": amenities?.hasWifi ?? false,
      "basicInfo.amenities.waitingArea": amenities?.waitingArea ?? false,
      "basicInfo.amenities.restroom": amenities?.restroom ?? false,

      "location.geo.type": "Point",
      "location.geo.coordinates": [0, 0],
      "approval.status": "DRAFT",

      $max: {
        "onboarding.step": 1,
      },
    };

    const salon = await Salon.findOneAndUpdate(
      { ownerId },
      {
        $set: updatePayload,
        $setOnInsert: { ownerId },
      },
      {
        new: true,
        upsert: true,
        runValidators: false,  // ← step-wise validation, poora schema nahi
      }
    );

    return res.status(200).json({
      success: true,
      message: "Basic info saved successfully",
      data: {
        salonId: salon._id,
        onboardingStep: salon.onboarding?.step,
        status: salon.approval?.status,
        basicInfo: salon.basicInfo,
      },
    });

  } catch (error) {
    console.error("SAVE_BASIC_INFO_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP 2 — SAVE LOCATION (FINAL ZOMATO VERSION)
///////////////////////////////////////////////////////////

export const saveLocation = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { address, lat, lng } = req.body;

    //////////////////////////////////////////////////////
    // VALIDATION
    //////////////////////////////////////////////////////

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (
      isNaN(latNum) ||
      isNaN(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid lat & lng required",
      });
    }

    //////////////////////////////////////////////////////
    // 🔥 GEO DETECT (PINCODE + REDIS BASED)
    //////////////////////////////////////////////////////

    const location = await geoService.detectLocation(latNum, lngNum);
    if (!location) {
      return res.status(400).json({
        success: false,
        message: "Service not available in this area",
      });
    }

    //////////////////////////////////////////////////////
    // 🔥 ADMIN ASSIGN (FIXED)
    //////////////////////////////////////////////////////

    const existingSalon = await Salon.findOne({ ownerId }).select('assignedAdmin').lean();
    if (existingSalon?.assignedAdmin) {
      await User.findByIdAndUpdate(
        existingSalon.assignedAdmin,
        { $unset: { lastAssignedAt: 1 } }
      );
    }
    

    const admin = await assignAdminByDistrict({
      districtRef: location.districtRef,
      stateRef: location.stateRef,
    });

    //////////////////////////////////////////////////////
    // 💾 SAVE LOCATION
    //////////////////////////////////////////////////////

    // ✅ FIRST DEFINE
    const validAdmin =
      admin && mongoose.Types.ObjectId.isValid(admin)
        ? admin
        : null;

    // 💾 THEN SAVE
    const salon = await Salon.findOneAndUpdate(
      { ownerId },
      {
        $set: {
          "location.address": address?.trim() || null,

          "location.geo": {
            type: "Point",
            coordinates: [lngNum, latNum],
          },

          "location.territory.countryRef": location.countryRef,
          "location.territory.stateRef": location.stateRef,
          "location.territory.districtRef": location.districtRef,
          "location.territory.cityRef": location.cityRef,
          "location.territory.pincodeRef": location.pincodeRef,

          assignedAdmin: validAdmin,
        },

        $setOnInsert: { ownerId }, // 🔥 ADD THIS
        $max: {
          "onboarding.step": 2,
        },
      },
      {
        new: true,
        upsert: true,       // 🔥 ADD THIS
        runValidators: false,  // ← FIXED
      }
    );

    //////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      message: "Location saved successfully",
      data: {
        cityRef: location.cityRef,
        districtRef: location.districtRef,
        stateRef: location.stateRef,
        pincodeRef: location.pincodeRef,
        onboardingStep: salon?.onboarding?.step || 2,
        ////////////////////////////////////////////////////////
        // 🧑‍💼 ADMIN RESPONSE (PRO)
        ////////////////////////////////////////////////////////
        assignedAdmin: validAdmin,
      },
    });

  } catch (error) {
    console.error("SAVE_LOCATION_ERROR:", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// SEARCH TAGS — auto-generated from name + category +
// applicableFor (see Service model NOTE 3). Never accept
// owner-entered tags — spam risk.
///////////////////////////////////////////////////////////

const generateSearchTags = (name, category, applicableFor) => {
  const tags = new Set();

  const nameWords = name.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1);
  nameWords.forEach((w) => tags.add(w));
  if (nameWords.length > 1) tags.add(name.toLowerCase().trim());

  if (category) tags.add(category.toLowerCase().replace(/_/g, " "));

  if (applicableFor === "MEN")   tags.add("men");
  if (applicableFor === "WOMEN") tags.add("women");

  return Array.from(tags);
};

///////////////////////////////////////////////////////////
// 🔥 STEP 3 — SAVE SERVICES (TRANSACTION SAFE)
///////////////////////////////////////////////////////////

export const saveServices = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;

    //////////////////////////////////////////////////////
    // 🔒 AUTH CHECK
    //////////////////////////////////////////////////////
    if (!ownerId) {
      await session.abortTransaction();
      session.endSession();

      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { services } = req.body;

    //////////////////////////////////////////////////////
    // 📦 VALIDATION
    //////////////////////////////////////////////////////
    if (!Array.isArray(services) || services.length === 0) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Services array required",
      });
    }

    //////////////////////////////////////////////////////
    // 🚫 DUPLICATE CHECK (REQUEST LEVEL)
    //////////////////////////////////////////////////////
    const names = services.map((s) =>
      s.name?.trim().toLowerCase()
    );

    if (new Set(names).size !== names.length) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Duplicate service names in request",
      });
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId }).session(session);

    if (!salon) {
      await session.abortTransaction();
      session.endSession();

      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    //////////////////////////////////////////////////////
    // 🚫 STATUS CHECK
    //////////////////////////////////////////////////////
    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Salon not editable",
      });
    }

    //////////////////////////////////////////////////////
    // 🚫 STEP CHECK
    //////////////////////////////////////////////////////
    if (salon.onboarding?.step < 2) {
      await session.abortTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: "Complete previous steps first",
      });
    }

    //////////////////////////////////////////////////////
    // 🔍 FETCH EXISTING SERVICES — needed to diff against
    // the incoming array instead of destroying everything.
    //////////////////////////////////////////////////////
    const existingServices = await Service.find(
      { salonId: salon._id, isDeleted: false }
    ).session(session);

    const existingById = new Map(
      existingServices.map((s) => [s._id.toString(), s])
    );

    //////////////////////////////////////////////////////
    // 🛠 VALIDATE + SPLIT INCOMING SERVICES
    // Item has a matching existing _id  → update in place
    // Item has no (or unrecognized) _id → insert as new
    // PRESERVES _id + bookingCount for every edited service
    // — Booking.serviceRefs and discovery ranking depend on
    // the _id never changing under an edit/toggle.
    //////////////////////////////////////////////////////
    const updateOps = [];
    const newDocs   = [];
    const keptIds   = new Set();

    for (const item of services) {
      if (!item.name || item.price <= 0 || item.duration <= 0) {
        throw new Error("Invalid service data");
      }

      if (
        item.bufferMin !== undefined &&
        item.bufferMax !== undefined &&
        item.bufferMin > item.bufferMax
      ) {
        throw new Error("Invalid buffer range");
      }

      const name = item.name.trim().toLowerCase();
      const category = item.category
        ? item.category.trim().toUpperCase()
        : "OTHER";
      const applicableFor = item.applicableFor || "BOTH";

      const fields = {
        name,

        price: Math.round(item.price),

        duration: item.duration,

        buffer: item.buffer ?? 5,
        bufferMin: item.bufferMin ?? 5,
        bufferMax: item.bufferMax ?? 15,

        category,

        applicableFor,

        // Was silently dropped by the old insertMany-only path —
        // every service always ended up isActive:true regardless
        // of what the owner toggled. Fixed as part of this rewrite.
        isActive: item.isActive !== false,

        thumbnailImage: item.thumbnailImage || null,

        description: item.description || "",

        benefits: Array.isArray(item.benefits)
          ? item.benefits
          : [],

        suitableFor: Array.isArray(item.suitableFor)
          ? item.suitableFor
          : [],

        brandsUsed: Array.isArray(item.brandsUsed)
          ? item.brandsUsed
          : [],

        steps: Array.isArray(item.steps)
          ? item.steps
          : [],

        resultsDurationText:
          item.resultsDurationText || "",

        images: Array.isArray(item.images)
          ? item.images
          : [],

        beforeAfterImages: Array.isArray(item.beforeAfterImages)
          ? item.beforeAfterImages
          : [],

        introVideo: item.introVideo || null,

        // Auto-generated, never taken from the request — owners
        // manually entering tags is a spam vector (see model note).
        searchTags: generateSearchTags(name, category, applicableFor),

        isFeatured: item.isFeatured || false,

        updatedBy: ownerId,
      };

      const existing = item._id && existingById.get(item._id.toString());

      if (existing) {
        keptIds.add(existing._id.toString());
        updateOps.push({ id: existing._id, fields });
      } else {
        newDocs.push({
          ...fields,
          salonId: salon._id,
          createdBy: ownerId,
        });
      }
    }

    //////////////////////////////////////////////////////
    // 🗑️ SOFT-DELETE — existing services no longer present
    // in the incoming array (owner pressed Delete). Never
    // hard-delete: Booking.serviceRefs and bookingCount must
    // keep resolving for historical bookings. isDeleted:false
    // is already respected everywhere that matters (discovery,
    // slot engine, booking populate) — isActive:false alongside
    // it frees up the unique {salonId,name} slot so the name
    // can be reused by a future service.
    //////////////////////////////////////////////////////
    const removedIds = existingServices
      .map((s) => s._id.toString())
      .filter((id) => !keptIds.has(id));

    if (removedIds.length > 0) {
      await Service.updateMany(
        { _id: { $in: removedIds }, salonId: salon._id },
        { $set: { isDeleted: true, isActive: false, updatedBy: ownerId } },
        { session }
      );
    }

    //////////////////////////////////////////////////////
    // 💾 APPLY UPDATES + INSERTS (VALIDATION SAFE)
    //
    // Sequential findOneAndUpdate, NOT bulkWrite — verified directly
    // that bulkWrite's per-operation `runValidators: true` does NOT
    // actually enforce Mongoose schema validation (confirmed via a
    // live test: an invalid category + out-of-range duration were
    // both silently written to Mongo through bulkWrite). findOneAndUpdate
    // with runValidators:true was verified to correctly reject the
    // same invalid input. Slower (N round-trips vs 1 bulk op) but a
    // salon's service catalog is small — correctness over micro-perf
    // here. This also makes the schema's own pre("findOneAndUpdate")
    // buffer-range hook fire again, which bulkWrite was silently
    // skipping too.
    //////////////////////////////////////////////////////

    for (const { id, fields } of updateOps) {
      await Service.findOneAndUpdate(
        { _id: id, salonId: salon._id },
        { $set: fields },
        { session, runValidators: true }
      );
    }

    if (newDocs.length > 0) {
      await Service.insertMany(newDocs, { session, ordered: true });
    }

    const totalProcessed = updateOps.length + newDocs.length;

    //////////////////////////////////////////////////////
    // 🔄 UPDATE ONBOARDING STEP → 3
    //////////////////////////////////////////////////////
    if (salon.onboarding.step < 3) {
      salon.onboarding.step = 3;
      await salon.save({ session, validateBeforeSave: false });
    }

    //////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Services saved successfully",
      data: {
        totalServices: totalProcessed,
        onboardingStep: salon.onboarding.step,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("SAVE_SERVICES_ERROR:", {
      message: error.message,
      stack: error.stack,
    });

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate service name",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};


export const saveChairs = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;

    //////////////////////////////////////////////////////
    // 🔒 AUTH
    //////////////////////////////////////////////////////
    if (!ownerId) {
      throw new Error("Authentication required");
    }

    const { chairCount } = req.body;

    //////////////////////////////////////////////////////
    // 📦 VALIDATION
    //////////////////////////////////////////////////////
    if (
      !chairCount ||
      Number(chairCount) < 1 ||
      Number(chairCount) > 50
    ) {
      throw new Error("Valid chairCount required");
    }

    //////////////////////////////////////////////////////
    // 🚫 DUPLICATE CHECK (REQUEST LEVEL)
    //////////////////////////////////////////////////////
    //const names = chairs.map((c) =>
    //  c.name?.trim().toLowerCase()
    //);

    //if (new Set(names).size !== names.length) {
    //  throw new Error("Duplicate chair names in request");
    //}

    //const positions = chairs.map((c, i) => c.position || i + 1);

    //if (new Set(positions).size !== positions.length) {
    //  throw new Error("Duplicate chair positions in request");
    //}

    //////////////////////////////////////////////////////
    // 🔍 GET SALON
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId }).session(session);

    if (!salon) throw new Error("Salon not found");

    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      throw new Error("Salon not editable");
    }

    if (salon.onboarding?.step < 3) {
      throw new Error("Complete previous steps first");
    }

    //////////////////////////////////////////////////////
    // 🛠 PREPARE DATA
    //////////////////////////////////////////////////////
    //const allowedTypes = ["NORMAL", "VIP", "PREMIUM"];

    const chairDocs = Array.from(
      { length: Number(chairCount) },
      (_, index) => ({
        salonId: salon._id,
        chairCode: `${salon._id.toString().slice(-6)}-CHR-${String(index + 1).padStart(3, "0")}`,
        name: `Chair ${index + 1}`,
        position: index + 1,
        photo: {
          url: null,
          publicId: null,
        },
        barberId: null,
        skills: [],
        priority: 1,
        createdBy: ownerId,
      })
    );
    //////////////////////////////////////////////////////
    // 💾 DELETE + INSERT (TRANSACTION FIX)
    //////////////////////////////////////////////////////

    // Transaction abort karo — delete transaction ke bahar hoga
    await session.abortTransaction();
    session.endSession();

    // Transaction ke BAHAR delete karo — index conflict nahi hoga
    await Chair.deleteMany({
      salonId: salon._id
    });

    // Step update karo
    await Salon.findOneAndUpdate(
      { ownerId },
      {
        $max: { "onboarding.step": 4 },
        $set: { chairCount: Number(chairCount) },
      },
      { runValidators: false }
    );

    //////////////////////////////////////////////////////
    // TODO:
    // Current onboarding uses delete + recreate.
    //
    // After Owner Chair Management release,
    // replace with diff-based update logic.
    //
    // Reason:
    // Chair photos, skills, barber assignment,
    // and analytics data should not be lost when
    // owner changes chair count later.
    //
    //////////////////////////////////////////////////////
  
    // Naye session mein insert karo
    const session2 = await mongoose.startSession();
    session2.startTransaction();

    try {
      await Chair.insertMany(chairDocs, { session: session2, ordered: true });
      await session2.commitTransaction();
      session2.endSession();
    } catch (insertErr) {
      await session2.abortTransaction();
      session2.endSession();
      throw insertErr;
    }

    return res.status(200).json({
      success: true,
      message: "Chairs created successfully",
      data: {
        totalChairs:    chairDocs.length,
        onboardingStep: 4,
        chairs: chairDocs.map((c) => ({
          chairCode: c.chairCode,
          name:      c.name,
          position:  c.position,
        })),
      },
    });

  } catch (error) {
    try {
      await session.abortTransaction();
      session.endSession();
    } catch {}

    console.error("SAVE_CHAIRS_ERROR:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate chair name or position",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP 5 — SAVE TIMINGS (ADVANCED)
///////////////////////////////////////////////////////////

export const saveTimings = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    let { timings } = req.body;

    // Time comparison helper — prevents string comparison bugs
    const toMinutes = (time) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };

    if (!timings || typeof timings !== "object") {
      return res.status(400).json({
        success: false,
        message: "Timings object required",
      });
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId });

    if (!salon) {
      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      return res.status(400).json({
        success: false,
        message: "Salon not editable",
      });
    }

    if (salon.onboarding?.step < 4) {
      return res.status(400).json({
        success: false,
        message: "Complete previous steps first",
      });
    }

    //////////////////////////////////////////////////////
    // 🧠 FORCE FULL WEEK (CRITICAL FIX)
    //////////////////////////////////////////////////////
    const days = [
      "monday","tuesday","wednesday",
      "thursday","friday","saturday","sunday"
    ];

    const finalTimings = {};

    for (const day of days) {
      const d = timings[day];

      // 👉 if not provided → mark closed
      if (!d) {
        finalTimings[day] = { isClosed: true };
        continue;
      }

      // 🛑 CLOSED DAY
      if (d.isClosed) {
        finalTimings[day] = { isClosed: true };
        continue;
      }

      //////////////////////////////////////////////////////
      // ❗ VALIDATION
      //////////////////////////////////////////////////////
      if (!d.open || !d.close) {
        return res.status(400).json({
          success: false,
          message: `${day}: open & close required`,
        });
      }

      if (toMinutes(d.open) >= toMinutes(d.close)) {
        return res.status(400).json({
          success: false,
          message: `${day}: open must be before close`,
        });
      }

      //////////////////////////////////////////////////////
      // 🔥 BREAK VALIDATION
      //////////////////////////////////////////////////////
      const breaks = Array.isArray(d.breaks) ? d.breaks : [];

      for (let i = 0; i < breaks.length; i++) {
        const b = breaks[i];

        if (!b.start || !b.end) {
          return res.status(400).json({
            success: false,
            message: `${day}: invalid break`,
          });
        }

        if (toMinutes(b.start) >= toMinutes(b.end)) {
          return res.status(400).json({
            success: false,
            message: `${day}: break start must be before end`,
          });
        }

        if (toMinutes(b.start) < toMinutes(d.open) || toMinutes(b.end) > toMinutes(d.close)) {
          return res.status(400).json({
            success: false,
            message: `${day}: break must be within working hours`,
          });
        }

        // overlap check
        for (let j = i + 1; j < breaks.length; j++) {
          const next = breaks[j];

          if (!(toMinutes(b.end) <= toMinutes(next.start) || toMinutes(b.start) >= toMinutes(next.end))) {
            return res.status(400).json({
              success: false,
              message: `${day}: overlapping breaks`,
            });
          }
        }
      }

      //////////////////////////////////////////////////////
      // ✅ SAVE CLEAN DATA
      //////////////////////////////////////////////////////
      finalTimings[day] = {
        open: d.open,
        close: d.close,
        isClosed: false,
        breaks,
      };
    }

    //////////////////////////////////////////////////////
    // 💾 SAVE FINAL
    //////////////////////////////////////////////////////
    salon.timings = finalTimings;

    if (salon.onboarding.step < 5) {
      salon.onboarding.step = 5;
    }

    await salon.save();

    //////////////////////////////////////////////////////
    // 🗑️ CACHE INVALIDATION — timings changed, ALL future
    // dates' next-slot cache for this salon is now stale
    //////////////////////////////////////////////////////
    await invalidateAllNextSlotCache(salon._id.toString());


    //////////////////////////////////////////////////////
    // ✅ RESPONSE
    //////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Timings saved successfully",
      data: {
        onboardingStep: salon.onboarding.step,
      },
    });

  } catch (error) {
    console.error("SAVE_TIMINGS_ERROR:", {
      message: error.message,
      stack: error.stack,
    });

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP 6 — SAVE STAFF (ADVANCED)
///////////////////////////////////////////////////////////


export const saveStaff = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;
    const { staff = [], isOwnerOnly } = req.body;

    //////////////////////////////////////////////////////
    // 🔒 AUTH
    //////////////////////////////////////////////////////
    if (!ownerId) {
      throw new Error("Authentication required");
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId }).session(session);

    if (!salon) throw new Error("Salon not found");

    //////////////////////////////////////////////////////
    // 🔒 SALON STATUS LOCK
    //////////////////////////////////////////////////////
    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      throw new Error("Salon not editable");
    }

    //////////////////////////////////////////////////////
    // 🔁 STEP CHECK
    //////////////////////////////////////////////////////
    if (salon.onboarding?.step < 5) {
      throw new Error("Complete previous steps first");
    }

    //////////////////////////////////////////////////////
    // ❌ BOTH MODE CHECK
    //////////////////////////////////////////////////////
    if (isOwnerOnly && staff.length > 0) {
      throw new Error("Choose either owner-only or add staff");
    }

    //////////////////////////////////////////////////////
    // ❌ BLOCK SWITCH (STAFF → OWNER)
    //////////////////////////////////////////////////////
    if (isOwnerOnly) {
      // Soft delete existing staff — allow re-save in owner-only mode
      await Staff.updateMany(
        { salonId: salon._id, isDeleted: false },
        { $set: { isDeleted: true, updatedBy: ownerId } },
        { session }
      );
    }

    //////////////////////////////////////////////////////
    // 🧠 OWNER ONLY MODE
    //////////////////////////////////////////////////////
    if (isOwnerOnly === true) {
      const existingOwner = await Staff.findOne({
        salonId:   salon._id,
        createdBy: ownerId,
        isOwner:   true,
        isDeleted: false,
      }).session(session);

      if (!existingOwner) {
        // Get all salon services — owner barber can perform all services
        const allSalonServices = await Service.find({
          salonId: salon._id,
          isDeleted: false,
          isActive: true,
        }).select("_id").session(session).lean();

        const ownerSkills = allSalonServices.map(s => s._id);

        await Staff.create(
          [
            {
              salonId:   salon._id,
              name:      req.user.name?.trim() || "Owner",
              phone:     req.user.phone?.replace(/^\+91/, "").replace(/\D/g, "").slice(-10) || null,
              role:      "BARBER",
              skills:    ownerSkills,
              chairId:   null,
              createdBy: ownerId,
              updatedBy: ownerId,
              isOwner:   true,
            },
          ],
          { session }
        );
      }
    }

    //////////////////////////////////////////////////////
    // 👨‍🔧 NORMAL STAFF MODE
    //////////////////////////////////////////////////////
    else {
      if (!Array.isArray(staff) || staff.length === 0) {
        throw new Error("Staff array required");
      }

      //////////////////////////////////////////////////////
      // 🔁 DUPLICATE NAME CHECK
      //////////////////////////////////////////////////////
      const names = staff.map((s) =>
        s.name?.trim().toLowerCase()
      );

      if (new Set(names).size !== names.length) {
        throw new Error("Duplicate staff names in request");
      }

      //////////////////////////////////////////////////////
      // 🔁 DUPLICATE PHONE CHECK
      //////////////////////////////////////////////////////
      const phones = staff
        .map((s) => s.phone?.trim())
        .filter(Boolean);

      if (new Set(phones).size !== phones.length) {
        throw new Error("Duplicate phone numbers in request");
      }

      //////////////////////////////////////////////////////
      // 🛠 OBJECT ID VALIDATION
      //////////////////////////////////////////////////////
      const isValidObjectId = mongoose.Types.ObjectId.isValid;

      //////////////////////////////////////////////////////
      // 🛠 PREPARE DATA
      //////////////////////////////////////////////////////

      const normalizeStaffPhone = (p) => {
        if (!p) return null;
        let c = p.replace(/\D/g, "");
        if (c.startsWith("91") && c.length === 12) c = c.slice(2);
        return /^[6-9]\d{9}$/.test(c) ? c : null;
      };

      const allowedRoles = ["BARBER", "HELPER", "MANAGER"];

      // FIX: Duplicate chair assignment check
      const assignedChairs = staff.map(s => s.chairId).filter(Boolean);
      if (new Set(assignedChairs.map(String)).size !== assignedChairs.length) {
        throw new Error('Same chair cannot be assigned to multiple staff');
      }

      // FIX: Chair ownership validation
      if (assignedChairs.length > 0) {
        const validChairs = await Chair.countDocuments({
          _id: { $in: assignedChairs },
          salonId: salon._id,
          isDeleted: false,
          isActive: true,
        }).session(session);
        if (validChairs !== assignedChairs.length) {
          throw new Error('Invalid chair assignment');
        }
      }

      // FIX: Service ownership validation
      const allSkills = staff.flatMap(s => Array.isArray(s.skills) ? s.skills : []);
      if (allSkills.length > 0) {
        const validServices = await Service.countDocuments({
          _id: { $in: allSkills },
          salonId: salon._id,
          isDeleted: false,
          isActive: true,
        }).session(session);
        if (validServices !== allSkills.length) {
          throw new Error('Invalid service assignment');
        }
      }

      const staffDocs = staff.map((s) => {
        if (!s.name || !s.name.trim()) {
          throw new Error("Staff name required");
        }

        const role = allowedRoles.includes(s.role)
          ? s.role
          : "BARBER";

        if (role === "BARBER" && (!s.skills || s.skills.length === 0)) {
          throw new Error("Barber must have at least one skill");
        }

        if (s.chairId && !isValidObjectId(s.chairId)) {
          throw new Error("Invalid chairId");
        }

        if (Array.isArray(s.skills)) {
          for (const skill of s.skills) {
            if (!isValidObjectId(skill)) {
              throw new Error("Invalid serviceId in skills");
            }
          }
        }

        return {
          salonId: salon._id,
          name: s.name.trim(),
          phone: normalizeStaffPhone(s.phone),
          role,
          skills: Array.isArray(s.skills) ? s.skills : [],
          chairId:   s.chairId || null,
          createdBy: ownerId,
          updatedBy: ownerId,
        };
      });

      //////////////////////////////////////////////////////
      // 💾 INSERT
      //////////////////////////////////////////////////////
      // Soft delete existing staff before re-save
      await Staff.updateMany(
        { salonId: salon._id, isDeleted: false },
        { $set: { isDeleted: true, updatedBy: ownerId } },
        { session }
      );

      await Staff.insertMany(staffDocs, {
        session,
        ordered: true,
      });
    }

    //////////////////////////////////////////////////////
    // 🔄 UPDATE STEP → 6
    //////////////////////////////////////////////////////
    if (salon.onboarding.step < 6) {
      salon.onboarding.step = 6;
      await salon.save({ session, validateBeforeSave: false });
    }

    //////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////
    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////
    // 📤 RESPONSE (PRO LEVEL)
    //////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Staff saved successfully",
      data: {
        onboardingStep: salon.onboarding.step,
        mode: isOwnerOnly ? "OWNER_ONLY" : "STAFF_ADDED",
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("SAVE_STAFF_ERROR:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Duplicate staff (name or phone)",
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP -7 — SAVE SALON MEDIA (ADVANCED)
///////////////////////////////////////////////////////////

export const savePhotos = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;
    const { photos } = req.body;

    //////////////////////////////////////////////////////
    // 🔒 AUTH
    //////////////////////////////////////////////////////
    if (!ownerId) throw new Error("Authentication required");

    if (!Array.isArray(photos) || photos.length === 0) {
      throw new Error("Photos array required");
    }
    if (photos.length > 20) {
      throw new Error("Maximum 20 photos allowed");
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId }).session(session);

    if (!salon) throw new Error("Salon not found");

    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      throw new Error("Salon not editable");
    }

    if (salon.onboarding.step < 6) {
      throw new Error("Complete previous steps first");
    }

    //////////////////////////////////////////////////////
    // 🧠 VALIDATION
    //////////////////////////////////////////////////////
    const coverCount = photos.filter(p => p.type === "COVER").length;

    if (coverCount > 1) {
      throw new Error("Only one cover image allowed");
    }

    // ✅ URL validation + normalize
    const urls = photos.map(p => {
      if (!p.url) throw new Error("Image URL required");
      try { new URL(p.url.trim()); } catch { throw new Error("Invalid image URL: " + p.url); }
      return p.url.trim();
    });

    if (new Set(urls).size !== urls.length) {
      throw new Error("Duplicate image URLs in request");
    }

    //////////////////////////////////////////////////////
    // 🧠 PREPARE DATA
    //////////////////////////////////////////////////////
    const allowedTypes = ["COVER", "SHOP", "WORK", "CERTIFICATE"];

    const mediaDocs = photos.map((p, index) => {
      const type = allowedTypes.includes(p.type)
        ? p.type
        : "SHOP";

      return {
        salonId: salon._id,
        url: p.url.trim(),
        type,
        order: index + 1, // ✅ always safe sequential order
        createdBy: ownerId,
      };
    });

    //////////////////////////////////////////////////////
    // 🔄 SOFT DELETE OLD MEDIA (REPLACE MODE)
    //////////////////////////////////////////////////////
    await SalonMedia.updateMany(
      { salonId: salon._id, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          isActive: false,
        },
      },
      { session }
    );

    //////////////////////////////////////////////////////
    // 💾 INSERT NEW MEDIA
    //////////////////////////////////////////////////////
    await SalonMedia.insertMany(mediaDocs, { session });

    //////////////////////////////////////////////////////
    // 🔄 UPDATE STEP → 7
    //////////////////////////////////////////////////////
    if (salon.onboarding.step < 7) {
      salon.onboarding.step = 7;
      await salon.save({ session, validateBeforeSave: false });
    }

    //////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////
    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////
    // 📤 RESPONSE (PRO LEVEL)
    //////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Photos saved successfully",
      data: {
        totalPhotos: mediaDocs.length,
        onboardingStep: salon.onboarding.step,
        mode: "PHOTOS_UPDATED",
      },
    });

  } catch (error) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}

    console.error("SAVE_PHOTOS_ERROR:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP -7 — GET REVIEW  (ADVANCED)
///////////////////////////////////////////////////////////

export const getReview = async (req, res) => {
  try {
    const ownerId = req.user?._id;

    //////////////////////////////////////////////////////
    // 🔒 AUTH CHECK
    //////////////////////////////////////////////////////
    if (!ownerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON (SAFE + LEAN)
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId })
      .lean();

    if (!salon || !salon._id) {
      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    //////////////////////////////////////////////////////
    // 🔥 FETCH RELATED DATA (PARALLEL + OPTIMIZED)
    //////////////////////////////////////////////////////
    const [services, staff, media, chairs] = await Promise.all([
      Service.find({ salonId: salon._id, isDeleted: false, isActive: true })
        .select(
        "_id name price duration buffer category bookingCount description benefits suitableFor brandsUsed steps resultsDurationText thumbnailImage images beforeAfterImages introVideo applicableFor isFeatured"
        )
        .sort({ createdAt: 1 })
        .lean(),

      Staff.find({ salonId: salon._id, isDeleted: false })
        .select("_id name role chairId skills")
        .sort({ createdAt: 1 })
        .lean(),

      SalonMedia.find({ salonId: salon._id, isDeleted: false })
        .select("_id url type order")
        .sort({ order: 1 })
        .lean(),

      Chair.find({ salonId: salon._id, isDeleted: false, isActive: true })
          .select("_id name position")
          .sort({ position: 1 })
          .lean(),
    ]);
    

    //////////////////////////////////////////////////////
    // 📤 RESPONSE (CLEAN + SAFE)
    //////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      data: {
        salon,
        services: services.length ? services : [],
        staff: staff.length ? staff : [],
        media: media.length ? media : [],
        chairs:   chairs.length   ? chairs   : [],  // ← ADD
      },
    });

  } catch (error) {
    console.error("GET_REVIEW_ERROR:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

///////////////////////////////////////////////////////////
// 🔥 STEP -8 — SUBMIT FOR APPOVAL  (ADVANCED)
///////////////////////////////////////////////////////////

export const submitSalon = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ownerId = req.user?._id;

    //////////////////////////////////////////////////////
    // 🔒 AUTH
    //////////////////////////////////////////////////////
    if (!ownerId) {
      throw new Error("Authentication required");
    }

    //////////////////////////////////////////////////////
    // 🔍 GET SALON (LIGHTWEIGHT)
    //////////////////////////////////////////////////////
    const salon = await Salon.findOne({ ownerId })
      .select("_id onboarding approval")
      .session(session);

    if (!salon) {
      throw new Error("Salon not found");
    }

    //////////////////////////////////////////////////////
    // 🚫 STATUS CHECK (EARLY EXIT)
    //////////////////////////////////////////////////////
    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) {
      throw new Error("Already submitted or not editable");
    }

    //////////////////////////////////////////////////////
    // 🚫 STEP CHECK
    //////////////////////////////////////////////////////
    if (salon.onboarding?.step < 7) {
      throw new Error("Complete all steps before submit");
    }

    //////////////////////////////////////////////////////
    // 🔥 DATA COMPLETENESS CHECK (CONSISTENT READ)
    //////////////////////////////////////////////////////
    const [servicesCount, staffCount, mediaCount, chairsCount] = await Promise.all([
      Service.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      Staff.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      SalonMedia.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      Chair.countDocuments({ salonId: salon._id, isDeleted: false, isActive: true }).session(session),
    ]);

    if (servicesCount === 0 || staffCount === 0 || mediaCount === 0 || chairsCount === 0) {
      throw new Error("Complete all required data before submission");
    }

    //////////////////////////////////////////////////////
    // 🔥 ATOMIC UPDATE (NO DOUBLE SUBMIT)
    //////////////////////////////////////////////////////
    const updatedSalon = await Salon.findOneAndUpdate(
      {
        ownerId,
        "approval.status": "DRAFT",
      },
      {
        $set: {
          "approval.status": "PENDING",
          "approval.submittedAt": new Date(),
          "onboarding.completed": true,
        },
      },
      {
        new: true,
        session,
      }
    );

    if (!updatedSalon) {
      throw new Error("Already submitted or not editable");
    }

    //////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////
    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////
    // 📤 RESPONSE (FINAL)
    //////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Salon submitted for approval",
      data: {
        status: updatedSalon.approval.status,
        completed: true,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("SUBMIT_SALON_ERROR:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};