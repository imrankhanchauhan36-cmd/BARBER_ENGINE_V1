///////////////////////////////////////////////////////////
// BOOKING READINESS ENGINE — R2 (OWNER-SCOPED, READ-ONLY HTTP LAYER)
//
// Thin controller only — ALL readiness business logic lives in
// services/bookingReadiness.service.js (R1, frozen, unmodified).
// This file's only responsibilities are: authenticate, resolve the
// caller's OWN salon server-side, validate the date query param, and
// pass both straight into getBookingReadiness() untouched. It never
// computes availability itself.
//
// Same owner-resolution pattern already used by
// controllers/salon.holiday.controller.js and
// controllers/salon.me.controller.js (Salon.findOne({ownerId}) —
// never a client-supplied salonId), and the same strict YYYY-MM-DD
// validation salon.holiday.controller.js already uses — duplicated
// locally rather than importing from that file, matching this
// codebase's own established per-file-duplication convention for
// small, stable primitives (see that file's own identical comment
// about todayIST()).
///////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import { getBookingReadiness } from "../services/bookingReadiness.service.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

///////////////////////////////////////////////////////////
// GET /api/salon/owner/booking-readiness?date=YYYY-MM-DD
///////////////////////////////////////////////////////////

export const getBookingReadinessHandler = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    if (!ownerId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    // date is required — never defaulted here, so the caller always
    // gets an explicit, unambiguous answer for the exact date it asked
    // about (R1 itself would silently default to "today" if omitted,
    // which is the right behavior for a service function but the
    // wrong behavior for an API contract).
    const { date } = req.query;
    if (!date || !DATE_RE.test(date)) {
      return res.status(400).json({ success: false, message: "date must be in YYYY-MM-DD format" });
    }

    // Owner → salon resolution is ENTIRELY server-side. The client
    // never supplies a salonId anywhere in this request (query, body,
    // or params) — there is no code path here that could be
    // influenced into resolving a different owner's salon.
    const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    const readiness = await getBookingReadiness({ salonId: salon._id, date });

    return res.json({
      success: true,
      data: readiness,
    });

  } catch (error) {
    console.error("GET_BOOKING_READINESS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
