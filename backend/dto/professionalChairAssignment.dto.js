//////////////////////////////////////////////////////////////
// PROFESSIONAL ↔ CHAIR ASSIGNMENT ENGINE — RESPONSE DTO (Phase 3)
//
// Mirrors dto/chairAvailability.dto.js's exact convention — keeps
// Mongoose internals out of the owner-facing response, handles a
// ref field whether it arrived raw or populated.
//////////////////////////////////////////////////////////////

const toIdString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const populatedOr = (value, extraFields = {}) => {
  const isPopulated = value && typeof value === "object" && "name" in value;
  return {
    id: toIdString(value),
    ...(isPopulated
      ? Object.fromEntries(Object.keys(extraFields).map((k) => [k, value[k] ?? null]))
      : Object.fromEntries(Object.keys(extraFields).map((k) => [k, null]))),
  };
};

export const toAssignmentDTO = (assignment) => {
  if (!assignment) return null;

  return {
    id:             toIdString(assignment._id),
    salonId:        toIdString(assignment.salonId),
    chair:          populatedOr(assignment.chairId, { name: null, position: null }),
    professional:   populatedOr(assignment.professionalId, { name: null, profession: null }),
    date:           assignment.date,
    startTime:      assignment.startTime,
    endTime:        assignment.endTime,
    status:         assignment.status,
    createdBy:      toIdString(assignment.createdBy),
    updatedBy:      toIdString(assignment.updatedBy),
    createdAt:      assignment.createdAt,
    updatedAt:      assignment.updatedAt,
  };
};

export const toAssignmentListDTO = (assignments = []) => assignments.map(toAssignmentDTO);
