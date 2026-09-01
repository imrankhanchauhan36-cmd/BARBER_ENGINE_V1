import Joi from "joi";

import { ASSIGNMENT_STATUS, MAX_ASSIGNMENT_RANGE_DAYS } from "../constants/professionalChairAssignment.constants.js";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES — same conventions as
// validators/chairAvailability.validator.js
//////////////////////////////////////////////////////////////

const objectId = Joi.string().hex().length(24);

const dateField = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be in YYYY-MM-DD format" });

const timeField = Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
  .messages({ "string.pattern.base": "must be in HH:mm 24-hour format" });

//////////////////////////////////////////////////////////////
// 🚀 PROFESSIONAL ↔ CHAIR ASSIGNMENT VALIDATORS (Phase 3)
//////////////////////////////////////////////////////////////

export const professionalChairAssignmentSchemas = {

  //////////////////////////////////////////////////////////
  // 1. CREATE — single date OR a date range (multi-day
  // convenience). Never both, never neither.
  //
  // Single-day:
  //   { chairId, professionalId, date, startTime, endTime }
  // Range (owner convenience — generates one concrete row per date,
  // no recurrence rule):
  //   { chairId, professionalId, startDate, endDate, startTime, endTime }
  //////////////////////////////////////////////////////////
  create: Joi.object({
    chairId:        objectId.required().messages({ "any.required": "chairId is required" }),
    professionalId: objectId.required().messages({ "any.required": "professionalId is required" }),

    date:      dateField,
    startDate: dateField,
    endDate:   dateField,

    startTime: timeField.required().messages({ "any.required": "startTime is required (HH:mm)" }),
    endTime:   timeField.required().messages({ "any.required": "endTime is required (HH:mm)" }),
  })
    .unknown(false)
    .xor("date", "startDate")
    .with("startDate", "endDate")
    .with("endDate", "startDate")
    .messages({
      "object.xor":      "Provide either date (single day) or startDate+endDate (range), not both",
      "object.missing":  "Provide either date (single day) or startDate+endDate (range)",
    })
    .custom((value, helpers) => {
      if (value.startTime && value.endTime && value.startTime >= value.endTime) {
        return helpers.error("assignment.timeRange");
      }
      if (value.startDate && value.endDate) {
        if (value.startDate > value.endDate) {
          return helpers.error("assignment.dateRange");
        }
        const spanDays = (new Date(`${value.endDate}T00:00:00Z`) - new Date(`${value.startDate}T00:00:00Z`)) / 86400000 + 1;
        if (spanDays > MAX_ASSIGNMENT_RANGE_DAYS) {
          return helpers.error("assignment.rangeTooLong");
        }
      }
      return value;
    })
    .messages({
      "assignment.timeRange":    "endTime must be after startTime",
      "assignment.dateRange":    "endDate cannot be before startDate",
      "assignment.rangeTooLong": `date range cannot exceed ${MAX_ASSIGNMENT_RANGE_DAYS} days`,
    }),

  //////////////////////////////////////////////////////////
  // 2. LIST
  // GET /api/salon/owner/professional-chair-assignments
  //////////////////////////////////////////////////////////
  list: Joi.object({
    date:           dateField,
    chairId:        objectId,
    professionalId: objectId,
    status:         Joi.string().valid(ASSIGNMENT_STATUS.ACTIVE, ASSIGNMENT_STATUS.CANCELLED, "ALL").default(ASSIGNMENT_STATUS.ACTIVE),
    page:           Joi.number().integer().min(1).default(1),
    limit:          Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. ASSIGNMENT ID (params) — get / update / status
  //////////////////////////////////////////////////////////
  assignmentId: Joi.object({
    id: objectId.required().messages({ "any.required": "assignment id is required" }),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 4. UPDATE — reassignment (chair/date/time only, never status;
  // status changes go through the dedicated /status endpoint).
  // PATCH /api/salon/owner/professional-chair-assignments/:id
  //////////////////////////////////////////////////////////
  update: Joi.object({
    chairId:   objectId,
    date:      dateField,
    startTime: timeField,
    endTime:   timeField,
  })
    .unknown(false)
    .min(1)
    .messages({ "object.min": "At least one field is required to update" })
    .custom((value, helpers) => {
      if (value.startTime && value.endTime && value.startTime >= value.endTime) {
        return helpers.error("assignment.timeRange");
      }
      return value;
    })
    .messages({ "assignment.timeRange": "endTime must be after startTime" }),

};
