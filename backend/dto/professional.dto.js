//////////////////////////////////////////////////////////////
// PROFESSIONAL ENGINE — RESPONSE DTO (Phase 1, backend only)
//
// Shapes what the owner-facing API actually returns — keeps
// Mongoose internals out of the response and gives every endpoint
// one consistent shape. Mirrors dto/chairAvailability.dto.js's
// existing convention (same toIdString helper pattern).
//////////////////////////////////////////////////////////////

const toIdString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

export const toProfessionalDTO = (staff) => {
  if (!staff) return null;

  return {
    id:              toIdString(staff._id),
    salonId:         toIdString(staff.salonId),
    name:            staff.name,
    phone:           staff.phone ?? null,
    role:            staff.role,
    profession:      staff.profession ?? null,
    photo:           staff.photo ?? null,
    experienceYears: staff.experienceYears ?? null,
    languages:       staff.languages ?? [],
    bio:             staff.bio ?? null,
    skills:          (staff.skills || []).map(toIdString),
    isActive:        staff.isActive,
    isOwner:         staff.isOwner,
    createdBy:       toIdString(staff.createdBy),
    updatedBy:       toIdString(staff.updatedBy),
    createdAt:       staff.createdAt,
    updatedAt:       staff.updatedAt,
  };
};

export const toProfessionalListDTO = (staffList = []) => staffList.map(toProfessionalDTO);
