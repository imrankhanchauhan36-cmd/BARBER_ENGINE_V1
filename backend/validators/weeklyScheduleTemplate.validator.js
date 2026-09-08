import Joi from "joi";

import { TEMPLATE_STATUS, WEEKDAYS } from "../constants/weeklyScheduleTemplate.constants.js";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES — same conventions as
// validators/professionalChairAssignment.validator.js
//////////////////////////////////////////////////////////////

const objectId = Joi.string().hex().length(24);

const dateField = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be in YYYY-MM-DD format" });

const timeField = Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
  .messages({ "string.pattern.base": "must be in HH:mm 24-hour format" });

//////////////////////////////////////////////////////////////
// ENTRY — one {professional, chair, time window} row inside a weekday.
// Structural validation only (shape + time ordering). Cross-references
// (professional/chair actually belong to this salon and are active)
// are checked at the service layer, not here — same division of
// responsibility as every other validator in this codebase.
//////////////////////////////////////////////////////////////

const entrySchema = Joi.object({
  professionalId: objectId.required().messages({ "any.required": "professionalId is required" }),
  chairId:        objectId.required().messages({ "any.required": "chairId is required" }),
  startTime:      timeField.required().messages({ "any.required": "startTime is required (HH:mm)" }),
  endTime:        timeField.required().messages({ "any.required": "endTime is required (HH:mm)" }),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (value.startTime >= value.endTime) return helpers.error("entry.timeRange");
    return value;
  })
  .messages({ "entry.timeRange": "endTime must be after startTime" });

const daySchema = Joi.object({
  entries: Joi.array().items(entrySchema).default([]),
}).unknown(false);

// Every key must be one of the 7 lowercase weekday names — anything
// else (a typo, "Monday" capitalized, "mon") is rejected outright by
// .unknown(false) rather than silently ignored.
const fullDaysSchema = Joi.object(
  Object.fromEntries(WEEKDAYS.map((day) => [day, daySchema]))
).unknown(false);

const partialDaysSchema = Joi.object(
  Object.fromEntries(WEEKDAYS.map((day) => [day, daySchema]))
)
  .unknown(false)
  .min(1)
  .messages({ "object.min": "Provide at least one weekday to update" });

//////////////////////////////////////////////////////////////
// 🚀 WEEKLY SCHEDULE TEMPLATE VALIDATORS (C4 Phase 1)
//////////////////////////////////////////////////////////////

export const weeklyScheduleTemplateSchemas = {

  //////////////////////////////////////////////////////////
  // 1. CREATE
  // POST /api/salon/owner/weekly-schedule-templates
  //
  // `days` is optional and every weekday within it is optional — an
  // all-empty template (every weekday with zero entries) is valid
  // (e.g. the owner wants to set up the effective date first and fill
  // in days later via update).
  //////////////////////////////////////////////////////////
  create: Joi.object({
    effectiveFrom: dateField.required().messages({ "any.required": "effectiveFrom is required (YYYY-MM-DD)" }),
    days:          fullDaysSchema,
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 2. LIST
  // GET /api/salon/owner/weekly-schedule-templates
  //////////////////////////////////////////////////////////
  list: Joi.object({
    status: Joi.string().valid(TEMPLATE_STATUS.ACTIVE, TEMPLATE_STATUS.CANCELLED, "ALL").default(TEMPLATE_STATUS.ACTIVE),
    page:   Joi.number().integer().min(1).default(1),
    limit:  Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. TEMPLATE ID (params) — get / update / cancel
  //////////////////////////////////////////////////////////
  templateId: Joi.object({
    id: objectId.required().messages({ "any.required": "template id is required" }),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 4. UPDATE — content only (one or more weekdays' entries).
  // `effectiveFrom` is deliberately NOT editable here — changing a
  // version's effective date is a distinct, riskier operation (could
  // collide with another version or change which dates it covers);
  // create a new version instead. Only ever allowed by the service
  // when the version has not yet become effective — see NOTE 3 in the
  // model file.
  // PATCH /api/salon/owner/weekly-schedule-templates/:id
  //////////////////////////////////////////////////////////
  update: Joi.object({
    days: partialDaysSchema.required(),
  }).unknown(false),

};
