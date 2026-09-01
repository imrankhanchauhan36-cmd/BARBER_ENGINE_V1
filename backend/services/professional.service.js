//////////////////////////////////////////////////////////////
// PROFESSIONAL ENGINE — SERVICE (PHASE 1, BACKEND FOUNDATION ONLY)
//
// Owner-facing, safe, incremental CRUD for the generic Professional
// entity (Barber, Stylist, Beautician, Makeup Artist, Nail Artist,
// ...) — built on the EXISTING models/Staff.js collection (see the
// Phase 0 audit decision: exactly 3 existing consumers were traced
// — adminStaff.controller.js, salon.onboarding.controller.js,
// salon.me.controller.js — none of which are affected by these
// purely-additive fields/operations).
//
// Deliberately does NOT reuse salon.onboarding.controller.js's
// saveStaff() — that endpoint replaces a salon's ENTIRE staff array
// destructively (soft-deletes everything not in the submitted list)
// and is only correct for onboarding's "replace the whole draft
// roster" semantics. Every operation here mutates exactly ONE
// Staff document at a time; nothing here ever touches any other
// professional's record.
//
// Out of scope for Phase 1 (do not add here): chairId assignment,
// date/time-window scheduling, Slot Engine integration, Booking
// linkage, rating fields. See the Phase 0/1 decision document.
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Staff from "../models/Staff.js";
import Service from "../models/Service.js";
import { Errors } from "../utils/response.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

// Local, independent copy of the same pattern chairAvailability.service.js
// already uses — salon resolved server-side from the JWT-derived ownerId,
// never trusted from client input. Kept local rather than shared/imported
// to match this codebase's own established convention (see e.g.
// socket/index.js's CLIENT_ORIGIN comment: independent local copies over
// cross-file coupling for small, stable helpers).
const resolveOwnerSalon = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
  if (!salon) throw Errors.notFound("Salon not found");
  return salon;
};

// Confirms every supplied service id both exists and belongs to the
// SAME salon as the professional being created/updated — prevents an
// owner from (accidentally or otherwise) mapping a professional to
// another salon's service.
const assertServicesBelongToSalon = async (salonId, serviceIds = []) => {
  if (!serviceIds.length) return;

  const count = await Service.countDocuments({
    _id:       { $in: serviceIds },
    salonId,
    isDeleted: false,
  });

  if (count !== serviceIds.length) {
    throw Errors.badRequest("One or more skills reference a service that does not belong to this salon.");
  }
};

//////////////////////////////////////////////////////////////
// 🚀 1. CREATE PROFESSIONAL
//////////////////////////////////////////////////////////////

export const createProfessional = async ({ ownerId, payload }) => {
  const salon = await resolveOwnerSalon(ownerId);

  await assertServicesBelongToSalon(salon._id, payload.skills);

  try {
    const staff = await Staff.create({
      salonId:         salon._id,
      name:            payload.name,
      phone:           payload.phone || null,
      role:            payload.role || "BARBER",
      profession:      payload.profession || null,
      photo:           payload.photo || null,
      experienceYears: payload.experienceYears ?? null,
      languages:       payload.languages || [],
      bio:             payload.bio || null,
      skills:          payload.skills || [],
      isActive:        true,
      isOwner:         false,
      createdBy:       ownerId,
      updatedBy:       ownerId,
    });

    return staff.toObject();
  } catch (err) {
    // Duplicate name/phone-per-salon — same unique partial indexes
    // models/Staff.js already enforces for every other write path.
    if (err.code === 11000) {
      throw Errors.conflict("A professional with this name or phone already exists in this salon.");
    }
    throw err;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 2. LIST PROFESSIONALS
//////////////////////////////////////////////////////////////

export const listProfessionals = async ({ ownerId, page = 1, limit = 20, status = "ALL", serviceId = null }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const filter = { salonId: salon._id, isDeleted: false };
  if (status === "ACTIVE")   filter.isActive = true;
  if (status === "INACTIVE") filter.isActive = false;

  // Phase 2 — service eligibility filter (read-only). Validates the
  // service belongs to THIS salon (same guard used by create/update)
  // before using it to filter — never trusts a client-supplied id
  // blindly, even for a read.
  if (serviceId) {
    await assertServicesBelongToSalon(salon._id, [serviceId]);
    filter.skills = serviceId;
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Staff.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Staff.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 },
  };
};

//////////////////////////////////////////////////////////////
// 🚀 3. GET ONE PROFESSIONAL
//////////////////////////////////////////////////////////////

export const getProfessionalById = async ({ ownerId, professionalId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const staff = await Staff.findOne({ _id: professionalId, salonId: salon._id, isDeleted: false }).lean();
  if (!staff) throw Errors.notFound("Professional not found");

  return staff;
};

//////////////////////////////////////////////////////////////
// 🚀 4. UPDATE PROFESSIONAL (partial — profile fields only)
//////////////////////////////////////////////////////////////

export const updateProfessional = async ({ ownerId, professionalId, payload }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const staff = await Staff.findOne({ _id: professionalId, salonId: salon._id, isDeleted: false });
  if (!staff) throw Errors.notFound("Professional not found");

  if (payload.skills) {
    await assertServicesBelongToSalon(salon._id, payload.skills);
  }

  // Only ever touches fields explicitly present in the request —
  // never mass-assigns, never touches chairId/isActive/isOwner
  // (isActive has its own dedicated endpoint, see setProfessionalStatus).
  const editableFields = ["name", "phone", "role", "profession", "photo", "experienceYears", "languages", "bio", "skills"];
  for (const field of editableFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      staff[field] = payload[field];
    }
  }
  staff.updatedBy = ownerId;

  try {
    await staff.save();
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A professional with this name or phone already exists in this salon.");
    }
    throw err;
  }

  return staff.toObject();
};

//////////////////////////////////////////////////////////////
// 🚀 5. SET STATUS (activate / deactivate — never a hard delete)
//////////////////////////////////////////////////////////////

export const setProfessionalStatus = async ({ ownerId, professionalId, isActive, reason }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const staff = await Staff.findOne({ _id: professionalId, salonId: salon._id, isDeleted: false });
  if (!staff) throw Errors.notFound("Professional not found");

  // Idempotent no-op — same pattern chairAvailability.service.js uses
  // for "already in the requested state".
  if (staff.isActive === isActive) {
    return staff.toObject();
  }

  const previousStatus = staff.isActive;

  staff.isActive = isActive;
  staff.updatedBy = ownerId;

  // Reuses the EXISTING statusHistory sub-schema already defined on
  // models/Staff.js (previousStatus/currentStatus/isActive/changedAt/
  // changedBy/adminLevel/reason) — adminLevel is left unset here since
  // this is an owner action, not a platform-admin one; the field is a
  // free String (no enum), so an absent value is valid and unambiguous.
  if (!Array.isArray(staff.statusHistory)) staff.statusHistory = [];
  staff.statusHistory.push({
    previousStatus,
    currentStatus: isActive,
    isActive,
    changedAt:     new Date(),
    changedBy:     ownerId,
    reason:        reason || null,
  });

  await staff.save();
  return staff.toObject();
};
