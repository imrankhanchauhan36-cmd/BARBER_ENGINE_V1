/**
 * BARBER ENGINE V1
 * backend/validators/adminFinancePolicy.validator.js
 *
 * PAN-India GST + Area Platform Fee admin authoring validation. Same
 * conventions as
 * modules/fieldAgent/validators/adminCommercialPolicy.validator.js:
 * shared `objectId` primitive, `.unknown(false)`, explicit
 * `.forbidden()` on every server-controlled field so this project's
 * `stripUnknown:true` Joi config can't silently swallow a client's
 * attempt to inject one.
 */

import Joi from "joi";
import { PLATFORM_FEE_SCOPE, PLATFORM_FEE_CALCULATION_TYPE } from "../models/AreaPlatformFeePolicy.js";

const objectId = Joi.string().hex().length(24);

// Pricing Engine Expansion — a single slab's shape. Backend remains
// authoritative (full overlap/gap/boundary validation happens in
// areaPlatformFee.service.js#validateGlobalFeeConfig); this Joi layer
// only enforces the basic per-item shape/types so a malformed item
// never even reaches that logic. maxAmountInPaise is `.required()`
// but `.allow(null)` — the client must say EXPLICITLY null (unlimited)
// rather than omitting the field, so "omitted" can never be confused
// with "unlimited".
const slabItemSchema = Joi.object({
  minAmountInPaise: Joi.number().integer().min(0).required(),
  maxAmountInPaise: Joi.number().integer().min(0).allow(null).required(),
  feeInPaise: Joi.number().integer().min(0).required(),
}).unknown(false);

const forbiddenServerControlledFields = {
  status: Joi.any().forbidden(),
  createdBy: Joi.any().forbidden(),
  publishedBy: Joi.any().forbidden(),
  retiredBy: Joi.any().forbidden(),
  publishedAt: Joi.any().forbidden(),
  retiredAt: Joi.any().forbidden(),
};

// SALON GST LAUNCH PHASE (2026-10): two rates, both required on every
// write — no default, no single-rate fallback, matching
// GstPolicyVersion.js's own header rationale.
//
// PLATFORM-FEE GST FOUNDATION (additive, 2026-10-12): platformFeeGstRatePercent
// is `.optional()` — deliberately NOT `.required()` — so every existing
// create/update request for the two service-GST rates alone continues
// to validate exactly as before. `.allow(null)` lets an update
// explicitly clear a previously-set value back to "not configured".
export const gstPolicySchemas = {
  createDraft: Joi.object({
    registeredRatePercent: Joi.number().min(0).max(100).required(),
    unregisteredRatePercent: Joi.number().min(0).max(100).required(),
    platformFeeGstRatePercent: Joi.number().min(0).max(100).allow(null).optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  updateDraft: Joi.object({
    registeredRatePercent: Joi.number().min(0).max(100).required(),
    unregisteredRatePercent: Joi.number().min(0).max(100).required(),
    platformFeeGstRatePercent: Joi.number().min(0).max(100).allow(null).optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  versionIdParam: Joi.object({ versionId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};

export const areaPlatformFeeSchemas = {
  // LAUNCH-PHASE SCOPE ADDITION (2026-10 — "Global Platform Fee"):
  // `scope` is now required; `areaRef` is conditionally
  // required/forbidden by scope — same idiom as
  // modules/fieldAgent/validators/adminCommercialPolicy.validator.js's
  // own scopeType-conditional fields. updateDraft is intentionally
  // unchanged: scope/areaRef are immutable after creation (a draft's
  // scope can't be edited — delete and recreate instead), and
  // `.unknown(false)` already rejects both there.
  // Pricing Engine Expansion (2026-10 — GLOBAL scope only): `calculationType`
  // is required for scope:"GLOBAL", forbidden for scope:"AREA" (AREA
  // keeps its pre-existing flat feeInPaise-only shape, untouched).
  // feeInPaise/percentageRate/slabs are then each conditionally
  // required/forbidden by calculationType — same nested `.when()`
  // idiom as areaRef above. Mirrors
  // modules/fieldAgent/validators/adminCommercialPolicy.validator.js's
  // own scopeType-conditional-field convention.
  createDraft: Joi.object({
    scope: Joi.string().valid(...Object.values(PLATFORM_FEE_SCOPE)).required(),
    areaRef: Joi.when("scope", {
      is: PLATFORM_FEE_SCOPE.AREA,
      then: objectId.required(),
      otherwise: Joi.any().forbidden(),
    }),
    calculationType: Joi.when("scope", {
      is: PLATFORM_FEE_SCOPE.GLOBAL,
      then: Joi.string().valid(...Object.values(PLATFORM_FEE_CALCULATION_TYPE)).required(),
      otherwise: Joi.any().forbidden(),
    }),
    feeInPaise: Joi.when("scope", {
      is: PLATFORM_FEE_SCOPE.AREA,
      then: Joi.number().integer().min(0).required(),
      otherwise: Joi.when("calculationType", {
        is: PLATFORM_FEE_CALCULATION_TYPE.FIXED,
        then: Joi.number().integer().min(0).required(),
        otherwise: Joi.any().forbidden(),
      }),
    }),
    percentageRate: Joi.when("calculationType", {
      is: PLATFORM_FEE_CALCULATION_TYPE.PERCENTAGE,
      then: Joi.number().min(0).max(100).required(),
      otherwise: Joi.any().forbidden(),
    }),
    slabs: Joi.when("calculationType", {
      is: PLATFORM_FEE_CALCULATION_TYPE.SLAB,
      then: Joi.array().items(slabItemSchema).min(1).required(),
      otherwise: Joi.any().forbidden(),
    }),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  // updateDraft intentionally omits `scope`/`areaRef` (immutable after
  // creation, `.unknown(false)` already rejects both). `calculationType`
  // is optional here (omitting it keeps the draft's existing type —
  // enforced in updateDraftAreaPlatformFee) but every field is still
  // validated for shape when present; cross-field "does this field
  // make sense for THIS draft's scope/type" enforcement is pushed to
  // the service layer, which already knows the existing document's
  // scope (AREA-2.4.1 lesson precedent — see model file header).
  updateDraft: Joi.object({
    feeInPaise: Joi.number().integer().min(0).optional(),
    calculationType: Joi.string().valid(...Object.values(PLATFORM_FEE_CALCULATION_TYPE)).optional(),
    percentageRate: Joi.number().min(0).max(100).optional(),
    slabs: Joi.array().items(slabItemSchema).min(1).optional(),
    ...forbiddenServerControlledFields,
  }).unknown(false),

  policyIdParam: Joi.object({ policyId: objectId.required() }).unknown(false),

  listQuery: Joi.object({
    areaRef: objectId.optional(),
    scope: Joi.string().valid(...Object.values(PLATFORM_FEE_SCOPE)).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false),
};
