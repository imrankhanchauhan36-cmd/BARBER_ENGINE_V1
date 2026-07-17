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