/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentOnboarding.service.js
 *
 * PHASE 2B — Field Agent salonId-scoped onboarding step-write service.
 *
 * Every function below is a line-by-line port of its namesake in the
 * FROZEN, UNTOUCHED controllers/salon.onboarding.controller.js — same
 * field names, same validation order, same transaction boundaries,
 * same sub-resource write logic (Service/Staff/Chair/SalonMedia, all
 * still keyed by the plain `salonId` field those models already have
 * — untouched, unmodified). The ONLY two structural differences,
 * applied uniformly and disclosed here once rather than at every call
 * site:
 *
 *   1. The target Salon is resolved via `Salon.findById(salonId)`
 *      (salonId supplied explicitly, already proven to belong to an
 *      active, non-terminal AcquisitionClaim for the calling Field
 *      Agent by requireActiveClaimForSalon.js) — NEVER via
 *      `findOne({ownerId})`. ownerId is never read from req.user here;
 *      it is always `salon.ownerId`, the real owner, exactly as it
 *      already was in the original (there, ownerId and salon.ownerId
 *      were always the same value by construction, since the salon was
 *      looked up BY that ownerId; here they are explicitly the same
 *      value, read directly off the resolved document instead).
 *
 *   2. Every `createdBy`/`updatedBy` attribution field that the
 *      original populated with `ownerId` is populated with
 *      `salon.ownerId` here — i.e. these audit fields still mean
 *      exactly what they meant before ("the salon's owner"), now
 *      sourced from the resolved Salon document instead of the
 *      caller's own session (the caller is a Field Agent, never the
 *      owner, and must never be written into an ownership/attribution
 *      field anywhere — see Phase 1's own locked invariant).
 *
 * ONE further, narrower adaptation, confirmed necessary only inside
 * saveStaff's own "owner-only" branch: the original reads
 * `req.user.name`/`req.user.phone` to name/phone the auto-created
 * "Owner" Staff document, because in the original flow the caller IS
 * the owner. Here the caller is the Field Agent (whose JWT payload
 * does not even carry name/phone — see middlewares/auth.middleware.js's
 * own req.user shape), so this function fetches the REAL owner's
 * name/phone from `User.findById(salon.ownerId)` instead. This writes
 * the identical kind of value (the owner's own name/phone) the
 * original always intended — it is a required correction for a
 * caller-identity swap the original function's own code never
 * anticipated, not a new rule.
 *
 * Error-code normalization (disclosed, minor, deliberate — see the
 * Phase 2B report's own "Status / Submit / Resubmit Behavior"
 * section): the original returns an inconsistent mix of 400 vs 404
 * for "Salon not found" across its 9 functions (saveLocation/
 * saveTimings/getReview use 404; saveChairs/saveStaff/savePhotos fall
 * through a generic catch to 400). Every function here uses
 * Errors.notFound (404) for that case uniformly — in practice
 * unreachable anyway, since requireActiveClaimForSalon.js already
 * proves the salon exists before any of these run; this only
 * harmonizes an edge the original itself was inconsistent about, never
 * removes or weakens the "complete previous steps" / "salon not
 * editable" state checks themselves, which are preserved VERBATIM
 * (same conditions, same approval-status allow-list, same step
 * thresholds) via Errors.badRequest (400), matching the original's own
 * status code for those two checks exactly.
 */

import mongoose from "mongoose";
import Chair from "../../../models/Chair.js";
import Salon from "../../../models/Salon.js";
import SalonMedia from "../../../models/SalonMedia.js";
import Service from "../../../models/Service.js";
import Staff from "../../../models/Staff.js";
import User from "../../../models/User.js";
import { assignAdminByDistrict } from "../../../services/adminAssign.service.js";
import geoService from "../../../services/geo.service.js";
import { invalidateAllNextSlotCache } from "../../../services/slotEngine.service.js";
import logger from "../../../utils/logger.js";
import { Errors } from "../../../utils/response.js";

// Same allow-list every editable step in the original enforces
// (controller lines 405/755/914/1118/1400/1624) — ported verbatim.
const EDITABLE_STATUSES = ["DRAFT", "APPROVED"];

const generateSearchTags = (name, category, applicableFor) => {
  const tags = new Set();
  const nameWords = name.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1);
  nameWords.forEach((w) => tags.add(w));
  if (nameWords.length > 1) tags.add(name.toLowerCase().trim());
  if (category) tags.add(category.toLowerCase().replace(/_/g, " "));
  if (applicableFor === "MEN") tags.add("men");
  if (applicableFor === "WOMEN") tags.add("women");
  return Array.from(tags);
};

