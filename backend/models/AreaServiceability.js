/**
 * BARBER ENGINE V1
 * backend/models/AreaServiceability.js
 *
 * AREA-2.4.1 — Area-level serviceability. Deliberately a SEPARATE model
 * from Area.js (AREA-2.4 audit Option C, hybrid): Area stays pure
 * geography ("where is this place?"); this model answers the
 * independent question "does ZEMISH currently offer service here?".
 * Commercial Territory ("who commercially operates this Area?") and
 * Salon ServiceZone (currently orphaned, unrelated) are both
 * out of scope and untouched by this model.
 *
 * Placed alongside Area/City/State/District/Country (not under
 * modules/fieldAgent/) because every other pure-geography model in
 * this repo lives here, and serviceability is explicitly independent
 * of the Field Agent/Territory domain (AREA-2.4 audit §D, §P).
 *
 * NOT_CONFIGURED is represented by the ABSENCE of a document for a
 * given Area (AREA-2.4 audit §F/§G) — it is not a stored enum value.
 * A document only ever exists once an admin has started configuring
 * serviceability for that Area.
 */

import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 ENUMS
//////////////////////////////////////////////////////////////

export const AREA_SERVICEABILITY_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACTIVE:  "ACTIVE",
  PAUSED:  "PAUSED",
  RETIRED: "RETIRED",
});

// Explicit adjacency map — never inferred, same convention as
// fieldAgent.constants.js's VALID_APPLICATION_TRANSITIONS. RETIRED is
// terminal: RETIRED → ACTIVE is deliberately absent per the explicit
// instruction not to invent a reactivation path without an approved
// business requirement.
export const VALID_SERVICEABILITY_TRANSITIONS = Object.freeze({
  [AREA_SERVICEABILITY_STATUS.PENDING]: [AREA_SERVICEABILITY_STATUS.ACTIVE, AREA_SERVICEABILITY_STATUS.RETIRED],
  [AREA_SERVICEABILITY_STATUS.ACTIVE]:  [AREA_SERVICEABILITY_STATUS.PAUSED, AREA_SERVICEABILITY_STATUS.RETIRED],
  [AREA_SERVICEABILITY_STATUS.PAUSED]:  [AREA_SERVICEABILITY_STATUS.ACTIVE, AREA_SERVICEABILITY_STATUS.RETIRED],
  [AREA_SERVICEABILITY_STATUS.RETIRED]: [],
});

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const AreaServiceabilitySchema = new mongoose.Schema(
  {
    // One serviceability document per Area — the unique index below is
    // the concurrency authority, not the service-layer pre-check.
    areaRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Area",
      required: true,
      unique:   true,
    },

    // Document creation itself represents the NOT_CONFIGURED → PENDING
    // transition; every later change is one of VALID_SERVICEABILITY_TRANSITIONS.
    status: {
      type:    String,
      enum:    Object.values(AREA_SERVICEABILITY_STATUS),
      required: true,
      default: AREA_SERVICEABILITY_STATUS.PENDING,
      index:   true,
    },

    effectiveFrom: {
      type:    Date,
      default: null,
    },

    effectiveUntil: {
      type:    Date,
      default: null,
      validate: {
        validator: function (val) {
          if (!val || !this.effectiveFrom) return true;
          return val > this.effectiveFrom;
        },
        message: "effectiveUntil must be after effectiveFrom",
      },
    },

    // Latest actor only — full WHO/WHEN/OLD/NEW history lives in
    // AdminAuditLog (existing convention), not duplicated here.
    updatedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
    },

    reason: {
      type:      String,
      trim:      true,
      maxlength: 500,
      default:   null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.AreaServiceability ||
  mongoose.model("AreaServiceability", AreaServiceabilitySchema);
