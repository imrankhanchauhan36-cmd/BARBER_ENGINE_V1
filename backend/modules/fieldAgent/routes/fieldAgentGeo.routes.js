/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/fieldAgentGeo.routes.js
 *
 * PUBLIC, read-only geo reference route — GET /api/field-agent/geo/states.
 * No protect/onboardingBypass, same reasoning as fieldAgentAuth.routes.js:
 * must be callable before an applicant has any session at all (the
 * Application Profile step happens right after apply-OTP verify), and
 * is equally safe for an already-authenticated FIELD_AGENT applicant
 * to call — it returns the same non-sensitive, read-only reference
 * data either way. Rate-limited per-IP the same shape as the OTP
 * routes in fieldAgentAuth.routes.js, since it is unauthenticated.
 *
 * No new schema, no write operation, no modification to any existing
 * State/District/City/Area route or model.
 *
 * Phase 1 — Territory Engine: added /districts, /cities, /areas —
 * same public/rate-limited/read-only shape as /states. Each requires
 * its parent ref as a query param (stateRef/districtRef/cityRef),
 * enforced in the controller. Pincode is intentionally not exposed.
 */

import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  getFieldAgentGeoStates,
  getFieldAgentGeoDistricts,
  getFieldAgentGeoCities,
  getFieldAgentGeoAreas,
} from "../controllers/fieldAgentGeo.controller.js";

const router = express.Router();

const fieldAgentGeoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => `field_agent_geo_${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/states", fieldAgentGeoLimiter, getFieldAgentGeoStates);
router.get("/districts", fieldAgentGeoLimiter, getFieldAgentGeoDistricts);
router.get("/cities", fieldAgentGeoLimiter, getFieldAgentGeoCities);
router.get("/areas", fieldAgentGeoLimiter, getFieldAgentGeoAreas);

export default router;
