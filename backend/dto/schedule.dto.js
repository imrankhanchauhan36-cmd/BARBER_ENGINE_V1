//////////////////////////////////////////////////////////////
// UNIFIED SCHEDULE — RESPONSE DTO
//
// Raw professionalId/chairId strings, not populated {id, name}
// objects — matches dto/weeklyScheduleTemplate.dto.js's exact
// convention (the Salon App already resolves display names
// client-side from its own separately-fetched professionals/chairs
// lists, e.g. features/schedule/hooks/useWeeklySchedule.js). Never
// exposes `source`, internal ids beyond professional/chair, or any
// other backend-only concept — the owner-facing contract is exactly:
// date, weekday, professional, chair, time, and whether this date
// diverges from the recurring master.
//////////////////////////////////////////////////////////////

const toIdString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const toResolvedEntryDTO = (entry) => ({
  professionalId: toIdString(entry.professionalId),
  chairId:        toIdString(entry.chairId),
  startTime:      entry.startTime,
  endTime:        entry.endTime,
  isOverride:     !!entry.isOverride,
});

export const toResolvedDateDTO = (resolvedDate) => ({
  date:    resolvedDate.date,
  weekday: resolvedDate.weekday,
  entries: (resolvedDate.entries || []).map(toResolvedEntryDTO),
});

export const toResolvedScheduleListDTO = (resolvedDates = []) => resolvedDates.map(toResolvedDateDTO);

// Shared by the edit-date and restore-date write endpoints — same
// shape a single ProfessionalChairAssignment row already exposes via
// dto/professionalChairAssignment.dto.js, kept independent here (not
// imported) since this endpoint's owner-facing contract is
// deliberately narrower and must never grow by accident just because
// the other DTO grows.
export const toScheduleAssignmentDTO = (assignment) => {
  if (!assignment) return null;
  return {
    id:             toIdString(assignment._id),
    professionalId: toIdString(assignment.professionalId),
    chairId:        toIdString(assignment.chairId),
    date:           assignment.date,
    startTime:      assignment.startTime,
    endTime:        assignment.endTime,
  };
};