const requireSalon = async (salonId, { session } = {}) => {
  const query = Salon.findById(salonId);
  if (session) query.session(session);
  const salon = await query;
  if (!salon) throw Errors.notFound("Salon not found");
  return salon;
};

const assertEditable = (salon) => {
  if (!EDITABLE_STATUSES.includes(salon.approval?.status)) {
    throw Errors.badRequest("Salon not editable");
  }
};

// ─── STEP 1 — BASIC INFO ──────────────────────────────────────────
// Port of saveBasicInfo (controller:21-163). No approval-status gate
// and no step-threshold gate in the original — none added here.
export const saveBasicInfo = async ({ salonId, body }) => {
  const { shopName, category, tagline, since, amenities, tier, setupType, specializations, capabilities, privacySetup, whatsapp, brandName, branchCode, experience } = body;

  if (!shopName || !category) throw Errors.badRequest("shopName and category required");

  const cleanName = shopName.trim();
  const cleanCategory = category.trim().toUpperCase();
  const cleanTagline = tagline?.trim() || null;
  if (cleanName.length < 3) throw Errors.badRequest("Shop name too short");

  const allowedCategories = ["MEN_ONLY", "WOMEN_ONLY", "UNISEX"];
  const finalCategory = allowedCategories.includes(cleanCategory) ? cleanCategory : "UNISEX";
  const allowedSalonTypes = ["STANDARD", "PREMIUM", "LUXURY"];
  const finalTier = allowedSalonTypes.includes(tier) ? tier : "STANDARD";
  const allowedSetupTypes = ["PROPER_SHOP", "OPEN_SETUP"];
  const finalSetupType = allowedSetupTypes.includes(setupType) ? setupType : "PROPER_SHOP";
  const allowedPrivacy = ["SEPARATE", "MIXED"];
  const finalPrivacy = allowedPrivacy.includes(privacySetup) ? privacySetup : "MIXED";

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
    specializations: Array.isArray(specializations) ? specializations : [],
    capabilities: Array.isArray(capabilities) ? capabilities : [],
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
    $max: { "onboarding.step": 1 },
  };

  const salon = await Salon.findOneAndUpdate(
    { _id: salonId },
    { $set: updatePayload },
    { new: true, runValidators: false }
  );
  if (!salon) throw Errors.notFound("Salon not found");

  return {
    salonId: salon._id,
    onboardingStep: salon.onboarding?.step,
    status: salon.approval?.status,
    basicInfo: salon.basicInfo,
  };
};

// ─── STEP 2 — LOCATION ─────────────────────────────────────────────
// Port of saveLocation (controller:169-307). Same geoService/
// assignAdminByDistrict dependencies, called identically.
export const saveLocation = async ({ salonId, body }) => {
  const { address, lat, lng } = body;
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    throw Errors.badRequest("Valid lat & lng required");
  }

  const location = await geoService.detectLocation(latNum, lngNum);
  if (!location) throw Errors.badRequest("Service not available in this area");

  const existingSalon = await Salon.findById(salonId).select("assignedAdmin").lean();
  if (!existingSalon) throw Errors.notFound("Salon not found");
  if (existingSalon.assignedAdmin) {
    await User.findByIdAndUpdate(existingSalon.assignedAdmin, { $unset: { lastAssignedAt: 1 } });
  }

  const admin = await assignAdminByDistrict({ districtRef: location.districtRef, stateRef: location.stateRef });
  const validAdmin = admin && mongoose.Types.ObjectId.isValid(admin) ? admin : null;

  const salon = await Salon.findOneAndUpdate(
    { _id: salonId },
    {
      $set: {
        "location.address": address?.trim() || null,
        "location.geo": { type: "Point", coordinates: [lngNum, latNum] },
        "location.territory.countryRef": location.countryRef,
        "location.territory.stateRef": location.stateRef,
        "location.territory.districtRef": location.districtRef,
        "location.territory.cityRef": location.cityRef,
        "location.territory.pincodeRef": location.pincodeRef,
        assignedAdmin: validAdmin,
      },
      $max: { "onboarding.step": 2 },
    },
    { new: true, runValidators: false }
  );
  if (!salon) throw Errors.notFound("Salon not found");

  return {
    cityRef: location.cityRef,
    districtRef: location.districtRef,
    stateRef: location.stateRef,
    pincodeRef: location.pincodeRef,
    onboardingStep: salon?.onboarding?.step || 2,
    assignedAdmin: validAdmin,
  };
};

