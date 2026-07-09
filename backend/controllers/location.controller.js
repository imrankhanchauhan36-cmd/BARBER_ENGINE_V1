/**
 * BARBER ENGINE V1
 * backend/controllers/location.controller.js
 * City + Area Controller — Location Module — 10/10 FROZEN
 */

import mongoose from "mongoose";
import Area from "../models/Area.js";
import City from "../models/City.js";
import District from "../models/District.js";
import { Errors, successResponse } from "../utils/response.js";

const isValidId   = (id)  => mongoose.Types.ObjectId.isValid(id);
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sort whitelists
const CITY_SORT_MAP = {
  name:    { name: 1 },
  newest:  { createdAt: -1 },
  oldest:  { createdAt: 1 },
  areas:   { areaCount: -1 },
};

const AREA_SORT_MAP = {
  name:    { name: 1 },
  newest:  { createdAt: -1 },
  oldest:  { createdAt: 1 },
  pincode: { pincode: 1 },
};

///////////////////////////////////////////////////////////////
// 🏙️ CITIES
///////////////////////////////////////////////////////////////

/**
 * GET /api/locations/cities
 */
export const getCities = async (req, res, next) => {
  try {
    const {
      page       = 1,
      limit      = 20,
      sort       = "name",
      search     = "",
      districtId,
      stateId,
      isActive,
    } = req.query;

    const pageNum  = Math.max(parseInt(page,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;
    const sortQ    = CITY_SORT_MAP[sort] || CITY_SORT_MAP.name;

    const filter = {};
    if (search)    filter.name        = { $regex: escapeRegex(search), $options: "i" };
    if (districtId && isValidId(districtId)) filter.districtRef = districtId;
    if (stateId    && isValidId(stateId))    filter.stateRef    = stateId;
    if (isActive !== undefined) filter.isActive = isActive === "true";

    // ✅ Scope
    if (req.user.adminLevel === "STATE")    filter.stateRef    = req.user.stateRef;
    if (req.user.adminLevel === "DISTRICT") filter.districtRef = req.user.districtRef;

    const [cities, total] = await Promise.all([
      City.find(filter)
        .populate("districtRef", "name")
        .populate("stateRef",    "name")
        .sort(sortQ)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      City.countDocuments(filter),
    ]);

    // Area count per city — N+1 avoid
    const cityIds  = cities.map(c => c._id);
    const areaAggs = await Area.aggregate([
      { $match: { cityRef: { $in: cityIds }, isActive: { $ne: false } } },
      { $group: { _id: "$cityRef", count: { $sum: 1 } } },
    ]);
    const areaMap = Object.fromEntries(areaAggs.map(a => [String(a._id), a.count]));

    return successResponse(res, {
      message: "Cities fetched",
      data: cities.map(c => ({
        id:         c._id,
        name:       c.name,
        pincode:    c.pincode    ?? null,
        district:   { id: c.districtRef?._id, name: c.districtRef?.name },
        state:      { id: c.stateRef?._id,    name: c.stateRef?.name    },
        isActive:   c.isActive,
        areaCount:  areaMap[String(c._id)] ?? 0,
        createdAt:  c.createdAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/locations/cities/:id
 */
export const getCityById = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid city ID"));

    const city = await City.findById(req.params.id)
      .populate("districtRef", "name")
      .populate("stateRef",    "name")
      .lean();
    if (!city) return next(Errors.notFound("City not found"));

    // Scope check
    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(city.stateRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(city.districtRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }

    const areaCount = await Area.countDocuments({ cityRef: city._id, isActive: { $ne: false } });

    return successResponse(res, {
      message: "City fetched",
      data: {
        id:         city._id,
        name:       city.name,
        pincode:    city.pincode    ?? null,
        district:   { id: city.districtRef?._id, name: city.districtRef?.name },
        state:      { id: city.stateRef?._id,    name: city.stateRef?.name    },
        isActive:   city.isActive,
        areaCount,
        createdAt:  city.createdAt,
        updatedAt:  city.updatedAt,
      },
    });
  } catch (err) { next(err) }
};

/**
 * POST /api/locations/cities
 */
export const createCity = async (req, res, next) => {
  try {
    let { name, districtId, stateId, pincode } = req.body;

    if (!name || !districtId || !stateId) {
      return next(Errors.badRequest("Required fields: name, districtId, stateId"));
    }
    if (!isValidId(districtId)) return next(Errors.badRequest("Invalid districtId"));
    if (!isValidId(stateId))    return next(Errors.badRequest("Invalid stateId"));

    name = name.trim().replace(/\s+/g, " ");

    // Scope check — STATE admin
    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(stateId)) {
      return next(Errors.forbidden("You can only create cities in your own state"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(districtId)) {
      return next(Errors.forbidden("You can only create cities in your own district"));
    }

    // District exists + active
    const district = await District.findById(districtId).lean();
    if (!district || !district.isActive) return next(Errors.notFound("District not found or inactive"));
    if (String(district.stateRef) !== String(stateId)) return next(Errors.badRequest("District does not belong to this state"));

    // Duplicate check
    const existing = await City.findOne({
      name:        { $regex: `^${escapeRegex(name)}$`, $options: "i" },
      districtRef: districtId,
    });
    if (existing) return next(Errors.conflict(`City "${name}" already exists in this district`));

    // Pincode validation
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return next(Errors.badRequest("Pincode must be exactly 6 digits"));
    }

    const city = await City.create({
      name,
      districtRef: districtId,
      stateRef:    stateId,
      pincode:     pincode || null,
      createdBy:   req.user.id,
      isActive:    true,
    });

    return successResponse(res, {
      message: `City "${name}" created`,
      data: {
        id:       city._id,
        name:     city.name,
        pincode:  city.pincode,
        district: { id: districtId },
        state:    { id: stateId },
        isActive: city.isActive,
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /api/locations/cities/:id
 */
export const updateCity = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid city ID"));

    const { name, isActive, pincode } = req.body;
    const updates = {};

    if (name !== undefined) {
      const trimmed = name.trim().replace(/\s+/g, " ");
      const city    = await City.findById(req.params.id).lean();
      if (!city) return next(Errors.notFound("City not found"));

      // ✅ Fix 1 — Scope authorization in updateCity
      if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(city.stateRef)) {
        return next(Errors.forbidden("You can only update cities in your own state"));
      }
      if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(city.districtRef)) {
        return next(Errors.forbidden("You can only update cities in your own district"));
      }

      const existing = await City.findOne({
        name:        { $regex: `^${escapeRegex(trimmed)}$`, $options: "i" },
        districtRef: city.districtRef,
        _id:         { $ne: req.params.id },
      });
      if (existing) return next(Errors.conflict(`City "${trimmed}" already exists in this district`));
      updates.name = trimmed;
    }

    if (pincode !== undefined) {
      if (pincode && !/^\d{6}$/.test(pincode)) {
        return next(Errors.badRequest("Pincode must be exactly 6 digits"));
      }
      updates.pincode = pincode || null;
    }

    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const city = await City.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("districtRef", "name").populate("stateRef", "name");

    if (!city) return next(Errors.notFound("City not found"));

    return successResponse(res, {
      message: "City updated",
      data: {
        id:       city._id,
        name:     city.name,
        pincode:  city.pincode,
        district: { id: city.districtRef?._id, name: city.districtRef?.name },
        state:    { id: city.stateRef?._id,    name: city.stateRef?.name    },
        isActive: city.isActive,
      },
    });
  } catch (err) { next(err) }
};

/**
 * DELETE /api/locations/cities/:id
 * Soft delete — check areas first
 */
export const deleteCity = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid city ID"));

    // ✅ Fix 2 — Scope authorization in deleteCity
    const cityToDelete = await City.findById(req.params.id).lean();
    if (!cityToDelete) return next(Errors.notFound("City not found"));

    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(cityToDelete.stateRef)) {
      return next(Errors.forbidden("You can only delete cities in your own state"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(cityToDelete.districtRef)) {
      return next(Errors.forbidden("You can only delete cities in your own district"));
    }

    // ✅ Fix 3 — Count only active areas
    const areaCount = await Area.countDocuments({ cityRef: req.params.id, isActive: { $ne: false } });
    if (areaCount > 0) {
      return next(Errors.conflict(`Cannot delete — ${areaCount} areas exist in this city`));
    }

    const city = await City.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true }
    );
    if (!city) return next(Errors.notFound("City not found"));

    return successResponse(res, {
      message: "City deactivated",
      data: { id: city._id, name: city.name, isActive: city.isActive },
    });
  } catch (err) { next(err) }
};

///////////////////////////////////////////////////////////////
// 📍 AREAS
///////////////////////////////////////////////////////////////

/**
 * GET /api/locations/areas
 */
export const getAreas = async (req, res, next) => {
  try {
    const {
      page       = 1,
      limit      = 20,
      sort       = "name",
      search     = "",
      cityId,
      districtId,
      stateId,
      isActive,
      isServiceable,
    } = req.query;

    const pageNum  = Math.max(parseInt(page,  10), 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip     = (pageNum - 1) * limitNum;
    const sortQ    = AREA_SORT_MAP[sort] || AREA_SORT_MAP.name;

    const filter = {};
    if (search)       filter.name        = { $regex: escapeRegex(search), $options: "i" };
    if (cityId     && isValidId(cityId))       filter.cityRef     = cityId;
    if (districtId && isValidId(districtId))   filter.districtRef = districtId;
    if (stateId    && isValidId(stateId))      filter.stateRef    = stateId;
    if (isActive      !== undefined) filter.isActive      = isActive      === "true";
    if (isServiceable !== undefined) filter.isServiceable = isServiceable === "true";

    // Scope
    if (req.user.adminLevel === "STATE")    filter.stateRef    = req.user.stateRef;
    if (req.user.adminLevel === "DISTRICT") filter.districtRef = req.user.districtRef;

    const [areas, total] = await Promise.all([
      Area.find(filter)
        .populate("cityRef",     "name")
        .populate("districtRef", "name")
        .populate("stateRef",    "name")
        .sort(sortQ)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Area.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Areas fetched",
      data: areas.map(a => ({
        id:            a._id,
        name:          a.name,
        pincode:       a.pincode       ?? null,
        isServiceable: a.isServiceable ?? true,
        city:          { id: a.cityRef?._id,     name: a.cityRef?.name     },
        district:      { id: a.districtRef?._id, name: a.districtRef?.name },
        state:         { id: a.stateRef?._id,    name: a.stateRef?.name    },
        isActive:      a.isActive,
        createdAt:     a.createdAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total/limitNum)||1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/locations/areas/:id
 */
export const getAreaById = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid area ID"));

    const area = await Area.findById(req.params.id)
      .populate("cityRef",     "name")
      .populate("districtRef", "name")
      .populate("stateRef",    "name")
      .lean();
    if (!area) return next(Errors.notFound("Area not found"));

    // Scope check
    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(area.stateRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(area.districtRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }

    return successResponse(res, {
      message: "Area fetched",
      data: {
        id:            area._id,
        name:          area.name,
        pincode:       area.pincode       ?? null,
        isServiceable: area.isServiceable ?? true,
        city:          { id: area.cityRef?._id,     name: area.cityRef?.name     },
        district:      { id: area.districtRef?._id, name: area.districtRef?.name },
        state:         { id: area.stateRef?._id,    name: area.stateRef?.name    },
        isActive:      area.isActive,
        createdAt:     area.createdAt,
        updatedAt:     area.updatedAt,
      },
    });
  } catch (err) { next(err) }
};

/**
 * POST /api/locations/areas
 */
export const createArea = async (req, res, next) => {
  try {
    let { name, cityId, districtId, stateId, pincode, isServiceable } = req.body;

    if (!name || !cityId || !districtId || !stateId) {
      return next(Errors.badRequest("Required fields: name, cityId, districtId, stateId"));
    }
    if (!isValidId(cityId))     return next(Errors.badRequest("Invalid cityId"));
    if (!isValidId(districtId)) return next(Errors.badRequest("Invalid districtId"));
    if (!isValidId(stateId))    return next(Errors.badRequest("Invalid stateId"));

    name = name.trim().replace(/\s+/g, " ");

    // Scope check
    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(stateId)) {
      return next(Errors.forbidden("You can only create areas in your own state"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(districtId)) {
      return next(Errors.forbidden("You can only create areas in your own district"));
    }

    // City exists + active
    const city = await City.findById(cityId).lean();
    if (!city || !city.isActive) return next(Errors.notFound("City not found or inactive"));
    if (String(city.districtRef) !== String(districtId)) {
      return next(Errors.badRequest("City does not belong to this district"));
    }

    // Pincode validation
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return next(Errors.badRequest("Pincode must be exactly 6 digits"));
    }

    // Duplicate check
    const existing = await Area.findOne({
      name:    { $regex: `^${escapeRegex(name)}$`, $options: "i" },
      cityRef: cityId,
    });
    if (existing) return next(Errors.conflict(`Area "${name}" already exists in this city`));

    const area = await Area.create({
      name,
      cityRef:       cityId,
      districtRef:   districtId,
      stateRef:      stateId,
      pincode:       pincode || null,
      isServiceable: isServiceable !== false,
      createdBy:     req.user.id,
      isActive:      true,
    });

    return successResponse(res, {
      message: `Area "${name}" created`,
      data: {
        id:            area._id,
        name:          area.name,
        pincode:       area.pincode,
        isServiceable: area.isServiceable,
        city:          { id: cityId },
        district:      { id: districtId },
        state:         { id: stateId },
        isActive:      area.isActive,
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /api/locations/areas/:id
 */
export const updateArea = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid area ID"));

    const { name, isActive, pincode, isServiceable } = req.body;
    const updates = {};

    if (name !== undefined) {
      const trimmed = name.trim().replace(/\s+/g, " ");
      const area    = await Area.findById(req.params.id).lean();
      if (!area) return next(Errors.notFound("Area not found"));

      // ✅ Fix 4 — Scope authorization in updateArea
      if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(area.stateRef)) {
        return next(Errors.forbidden("You can only update areas in your own state"));
      }
      if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(area.districtRef)) {
        return next(Errors.forbidden("You can only update areas in your own district"));
      }

      const existing = await Area.findOne({
        name:    { $regex: `^${escapeRegex(trimmed)}$`, $options: "i" },
        cityRef: area.cityRef,
        _id:     { $ne: req.params.id },
      });
      if (existing) return next(Errors.conflict(`Area "${trimmed}" already exists in this city`));
      updates.name = trimmed;
    }

    if (pincode !== undefined) {
      if (pincode && !/^\d{6}$/.test(pincode)) {
        return next(Errors.badRequest("Pincode must be exactly 6 digits"));
      }
      updates.pincode = pincode || null;
    }

    if (isServiceable !== undefined) updates.isServiceable = Boolean(isServiceable);
    if (isActive      !== undefined) updates.isActive      = Boolean(isActive);

    const area = await Area.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("cityRef","name").populate("districtRef","name").populate("stateRef","name");

    if (!area) return next(Errors.notFound("Area not found"));

    return successResponse(res, {
      message: "Area updated",
      data: {
        id:            area._id,
        name:          area.name,
        pincode:       area.pincode,
        isServiceable: area.isServiceable,
        city:          { id: area.cityRef?._id,     name: area.cityRef?.name     },
        district:      { id: area.districtRef?._id, name: area.districtRef?.name },
        state:         { id: area.stateRef?._id,    name: area.stateRef?.name    },
        isActive:      area.isActive,
      },
    });
  } catch (err) { next(err) }
};

/**
 * DELETE /api/locations/areas/:id
 * Soft delete
 */
export const deleteArea = async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid area ID"));

    // ✅ Fix 5 — Scope authorization in deleteArea
    const areaToDelete = await Area.findById(req.params.id).lean();
    if (!areaToDelete) return next(Errors.notFound("Area not found"));

    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(areaToDelete.stateRef)) {
      return next(Errors.forbidden("You can only delete areas in your own state"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(areaToDelete.districtRef)) {
      return next(Errors.forbidden("You can only delete areas in your own district"));
    }

    const area = await Area.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true }
    );
    if (!area) return next(Errors.notFound("Area not found"));

    return successResponse(res, {
      message: "Area deactivated",
      data: { id: area._id, name: area.name, isActive: area.isActive },
    });
  } catch (err) { next(err) }
};