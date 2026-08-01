import Joi from "joi";

import { CHAIR_AVAILABILITY_TYPE_VALUES } from "../constants/chairAvailability.constants.js";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES
//////////////////////////////////////////////////////////////

/** MongoDB ObjectId — 24-char hex string */
const objectId = Joi.string().hex().length(24);

/** "YYYY-MM-DD" */
const dateField = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be in YYYY-MM-DD format" });

/** "HH:mm" — 24-hour, zero-padded */
const timeField = Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
  .messages({ "string.pattern.base": "must be in HH:mm 24-hour format" });

//////////////////////////////////////////////////////////////
// 🚀 CHAIR AVAILABILITY VALIDATORS
//////////////////////////////////////////////////////////////

export const chairAvailabilitySchemas = {

  //////////////////////////////////////////////////////////
  // 1. CREATE BLOCK
  // POST /api/salon/owner/chairs/availability
  //
  // Example body:
  // {
  //   "chairId":   "64a1b2c3d4e5f6a7b8c9d0e1",
  //   "date":      "2026-08-01",
  //   "startTime": "14:00",
  //   "endTime":   "16:00",
  //   "reason":    "AC repair",
  //   "type":      "MAINTENANCE"
  // }
  //////////////////////////////////////////////////////////
  create: Joi.object({
    chairId: objectId
      .required()
      .messages({ "any.required": "chairId is required" }),

    date: dateField
      .required()
      .messages({ "any.required": "date is required (YYYY-MM-DD)" }),

    startTime: timeField
      .required()
      .messages({ "any.required": "startTime is required (HH:mm)" }),

    endTime: timeField
      .required()
      .messages({ "any.required": "endTime is required (HH:mm)" }),

    reason: Joi.string().trim().max(200).allow("", null),

    type: Joi.string()
      .valid(...CHAIR_AVAILABILITY_TYPE_VALUES)
      .default("MANUAL")
  

  })
    .unknown(false)
    // Cross-field: endTime must be strictly after startTime. Safe as a
    // plain string comparison — both are zero-padded "HH:mm".
    .custom((value, helpers) => {
      if (value.startTime && value.endTime && value.startTime >= value.endTime) {
        return helpers.error("chair.timeRange");
      }
      return value;
    })
    .messages({ "chair.timeRange": "endTime must be after startTime" }),

  //////////////////////////////////////////////////////////
  // 2. LIST BLOCKS
  // GET /api/salon/owner/chairs/availability?date=&chairId=&status=
  //////////////////////////////////////////////////////////
  list: Joi.object({
    date:    dateField,
    chairId: objectId,
    status:  Joi.string().valid("ACTIVE", "CANCELLED", "ALL"),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. BLOCK ID (params) — get / cancel
  //////////////////////////////////////////////////////////
  blockId: Joi.object({
    id: objectId.required().messages({ "any.required": "block id is required" }),
  }).unknown(false),

};
