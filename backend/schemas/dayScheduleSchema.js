/**
 * BARBER ENGINE V1
 * backend/schemas/dayScheduleSchema.js
 *
 * Phase F.1 — TimeRangeSchema/DayScheduleSchema extracted verbatim
 * from backend/models/Salon.js (identical field shapes, identical
 * regexes, identical pre-validate rules — not redesigned) so other
 * modules can reuse the exact shape instead of duplicating it.
 * Salon.js itself is untouched and keeps its own inline copies; this
 * extraction changes nothing about Salon's behavior.
 *
 * Not yet consumed by anything in the Support module — Queue/Team/
 * SupportAgentProfile's `businessHoursRef` fields (Phase F.1) are
 * plain placeholder ObjectIds, not an embedding of this schema. This
 * file exists as a ready-to-reuse building block for whenever a real
 * business-hours consumer is implemented.
 */

import mongoose from "mongoose";

export const TimeRangeSchema = new mongoose.Schema(
  {
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
  },
  { _id: false }
);

export const DayScheduleSchema = new mongoose.Schema(
  {
    open: { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    close: { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    isClosed: { type: Boolean, default: false },
    // "true" means an all-day-open day — open/close still stay the
    // single source of truth for any consumer (mirrors Salon.js's own
    // convention); this flag only tells a UI which input mode to render.
    isOpen24Hours: { type: Boolean, default: false },
    breaks: { type: [TimeRangeSchema], default: [] },
  },
  { _id: false }
);

DayScheduleSchema.pre("validate", function (next) {
  if (!this.isClosed) {
    if (!this.open || !this.close) return next(new Error("Open and close time required"));
    // "00:00" as a close time means "closes at midnight" (end of day),
    // not start-of-day — treat it as the latest possible boundary so a
    // normal late-closing schedule (e.g. 18:00-00:00) can be saved.
    // "24:00" sorts after every valid "HH:MM" string, so the plain
    // string comparisons below still work unchanged.
    const effectiveClose = this.close === "00:00" ? "24:00" : this.close;
    if (this.open >= effectiveClose) return next(new Error("Open time must be before close time"));
    for (const b of this.breaks) {
      if (b.start >= b.end) return next(new Error("Invalid break time"));
      if (b.start < this.open || b.end > effectiveClose) return next(new Error("Break must be within working hours"));
    }
  }
  next();
});