// ─── STEP 3 — SERVICES (transaction-safe) ─────────────────────────
// Port of saveServices (controller:334-700).
export const saveServices = async ({ salonId, body }) => {
  const { services } = body;
  if (!Array.isArray(services) || services.length === 0) throw Errors.badRequest("Services array required");

  const names = services.map((s) => s.name?.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw Errors.badRequest("Duplicate service names in request");

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await requireSalon(salonId, { session });
    assertEditable(salon);
    if (salon.onboarding?.step < 2) throw Errors.badRequest("Complete previous steps first");

    const ownerId = salon.ownerId;

    const existingServices = await Service.find({ salonId: salon._id, isDeleted: false }).select("_id").session(session).lean();
    const existingById = new Map(existingServices.map((s) => [s._id.toString(), s]));

    const updateOps = [];
    const newDocs = [];
    const keptIds = new Set();

    for (const item of services) {
      if (!item.name || isNaN(Number(item.price)) || Number(item.price) <= 0 || isNaN(Number(item.duration)) || Number(item.duration) <= 0) {
        throw Errors.badRequest("Invalid service data");
      }
      if (item.bufferMin !== undefined && item.bufferMax !== undefined && item.bufferMin > item.bufferMax) {
        throw Errors.badRequest("Invalid buffer range");
      }
      for (const graceField of ["autoCompleteGraceMinutes", "autoNoShowGraceMinutes"]) {
        const value = item[graceField];
        if (value !== undefined && value !== null) {
          if (!Number.isInteger(value) || value < 0 || value > 120) {
            throw Errors.badRequest(`Invalid ${graceField} — must be a whole number between 0 and 120`);
          }
        }
      }

      const name = item.name.trim().toLowerCase();
      const category = item.category ? item.category.trim().toUpperCase() : "OTHER";
      const applicableFor = item.applicableFor || "BOTH";

      const fields = {
        name,
        price: Math.round(item.price),
        duration: item.duration,
        buffer: item.buffer ?? 5,
        bufferMin: item.bufferMin ?? 5,
        bufferMax: item.bufferMax ?? 15,
        autoCompleteGraceMinutes: item.autoCompleteGraceMinutes ?? null,
        autoNoShowGraceMinutes: item.autoNoShowGraceMinutes ?? null,
        category,
        applicableFor,
        isActive: item.isActive !== false,
        thumbnailImage: item.thumbnailImage || null,
        description: item.description || "",
        benefits: Array.isArray(item.benefits) ? item.benefits : [],
        suitableFor: Array.isArray(item.suitableFor) ? item.suitableFor : [],
        brandsUsed: Array.isArray(item.brandsUsed) ? item.brandsUsed : [],
        steps: Array.isArray(item.steps) ? item.steps : [],
        resultsDurationText: item.resultsDurationText || "",
        images: Array.isArray(item.images) ? item.images : [],
        beforeAfterImages: Array.isArray(item.beforeAfterImages) ? item.beforeAfterImages : [],
        introVideo: item.introVideo || null,
        searchTags: generateSearchTags(name, category, applicableFor),
        isFeatured: item.isFeatured || false,
        updatedBy: ownerId,
      };

      const existing = item._id && existingById.get(item._id.toString());
      if (existing) {
        keptIds.add(existing._id.toString());
        updateOps.push({ id: existing._id, fields });
      } else {
        newDocs.push({ ...fields, salonId: salon._id, createdBy: ownerId });
      }
    }

    const removedIds = existingServices.map((s) => s._id.toString()).filter((id) => !keptIds.has(id));
    if (removedIds.length > 0) {
      await Service.updateMany({ _id: { $in: removedIds }, salonId: salon._id }, { $set: { isDeleted: true, isActive: false, updatedBy: ownerId } }, { session });
    }

    for (const { id, fields } of updateOps) {
      const updated = await Service.findOneAndUpdate({ _id: id, salonId: salon._id }, { $set: fields }, { session, runValidators: true });
      if (!updated) throw new Error(`Service not found for update: ${id}`);
    }
    if (newDocs.length > 0) await Service.insertMany(newDocs, { session, ordered: true });

    const totalProcessed = updateOps.length + newDocs.length;
    logger.info("FIELD_AGENT_SAVE_SERVICES_SUCCESS", { salonId: salon._id.toString(), updated: updateOps.length, created: newDocs.length, removed: removedIds.length });

    if (salon.onboarding.step < 3) {
      salon.onboarding.step = 3;
      await salon.save({ session, validateBeforeSave: false });
    }

    await session.commitTransaction();
    return { totalServices: totalProcessed, onboardingStep: salon.onboarding.step };
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) throw Errors.badRequest("Duplicate service name");
    throw err;
  } finally {
    session.endSession();
  }
};

