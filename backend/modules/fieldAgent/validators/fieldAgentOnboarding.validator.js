/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/validators/fieldAgentOnboarding.validator.js
 *
 * PHASE 2B — Field Agent salonId-scoped onboarding step-write
 * validators. The real Owner onboarding engine
 * (controllers/salon.onboarding.controller.js) has NO dedicated Joi
 * validator file at all — every one of its 10 functions validates
 * inline/manually (confirmed by direct file search during the Phase
 * 2B audit). These schemas do not invent new rules; they mirror the
 * exact field names and the coarse shape-level checks (required
 * arrays, numeric lat/lng, etc.) that controller already performs at
 * the top of each function — the controller's own deeper business
 * validation (duplicate names, chair/service cross-ownership, buffer
 * ranges, time-overlap math, …) is NOT re-implemented here; it is
 * reused verbatim inside fieldAgentOnboarding.service.js, exactly as
 * the audit required ("Do NOT invent new validation rules... mirror
 * the actual existing request contracts").
 *
 * Every schema is `.unknown(false)` and explicitly `.forbidden()`s
 * every identity field — salonId/ownerId/fieldAgentRef are NEVER
 * client-suppliable in a body; salonId always comes from the route
 * param (validated separately below), ownerId is always derived
 * server-side from the resolved Salon document.
 */

import Joi from "joi";

const objectId = Joi.string().hex().length(24);

const forbiddenIdentity = {
  salonId: Joi.any().forbidden(),
  ownerId: Joi.any().forbidden(),
  fieldAgentId: Joi.any().forbidden(),
  fieldAgentRef: Joi.any().forbidden(),
};

export const fieldAgentOnboardingSchemas = {
  salonIdParam: Joi.object({ salonId: objectId.required() }).unknown(false),

  // STEP 1 — mirrors saveBasicInfo's own destructured field list
  // exactly (controllers/salon.onboarding.controller.js:32-47).
  basicInfoBody: Joi.object({
    shopName: Joi.string().trim().required(),
    category: Joi.string().trim().required(),
    tagline: Joi.string().trim().allow(null, "").optional(),
    since: Joi.alternatives(Joi.string(), Joi.number(), Joi.valid(null)).optional(),
    amenities: Joi.object({
      hasAC: Joi.boolean().optional(),
      hasParking: Joi.boolean().optional(),
      hasWifi: Joi.boolean().optional(),
      waitingArea: Joi.boolean().optional(),
      restroom: Joi.boolean().optional(),
    }).optional(),
    tier: Joi.string().optional(),
    setupType: Joi.string().optional(),
    specializations: Joi.array().items(Joi.string()).optional(),
    capabilities: Joi.array().items(Joi.string()).optional(),
    privacySetup: Joi.string().optional(),
    whatsapp: Joi.string().allow(null, "").optional(),
    brandName: Joi.string().allow(null, "").optional(),
    branchCode: Joi.string().allow(null, "").optional(),
    experience: Joi.alternatives(Joi.string(), Joi.number(), Joi.valid(null)).optional(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 2 — mirrors saveLocation's own {address,lat,lng} body
  // (controller:180) and its own numeric-range check (controller:186-201).
  locationBody: Joi.object({
    address: Joi.string().trim().allow(null, "").optional(),
    lat: Joi.alternatives(Joi.number(), Joi.string()).required(),
    lng: Joi.alternatives(Joi.number(), Joi.string()).required(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 3 — mirrors saveServices' {services:[...]} body. Per-item
  // deep validation (price/duration/buffer/grace-field ranges) is left
  // to the service layer, verbatim from the controller — this schema
  // only enforces the coarse "non-empty array of objects" shape the
  // controller itself requires before doing anything else (controller:360).
  servicesBody: Joi.object({
    services: Joi.array().items(Joi.object().unknown(true)).min(1).required(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 4 — mirrors saveChairs' {chairCount} body + its own 1-50 range
  // check (controller:723-729).
  chairsBody: Joi.object({
    chairCount: Joi.number().integer().min(1).max(50).required(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 5 — mirrors saveTimings' {timings} body (controller:887,895-900).
  // Per-day open/close/break validation is left to the service layer,
  // verbatim from the controller's own toMinutes()-based logic.
  timingsBody: Joi.object({
    timings: Joi.object().unknown(true).required(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 6 — mirrors saveStaff's {staff:[...], isOwnerOnly} body
  // (controller:1099).
  staffBody: Joi.object({
    staff: Joi.array().items(Joi.object().unknown(true)).optional(),
    isOwnerOnly: Joi.boolean().optional(),
    ...forbiddenIdentity,
  }).unknown(false),

  // STEP 7 — mirrors savePhotos' {photos:[...]} body + its own
  // 1-20 length check (controller:1386-1391).
  photosBody: Joi.object({
    photos: Joi.array().items(Joi.object().unknown(true)).min(1).max(20).required(),
    ...forbiddenIdentity,
  }).unknown(false),

  // review / submit / resubmit take no body — salonId (param) is the
  // only input, already validated by salonIdParam above.
};
