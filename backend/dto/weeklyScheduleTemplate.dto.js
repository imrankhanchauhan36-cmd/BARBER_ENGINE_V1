//////////////////////////////////////////////////////////////
// WEEKLY SCHEDULE TEMPLATE — RESPONSE DTO (C4 Phase 1)
//
// Phase 1 deliberately returns raw professionalId/chairId strings,
// not populated {id, name} objects — there is no Salon App UI yet to
// consume display names, and populating 7 weekdays' worth of entry
// refs on every read is unnecessary complexity before it's actually
// needed. Add population in the phase that builds the owner-facing
// screen, mirroring dto/professionalChairAssignment.dto.js's pattern
// at that point — not before.
//////////////////////////////////////////////////////////////

import { WEEKDAYS } from "../constants/weeklyScheduleTemplate.constants.js";

const toIdString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const toEntryDTO = (entry) => ({
  professionalId: toIdString(entry.professionalId),
  chairId:        toIdString(entry.chairId),
  startTime:      entry.startTime,
  endTime:        entry.endTime,
});

export const toTemplateDTO = (template) => {
  if (!template) return null;

  const days = {};
  for (const day of WEEKDAYS) {
    const entries = template.days?.[day]?.entries || [];
    days[day] = { entries: entries.map(toEntryDTO) };
  }

  return {
    id:            toIdString(template._id),
    salonId:       toIdString(template.salonId),
    effectiveFrom: template.effectiveFrom,
    timezone:      template.timezone,
    days,
    status:        template.status,
    createdBy:     toIdString(template.createdBy),
    updatedBy:     toIdString(template.updatedBy),
    createdAt:     template.createdAt,
    updatedAt:     template.updatedAt,
  };
};

export const toTemplateListDTO = (templates = []) => templates.map(toTemplateDTO);