// ─── STEP 4 — CHAIRS ───────────────────────────────────────────────
// Port of saveChairs (controller:703-870) — INCLUDING its own unusual
// "abort the first transaction, delete outside any transaction, then
// insert inside a second, separate transaction" structure. Preserved
// verbatim, not refactored, exactly as the ticket requires.
export const saveChairs = async ({ salonId, body }) => {
  const { chairCount } = body;
  if (!chairCount || Number(chairCount) < 1 || Number(chairCount) > 50) {
    throw Errors.badRequest("Valid chairCount required");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await requireSalon(salonId, { session });
    assertEditable(salon);
    if (salon.onboarding?.step < 3) throw Errors.badRequest("Complete previous steps first");

    const ownerId = salon.ownerId;

    const chairDocs = Array.from({ length: Number(chairCount) }, (_, index) => ({
      salonId: salon._id,
      chairCode: `${salon._id.toString().slice(-6)}-CHR-${String(index + 1).padStart(3, "0")}`,
      name: `Chair ${index + 1}`,
      position: index + 1,
      photo: { url: null, publicId: null },
      barberId: null,
      skills: [],
      priority: 1,
      createdBy: ownerId,
    }));

    // Same "abort, delete outside any transaction, insert in a fresh
    // one" idiom as the original — see controller:789-834's own comment.
    await session.abortTransaction();
    session.endSession();

    await Chair.deleteMany({ salonId: salon._id });

    await Salon.findOneAndUpdate(
      { _id: salonId },
      { $max: { "onboarding.step": 4 }, $set: { chairCount: Number(chairCount) } },
      { runValidators: false }
    );

    const session2 = await mongoose.startSession();
    session2.startTransaction();
    try {
      await Chair.insertMany(chairDocs, { session: session2, ordered: true });
      await session2.commitTransaction();
    } catch (insertErr) {
      await session2.abortTransaction();
      throw insertErr;
    } finally {
      session2.endSession();
    }

    return {
      totalChairs: chairDocs.length,
      onboardingStep: 4,
      chairs: chairDocs.map((c) => ({ chairCode: c.chairCode, name: c.name, position: c.position })),
    };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch {}
    session.endSession();
    if (err.code === 11000) throw Errors.badRequest("Duplicate chair name or position");
    throw err;
  }
};

