import Joi from "joi";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES — same conventions as
// validators/professionalChairAssignment.validator.js /
// validators/weeklyScheduleTemplate.validator.js
//////////////////////////////////////////////////////////////

const objectId = Joi.string().hex().length(24);

const dateField = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ "string.pattern.base": "date must be in YYYY-MM-DD format" });

const timeField = Joi.string()
  .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
  .messages({ "string.pattern.base": "must be in HH:mm 24-hour format" });

// "2026-09-09,2026-09-10,..." -> ["2026-09-09", "2026-09-10", ...].
// Kept intentionally simple (no upper bound on count here — the
// service layer only ever does one bounded find() + one
// resolveTemplateForDate() call per date, matching the same per-date
// cost the materializer already accepts for a whole rolling window).
const csvDates = Joi.string()
  .custom((value, helpers) => {
    const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return helpers.error("schedule.datesEmpty");
    for (const part of parts) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return helpers.error("schedule.datesFormat");
    }
    return parts;
  })
  .messages({
    "schedule.datesEmpty":  "dates must contain at least one YYYY-MM-DD value",
    "schedule.datesFormat": "dates must be a comma-separated list of YYYY-MM-DD values",
  });

//////////////////////////////////////////////////////////////
// 🚀 UNIFIED SCHEDULE VALIDATORS
//////////////////////////////////////////////////////////////

export const scheduleSchemas = {

  //////////////////////////////////////////////////////////
  // 1. RESOLVED SCHEDULE (read)
  // GET /api/salon/owner/schedule/resolved?dates=2026-09-09,2026-09-10
  //////////////////////////////////////////////////////////
  resolved: Joi.object({
    dates: csvDates.required().messages({ "any.required": "dates is required" }),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 2. DATE PARAM — shared by edit + restore
  //////////////////////////////////////////////////////////
  dateParam: Joi.object({
    date: dateField.required().messages({ "any.required": "date is required" }),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. EDIT DATE
  // PATCH /api/salon/owner/schedule/date/:date
  //////////////////////////////////////////////////////////
  editDate: Joi.object({
    professionalId: objectId.required().messages({ "any.required": "professionalId is required" }),
    chairId:        objectId.required().messages({ "any.required": "chairId is required" }),
    startTime:      timeField.required().messages({ "any.required": "startTime is required (HH:mm)" }),
    endTime:        timeField.required().messages({ "any.required": "endTime is required (HH:mm)" }),
  })
    .unknown(false)
    .custom((value, helpers) => {
      if (value.startTime >= value.endTime) return helpers.error("schedule.timeRange");
      return value;
    })
    .messages({ "schedule.timeRange": "endTime must be after startTime" }),

  //////////////////////////////////////////////////////////
  // 4. RESTORE DATE TO MASTER
  // POST /api/salon/owner/schedule/date/:date/restore
  //////////////////////////////////////////////////////////
  restoreDate: Joi.object({
    professionalId: objectId.required().messages({ "any.required": "professionalId is required" }),
  }).unknown(false),

};
