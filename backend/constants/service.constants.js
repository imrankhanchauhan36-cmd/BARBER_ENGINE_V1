//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — BACKEND
// constants/service.constants.js
// Single source of truth for Service-related enums.
// Used by: models/Service.js (schema enum) and
// controllers/discovery.controller.js (query validation).
// Update here ONLY — never duplicate this list elsewhere.
//////////////////////////////////////////////////////

export const SERVICE_CATEGORIES = [
  "HAIRCUT",
  "BEARD",
  "HAIR_COLOR",
  "HAIR_SPA",
  "FACIAL",
  "CLEANUP",
  "MAKEUP",
  "BRIDAL",
  "PRE_BRIDAL",
  "NAIL_ART",
  "MANICURE",
  "PEDICURE",
  "WAXING",
  "THREADING",
  "MASSAGE",
  "SKIN_TREATMENT",
  "HAIR_TREATMENT",
  "KERATIN",
  "SMOOTHENING",
  "REBONDING",
  "OTHER",
];

export const SERVICE_APPLICABLE_FOR = ["MEN", "WOMEN", "BOTH"];


// Recommended For You — candidate salon cap (geoNear result limit
// before category-matching). Configurable per city-density tier;
// hardcoded default for now, can be made env-driven or Salon-density
// aware later without touching the recommendation query itself.
export const MAX_CANDIDATE_SALONS = 200;

// How many of the user's most-booked categories to use as the
// recommendation signal (see Booking History algorithm).
export const TOP_CATEGORIES_COUNT = 3;

// Only bookings in these statuses count as "genuine interest" for
// recommendation purposes — a CANCELLED/EXPIRED/NO_SHOW booking
// tells us nothing about what the user actually wanted.
export const RECOMMENDATION_ELIGIBLE_BOOKING_STATUSES = ["COMPLETED", "CONFIRMED", "CHECKED_IN", "ONGOING"];