// ─── STEP 5 — TIMINGS ──────────────────────────────────────────────
// Port of saveTimings (controller:876-1085).
export const saveTimings = async ({ salonId, body }) => {
  const { timings } = body;
  const toMinutes = (time) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };

  if (!timings || typeof timings !== "object") throw Errors.badRequest("Timings object required");

  const salon = await requireSalon(salonId);
  assertEditable(salon);
  if (salon.onboarding?.step < 4) throw Errors.badRequest("Complete previous steps first");

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const finalTimings = {};

  for (const day of days) {
    const d = timings[day];
    if (!d) { finalTimings[day] = { isClosed: true }; continue; }
    if (d.isClosed) { finalTimings[day] = { isClosed: true }; continue; }

    const isOpen24Hours = !!d.isOpen24Hours;
    const dayOpen = isOpen24Hours ? "00:00" : d.open;
    const dayClose = isOpen24Hours ? "23:59" : d.close;

    if (!isOpen24Hours) {
      if (!dayOpen || !dayClose) throw Errors.badRequest(`${day}: open & close required`);
    }

    const closeMinutesForCompare = dayClose === "00:00" ? 24 * 60 : toMinutes(dayClose);
    if (!isOpen24Hours) {
      if (toMinutes(dayOpen) >= closeMinutesForCompare) throw Errors.badRequest(`${day}: open must be before close`);
    }

    const breaks = Array.isArray(d.breaks) ? d.breaks : [];
    for (let i = 0; i < breaks.length; i++) {
      const b = breaks[i];
      if (!b.start || !b.end) throw Errors.badRequest(`${day}: invalid break`);
      if (toMinutes(b.start) >= toMinutes(b.end)) throw Errors.badRequest(`${day}: break start must be before end`);
      if (toMinutes(b.start) < toMinutes(dayOpen) || toMinutes(b.end) > closeMinutesForCompare) {
        throw Errors.badRequest(`${day}: break must be within working hours`);
      }
      for (let j = i + 1; j < breaks.length; j++) {
        const next = breaks[j];
        if (!(toMinutes(b.end) <= toMinutes(next.start) || toMinutes(b.start) >= toMinutes(next.end))) {
          throw Errors.badRequest(`${day}: overlapping breaks`);
        }
      }
    }

    finalTimings[day] = { open: dayOpen, close: dayClose, isClosed: false, isOpen24Hours, breaks };
  }

  salon.timings = finalTimings;
  if (salon.onboarding.step < 5) salon.onboarding.step = 5;
  await salon.save();

  await invalidateAllNextSlotCache(salon._id.toString());

  return { onboardingStep: salon.onboarding.step };
};

// ─── STEP 6 — STAFF ─────────────────────────────────────────────────
// Port of saveStaff (controller:1092-1366). See this file's own
// header for the one disclosed adaptation inside the owner-only
// branch (owner name/phone read from User.findById(salon.ownerId),
// not from req.user).
export const saveStaff = async ({ salonId, body }) => {
  const { staff = [], isOwnerOnly } = body;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await requireSalon(salonId, { session });
    assertEditable(salon);
    if (salon.onboarding?.step < 5) throw Errors.badRequest("Complete previous steps first");
    if (isOwnerOnly && staff.length > 0) throw Errors.badRequest("Choose either owner-only or add staff");

    const ownerId = salon.ownerId;

    if (isOwnerOnly) {
      await Staff.updateMany({ salonId: salon._id, isDeleted: false }, { $set: { isDeleted: true, updatedBy: ownerId } }, { session });
    }

    if (isOwnerOnly === true) {
      const existingOwner = await Staff.findOne({ salonId: salon._id, createdBy: ownerId, isOwner: true, isDeleted: false }).session(session);
      if (!existingOwner) {
        const allSalonServices = await Service.find({ salonId: salon._id, isDeleted: false, isActive: true }).select("_id").session(session).lean();
        const ownerSkills = allSalonServices.map((s) => s._id);

        // Disclosed adaptation — see file header: the caller (Field
        // Agent) has no name/phone in req.user; the real OWNER's own
        // identity is read explicitly instead, since this Staff
        // document must carry the owner's name/phone, not the agent's.
        const ownerUser = await User.findById(ownerId).select("name phone").lean();

        await Staff.create(
          [
            {
              salonId: salon._id,
              name: ownerUser?.name?.trim() || "Owner",
              phone: ownerUser?.phone?.replace(/^\+91/, "").replace(/\D/g, "").slice(-10) || null,
              role: "BARBER",
              skills: ownerSkills,
              chairId: null,
              createdBy: ownerId,
              updatedBy: ownerId,
              isOwner: true,
            },
          ],
          { session }
        );
      }
    } else {
      if (!Array.isArray(staff) || staff.length === 0) throw Errors.badRequest("Staff array required");

      const names = staff.map((s) => s.name?.trim().toLowerCase());
      if (new Set(names).size !== names.length) throw Errors.badRequest("Duplicate staff names in request");

      const phones = staff.map((s) => s.phone?.trim()).filter(Boolean);
      if (new Set(phones).size !== phones.length) throw Errors.badRequest("Duplicate phone numbers in request");

      const isValidObjectId = mongoose.Types.ObjectId.isValid;
      const normalizeStaffPhone = (p) => {
        if (!p) return null;
        let c = p.replace(/\D/g, "");
        if (c.startsWith("91") && c.length === 12) c = c.slice(2);
        return /^[6-9]\d{9}$/.test(c) ? c : null;
      };
      const allowedRoles = ["BARBER", "HELPER", "MANAGER"];

      const assignedChairs = staff.map((s) => s.chairId).filter(Boolean);
      if (new Set(assignedChairs.map(String)).size !== assignedChairs.length) throw Errors.badRequest("Same chair cannot be assigned to multiple staff");

      if (assignedChairs.length > 0) {
        const validChairs = await Chair.countDocuments({ _id: { $in: assignedChairs }, salonId: salon._id, isDeleted: false, isActive: true }).session(session);
        if (validChairs !== assignedChairs.length) throw Errors.badRequest("Invalid chair assignment");
      }

      const allSkills = staff.flatMap((s) => (Array.isArray(s.skills) ? s.skills : []));
      if (allSkills.length > 0) {
        const validServices = await Service.countDocuments({ _id: { $in: allSkills }, salonId: salon._id, isDeleted: false, isActive: true }).session(session);
        if (validServices !== allSkills.length) throw Errors.badRequest("Invalid service assignment");
      }

      const staffDocs = staff.map((s) => {
        if (!s.name || !s.name.trim()) throw Errors.badRequest("Staff name required");
        const role = allowedRoles.includes(s.role) ? s.role : "BARBER";
        if (role === "BARBER" && (!s.skills || s.skills.length === 0)) throw Errors.badRequest("Barber must have at least one skill");
        if (s.chairId && !isValidObjectId(s.chairId)) throw Errors.badRequest("Invalid chairId");
        if (Array.isArray(s.skills)) {
          for (const skill of s.skills) {
            if (!isValidObjectId(skill)) throw Errors.badRequest("Invalid serviceId in skills");
          }
        }
        return {
          salonId: salon._id,
          name: s.name.trim(),
          phone: normalizeStaffPhone(s.phone),
          role,
          skills: Array.isArray(s.skills) ? s.skills : [],
          chairId: s.chairId || null,
          createdBy: ownerId,
          updatedBy: ownerId,
        };
      });

      await Staff.updateMany({ salonId: salon._id, isDeleted: false }, { $set: { isDeleted: true, updatedBy: ownerId } }, { session });
      await Staff.insertMany(staffDocs, { session, ordered: true });
    }

    if (salon.onboarding.step < 6) {
      salon.onboarding.step = 6;
      await salon.save({ session, validateBeforeSave: false });
    }

    await session.commitTransaction();
    return { onboardingStep: salon.onboarding.step, mode: isOwnerOnly ? "OWNER_ONLY" : "STAFF_ADDED" };
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) throw Errors.badRequest("Duplicate staff (name or phone)");
    throw err;
  } finally {
    session.endSession();
  }
};

// ─── STEP 7 — PHOTOS ────────────────────────────────────────────────
// Port of savePhotos (controller:1372-1506).
export const savePhotos = async ({ salonId, body }) => {
  const { photos } = body;
  if (!Array.isArray(photos) || photos.length === 0) throw Errors.badRequest("Photos array required");
  if (photos.length > 20) throw Errors.badRequest("Maximum 20 photos allowed");

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await requireSalon(salonId, { session });
    assertEditable(salon);
    if (salon.onboarding.step < 6) throw Errors.badRequest("Complete previous steps first");

    const ownerId = salon.ownerId;

    const coverCount = photos.filter((p) => p.type === "COVER").length;
    if (coverCount > 1) throw Errors.badRequest("Only one cover image allowed");

    const urls = photos.map((p) => {
      if (!p.url) throw Errors.badRequest("Image URL required");
      try { new URL(p.url.trim()); } catch { throw Errors.badRequest("Invalid image URL: " + p.url); }
      return p.url.trim();
    });
    if (new Set(urls).size !== urls.length) throw Errors.badRequest("Duplicate image URLs in request");

    const allowedTypes = ["COVER", "SHOP", "WORK", "CERTIFICATE"];
    const mediaDocs = photos.map((p, index) => ({
      salonId: salon._id,
      url: p.url.trim(),
      type: allowedTypes.includes(p.type) ? p.type : "SHOP",
      order: index + 1,
      createdBy: ownerId,
    }));

    await SalonMedia.updateMany({ salonId: salon._id, isDeleted: false }, { $set: { isDeleted: true, isActive: false } }, { session });
    await SalonMedia.insertMany(mediaDocs, { session });

    if (salon.onboarding.step < 7) {
      salon.onboarding.step = 7;
      await salon.save({ session, validateBeforeSave: false });
    }

    await session.commitTransaction();
    return { totalPhotos: mediaDocs.length, onboardingStep: salon.onboarding.step, mode: "PHOTOS_UPDATED" };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch {}
    throw err;
  } finally {
    session.endSession();
  }
};

// ─── STEP 8 — REVIEW (read-only) ───────────────────────────────────
// Port of getReview (controller:1512-1589). No approval-status gate
// in the original — none added here.
export const getReview = async ({ salonId }) => {
  const salon = await Salon.findById(salonId).lean();
  if (!salon || !salon._id) throw Errors.notFound("Salon not found");

  const [services, staff, media, chairs] = await Promise.all([
    Service.find({ salonId: salon._id, isDeleted: false, isActive: true })
      .select("_id name price duration buffer category bookingCount description benefits suitableFor brandsUsed steps resultsDurationText thumbnailImage images beforeAfterImages introVideo applicableFor isFeatured")
      .sort({ createdAt: 1 }).lean(),
    Staff.find({ salonId: salon._id, isDeleted: false }).select("_id name role chairId skills").sort({ createdAt: 1 }).lean(),
    SalonMedia.find({ salonId: salon._id, isDeleted: false }).select("_id url type order").sort({ order: 1 }).lean(),
    Chair.find({ salonId: salon._id, isDeleted: false, isActive: true }).select("_id name position").sort({ position: 1 }).lean(),
  ]);

  return { salon, services, staff, media, chairs };
};

// ─── SUBMIT ─────────────────────────────────────────────────────────
// Port of submitSalon (controller:1595-1703). Completeness rules
// (services/staff/media/chairs counts, all keyed by salonId already)
// preserved verbatim.
export const submitSalon = async ({ salonId }) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const salon = await Salon.findById(salonId).select("_id onboarding approval").session(session);
    if (!salon) throw Errors.notFound("Salon not found");

    if (!["DRAFT", "APPROVED"].includes(salon.approval?.status)) throw Errors.badRequest("Already submitted or not editable");
    if (salon.onboarding?.step < 7) throw Errors.badRequest("Complete all steps before submit");

    const [servicesCount, staffCount, mediaCount, chairsCount] = await Promise.all([
      Service.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      Staff.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      SalonMedia.countDocuments({ salonId: salon._id, isDeleted: false }).session(session),
      Chair.countDocuments({ salonId: salon._id, isDeleted: false, isActive: true }).session(session),
    ]);
    if (servicesCount === 0 || staffCount === 0 || mediaCount === 0 || chairsCount === 0) {
      throw Errors.badRequest("Complete all required data before submission");
    }

    const updatedSalon = await Salon.findOneAndUpdate(
      { _id: salonId, "approval.status": "DRAFT" },
      { $set: { "approval.status": "PENDING", "approval.submittedAt": new Date(), "onboarding.completed": true } },
      { new: true, session }
    );
    if (!updatedSalon) throw Errors.badRequest("Already submitted or not editable");

    await session.commitTransaction();
    return { status: updatedSalon.approval.status, completed: true };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

// ─── RESUBMIT ───────────────────────────────────────────────────────
// Port of resubmitOnboarding (controller:1715-1761).
export const resubmitOnboarding = async ({ salonId }) => {
  const salon = await Salon.findById(salonId);
  if (!salon) throw Errors.notFound("Salon not found");
  if (salon.approval?.status !== "REJECTED") throw Errors.badRequest("Salon is not in a rejected state");

  salon.approval.status = "DRAFT";
  await salon.save({ validateBeforeSave: false });

  return { status: salon.approval.status, onboardingStep: salon.onboarding?.step ?? 0 };
};
